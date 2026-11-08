#!/usr/bin/env bash
# Deploy Memour to the VPS, roll it back, show what runs there.
# Runbook: docs/DEPLOY.md §6.
#
#   scripts/deploy.sh deploy [<git-ref>] [--migrations-applied] [--dry-run]
#   scripts/deploy.sh rollback
#   scripts/deploy.sh status
#
# deploy builds <git-ref> (default: main) on the server next to the live
# release, test-runs it on TRIAL_PORT, swaps it in, health-checks it and
# rolls back by itself if the check fails. The server half is
# scripts/deploy-remote.sh, uploaded with the git bundle on every run.
#
# Settings: environment variables, else scripts/deploy.env (git-ignored;
# start from scripts/deploy.env.example). DEPLOY_HOST is required.
#
# Exit codes: 0 ok · 1 failed, the live release was not touched ·
# 2 usage or config · 3 refused (dirty tree, ref not pushed, migrations
# not confirmed) · 4 failed after the swap, rolled back to the previous
# release · 5 failed and could not restore a healthy release · 6 lost the
# ssh connection mid-run: check `status`.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REMOTE_SCRIPT="$SCRIPT_DIR/deploy-remote.sh"
CONFIG=${DEPLOY_CONFIG:-$SCRIPT_DIR/deploy.env}

# Variables handed to the server half when set here.
REMOTE_VARS="APP_DIR SERVICE APP_PORT TRIAL_PORT KEEP_RELEASES KEEP_FAILED HEALTH_TIMEOUT MIN_FREE_MB SERVICE_LOG UNIT_FILE TASK_TIMES NODE PNPM CURL SYSTEMCTL"

say()  { printf '%s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die()  { local code=$1; shift; printf '!! %s\n' "$*" >&2; exit "$code"; }

usage() {
  cat <<'EOF'
usage: scripts/deploy.sh deploy [<git-ref>] [--migrations-applied] [--dry-run]
       scripts/deploy.sh rollback
       scripts/deploy.sh status

  deploy     build <git-ref> (default: main) on the server, trial-run it,
             swap it in, health-check, roll back automatically on failure
               --migrations-applied  the new supabase/migrations are already
                                     applied to the prod database
               --dry-run             print the plan and run the server's
                                     read-only checks; change nothing
  rollback   switch back to the newest previous release
  status     live commit, service state, health, kept releases

Settings (environment, else scripts/deploy.env): DEPLOY_HOST (required),
APP_DIR, SERVICE, APP_PORT, TRIAL_PORT, KEEP_RELEASES, … — see
scripts/deploy.env.example and docs/DEPLOY.md §6.
EOF
}

# KEY=VALUE lines; the environment wins over the file. Not sourced, so
# the file can't run code.
load_config() {
  [ -f "$CONFIG" ] || return 0
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case $line in '' | '#'*) continue ;; esac
    key=${line%%=*}
    val=${line#*=}
    case $key in
      '' | [0-9]* | *[!ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_]*) warn "$CONFIG: ignoring line '$line'"; continue ;;
    esac
    case $val in
      \"*\") val=${val#\"}; val=${val%\"} ;;
      \'*\') val=${val#\'}; val=${val%\'} ;;
    esac
    if [ -z "$(eval "printf '%s' \"\${$key+set}\"")" ]; then export "$key=$val"; fi
  done <"$CONFIG"
}

# Quote for the remote POSIX shell.
sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# ---------------------------------------------------------------- ssh
CTL_DIR=""
REMOTE_TMP=""
LOCAL_TMP=""
TMP_REF=""

rsh() {
  ssh -o ControlMaster=auto -o "ControlPath=$CTL_DIR/s" -o ControlPersist=120 \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "$DEPLOY_HOST" "$@"
}

cleanup() {
  local code=$?
  set +e
  if [ -n "$TMP_REF" ]; then git update-ref -d "$TMP_REF" 2>/dev/null; fi
  if [ -n "$REMOTE_TMP" ]; then rsh "rm -rf $(sq "$REMOTE_TMP")" </dev/null >/dev/null 2>&1; fi
  if [ -n "$CTL_DIR" ]; then
    ssh -o "ControlPath=$CTL_DIR/s" -O exit "$DEPLOY_HOST" >/dev/null 2>&1
    rm -rf "$CTL_DIR"
  fi
  if [ -n "$LOCAL_TMP" ]; then rm -rf "$LOCAL_TMP"; fi
  exit "$code"
}

connect() {
  # /tmp, not $TMPDIR: macOS's is too long for an ssh control socket path.
  CTL_DIR=$(mktemp -d /tmp/memour-ssh.XXXXXX)
  trap cleanup EXIT
  REMOTE_TMP=$(rsh 'mktemp -d "${TMPDIR:-/tmp}/memour-deploy.XXXXXX"' </dev/null) ||
    die 1 "ssh $DEPLOY_HOST failed"
  case $REMOTE_TMP in */memour-deploy.*) ;; *) REMOTE_TMP=""; die 1 "unexpected answer from the server: '$REMOTE_TMP'" ;; esac
  upload "$REMOTE_SCRIPT" deploy-remote.sh
}

upload() { rsh "cat > $(sq "$REMOTE_TMP/$2")" <"$1" || die 1 "upload of $2 failed"; }

# Run the server half; its exit code is returned.
remote() {
  local envs="" v args="" a
  for v in $REMOTE_VARS; do
    if [ -n "${!v:-}" ]; then envs="$envs $v=$(sq "${!v}")"; fi
  done
  for a in "$@"; do args="$args $(sq "$a")"; done
  rsh "env$envs bash $(sq "$REMOTE_TMP/deploy-remote.sh")$args" </dev/null
}

remote_info() {
  local out k v
  out=$(remote info) || die 1 "could not read the server state"
  INFO_STATE="" INFO_SHA="" INFO_GIT="" INFO_SERVICE="" INFO_LOCK=""
  while IFS='=' read -r k v; do
    case $k in
      state) INFO_STATE=$v ;;
      sha) INFO_SHA=$v ;;
      git) INFO_GIT=$v ;;
      service) INFO_SERVICE=$v ;;
      lock) INFO_LOCK=$v ;;
    esac
  done <<<"$out"
}

# ---------------------------------------------------------------- git
subject() { git log -1 --format='%h %s' "$1" 2>/dev/null || printf '%s' "${1:0:7}"; }
have_commit() { [ -n "$1" ] && git cat-file -e "$1^{commit}" 2>/dev/null; }

# ---------------------------------------------------------------- commands
cmd_status() {
  connect
  remote_info
  local code=0
  remote status || code=$?
  local upstream="refs/remotes/$DEPLOY_REMOTE/$DEPLOY_BRANCH"
  if have_commit "$INFO_SHA" && git rev-parse --verify --quiet "$upstream" >/dev/null; then
    local ahead mig
    ahead=$(git rev-list --count "$INFO_SHA..$upstream")
    say "git       $DEPLOY_REMOTE/$DEPLOY_BRANCH is $ahead commit(s) ahead of the live release (as of your last fetch)"
    mig=$(git diff --name-only "$INFO_SHA" "$upstream" -- supabase/migrations)
    if [ -n "$mig" ]; then
      say "          migrations in between (docs/PROD-DB-APPLY.md):"
      printf '%s\n' "$mig" | sed 's/^/            /'
    fi
  elif [ -n "$INFO_SHA" ]; then
    say "git       live commit ${INFO_SHA:0:12} is not in this repo: git fetch"
  fi
  return "$code"
}

cmd_rollback() {
  [ $# -eq 0 ] || die 2 "rollback takes no arguments"
  connect
  remote_info
  [ -z "$INFO_LOCK" ] || die 1 "a deploy or rollback is running on the server (pid $INFO_LOCK)"
  local code=0
  remote rollback || code=$?
  finish "$code" rollback
}

finish() {
  local code=$1 what=$2
  case $code in
    0) ;;
    1) say "$what failed; the live release was not touched." ;;
    4) say "$what failed after the swap; the previous release is running (exit 4)." ;;
    5) say "$what failed and no healthy release could be restored: check the site now (exit 5)." ;;
    255) say "lost the ssh connection: the server finishes on its own; see 'scripts/deploy.sh status' and ${APP_DIR:-/var/www/memour}-deploy.log (exit 6)."; code=6 ;;
  esac
  return "$code"
}

cmd_deploy() {
  local ref="" migrations_ok="" dry="" behind
  while [ $# -gt 0 ]; do
    case $1 in
      --migrations-applied) migrations_ok=1 ;;
      --dry-run) dry=1 ;;
      -h | --help) usage; exit 0 ;;
      -*) die 2 "deploy: unknown option '$1'" ;;
      *) [ -z "$ref" ] || die 2 "deploy: one ref only"; ref=$1 ;;
    esac
    shift
  done
  ref=${ref:-$DEPLOY_BRANCH}

  local refusals=""
  refuse() {
    if [ -n "$dry" ]; then refusals="$refusals
  - $*"; else die 3 "$*"; fi
  }

  # ---- local checks
  local sha
  sha=$(git rev-parse --verify --quiet "$ref^{commit}") || die 2 "unknown git ref '$ref'"
  if [ -n "$(git status --porcelain)" ]; then
    refuse "the working tree has uncommitted or untracked changes: commit or stash them first (git status)"
  fi
  if [ -z "$(git for-each-ref --contains "$sha" --format='%(refname)' "refs/remotes/$DEPLOY_REMOTE/")" ]; then
    refuse "$ref (${sha:0:12}) is not pushed to $DEPLOY_REMOTE: push it first"
  fi
  local upstream="refs/remotes/$DEPLOY_REMOTE/$DEPLOY_BRANCH"
  if git rev-parse --verify --quiet "$upstream" >/dev/null && ! git merge-base --is-ancestor "$sha" "$upstream"; then
    warn "${sha:0:12} is not on $DEPLOY_REMOTE/$DEPLOY_BRANCH (CLAUDE.md: main is what runs in production)"
  fi
  if behind=$(git rev-list --count "$sha..$ref@{upstream}" 2>/dev/null) && [ "$behind" -gt 0 ]; then
    warn "local $ref is $behind commit(s) behind its upstream: git pull?"
  fi

  # ---- server state
  connect
  remote_info
  [ -z "$INFO_LOCK" ] || die 1 "a deploy or rollback is running on the server (pid $INFO_LOCK)"
  local deployed=$INFO_SHA
  case $INFO_STATE in
    release | envonly) ;;
    *) [ -n "$dry" ] || die 1 "$APP_DIR on the server is '$INFO_STATE': create $APP_DIR/.env first (docs/DEPLOY.md §2)" ;;
  esac
  if [ "$INFO_STATE" = release ] && [ -z "$deployed" ]; then
    die 1 "cannot tell which commit runs in $APP_DIR (no .release file, not a git checkout)"
  fi
  if [ -n "$deployed" ] && [ "$deployed" = "$sha" ]; then
    say "${sha:0:12} is already live on $DEPLOY_HOST; nothing to do."
    return 0
  fi
  if [ -n "$deployed" ] && ! have_commit "$deployed"; then
    refuse "the live commit ${deployed:0:12} is not in this repo, so the migration check can't run: git fetch $DEPLOY_REMOTE"
  fi

  # ---- migration guard
  local migrations="" first=""
  if [ -z "$deployed" ]; then
    first=1
    migrations=$(git ls-tree -r --name-only "$sha" -- supabase/migrations)
  elif have_commit "$deployed"; then
    migrations=$(git diff --name-only "$deployed" "$sha" -- supabase/migrations)
  fi
  local migration_note=""
  if [ -n "$migrations" ] && [ -z "$migrations_ok" ]; then
    if [ -n "$first" ]; then
      migration_note="first deploy: the prod database must have all $(printf '%s\n' "$migrations" | wc -l | tr -d ' ') migrations in supabase/migrations."
    else
      migration_note="supabase/migrations changed since the live release (${deployed:0:12}):
$(printf '%s\n' "$migrations" | sed 's/^/      /')
   "
    fi
    refuse "${migration_note} Apply them to prod first (docs/PROD-DB-APPLY.md), then re-run with --migrations-applied"
  fi

  # ---- plan
  local bundle_kind="full" base=""
  if [ "$INFO_GIT" = yes ] && have_commit "$deployed" && git merge-base --is-ancestor "$deployed" "$sha" && [ -z "${FULL_BUNDLE:-}" ]; then
    bundle_kind="incremental"
    base=$deployed
  fi
  say "Memour deploy${dry:+ (dry run)}"
  say "  host        $DEPLOY_HOST  ($APP_DIR, service $SERVICE)"
  if [ -n "$deployed" ]; then say "  live        $(subject "$deployed")"; else say "  live        none: first deploy"; fi
  say "  deploy      $(subject "$sha")  [$ref]"
  if [ -n "$deployed" ] && have_commit "$deployed"; then
    local n
    n=$(git rev-list --count "$deployed..$sha")
    say "  commits     $n new"
    git log --format='              %h %s' --max-count=15 "$deployed..$sha"
    [ "$n" -le 15 ] || say "              …"
    if git merge-base --is-ancestor "$sha" "$deployed"; then
      warn "this goes BACK $(git rev-list --count "$sha..$deployed") commit(s) from the live release"
    fi
  fi
  if [ -n "$migrations" ]; then
    if [ -n "$first" ]; then
      say "  migrations  first deploy — $(printf '%s\n' "$migrations" | wc -l | tr -d ' ') files; all must be applied to prod${migrations_ok:+ (confirmed)}"
    else
      say "  migrations  changed since the live release${migrations_ok:+ (confirmed applied)}:"
      printf '%s\n' "$migrations" | sed 's/^/              /'
    fi
  elif [ -n "$deployed" ] && ! have_commit "$deployed"; then
    say "  migrations  unknown: the live commit isn't in this repo"
  else
    say "  migrations  none changed"
  fi
  say "  bundle      $bundle_kind"
  local prev_name="${APP_DIR##*/}-prev-${deployed:0:12}"
  say "Steps on the server:"
  say "  1. build in $APP_DIR-next: checkout, copy .env, pnpm install --frozen-lockfile, pnpm build"
  say "  2. trial run on 127.0.0.1:$TRIAL_PORT: /api/health, /api/health?deep=1, /uz must answer 200"
  if [ -n "$deployed" ]; then
    say "  3. stop $SERVICE; $APP_DIR → $prev_name; $APP_DIR-next → $APP_DIR; start $SERVICE"
    say "  4. same checks on 127.0.0.1:$APP_PORT; on failure back to $prev_name automatically"
    say "  5. keep the $KEEP_RELEASES newest ${APP_DIR##*/}-prev-*, delete older"
  else
    say "  3. $APP_DIR-next → $APP_DIR (its .env moves along); start $SERVICE"
    say "  4. same checks on 127.0.0.1:$APP_PORT (nothing to roll back to on a first deploy)"
  fi

  if [ -n "$dry" ]; then
    local pf=0
    remote preflight || pf=$?
    if [ -n "$refusals" ]; then
      say "Dry run: nothing changed. A real run would refuse:$refusals"
      return 3
    fi
    if [ "$pf" -ne 0 ]; then say "Dry run: nothing changed. The server preflight has blocking problems."; return 1; fi
    say "Dry run: nothing changed."
    return 0
  fi

  # ---- ship and run
  LOCAL_TMP=$(mktemp -d "${TMPDIR:-/tmp}/memour-bundle.XXXXXX")
  TMP_REF="refs/memour-deploy/$sha"
  git update-ref "$TMP_REF" "$sha"
  if [ -n "$base" ]; then
    git bundle create "$LOCAL_TMP/memour.bundle" "$base..$TMP_REF" 2>/dev/null || die 1 "git bundle failed"
  else
    git bundle create "$LOCAL_TMP/memour.bundle" "$TMP_REF" 2>/dev/null || die 1 "git bundle failed"
  fi
  git update-ref -d "$TMP_REF"
  TMP_REF=""
  say "Uploading $bundle_kind bundle ($(du -k "$LOCAL_TMP/memour.bundle" | cut -f1) KB)"
  upload "$LOCAL_TMP/memour.bundle" memour.bundle

  local code=0 by
  by="$(git config user.name 2>/dev/null || id -un)"
  remote deploy --bundle "$REMOTE_TMP/memour.bundle" --sha "$sha" --ref "$ref" --by "$by" || code=$?
  finish "$code" deploy
}

# ---------------------------------------------------------------- main
command=${1:-}
[ $# -gt 0 ] && shift
case $command in
  -h | --help | help) usage; exit 0 ;;
  '') usage >&2; exit 2 ;;
  deploy | rollback | status) ;;
  *) usage >&2; exit 2 ;;
esac

load_config
DEPLOY_REMOTE=${DEPLOY_REMOTE:-origin}
DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}
APP_DIR=${APP_DIR:-/var/www/memour}
SERVICE=${SERVICE:-memour}
APP_PORT=${APP_PORT:-3300}
TRIAL_PORT=${TRIAL_PORT:-3399}
KEEP_RELEASES=${KEEP_RELEASES:-2}
[ -n "${DEPLOY_HOST:-}" ] || die 2 "DEPLOY_HOST is not set (user@host or an ~/.ssh/config alias): export it or put it in $CONFIG"
[ -f "$REMOTE_SCRIPT" ] || die 2 "missing $REMOTE_SCRIPT"
top=$(git rev-parse --show-toplevel 2>/dev/null) || die 2 "run this inside the memour git repository"
cd "$top"

case $command in
  deploy) cmd_deploy "$@" ;;
  rollback) cmd_rollback "$@" ;;
  status) cmd_status "$@" ;;
esac
