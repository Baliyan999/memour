#!/usr/bin/env bash
# Server half of scripts/deploy.sh. Runs ON the server as the ssh user;
# deploy.sh uploads it next to the git bundle and starts it. It can also
# be run by hand on the server for status, preflight and rollback.
#
#   deploy-remote.sh status                 human-readable state
#   deploy-remote.sh info                   the same, key=value (for deploy.sh)
#   deploy-remote.sh preflight              read-only checks (deploy --dry-run)
#   deploy-remote.sh deploy --bundle FILE --sha SHA [--ref NAME] [--by WHO]
#   deploy-remote.sh rollback               back to the newest APP_DIR-prev-*
#
# Layout, for APP_DIR=/var/www/memour (docs/DEPLOY.md §6):
#   /var/www/memour                  live release: git checkout + .output + .env,
#                                    the unit's WorkingDirectory
#   /var/www/memour-next             release being built
#   /var/www/memour-prev-<sha>       previous releases (newest KEEP_RELEASES kept)
#   /var/www/memour-failed-<sha>-<t> taken out by a failed deploy or a rollback
#   /var/www/memour-env-backups/     a copy of .env before every swap
#   /var/www/memour-deploy.log       what every deploy and rollback did
#
# Exit codes: 0 ok · 1 failed, the live release was not touched · 2 usage ·
# 4 failed after the swap, the previous release is back and healthy ·
# 5 failed and could not restore a healthy release: the site may be down.
#
# Settings come from the environment (deploy.sh passes them); the
# commands are injectable so the whole thing runs against a temp
# directory with a stub systemctl.
set -euo pipefail

APP_DIR=${APP_DIR:-/var/www/memour}
SERVICE=${SERVICE:-memour}
APP_PORT=${APP_PORT:-3300}            # NITRO_PORT of the unit
TRIAL_PORT=${TRIAL_PORT:-3399}
KEEP_RELEASES=${KEEP_RELEASES:-2}
KEEP_FAILED=${KEEP_FAILED:-1}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-60}  # seconds for /api/health to answer
MIN_FREE_MB=${MIN_FREE_MB:-1500}      # a release with node_modules is ~0.5 GB
SERVICE_LOG=${SERVICE_LOG:-/var/log/$SERVICE.log}
UNIT_FILE=${UNIT_FILE:-/etc/systemd/system/$SERVICE.service}
# nuxt.config.ts → nitro.scheduledTasks (server time). No deploy from
# 2 minutes before to 10 minutes after: the trial process would run the
# task a second time, and a stop would cut off the live one.
TASK_TIMES=${TASK_TIMES:-03:00 05:00}

if [ "$(id -u)" = 0 ]; then _systemctl_default=systemctl; else _systemctl_default="sudo -n systemctl"; fi
read -r -a SYSTEMCTL_CMD <<< "${SYSTEMCTL:-$_systemctl_default}"
read -r -a NODE_CMD <<< "${NODE:-node}"
read -r -a PNPM_CMD <<< "${PNPM:-pnpm}"
read -r -a CURL_CMD <<< "${CURL:-curl}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NUXT_TELEMETRY_DISABLED=1

case $APP_DIR in
  *[[:space:]]* | */ | *//*) echo "!! APP_DIR must be a plain absolute path like /var/www/memour (got '$APP_DIR')" >&2; exit 2 ;;
  /?*/?*) ;;
  *) echo "!! APP_DIR must be an absolute path at least two levels deep, like /var/www/memour (got '$APP_DIR')" >&2; exit 2 ;;
esac

NEXT="$APP_DIR-next"
PREV_PREFIX="$APP_DIR-prev-"
FAILED_PREFIX="$APP_DIR-failed-"
ENV_BACKUPS="$APP_DIR-env-backups"
LOCK_DIR="$APP_DIR-deploy.lock"
LOG_FILE="$APP_DIR-deploy.log"
APP_NAME=${APP_DIR##*/}

LOGGING=""      # set once a deploy/rollback holds the lock
HAVE_LOCK=""
TRIAL_PID=""

# ---------------------------------------------------------------- output
# Every line goes to stdout and, during a deploy, to LOG_FILE. Writes to
# stdout fail once the ssh connection is gone; the run carries on. They
# happen in a subshell: a failed write stays in bash's output buffer and
# would otherwise land in the next file a builtin writes to.
log_line() {
  (printf '%s\n' "$1") 2>/dev/null || true
  if [ -n "$LOGGING" ]; then printf '%s %s\n' "$(date -u +%FT%TZ)" "$1" >>"$LOG_FILE" 2>/dev/null || true; fi
}
step() { log_line "==> $*"; }
info() { log_line "    $*"; }
warn() { log_line "  ! $*"; }
die()  { local code=$1; shift; log_line "!! $*"; exit "$code"; }

short() { printf '%s' "${1:0:12}"; }
stamp() { date -u +%Y%m%d-%H%M%S; }

# ---------------------------------------------------------------- helpers
mtime_of() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; }
perms_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
fmt_epoch() { date -u -d "@$1" '+%Y-%m-%d %H:%M UTC' 2>/dev/null || date -u -r "$1" '+%Y-%m-%d %H:%M UTC'; }

is_release() { [ -f "$1/.output/server/index.mjs" ]; }

# Commit of a release dir: .release (written by this script), else git.
release_sha() {
  local d=$1 s=""
  if [ -f "$d/.release" ]; then s=$(sed -n 's/^sha=//p' "$d/.release" | head -n 1); fi
  if [ -z "$s" ] && [ -e "$d/.git" ]; then s=$(git -C "$d" rev-parse --verify --quiet HEAD 2>/dev/null || true); fi
  printf '%s' "$s"
}

# absent | release | envonly (first deploy: only .env) | empty | other
app_state() {
  if [ ! -e "$APP_DIR" ]; then echo absent
  elif is_release "$APP_DIR"; then echo release
  else
    local entries
    entries=$(ls -A "$APP_DIR")
    if [ -z "$entries" ]; then echo empty
    elif [ "$entries" = ".env" ]; then echo envonly
    else echo other
    fi
  fi
}

# Sort key for prev/failed dirs: the time they were retired, else mtime.
retired_at() {
  local d=$1 t=""
  if [ -f "$d/.retired" ]; then t=$(head -n 1 "$d/.retired" 2>/dev/null || true); fi
  case $t in '' | *[!0-9]*) t=$(mtime_of "$d") ;; esac
  printf '%s' "$t"
}

# Dirs with this prefix, newest first.
list_dirs() {
  local prefix=$1 d
  for d in "$prefix"*; do
    [ -d "$d" ] || continue
    printf '%s %s\n' "$(retired_at "$d")" "$d"
  done | sort -rn | cut -d' ' -f2-
}

newest_release() {
  local d
  while IFS= read -r d; do
    if is_release "$d"; then printf '%s' "$d"; return 0; fi
  done < <(list_dirs "$1")
  return 0
}

unique_name() {
  local n=$1
  if [ -e "$n" ]; then n="$n-$(stamp)"; fi
  printf '%s' "$n"
}

# rm -rf, but only for our own sibling dirs.
remove_dir() {
  local d=$1
  case $d in
    "$NEXT" | "$PREV_PREFIX"?* | "$FAILED_PREFIX"?*) ;;
    *) die 1 "refusing to delete '$d': not a release dir of $APP_DIR" ;;
  esac
  [ -d "$d" ] && rm -rf -- "$d"
  return 0
}

prune() {
  local prefix=$1 keep=$2 d n=0
  while IFS= read -r d; do
    n=$((n + 1))
    if [ "$n" -gt "$keep" ]; then
      remove_dir "$d"
      info "deleted ${d##*/}"
    fi
  done < <(list_dirs "$prefix")
}

svc() { "${SYSTEMCTL_CMD[@]}" "$@" "$SERVICE"; }
svc_state() { svc is-active 2>/dev/null || true; }

http_code() {
  local c
  c=$("${CURL_CMD[@]}" -s -o /dev/null -w '%{http_code}' --max-time "${2:-10}" "$1" 2>/dev/null) || true
  printf '%s' "${c:-000}"
}

port_answers() { [ "$(http_code "http://127.0.0.1:$1/" 3)" != 000 ]; }

wait_port_free() {
  local port=$1 i=0
  while port_answers "$port"; do
    i=$((i + 1))
    [ "$i" -ge "${2:-20}" ] && return 1
    sleep 1
  done
  return 0
}

# Wait for /api/health, then require /api/health?deep=1 and /uz to be 200.
# $2: pid of the process that must be the one answering (trial), or "".
health_ok() {
  local port=$1 pid=$2 base="http://127.0.0.1:$1" code deep uz start
  start=$(date +%s)
  while :; do
    code=$(http_code "$base/api/health" 5)
    [ "$code" = 200 ] && break
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      warn "the process exited before /api/health answered"
      return 1
    fi
    if [ -z "$pid" ] && [ "$(svc_state)" = failed ]; then
      warn "$SERVICE is in state 'failed'"
      return 1
    fi
    if [ $(($(date +%s) - start)) -ge "$HEALTH_TIMEOUT" ]; then
      warn "/api/health did not answer 200 within ${HEALTH_TIMEOUT}s (last: $code)"
      return 1
    fi
    sleep 1
  done
  deep=$(http_code "$base/api/health?deep=1" 15)
  uz=$(http_code "$base/uz" 30)
  info "/api/health 200 · /api/health?deep=1 $deep · /uz $uz  ($(($(date +%s) - start))s)"
  if [ "$deep" != 200 ]; then warn "deep health $deep: Supabase unreachable from the server, or the service key is wrong"; fi
  [ "$deep" = 200 ] && [ "$uz" = 200 ]
}

service_log_tail() {
  if [ -r "$SERVICE_LOG" ]; then
    info "last lines of $SERVICE_LOG:"
    tail -n 12 "$SERVICE_LOG" 2>/dev/null | cut -c1-160 | while IFS= read -r l; do info "  $l"; done
  else
    info "service log: $SERVICE_LOG (not readable here) or journalctl -u $SERVICE"
  fi
}

in_task_window() {
  local now t nowmin tmin d
  now=$(date +%H:%M)
  nowmin=$((10#${now%:*} * 60 + 10#${now#*:}))
  for t in $TASK_TIMES; do
    tmin=$((10#${t%:*} * 60 + 10#${t#*:}))
    d=$(((nowmin - tmin + 1440) % 1440))
    if [ "$d" -le 10 ] || [ "$d" -ge 1438 ]; then printf '%s' "$t"; return 0; fi
  done
  return 1
}

lock_holder() {
  local pid=""
  if [ -d "$LOCK_DIR" ]; then pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true); fi
  printf '%s' "$pid"
}

take_lock() {
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    local pid
    pid=$(lock_holder)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      die 1 "another deploy or rollback is running (pid $pid, lock $LOCK_DIR)"
    fi
    warn "removing a stale lock left by pid ${pid:-?}"
    rm -rf -- "$LOCK_DIR"
    mkdir "$LOCK_DIR" || die 1 "cannot create $LOCK_DIR"
  fi
  echo $$ >"$LOCK_DIR/pid"
  HAVE_LOCK=1
  LOGGING=1
  # Keep the log from growing forever.
  if [ -f "$LOG_FILE" ] && [ "$(wc -l <"$LOG_FILE")" -gt 5000 ]; then
    tail -n 2000 "$LOG_FILE" >"$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
}

stop_trial() {
  [ -n "$TRIAL_PID" ] || return 0
  local i=0
  if kill -0 "$TRIAL_PID" 2>/dev/null; then
    kill -TERM "$TRIAL_PID" 2>/dev/null || true
    while kill -0 "$TRIAL_PID" 2>/dev/null; do
      i=$((i + 1))
      if [ "$i" -ge 15 ]; then kill -KILL "$TRIAL_PID" 2>/dev/null || true; break; fi
      sleep 1
    done
  fi
  TRIAL_PID=""
}

on_exit() {
  local code=$?
  stop_trial
  if [ -n "$HAVE_LOCK" ]; then rm -rf -- "$LOCK_DIR"; fi
  exit "$code"
}
trap on_exit EXIT

backup_env() {
  [ -f "$APP_DIR/.env" ] || return 0
  mkdir -p "$ENV_BACKUPS"
  chmod 700 "$ENV_BACKUPS"
  local f
  f="$ENV_BACKUPS/env-$(stamp)-$(short "${1:-none}")"
  cp -p "$APP_DIR/.env" "$f"
  chmod 600 "$f"
  # Keep the newest 20.
  ls -1t "$ENV_BACKUPS" | tail -n +21 | while IFS= read -r old; do rm -f -- "$ENV_BACKUPS/$old"; done
  info ".env backed up to $f"
}

# ---------------------------------------------------------------- preflight
# Prints one line per check; returns 1 if a blocking problem was found.
preflight() {
  local bad=0 state v pid free t
  if command -v git >/dev/null 2>&1; then :; else log_line "  !! git not found"; bad=1; fi
  if command -v "${CURL_CMD[0]}" >/dev/null 2>&1; then :; else log_line "  !! curl not found (${CURL_CMD[0]})"; bad=1; fi
  if v=$("${NODE_CMD[@]}" -p 'process.versions.node' 2>/dev/null); then
    local major=${v%%.*} minor=${v#*.} patch=${v##*.}
    minor=${minor%%.*}
    patch=${patch%%[!0-9]*}
    if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 12 ]; }; then
      log_line "  !! node $v is too old: package.json needs >= 22.12"; bad=1
    elif [ "$major" -eq 23 ] || [ "$major" -eq 25 ] || { [ "$major" -eq 24 ] && [ "$minor" -lt 15 ]; } ||
      { [ "$major" -eq 22 ] && { [ "$minor" -lt 22 ] || { [ "$minor" -eq 22 ] && [ "$patch" -lt 3 ]; }; }; }; then
      log_line "  !  node $v: use Node 24 LTS (>= 24.15), or 22 >= 22.22.3 (nuxt 4.6 needs it; docs/DEPLOY.md §1)"
    fi
  else
    log_line "  !! node not found (${NODE_CMD[*]}); set NODE= if it isn't on the ssh PATH"; bad=1; v="-"
  fi
  local pv
  if pv=$("${PNPM_CMD[@]}" --version 2>/dev/null </dev/null); then :; else
    log_line "  !! pnpm not found (${PNPM_CMD[*]}): corepack enable, or set PNPM="; bad=1; pv="-"
  fi
  log_line "  ok node $v · pnpm $pv · $(git --version 2>/dev/null || echo 'git -')"

  if command -v "${SYSTEMCTL_CMD[0]}" >/dev/null 2>&1; then
    local out
    out=$(svc is-active 2>&1 || true)
    case $out in
      *password* | *"not allowed"* | *sudoers* | *"not found"*)
        log_line "  !! cannot run '${SYSTEMCTL_CMD[*]} is-active $SERVICE': $out"; bad=1 ;;
      *) log_line "  ok $SERVICE: $out" ;;
    esac
  else
    log_line "  !! ${SYSTEMCTL_CMD[0]} not found"; bad=1
  fi
  if [ ! -e "$UNIT_FILE" ]; then log_line "  !  no $UNIT_FILE: is the systemd unit installed? (docs/DEPLOY.md §3)"; fi

  state=$(app_state)
  case $state in
    release)
      log_line "  ok live release $(short "$(release_sha "$APP_DIR")") in $APP_DIR"
      if [ ! -f "$APP_DIR/.env" ]; then log_line "  !! $APP_DIR/.env is missing"; bad=1; fi ;;
    envonly) log_line "  ok first deploy: $APP_DIR holds only .env" ;;
    absent | empty) log_line "  !! $APP_DIR/.env not found: create it first (docs/DEPLOY.md §2)"; bad=1 ;;
    other)
      log_line "  !! $APP_DIR is not a release and holds more than .env:"
      ls -A "$APP_DIR" | head -n 10 | while IFS= read -r e; do log_line "       $e"; done
      bad=1 ;;
  esac
  if [ -f "$APP_DIR/.env" ]; then
    v=$(perms_of "$APP_DIR/.env")
    case $v in 600 | 400) ;; *) log_line "  !  $APP_DIR/.env has mode $v; it holds secrets: chmod 600" ;; esac
  fi

  pid=$(lock_holder)
  if [ -n "$pid" ] && [ "$pid" != $$ ] && kill -0 "$pid" 2>/dev/null; then log_line "  !! a deploy or rollback is running (pid $pid)"; bad=1; fi
  [ -d "$NEXT" ] && log_line "  ok ${NEXT##*/} exists from an earlier run; it will be rebuilt"

  local parent=${APP_DIR%/*}
  if [ -d "$parent" ]; then
    free=$(df -Pk "$parent" | awk 'NR==2 {print int($4 / 1024)}')
    if [ "$free" -lt "$MIN_FREE_MB" ]; then
      log_line "  !! only ${free} MB free in $parent (need $MIN_FREE_MB): delete old ${APP_NAME}-prev-*/failed-* dirs"; bad=1
    else
      log_line "  ok ${free} MB free in $parent"
    fi
    if [ ! -w "$parent" ]; then log_line "  !! $(id -un) cannot create directories in $parent"; bad=1; fi
  fi

  if port_answers "$TRIAL_PORT"; then
    log_line "  !! something already answers on trial port $TRIAL_PORT (a stale trial? check: ss -ltnp | grep :$TRIAL_PORT)"; bad=1
  fi
  if t=$(in_task_window); then
    log_line "  !! the $t scheduled task window ($(date +%H:%M) now, server time): try again in a few minutes"; bad=1
  fi
  return "$bad"
}

# ---------------------------------------------------------------- commands
cmd_info() {
  local state sha="" git=no
  state=$(app_state)
  if [ "$state" = release ]; then
    sha=$(release_sha "$APP_DIR")
    [ -e "$APP_DIR/.git" ] && git=yes
  fi
  local pid
  pid=$(lock_holder)
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then pid=""; fi   # stale: the next run clears it
  printf 'app_dir=%s\nstate=%s\nsha=%s\ngit=%s\nservice=%s\nlock=%s\n' \
    "$APP_DIR" "$state" "$sha" "$git" "$(svc_state)" "$pid"
}

cmd_status() {
  local state sha d code deep ok=0
  state=$(app_state)
  if [ "$state" = release ]; then
    sha=$(release_sha "$APP_DIR")
    local ref="" built=""
    if [ -f "$APP_DIR/.release" ]; then
      ref=$(sed -n 's/^ref=//p' "$APP_DIR/.release" | head -n 1)
      built=$(sed -n 's/^built_at=//p' "$APP_DIR/.release" | head -n 1)
    fi
    log_line "release   ${sha:-unknown}${ref:+  ($ref)}${built:+  built $built}"
  else
    log_line "release   none ($APP_DIR: $state)"; ok=1
  fi
  local st
  st=$(svc_state)
  log_line "service   $SERVICE: ${st:-unknown}"
  [ "$st" = active ] || ok=1
  code=$(http_code "http://127.0.0.1:$APP_PORT/api/health" 5)
  deep=$(http_code "http://127.0.0.1:$APP_PORT/api/health?deep=1" 15)
  log_line "health    127.0.0.1:$APP_PORT /api/health $code · ?deep=1 $deep"
  [ "$code" = 200 ] || ok=1
  local any=""
  while IFS= read -r d; do
    any=1
    local s note=""
    s=$(release_sha "$d")
    is_release "$d" || note="  (not a complete release)"
    log_line "previous  ${d##*/}  ${s:0:12}  retired $(fmt_epoch "$(retired_at "$d")")$note"
  done < <(list_dirs "$PREV_PREFIX")
  [ -n "$any" ] || log_line "previous  none: rollback is not possible"
  while IFS= read -r d; do
    log_line "failed    ${d##*/}"
  done < <(list_dirs "$FAILED_PREFIX")
  if [ -f "$APP_DIR/.env" ]; then log_line "env       $APP_DIR/.env (mode $(perms_of "$APP_DIR/.env"))"; fi
  local pid
  pid=$(lock_holder)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then log_line "lock      a deploy or rollback is running (pid $pid)"
  elif [ -n "$pid" ]; then log_line "lock      stale ($LOCK_DIR, pid $pid gone); the next run removes it"
  fi
  return "$ok"
}

cmd_preflight() {
  log_line "Server preflight ($(id -un)@$(hostname), $APP_DIR):"
  if preflight; then log_line "  all checks passed"; else log_line "  blocking problems above"; return 1; fi
}

cmd_deploy() {
  local bundle="" sha="" ref="" by=""
  while [ $# -gt 0 ]; do
    case $1 in
      --bundle) bundle=${2:-}; shift 2 ;;
      --sha) sha=${2:-}; shift 2 ;;
      --ref) ref=${2:-}; shift 2 ;;
      --by) by=${2:-}; shift 2 ;;
      *) die 2 "deploy: unknown argument '$1'" ;;
    esac
  done
  [ -n "$bundle" ] && [ -f "$bundle" ] || die 2 "deploy: --bundle FILE is required"
  case $sha in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;; *) die 2 "deploy: --sha must be a commit id" ;; esac

  # A dropped ssh connection must not stop a half-done swap.
  trap '' HUP INT PIPE
  take_lock
  log_line "---- deploy $(short "$sha")${ref:+ ($ref)} by ${by:-$(id -un)}"
  step "Preflight"
  preflight || die 1 "preflight failed; nothing changed"

  local state cur_sha=""
  state=$(app_state)
  [ "$state" = release ] && cur_sha=$(release_sha "$APP_DIR")

  # ---- build
  step "Building $(short "$sha") in $NEXT"
  remove_dir "$NEXT"
  git -c init.defaultBranch=release init --quiet "$NEXT"
  # An incremental bundle builds on the live commit: take its history first.
  if [ -e "$APP_DIR/.git" ]; then
    git -C "$NEXT" fetch --quiet --no-tags "$APP_DIR" HEAD 2>/dev/null || warn "could not read git history from $APP_DIR"
  fi
  if ! git -C "$NEXT" bundle verify "$bundle" >/dev/null 2>&1; then
    die 1 "the bundle doesn't apply here (it needs a commit the server lacks); re-run with FULL_BUNDLE=1"
  fi
  git -C "$NEXT" fetch --quiet --no-tags "$bundle" '+refs/memour-deploy/*:refs/memour-deploy/*' || die 1 "git fetch from the bundle failed"
  git -C "$NEXT" -c advice.detachedHead=false checkout --quiet --detach "$sha" || die 1 "commit $sha is not in the bundle"
  git -C "$NEXT" for-each-ref --format='%(refname)' refs/memour-deploy/ | while IFS= read -r r; do git -C "$NEXT" update-ref -d "$r"; done
  cp -p "$APP_DIR/.env" "$NEXT/.env"
  chmod 600 "$NEXT/.env"
  printf 'sha=%s\nref=%s\nbuilt_at=%s\nby=%s\n' "$sha" "$ref" "$(date -u +%FT%TZ)" "${by:-$(id -un)}" >"$NEXT/.release"

  local t0 f t
  t0=$(date +%s)
  info "pnpm install --frozen-lockfile && pnpm build  (log: $NEXT/.build.log)"
  if ! (cd "$NEXT" &&
    "${PNPM_CMD[@]}" install --frozen-lockfile &&
    "${PNPM_CMD[@]}" build) >"$NEXT/.build.log" 2>&1 </dev/null; then
    tail -n 25 "$NEXT/.build.log" | while IFS= read -r l; do info "  $l"; done
    die 1 "build failed; nothing changed (build dir kept: $NEXT)"
  fi
  [ -f "$NEXT/.output/server/index.mjs" ] || die 1 "build has no .output/server/index.mjs; nothing changed"
  # Every scheduled task of this commit must be in the bundle (the
  # retention promise and the couple bot's reminders depend on them).
  for f in "$NEXT"/server/tasks/*.ts; do
    [ -f "$f" ] || continue
    f=${f##*/}
    [ -f "$NEXT/.output/server/chunks/tasks/${f%.ts}.mjs" ] || die 1 "build has no task chunk for server/tasks/$f; nothing changed"
  done
  info "built in $(($(date +%s) - t0))s"

  # ---- trial run of the new build next to the live one
  step "Trial run on 127.0.0.1:$TRIAL_PORT"
  if port_answers "$TRIAL_PORT"; then die 1 "port $TRIAL_PORT is busy; nothing changed"; fi
  (cd "$NEXT" && exec env NITRO_HOST=127.0.0.1 NITRO_PORT="$TRIAL_PORT" \
    "${NODE_CMD[@]}" --env-file=.env .output/server/index.mjs) >"$NEXT/.trial.log" 2>&1 </dev/null &
  TRIAL_PID=$!
  if ! health_ok "$TRIAL_PORT" "$TRIAL_PID"; then
    tail -n 15 "$NEXT/.trial.log" | while IFS= read -r l; do info "  $l"; done
    die 1 "trial run failed; nothing changed (log: $NEXT/.trial.log)"
  fi
  stop_trial
  info "trial passed and stopped"

  # ---- swap
  if t=$(in_task_window); then die 1 "the $t scheduled task window started during the build; nothing changed, try again in a few minutes"; fi
  step "Swapping releases"
  backup_env "$cur_sha"
  local prev=""
  if [ "$state" = release ]; then prev=$(unique_name "$PREV_PREFIX$(short "${cur_sha:-unknown}")"); fi
  if ! svc stop; then
    die 1 "systemctl stop $SERVICE failed; nothing moved"
  fi
  if ! wait_port_free "$APP_PORT" 20; then
    svc start || true
    die 1 "port $APP_PORT still answers after stopping $SERVICE (another process?); started $SERVICE again, nothing moved"
  fi
  if [ -n "$prev" ]; then
    if ! mv "$APP_DIR" "$prev"; then svc start || true; die 1 "could not move $APP_DIR aside; started the old release again"; fi
    date -u +%s >"$prev/.retired"
    info "${APP_NAME} → ${prev##*/}"
  else
    rm -f -- "$APP_DIR/.env"
    rmdir "$APP_DIR" || die 1 "$APP_DIR is no longer empty besides .env; nothing moved (its .env is in $ENV_BACKUPS)"
  fi
  if ! mv "$NEXT" "$APP_DIR"; then
    if [ -n "$prev" ] && mv "$prev" "$APP_DIR"; then
      rm -f "$APP_DIR/.retired"
      svc start || true
      die 4 "could not move the new build into place; the old release is back"
    fi
    die 5 "could not move the new build into place and could not restore $APP_DIR"
  fi
  info "${NEXT##*/} → ${APP_NAME}"
  svc start || warn "systemctl start $SERVICE returned an error"

  step "Health check on 127.0.0.1:$APP_PORT"
  if health_ok "$APP_PORT" ""; then
    step "Cleaning up"
    prune "$PREV_PREFIX" "$KEEP_RELEASES"
    prune "$FAILED_PREFIX" "$KEEP_FAILED"
    log_line "Deployed $(short "$sha")${ref:+ ($ref)}.${prev:+ Previous release: ${prev##*/}.}"
    return 0
  fi

  service_log_tail
  if [ -z "$prev" ]; then
    die 5 "first deploy failed its health check; nothing to roll back to. The new release stays in $APP_DIR: fix the cause, then systemctl restart $SERVICE"
  fi
  step "Rolling back to ${prev##*/}"
  svc stop || warn "systemctl stop $SERVICE returned an error"
  wait_port_free "$APP_PORT" 20 || warn "port $APP_PORT still answers"
  local failed
  failed=$(unique_name "$FAILED_PREFIX$(short "$sha")-$(stamp)")
  mv "$APP_DIR" "$failed" || die 5 "could not move the failed release aside: $APP_DIR is still the new build"
  mv "$prev" "$APP_DIR" || die 5 "could not move ${prev##*/} back to $APP_DIR"
  rm -f "$APP_DIR/.retired"
  info "${APP_NAME} → ${failed##*/}, ${prev##*/} → ${APP_NAME}"
  svc start || warn "systemctl start $SERVICE returned an error"
  if health_ok "$APP_PORT" ""; then
    die 4 "deploy of $(short "$sha") failed its health check; rolled back to $(short "$cur_sha"), which is healthy. Failed build: $failed"
  fi
  service_log_tail
  die 5 "rolled back to $(short "$cur_sha") but it is not healthy either: the site may be down"
}

cmd_rollback() {
  trap '' HUP INT PIPE
  take_lock
  local target cur_sha tgt_sha
  target=$(newest_release "$PREV_PREFIX")
  [ -n "$target" ] || die 1 "no previous release (${PREV_PREFIX##*/}*) to roll back to"
  cur_sha=$(release_sha "$APP_DIR")
  tgt_sha=$(release_sha "$target")
  log_line "---- rollback $(short "$cur_sha") → $(short "$tgt_sha") by $(id -un)"
  step "Rolling back $SERVICE: $(short "${cur_sha:-none}") → $(short "$tgt_sha") (${target##*/})"
  backup_env "$cur_sha"
  # Secrets may have changed since that release ran: it gets the current .env.
  if [ -f "$APP_DIR/.env" ]; then cp -p "$APP_DIR/.env" "$target/.env"; chmod 600 "$target/.env"; fi
  svc stop || die 1 "systemctl stop $SERVICE failed; nothing moved"
  if ! wait_port_free "$APP_PORT" 20; then
    svc start || true
    die 1 "port $APP_PORT still answers after stopping $SERVICE; started it again, nothing moved"
  fi
  local aside=""
  if [ -e "$APP_DIR" ]; then
    aside=$(unique_name "$FAILED_PREFIX$(short "${cur_sha:-unknown}")-$(stamp)")
    mv "$APP_DIR" "$aside" || { svc start || true; die 1 "could not move $APP_DIR aside; started it again"; }
  fi
  if ! mv "$target" "$APP_DIR"; then
    [ -n "$aside" ] && mv "$aside" "$APP_DIR" && svc start
    die 1 "could not move ${target##*/} into place; the release that was running is back"
  fi
  rm -f "$APP_DIR/.retired"
  info "${APP_NAME} → ${aside##*/}, ${target##*/} → ${APP_NAME}"
  svc start || warn "systemctl start $SERVICE returned an error"
  step "Health check on 127.0.0.1:$APP_PORT"
  if health_ok "$APP_PORT" ""; then
    log_line "Rolled back to $(short "$tgt_sha"). The release taken out: ${aside##*/}"
    return 0
  fi
  service_log_tail
  [ -n "$aside" ] || die 5 "rollback target is not healthy and there was nothing to put back"
  step "Rollback target unhealthy; putting $(short "$cur_sha") back"
  svc stop || true
  wait_port_free "$APP_PORT" 20 || true
  mv "$APP_DIR" "$target" && date -u +%s >"$target/.retired"
  mv "$aside" "$APP_DIR" || die 5 "could not move ${aside##*/} back: $APP_DIR is missing, the site is down"
  svc start || true
  if health_ok "$APP_PORT" ""; then
    die 4 "${target##*/} failed its health check; $(short "$cur_sha") is running again"
  fi
  die 5 "neither ${target##*/} nor $(short "$cur_sha") is healthy: the site may be down"
}

exec </dev/null
case ${1:-} in
  info) cmd_info ;;
  status) cmd_status ;;
  preflight) cmd_preflight ;;
  deploy) shift; cmd_deploy "$@" ;;
  rollback) cmd_rollback ;;
  *) echo "usage: deploy-remote.sh status|info|preflight|rollback|deploy --bundle FILE --sha SHA [--ref NAME] [--by WHO]" >&2; exit 2 ;;
esac
