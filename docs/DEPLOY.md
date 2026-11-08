# Deploying Memour to the VPS

Production is a single Nitro `node-server` process behind nginx on a VPS
(Ubuntu 22.04 or 24.04). nginx terminates TLS for `memour.uz` and proxies
to `127.0.0.1:3300`; the systemd unit `memour` runs
`node .output/server/index.mjs` from `/var/www/memour`. Releases are built
on the server and switched in by one command from your machine,
[`scripts/deploy.sh`](../scripts/deploy.sh) (§6), which also rolls back.

The VPS may host other, unrelated projects. Nothing on this page touches
anything but Memour's own directories under `/var/www`, its unit, its log
and its nginx site.

- [1. Server prerequisites](#1-server-prerequisites)
- [2. Environment](#2-environment)
- [3. systemd unit](#3-systemd-unit)
- [4. nginx](#4-nginx)
- [5. TLS certificate (certbot)](#5-tls-certificate-certbot)
- [6. Deploying and rolling back](#6-deploying-and-rolling-back)
- [7. After every deploy](#7-after-every-deploy)
- [8. Upgrading from main @35e1833](#8-upgrading-from-main-35e1833)
- [9. Scheduled tasks](#9-scheduled-tasks)
- [10. Moving to a new server](#10-moving-to-a-new-server)

A fresh server: §1 → §2 → §3 → §4/§5 → §6 (first deploy) → §7.

---

## 1. Server prerequisites

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx ufw
sudo timedatectl set-timezone Etc/UTC     # scheduled tasks run on server time (§9)
```

- **Node.js 24 LTS (≥ 24.15)** — recommended. The minimum is **22.22.3**:
  Nuxt from 4.6 on declares `^22.22.3 || ^24.15.0 || >=26` (`package.json`
  → `engines` itself still says `>=22.12.0`; an older 22 works, pnpm only
  warns). Not 23 or 25: odd releases are short-lived and get no security
  fixes. From NodeSource, so `node` is `/usr/bin/node` for the unit and on
  the PATH of a non-interactive ssh session:

  ```bash
  curl -fsSLo /tmp/nodesource_setup.sh https://deb.nodesource.com/setup_24.x
  sudo bash /tmp/nodesource_setup.sh && sudo apt install -y nodejs
  node -v
  ```

- **pnpm** via corepack: `sudo corepack enable`. The version is pinned in
  `package.json` → `packageManager`; corepack fetches it on first use.
- **Memory.** `pnpm build` can take 1.5–2 GB while the live site keeps
  running. With less RAM than that free, add swap or the build gets
  killed (`free -h`; `fallocate -l 2G /swapfile`, `mkswap`, `swapon`, fstab).
- **Firewall.** Only ssh and nginx face the internet; the app and the
  trial run listen on `127.0.0.1` only:

  ```bash
  sudo ufw allow OpenSSH
  sudo ufw allow 'Nginx Full'
  sudo ufw enable
  ```

- **nginx** comes with `gzip`; `ngx_brotli` is optional
  (`apt install libnginx-mod-http-brotli-filter`).

### Users

The app runs as an unprivileged system user, never as root:

```bash
sudo adduser --system --group --no-create-home memour
```

The unit (§3) starts Node as `memour`. The app writes nothing to disk,
so it only needs to read the release; `.env` is read by systemd itself.

**Who deploys.** `scripts/deploy.sh` logs in as the user in `DEPLOY_HOST`.
That user builds the release, so it needs write access to the parent of
`APP_DIR` (the script creates `memour-next`, `memour-prev-*` and friends
next to `/var/www/memour`) and the right to start and stop the unit.

- **root** with key-only ssh (`PermitRootLogin prohibit-password`) is the
  simplest.
- **A non-root deploy user** is safer on a dedicated server. Give it a
  directory of its own and point `APP_DIR` one level down, e.g.
  `APP_DIR=/var/www/memour/current` with `/var/www/memour` owned by
  `deploy`, and use those paths in the unit. The script then calls
  `sudo -n systemctl`, so allow exactly that (`sudo visudo -f
  /etc/sudoers.d/memour-deploy`):

  ```
  deploy ALL=(root) NOPASSWD: /usr/bin/systemctl start memour, /usr/bin/systemctl stop memour, /usr/bin/systemctl restart memour, /usr/bin/systemctl is-active memour
  ```

The rest of this page uses the default layout, `APP_DIR=/var/www/memour`.

## 2. Environment

All secrets live in **one file read at runtime**, never in the build:
`/var/www/memour/.env`. Create it before the first deploy; the script
copies it into every new release, systemd reads it (`EnvironmentFile`),
and so does the trial run (`node --env-file`).

```bash
sudo install -d -m 755 /var/www/memour
sudo install -m 600 /dev/null /var/www/memour/.env   # owned by the deploy user
sudo nano /var/www/memour/.env                       # start from .env.example in the repo
```

Plain `KEY=value` lines: no `export`, no quotes around values. systemd and
Node parse quotes differently, and only plain lines mean the same to both.

To change a value later: edit `/var/www/memour/.env`, then
`sudo systemctl restart memour`. A deploy carries the file into the next
release; a rollback gives the restored release the current file too.

On startup `server/plugins/env-check.ts` validates this list. Rows marked
**fatal** make a production server **refuse to start** (the log says
exactly what's missing); **warn** rows only log a warning.

| Variable | | What it's for |
|---|---|---|
| `NUXT_PUBLIC_SITE_URL` | fatal | `https://memour.uz` — no trailing slash (warns). QR codes, login links, canonical/hreflang, robots/sitemap. |
| `NUXT_PUBLIC_SUPABASE_URL` | fatal | `https://<ref>.supabase.co` |
| `NUXT_PUBLIC_SUPABASE_KEY` | fatal | Supabase anon / publishable key. |
| `NUXT_SUPABASE_SECRET_KEY` | fatal | Supabase service-role / secret key. Read at **runtime** only — it is never written into `.output`. The legacy name `SUPABASE_SERVICE_ROLE_KEY` still works; set one of the two. |
| `ADMIN_SESSION_SECRET` | warn | ≥ 32 random characters for signing admin sessions: `openssl rand -hex 32`. Without it admin login is refused. |
| `ESKIZ_USE_TEST_TEMPLATE` | warn if `true` | `true` = Eskiz' fixed test text, which can't carry the login code, so production turns SMS login off (couples use the email link) and admin-created events send no "cabinet is open" SMS. Set `false` (or unset) once Eskiz has approved the Memour templates. |
| `ESKIZ_EMAIL`, `ESKIZ_PASSWORD` | warn | Eskiz SMS gateway credentials (СМС шлюз, not the cabinet password). Without them couples can't log in by SMS. |
| `ESKIZ_SENDER`, `ESKIZ_BASE_URL` | — | Optional, default `4546` / `https://notify.eskiz.uz/api`. |
| `OTP_SMS_HOURLY_CAP` | — | Optional, default `200`: login SMS per hour site-wide before SMS login pauses (the founder gets a Telegram alert). Tune to the Eskiz budget. |
| `TELEGRAM_BOT_TOKEN` | warn | Admin 2FA codes, lead and payment alerts, the couples' notifications. Without it nobody can log into `/admin`. |
| `TELEGRAM_LEAD_CHAT_ID` | warn | Chat that receives new-lead and payment alerts. |
| `TELEGRAM_BOT_USERNAME` | warn | The bot's username without `@`: the dashboard's `t.me/<bot>?start=…` link. Without it couples can't connect Telegram. |
| `TELEGRAM_WEBHOOK_SECRET` | warn | 16–256 characters of `A–Z a–z 0–9 _ -` (`openssl rand -hex 32`): Telegram sends it with every update and `/api/telegram/webhook` refuses anything else (503 while it is unset). Without it the bot can't receive `/start`, so couples can't connect. After setting or changing it, run `scripts/telegram-setup.mjs` (§7). |
| `TELEGRAM_DIGEST_WINDOW_SECONDS` | — | Optional, default `600`: at most one "new photos" digest per event per this many seconds. Only lowered for tests. |
| `PAYME_MERCHANT_ID`, `PAYME_MERCHANT_KEY` | fatal if half-set | Payme: set both or neither. Sandbox: the TEST_KEY plus `PAYME_CHECKOUT_URL`. |
| `PAYME_LOGIN`, `PAYME_CHECKOUT_URL` | — | Optional, default `Paycom` / `https://checkout.paycom.uz` (sandbox: `https://test.paycom.uz`). |
| `PAYME_IKPU_CODE`, `PAYME_PACKAGE_CODE`, `PAYME_VAT_PERCENT` | warn if Payme is on without them | The receipt line Payme needs for tax rules (ИКПУ, package code, VAT 12 or 0 — ask the accountant). Without all three the webhook sends no `detail`. |
| `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` | fatal if half-set | Click: set all three or none. No provider at all → warning: nobody can pay, checkout answers "payments unavailable". |
| `PAYMENTS_DEV_MODE` | — | Local development only ("mark as paid" without a provider). Production builds ignore it. |
| `NUXT_PUBLIC_LEGAL_ENTITY_NAME`, `…_INN`, `…_REGISTRATION`, `…_ADDRESS`, `…_PHONE`, `…_BANK`, `NUXT_PUBLIC_LEGAL_EFFECTIVE_DATE` | warn | The operator's details for the full privacy policy, user agreement and public offer (`…_POSTAL_ADDRESS`, `…_EMAIL` optional; `…_RU` variants for the Russian text). Until all are set **and** the texts generated by `scripts/legal-publish.mjs` have no open placeholders and no `todo` items (`shared/legal-meta.json`), the short interim `/privacy` and `/terms` are served, `/offer` redirects to the terms and checkout asks to accept the terms. README → Legal documents. |
| `NUXT_PUBLIC_LEGAL_PREVIEW` | warn if `true` | Shows the unpublished drafts, marked as drafts, for review. Local / staging only. |
| `RETENTION_PURGE_ENABLED` | warn | `true` = the daily 03:00 retention task really deletes media of events past `archive_expires_at`. Unset = dry run (logs only). **Required in production** — the privacy page, Pricing, the guest welcome screen and the checkout checkbox all promise that files are deleted 180 days after the wedding (Luxury 365); unset, that promise is false. Only the first release runs without it, for one dry run (§8 step 6). |
| `NUXT_PUBLIC_SUPABASE_COOKIE_OPTIONS_SECURE` | — | Only if the build was made with an `http://` site URL but serves https: set `true`. The env check warns when this is needed. |
| `NITRO_HOST`, `NITRO_PORT` | — | Set by the unit (§3): `127.0.0.1` / `3300`. Keep the host on loopback: every per-IP limit (login SMS and codes, admin login, guest upload, lead form) keys on nginx's `X-Real-IP` / `X-Forwarded-For`. They're trusted only from a loopback/private peer, so a request that bypasses nginx is keyed by its own address — but only nginx sets them correctly. |
| `UV_THREADPOOL_SIZE` | — | Optional, e.g. `8`: sharp (guest photos) and DNS share libuv's pool of 4. |

Only `NUXT_PUBLIC_SITE_URL` and `NUXT_PUBLIC_SUPABASE_URL` are also read
at **build** time (Secure-cookie default and the CSP's Supabase origin).
The script copies `.env` into the new release before `pnpm build`, and
Nuxt's build reads them from there; the build never needs a secret.

## 3. systemd unit

`/etc/systemd/system/memour.service`:

```ini
[Unit]
Description=Memour (Nuxt / Nitro)
After=network-online.target
Wants=network-online.target
# A refused start (bad env) shouldn't spin forever.
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=memour
Group=memour
WorkingDirectory=/var/www/memour
EnvironmentFile=/var/www/memour/.env
Environment=NODE_ENV=production
Environment=NITRO_HOST=127.0.0.1
Environment=NITRO_PORT=3300
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=always
RestartSec=3
StandardOutput=append:/var/log/memour.log
StandardError=append:/var/log/memour.log
# Guest uploads are buffered in memory; cap the damage of a runaway.
MemoryMax=1536M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

A unit without `User=` runs Node as root. On an existing server, adding
`User=memour`/`Group=memour` (with the user from §1) needs nothing else —
the release is world-readable and systemd reads `.env` itself — but
restart and check `/api/health` right after.

```bash
sudo systemctl daemon-reload
sudo systemctl enable memour      # start comes with the first deploy (§6)
tail -f /var/log/memour.log       # look for "[memour] env check …"
```

systemd opens the log itself and appends to it, so rotate it with
`copytruncate` — `/etc/logrotate.d/memour`:

```
/var/log/memour.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

The deploy script drives this unit with `systemctl`; PM2 or a second
process manager is not supported (and would break "one instance only", §9).

## 4. nginx

The app already sends `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options`, `Permissions-Policy`, the CSP headers and
`X-Robots-Tag` for private pages. nginx owns TLS, HSTS, compression of
dynamic responses, body-size limits and the www → apex redirect.

`/etc/nginx/sites-available/memour.conf` (`http2 on;` needs nginx ≥ 1.25.1;
Ubuntu 22.04/24.04 ship older versions, so drop it there and write
`listen 443 ssl http2;`):

```nginx
# http → https, for both names
server {
    listen 80;
    listen [::]:80;
    server_name memour.uz www.memour.uz;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://memour.uz$request_uri; }
}

# www → apex
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name www.memour.uz;
    ssl_certificate     /etc/letsencrypt/live/memour.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/memour.uz/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;
    return 301 https://memour.uz$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name memour.uz;

    ssl_certificate     /etc/letsencrypt/live/memour.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/memour.uz/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    # One HSTS header, from nginx, also on its own 502 pages.
    proxy_hide_header Strict-Transport-Security;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # Guest videos are up to 30 MB, cover photos 8 MB (+ multipart overhead).
    client_max_body_size 40m;
    client_body_timeout 120s;

    # /_nuxt assets arrive pre-compressed (.br/.gz) from Nitro; this covers
    # HTML and JSON. nginx never re-compresses an encoded response.
    gzip on;
    gzip_proxied any;
    gzip_vary on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml application/javascript
               application/json application/xml image/svg+xml
               application/manifest+json;
    # With ngx_brotli installed:
    # brotli on;
    # brotli_comp_level 5;
    # brotli_types text/plain text/css text/xml application/javascript
    #              application/json application/xml image/svg+xml;

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        $connection_upgrade;

    location / {
        proxy_pass http://127.0.0.1:3300;
        proxy_read_timeout 60s;
    }

    # Hashed build assets: cache forever.
    location /_nuxt/ {
        proxy_pass http://127.0.0.1:3300;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header Strict-Transport-Security "max-age=31536000" always;
    }

    # ZIP archives stream (constant memory) for as long as the client
    # needs: multi-GB albums on slow mobile links take many minutes.
    location /api/couple/zip/ {
        proxy_pass http://127.0.0.1:3300;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        gzip off;
    }

    # Uploads: let slow venue Wi-Fi finish. Keep proxy_request_buffering
    # on (the default): nginx then always forwards a Content-Length,
    # which the endpoint requires (411 without it).
    location /api/guest/upload {
        proxy_pass http://127.0.0.1:3300;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }
}
```

And once, in `/etc/nginx/nginx.conf` → `http { … }` (skip if another
site on the server already defines it):

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

On a fresh server the 443 blocks can't load until the certificate exists:
enable the file with only the first (port 80) block, get the certificate
(§5), then put in the full file.

```bash
sudo ln -sf /etc/nginx/sites-available/memour.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HSTS note: once browsers have seen `max-age=31536000` they refuse plain
http for a year — a lapsed certificate then locks visitors out instead
of showing a click-through warning. That's the point, but it makes the
renewal check below non-optional. `includeSubDomains`/`preload` are
deliberately off until every subdomain is on https.

## 5. TLS certificate (certbot)

certbot from snap, with the nginx plugin:

```bash
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
# DNS for memour.uz and www.memour.uz must already point at this server,
# and nginx must serve the port-80 block from §4.
sudo certbot certonly --nginx -d memour.uz -d www.memour.uz
```

`certonly` leaves the config from §4 alone; the nginx plugin also writes
`/etc/letsencrypt/options-ssl-nginx.conf`, which that config includes.
Make nginx pick up renewed certificates:

```bash
echo -e '#!/bin/sh\nsystemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

Certbot renews 30 days before expiry. Check that it really does, after
setup and now and then:

```bash
# expiry of what nginx actually serves
echo | openssl s_client -connect memour.uz:443 -servername memour.uz 2>/dev/null \
  | openssl x509 -noout -enddate
sudo certbot certificates             # what certbot has on disk
systemctl list-timers | grep certbot  # the renewal timer is scheduled
sudo certbot renew --dry-run          # renewal actually works
```

If the dry run fails, fix it now (usually port 80 blocked, or the
port-80 server block missing). Also put a calendar reminder a week before
each expiry date, or point an uptime monitor with certificate-expiry
alerts at `https://memour.uz`.

## 6. Deploying and rolling back

**Database migrations go first and never through the deploy:** apply
them to prod as in [`PROD-DB-APPLY.md`](./PROD-DB-APPLY.md), then deploy
the code that needs them. The script checks this: it refuses a deploy
whose `supabase/migrations` differ from the live release's until you
pass `--migrations-applied`.

### Once, on your machine

You need bash, git and ssh (macOS or Linux), the repo, and ssh access to
the server. Put the port, key and user in `~/.ssh/config` and use the
alias:

```bash
cp scripts/deploy.env.example scripts/deploy.env   # git-ignored
# DEPLOY_HOST=memour-prod   (an ~/.ssh/config Host, or user@host)
```

### Deploy

```bash
git switch main && git pull
scripts/deploy.sh deploy --dry-run       # the plan + the server's read-only checks
scripts/deploy.sh deploy                 # main
scripts/deploy.sh deploy <ref>           # any pushed commit, tag or branch
scripts/deploy.sh deploy --migrations-applied   # after PROD-DB-APPLY.md
```

It refuses (exit 3) when the working tree is dirty, when the ref isn't
pushed to `origin`, when `supabase/migrations` changed since the live
release (it lists the files) or it's the first deploy, unless
`--migrations-applied`, and when the live commit isn't in your clone
(`git fetch`). If the ref is already live it does nothing.

Then, on the server, as the `DEPLOY_HOST` user:

1. **Preflight** — node/pnpm/git present, `.env` in place, ≥ 1.5 GB free,
   the trial port free, no other deploy running, not near a scheduled
   task (§9).
2. **Build** in `/var/www/memour-next`: the commit from a git bundle the
   script uploads (incremental on top of the live commit), `.env`
   copied in, `pnpm install --frozen-lockfile`, `pnpm build`. The build
   must contain `.output/server/index.mjs` and a chunk for every
   `server/tasks/*.ts`. Log: `memour-next/.build.log`.
3. **Trial run** of the new build next to the live one on
   `127.0.0.1:3399` with the real `.env`: `/api/health`,
   `/api/health?deep=1` and `/uz` must answer 200; then it is stopped by
   its pid. Log: `.trial.log`.
4. **Swap** — `.env` backed up, `systemctl stop memour`,
   `memour` → `memour-prev-<sha>`, `memour-next` → `memour`,
   `systemctl start memour`.
5. **Health check** on `127.0.0.1:3300`, same three URLs. If it fails, the
   script **rolls back by itself**: the failed release goes to
   `memour-failed-<sha>-<time>`, the previous one comes back, exit 4.
6. **Clean-up** after a successful deploy only: the newest
   `KEEP_RELEASES` (2) `memour-prev-*` stay, older ones are deleted; of
   the `memour-failed-*` the newest one stays.

A failure before step 4 leaves the live site untouched (exit 1). Steps 1
to 3 take a minute or a few on a small VPS; the site is down only between
stop and start in step 4, a few seconds.

If your ssh connection drops, the server half carries on to the end on
its own, including a rollback. Look with `scripts/deploy.sh status` and in
`/var/www/memour-deploy.log`.

The first deploy on a fresh server (`/var/www/memour` holds only `.env`)
moves the build into `/var/www/memour` and starts the unit; there is
nothing to roll back to yet. On the current server the hand-made layout
is compatible: the release is a git checkout and `memour-prev-<sha>` dirs
are recognised. The first scripted deploy deletes all but the two newest
of them.

### Roll back

```bash
scripts/deploy.sh rollback
```

Switches to the newest `memour-prev-*`: stop, `memour` →
`memour-failed-<sha>-<time>`, `memour-prev-<sha>` → `memour`, start,
health check. The restored release gets the **current** `.env` (secrets
may have changed since it ran). If it isn't healthy, the release that was
running is put back (exit 4). Run it again to go one more release back.
Rolling back code never touches the database: migrations stay applied,
and the old code copes with them because migrations ship before the code
that needs them (`CLAUDE.md` → Migrations).

Without your machine, on the server (each release contains the script;
copy it out first, the directory is about to move):

```bash
cp /var/www/memour/scripts/deploy-remote.sh /tmp/ && bash /tmp/deploy-remote.sh rollback
bash /tmp/deploy-remote.sh status
```

By hand, if all else fails: `systemctl stop memour`,
`mv /var/www/memour /var/www/memour-failed-<sha>`,
`mv /var/www/memour-prev-<sha> /var/www/memour`, `systemctl start memour`,
`curl -s http://127.0.0.1:3300/api/health`.

### Status

```bash
scripts/deploy.sh status
```

The live commit (and the ref and time it was built from), the unit's
state, `/api/health` and `?deep=1` on the server, the releases kept for
rollback, and how far `origin/main` is ahead of the live commit, with
any migrations in between. Exit 0 when the unit is active and healthy.

### Layout on the server

| Path | What it is |
|---|---|
| `/var/www/memour` | The live release: git checkout, `node_modules`, `.output`, `.env`, `.release` (commit, ref, build time, who). The unit's `WorkingDirectory`. |
| `/var/www/memour-next` | The release being built; left in place after a failed build for a look, replaced by the next deploy. |
| `/var/www/memour-prev-<sha>` | Previous releases, for rollback (~0.5 GB each). |
| `/var/www/memour-failed-<sha>-<time>` | Taken out by an automatic or manual rollback. |
| `/var/www/memour-env-backups/` | A copy of `.env` before every swap (newest 20, mode 600). |
| `/var/www/memour-deploy.log` | What every deploy and rollback did. |
| `/var/www/memour-deploy.lock` | Exists while a deploy or rollback runs. A stale one (its pid gone) is removed by the next run. |

### Settings

Environment variables, else `scripts/deploy.env` (`KEY=value` lines; the
environment wins). The server-side ones are passed along over ssh.

| Variable | Default | |
|---|---|---|
| `DEPLOY_HOST` | — | **Required.** `user@host` or an `~/.ssh/config` alias. |
| `APP_DIR` | `/var/www/memour` | The live release; its siblings live next to it. |
| `SERVICE` | `memour` | The systemd unit. |
| `APP_PORT` | `3300` | `NITRO_PORT` of the unit: post-swap health check. |
| `TRIAL_PORT` | `3399` | The trial run. |
| `KEEP_RELEASES` | `2` | `memour-prev-*` kept after a successful deploy. |
| `HEALTH_TIMEOUT` | `60` | Seconds a release gets to answer `/api/health`. |
| `SERVICE_LOG` | `/var/log/memour.log` | Its tail is shown after a failed health check. |
| `SYSTEMCTL` | `systemctl` as root, else `sudo -n systemctl` | How start/stop/is-active are run. |
| `NODE`, `PNPM` | `node`, `pnpm` | Full paths if they aren't on the PATH of a non-interactive ssh session (nvm). |
| `MIN_FREE_MB` | `1500` | Free space the preflight wants next to `APP_DIR`. |
| `TASK_TIMES` | `03:00 05:00` | No deploy from 2 min before to 10 min after these (server time, §9). |
| `DEPLOY_REMOTE`, `DEPLOY_BRANCH` | `origin`, `main` | The default ref, and what "pushed" means. |
| `FULL_BUNDLE` | — | `1` sends the whole history instead of an incremental bundle. |
| `DEPLOY_CONFIG` | `scripts/deploy.env` | Another settings file. |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done (or nothing to do). |
| 1 | Failed before the swap: the live release was not touched. |
| 2 | Usage or configuration error. |
| 3 | Refused: dirty tree, ref not pushed, migrations not confirmed, live commit unknown locally. |
| 4 | Failed after the swap; rolled back, the previous release is running and healthy. |
| 5 | Failed and no healthy release could be restored: **the site may be down**, look now. |
| 6 | Lost the ssh connection: the server finishes on its own; check `status`. |

## 7. After every deploy

The script has already checked `/api/health`, `?deep=1` and `/uz` on
`127.0.0.1`. These go through nginx, from your machine or the server.
**GET only:** a valid POST in production sends real, paid SMS and real
Telegram messages to real couples.

```bash
tail -n 30 /var/log/memour.log    # "[memour] env check passed." or the warnings
curl -s  https://memour.uz/api/health           # {"ok":true} — liveness, no DB
curl -s 'https://memour.uz/api/health?deep=1'  # {"ok":true}; 503 db_unavailable if Supabase is down/paused
ls /var/www/memour/.output/server/chunks/tasks/   # cleanup-archives.mjs, telegram-reminders.mjs (§9)
curl -sI https://memour.uz/uz | grep -iE 'strict-transport|x-frame|content-security|permissions|referrer|x-powered'
curl -sI https://memour.uz/uz/e/00000000-0000-0000-0000-000000000000 | grep -i x-robots-tag   # noindex
curl -s  https://memour.uz/robots.txt    # absolute Sitemap line
curl -s  https://memour.uz/sitemap.xml | head
curl -sI -H 'Accept-Encoding: br, gzip' https://memour.uz/uz | grep -i content-encoding
curl -s  https://memour.uz/uz | grep -o '<html[^>]*>'   # lang="uz-UZ"
```

`x-powered-by` must not appear. CSP violations are only **reported**
(the policy is Report-Only); they show up as `[csp] would block …` in
the log. When those stay quiet for a couple of weeks of real traffic,
switch the header to enforcing in `nuxt.config.ts`.

Monitoring: point the process watchdog at `https://memour.uz/api/health`
(liveness only, never touches Supabase) and an external uptime monitor at
`https://memour.uz/api/health?deep=1` — **alert only**, never restart on
it: restarting Node doesn't wake a paused database, it only cuts off
uploads in progress and resets the rate limits.

### Telegram bot (couples' notifications)

Once, and again whenever the domain (`NUXT_PUBLIC_SITE_URL`),
`TELEGRAM_BOT_TOKEN` (a new bot) or `TELEGRAM_WEBHOOK_SECRET` changes — on
the server, from the live release:

```bash
cd /var/www/memour
node --env-file=.env scripts/telegram-setup.mjs --dry-run   # what it will send; secret and token masked
node --env-file=.env scripts/telegram-setup.mjs             # setWebhook + name, descriptions, commands (uz, ru)
node --env-file=.env scripts/telegram-setup.mjs --info      # webhook URL, pending updates, last error
```

What a re-run touches: `setWebhook` always (the secret can't be read
back); Telegram's queue of undelivered updates is dropped only on the
first setup — while the webhook isn't at this URL yet — or with
`--drop-pending`, so a couple who pressed Start during a restart still
gets linked. The name, descriptions and commands are read first and set
only when they differ; Telegram rate-limits these edits, and a `wait …`
line (429) means the old text stays until you run the script again
later — the webhook is already set, the exit code is 0.

`--info` must show `webhook: https://memour.uz/api/telegram/webhook`,
`allowed updates: message, my_chat_member` and no recent `last error`.
Then check it end to end: open a Pro test event in the dashboard, press
«Подключить Telegram», press Start in Telegram — the bot answers «Готово!…»
and the chat appears on the card; «Отключить» removes it. A request without
the secret is refused (a deliberately invalid POST, safe in production):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://memour.uz/api/telegram/webhook   # 401
```

The setup only changes what the bot receives; the team's alerts and admin
codes keep working as before (they only send). A deploy needs no re-run:
the webhook URL and the secret stay the same.

## 8. Upgrading from main @35e1833

Apply the database migrations **first** ([`PROD-DB-APPLY.md`](./PROD-DB-APPLY.md)),
then deploy (§6). One-time changes to `/var/www/memour/.env` before the
first deploy of this release. Items 1–3 are fatal — without them the
server refuses to start:

1. The service-role key: keep `SUPABASE_SERVICE_ROLE_KEY` or rename it
   to `NUXT_SUPABASE_SECRET_KEY`. It must now be in the runtime
   environment — a key that only existed at build time is no longer
   baked into `.output`.
2. `NUXT_PUBLIC_SITE_URL` must be in the runtime environment too.
3. Payme / Click: all keys of a provider, or none.
4. `ADMIN_SESSION_SECRET=$(openssl rand -hex 32)` — otherwise nobody can
   log into `/admin`.
5. `ESKIZ_USE_TEST_TEMPLATE`: leave it `true` until Eskiz has approved
   the Memour SMS templates (SMS login stays off, couples sign in by
   email), then set `false`.
6. **Required — the release is not finished without it:**
   `RETENTION_PURGE_ENABLED=true`. This release's texts promise that
   files are deleted 180 days after the wedding (Luxury 365): the
   privacy page, Pricing, the guest welcome screen and the checkout
   checkbox the couple ticks. Deploy with it unset, read the first
   `[retention] dry run, would purge event …` / `[retention] done {…}`
   lines (next 03:00), and if they list only events past their date,
   set it to `true` and restart the same day. If they look wrong, stop
   and fix the task — don't leave the dry run running.
7. Payme: `PAYME_IKPU_CODE`, `PAYME_PACKAGE_CODE`, `PAYME_VAT_PERCENT`
   together with the merchant keys.

And in nginx (§4): `X-Real-IP` / `X-Forwarded-For` as above (without
them every visitor shares one rate-limit bucket), the 3600 s ZIP
timeouts, `client_max_body_size` ≥ 32m. Then point the watchdog and the
uptime monitor at the two health URLs (§7).

## 9. Scheduled tasks

Two tasks run **inside the Node process** (`nuxt.config.ts` →
`nitro.scheduledTasks`), on server time — keep the server on UTC (§1):

| When (UTC) | Task | What it does | Log lines |
|---|---|---|---|
| 03:00 | `cleanup-archives` (`server/tasks/cleanup-archives.ts`) | Retention: deletes the media of events past `archive_expires_at`. A dry run until `RETENTION_PURGE_ENABLED=true` (§8 step 6). | `[retention] dry run, would purge event …`, `[retention] done {…}` |
| 05:00 (10:00 Tashkent) | `telegram-reminders` (`server/tasks/telegram-reminders.ts`) | The couple bot: "download the archive" 30 and 7 days before deletion, disconnects chats of purged events, deletes stale link tokens. | `[telegram-bot] reminders done {…}` |

Pending upload digests are sent when the service stops
(`[telegram-bot] shutdown: N pending digest(s) sent`).

**One instance only.** Rate limits, digest timers and these tasks live in
process memory, so every extra process (a second server, a PM2 cluster,
a forgotten `node .output/server/index.mjs`) runs the tasks again and
splits the limits. The trial run of a deploy is such a process for a few
seconds, so the script refuses to deploy from 2 minutes before to 10
minutes after each task (`TASK_TIMES`). Scaling out needs that state in
Redis or the database first.

Separately, pg_cron jobs inside Supabase (`supabase/migrations/*_cron.sql`:
archiving expired events, purging old login codes) run in the database
and don't depend on the server at all.

## 10. Moving to a new server

The database, Storage and the domain stay; only the Node process and
nginx move. Plan for an overlap in which both servers serve the site.

1. **A day before:** lower the TTL of the `memour.uz` and `www` DNS
   records to 300 s. If Eskiz, Payme or Click have the old server's IP
   on an allowlist in their cabinets, add the new IP.
2. **Set up the new server**, §1–§4, without starting anything that needs
   the certificate yet.
3. **Copy `.env`** from the old server, over ssh only, never through git
   or chat, and keep it at mode 600:
   ```bash
   ssh old 'cat /var/www/memour/.env' | ssh new 'umask 077; cat > /var/www/memour/.env'
   ```
4. **Certificate.** For no gap in https, copy it: as root,
   `ssh old 'tar czf - /etc/letsencrypt' | ssh new 'tar xzf - -C /'`, then
   enable the full nginx file (§4) and the reload hook (§5). After the DNS
   switch, re-issue it on the new server
   (`certbot certonly --nginx --force-renewal -d memour.uz -d www.memour.uz`)
   and check `certbot renew --dry-run`. Without the copy, issue it right
   after the switch instead and accept a few minutes without https.
5. **Deploy** with `DEPLOY_HOST` pointing at the new server:
   `scripts/deploy.sh deploy --migrations-applied` (the first deploy asks
   for it; the database is the same one). Check it before DNS points
   there, from your machine:
   ```bash
   curl -s --resolve memour.uz:443:<new-ip> https://memour.uz/api/health
   curl -s --resolve memour.uz:443:<new-ip> 'https://memour.uz/api/health?deep=1'
   ```
6. **Switch DNS** to the new IP, outside 02:50–05:20 UTC so the two
   servers don't both run the scheduled tasks (§9). Keep the old server
   running while caches expire; both talk to the same database.
7. **Telegram:** the webhook URL is the domain, so nothing to change
   while the domain, token and secret stay the same. Run
   `scripts/telegram-setup.mjs --info` on the new server (§7) once DNS has
   switched; if anything of the three changed, run the setup itself.
8. **Retire the old server** once its log shows no more traffic (a few
   TTLs; Telegram and the payment providers resolve DNS on their own
   schedule, give it a day): `systemctl stop memour && systemctl disable
   memour` there. Point `scripts/deploy.env` and the monitors at the new
   server.

If the **domain** changes as well: new `NUXT_PUBLIC_SITE_URL` (it is also
read at build time, so deploy again after changing it), nginx
`server_name` and a certificate for the new name, Supabase Auth → Site URL
and Redirect URLs, the Payme / Click merchant callback and return URLs,
and `scripts/telegram-setup.mjs` again (§7).
