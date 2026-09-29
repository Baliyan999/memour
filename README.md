# Memour

Wedding photo SaaS — QR codes on guest tables, browser-native camera, real-time slideshow, couple dashboard.

**Live:** https://memour.uz (VPS, see [Deploy](#deploy))
**Stack:** Nuxt 4 · Vue 3 · Tailwind v4 · Supabase (Postgres + Auth + Storage) · Eskiz SMS · Telegram Bot · Payme / Click

---

## What it does

A couple buys a wedding tier on the landing → admin creates the event → couple logs into the dashboard with a phone OTP → downloads a printable PDF with one QR code per table → on the wedding day guests scan their table's QR, open a branded landing in the browser, take photos directly (no app to install) → photos stream to a live slideshow on the venue projector → after the wedding the couple swipes through to moderate and downloads everything as a ZIP.

---

## Local dev

```bash
pnpm install
npx supabase start     # local Supabase in Docker, applies supabase/migrations
cp .env.example .env   # URL + keys from `npx supabase status -o env`
pnpm dev               # → http://localhost:3000
```

Required services:
- Supabase — the local stack above (recommended), or your own free hosted project with the migrations pushed (see [Database](#database))
- Eskiz.uz account (optional in dev — `pnpm dev` prints the SMS login code to the server console; the email login lands in Mailpit, http://127.0.0.1:54324)
- Telegram bot (lead notifications; also the admin 2FA channel — admin login needs it)
- Payme / Click merchant (optional — without credentials a provider's checkout is closed (503 `payments_unavailable`); to click through a payment locally, run `pnpm dev` with `PAYMENTS_DEV_MODE=true`)

### Env vars

See [`.env.example`](./.env.example). Bare minimum to boot:

```env
NUXT_PUBLIC_SITE_URL=http://localhost:3000
NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321     # or https://<project-ref>.supabase.co
NUXT_PUBLIC_SUPABASE_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

---

## Database

The schema lives in [`supabase/migrations/`](./supabase/migrations) — the single source of truth. The first twelve files are the SQL prod ran (copied from `supabase_migrations.schema_migrations`, under the same versions), so `supabase db push` sees them as already applied. Only two prod-only bootstrap `UPDATE`s that named the founding admin are left out; on a fresh project create your first admin by hand (see [CONTRIBUTING](./CONTRIBUTING.md)).

| Migration | What it does |
|---|---|
| `20260520154140_memour_schema_v1` | events, leads, photos, branding, admins, referrals, attributions; `photos` bucket |
| `20260520170600_phone_otps_v1` | phone OTP storage (hashed codes) |
| `20260523114204_photos_realtime` | Realtime on `photos` (live slideshow) |
| `20260523114459_events_owner_phone` | phone-based event ownership claim |
| `20260523121533_payments_v1` | payments ledger |
| `20260523210503_photos_media_type` | photo / video / voice + duration |
| `20260523211655_leads_status` | lead workflow (new/contacted/won/lost) |
| `20260523212453_archive_cleanup_cron` | `archive_expires_at` trigger (wedding + 180 days) + hourly pg_cron job that archives expired events |
| `20260524065502_admins_super_role` | admin roles (`super` / `admin`) |
| `20260524073243_admins_telegram_2fa` | admin Telegram chat id + `admin_otps` |
| `20260524074746_events_qr_settings` | per-event QR PDF styling |
| `20260525151616_guest_devices_binding` | per-device table binding + upload quotas |
| `20260928000000_branding_bucket` | public `branding` bucket (was created by hand in prod) |
| `20260928000100_security_hardening` | clients read-only, payment records protected, storage limits, `events.purged_at`, 12-month retention for Luxury, expiry follows date/tier changes, deleted accounts release their phone |
| `20260928000200_purge_otps_cron` | daily pg_cron job: login-code rows (`phone_otps`, `admin_otps`: phone/email, IP, user agent) older than 7 days are deleted |
| `20260928000300_payments_unique_paid` | at most one settled provider payment per event, one row per provider transaction |
| `20260928020000_leads_plan_tier` | `leads.plan_tier`: the tier picked on a Pricing card before the lead form was sent |
| `20260929000000_claim_guest_device` | `claim_guest_device()`: a new guest phone joins an event only while it has fewer than its tier's guests (Basic 50, Pro 150, Premium 300, Luxury 500 — `shared/plans.ts`), atomically; phones already in are never refused |

**Security model.** The browser holds the anon key and the user's JWT, so anything RLS allows is reachable straight through PostgREST. Clients therefore only *read* their own rows (events, photos, branding, payments; admins read their own `admins` row). Every write goes through a Nitro endpoint on the service role, which is where the checks live (payment gate, zod limits, ownership). Server-only tables (`phone_otps`, `admin_otps`, `guest_devices`, `leads`, `referrals`, `referral_attributions`) are closed to clients entirely. Do not add client-side `.insert/.update/.delete`; if one is ever truly needed, grant the specific columns and add a policy `WITH CHECK` — never `FOR ALL`.

Deleting a couple's auth user keeps their events and payments (`events.owner_id` becomes NULL) and clears `owner_phone` in the same step, so whoever logs in with that number next doesn't get the wedding (phone login claims unowned events by `owner_phone`).

Storage buckets:
- `photos` — private, 30 MB per file, `image/jpeg|png|webp`, `video/webm|mp4`, `audio/webm|mp4|mpeg|ogg` (mirrors `LIMITS` in `server/api/guest/upload.post.ts` — widen both together). Served through `/api/photo/[id]` signed URLs.
- `branding` — public, 8 MB per file, `image/jpeg|png|webp` only (no SVG: it would be served from our storage domain and can carry script).

Workflow:
```bash
npx supabase migration new <name>          # write SQL in the new file
npx supabase db reset                      # local: re-apply everything from scratch
npx supabase gen types typescript --local > app/types/database.types.ts
```
Commit the migration and the regenerated types together (a stale types file breaks CI). Production is changed only with `supabase db push` by the owner — see [`docs/PROD-DB-APPLY.md`](./docs/PROD-DB-APPLY.md).

Authentication → URL Configuration (hosted projects; the local stack takes these from `supabase/config.toml`):
- Site URL = `http://localhost:3000` (or your prod domain)
- Redirect URLs include `http://localhost:3000/**`

### Retention

`archive_expires_at` is set to wedding date + 180 days (365 for Luxury, which is sold with 12 months of storage) and recomputed whenever the wedding date or the tier changes, so a postponed wedding or an upgrade never expires early. A date written explicitly in the same `UPDATE` wins (e.g. an early purge on request); a NULL is always refilled. pg_cron flips expired events to `archived` every hour. The Nitro task [`server/tasks/cleanup-archives.ts`](./server/tasks/cleanup-archives.ts) then deletes their media — every object under `{event_id}/` in both buckets (through the Storage API) and the `photos` rows — and stamps `events.purged_at`. Event rows, branding text and payments stay.

It is scheduled in `nuxt.config.ts` (without `experimental.tasks` it wouldn't even be bundled into `.output`):

```ts
nitro: {
  experimental: { tasks: true },
  scheduledTasks: { '0 3 * * *': ['cleanup-archives'] },   // daily, 03:00 server time
},
```

It is a **dry run** (logs `[retention] dry run, would purge event …`) until `RETENTION_PURGE_ENABLED=true` is set on the server. Watch the dry-run log for a few days before enabling it. An event whose purge fails is logged and retried on the next run; it doesn't hold up the others.

---

## Legal documents and consents

The full privacy policy, user agreement (with the guest rules) and public offer (with the refund policy) are written as drafts **outside this repo** — the drafts carry internal notes that must never be published. `scripts/legal-publish.mjs` turns them into the publishable texts:

```bash
node scripts/legal-publish.mjs --drafts ../memour-legal-drafts   # or LEGAL_DRAFTS_DIR=…
```

It drops the internal sections and every `[ПРОВЕРИТЬ …]` / `[СДЕЛАТЬ …]` / `[BAJARISH …]` / `[TEKSHIRISH …]` marker (and every "[… ДО ПУБЛИКАЦИИ]" instruction), turns the operator's details into tokens, writes `server/assets/legal/{uz,ru}/{privacy,terms,offer}.md` and `shared/legal-meta.json` (version = the date the text last changed; per language the number of open placeholders and of `todo` items), and prints what it removed and what is still open. Commit only those outputs. Nothing is written if any document fails.

`todo` counts what the text must not go out with even once every placeholder is filled: each marker it removed (a statement the drafts themselves say is not true or not settled yet), each reference to an appendix it removed ("Приложение А" of the privacy policy) and each link to a page the site doesn't have (`/legal/consent-couple`, `memour.uz/x` …, checked against `app/pages`). Resolve an item in the draft — make it true, rewrite the sentence, or delete the marker once it is done — and re-run the script.

The full documents go live only when the operator's details are configured (`NUXT_PUBLIC_LEGAL_*`, docs/DEPLOY.md) **and** no placeholder and no `todo` is left; until then `/privacy` and `/terms` serve the short interim pages, `/offer` leads to the terms' refund section, and checkout asks to accept the terms. `NUXT_PUBLIC_LEGAL_PREVIEW=true` shows the drafts, marked as such, for review on a local or staging server.

Every consent is required by the server and recorded in the append-only `consent_events` table (who, which document and version, when, trusted IP, user agent, locale): the lead form (privacy policy), couple login by SMS or email (terms + privacy; opening the email link adds the same documents with the account id, method `email_link`), the guest welcome screen before a device's first upload to an event (guest rules + licence notice + privacy), and checkout (offer, or the interim terms). Versions live in `shared/legal.ts`; bump an interim date there whenever a short page changes.

---

## Project structure

```
app/
  assets/css/main.css     # Tailwind v4 + design tokens + animations
  components/
    marketing/            # Landing components (Hero, Pricing, LeadForm, …)
    guest/                # GuestCamera, GuestVideo, GuestVoice
  composables/useUpload.ts
  layouts/                # default, dashboard, admin, guest
  middleware/auth.global.ts
  pages/
    index.vue             # Marketing landing
    privacy.vue           # Privacy policy (full document or interim text)
    terms.vue             # User agreement / terms of use (same)
    offer.vue             # Public offer + refund policy (full document only)
    e/[id]/index.vue      # Guest event page (camera)
    e/[id]/live.vue       # Live slideshow
    dashboard/            # Couple area (login, events list, event detail,
                          # branding, settings, moderate)
    admin/                # Admin back office (login, events, leads,
                          # referrals, event/create)
  types/database.types.ts # Generated Supabase types
i18n/locales/{ru,uz}.json # All strings
server/
  api/                    # All server endpoints (Nitro)
    admin/                # events, leads, referrals, qr-pdf
    auth/phone/           # send, verify (OTP)
    checkout/[provider]   # payme / click checkout start
    couple/               # branding, photo PATCH, zip
    guest/                # event (read), live-init, upload
    payments/{payme,click}/webhook
    photo/[id]            # signed-URL redirect (with ?t=thumb)
    health.get.ts         # liveness; ?deep=1 also checks Supabase
    lead.post.ts
  tasks/                  # Nitro scheduled tasks (retention purge)
  utils/                  # eskiz, telegram, phone-otp, rate-limit (+ trusted client IP),
                          # errors (fail()), payments, pricing, upload-window, qr-pdf
  assets/fonts/           # Manrope.ttf (PDF Cyrillic support)
supabase/
  config.toml             # local stack (`npx supabase start`)
  migrations/             # schema, RLS, buckets, cron — source of truth
docs/PROD-DB-APPLY.md     # how the owner applies migrations to prod
```

---

## Deploy

### VPS (production)

memour.uz runs as one Node process (Nitro `node-server` preset) on the owner's VPS behind nginx. The whole runbook — runtime env file, systemd/PM2 unit, nginx config, certbot and the post-deploy checks — is [`docs/DEPLOY.md`](./docs/DEPLOY.md).

```bash
pnpm install --frozen-lockfile
pnpm build                            # → .output/
node .output/server/index.mjs         # HOST=127.0.0.1 PORT=3000 in production
```

- **One** instance: rate limits and the retention schedule live in-process.
- Secrets are read at **runtime** only: `NUXT_SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`) and `NUXT_PUBLIC_SITE_URL` must be in the process manager's env, not just at build time. `server/plugins/env-check.ts` refuses to start without them (list in DEPLOY.md → Environment).
- nginx proxies to `127.0.0.1:3000` and sets `X-Real-IP $remote_addr` + `X-Forwarded-For $proxy_add_x_forwarded_for`: every per-IP limit (login, guest upload, lead form) keys on them, and trusts them only from the local proxy.
- Health checks:
  - `GET /api/health` → `200 {"ok":true}` whenever the Node process answers; it never touches Supabase. Point the process watchdog here.
  - `GET /api/health?deep=1` → also queries Supabase: `503` (`db_unavailable`) within ~3 s when it is down or paused. Point an external uptime monitor here and **alert only**: restarting Node doesn't bring a paused database back, it only cuts off uploads in progress and resets the rate limits.
- Database changes ship **before** the app that needs them: `supabase db push` first, then deploy (see [`docs/PROD-DB-APPLY.md`](./docs/PROD-DB-APPLY.md)).

### Domain

Whatever domain you use (e.g. `memour.uz`), update:
- `NUXT_PUBLIC_SITE_URL`
- Supabase Auth → Redirect URLs
- Payme / Click merchant return URL config

### Vercel (not used)

The app also builds on Vercel (framework preset **Nuxt**), but that is not how prod runs. If you ever move there: the retention task needs a Vercel Cron instead of `nitro.scheduledTasks`, the in-memory rate limits reset per function instance, and the function region must be pinned next to the Supabase region (Vercel defaults to `iad1`).

---

## Production readiness

Done:
- [x] Phone OTP login (Eskiz)
- [x] Couple/admin auth + RLS
- [x] Guest camera (photo/video/voice) + soft geofence + upload window (18:00 the evening before → 12:00 the day after, Tashkent)
- [x] Live slideshow (polls `/api/guest/live-init`, catches up after a dropped connection)
- [x] Tier limits enforced on the server (`shared/plans.ts`): per-phone photo/video/voice quotas, guests per event, live slideshow and guest-page design from Pro
- [x] QR PDF generation (PDFKit + Manrope Cyrillic)
- [x] ZIP archive streaming (archiver)
- [x] Swipe moderation
- [x] Payme + Click checkout + JSON-RPC/REST webhooks
- [x] Telegram outbound notifications (lead, payment, new photo — debounced)
- [x] Sharp-based thumbnail generation + EXIF strip
- [x] Upload progress UI (XHR-based)
- [x] Rate limits: guest upload (20/min per device, 600/min per IP), login SMS / codes, admin login, lead form
- [x] Privacy + Terms pages (ru/uz)
- [x] Branded 404 page
- [x] Custom error codes with localized messages
- [x] Schema, RLS and buckets in `supabase/migrations` (clients read-only)
- [x] Retention purge task, scheduled daily (`server/tasks/cleanup-archives.ts`, dry run until enabled)
- [x] `/api/health` for the process watchdog, `?deep=1` for the uptime monitor
- [x] CI on GitHub Actions (typecheck + build; migrations applied to a fresh database + `db lint`)

Pending (require your action — external services):
- [ ] **Supabase plan.** Prod is on the Free plan: no backups at all, 1 GB file storage and 5 GB egress (one wedding with ~150 active guests is 1–2 GB of photos before any video), and the project is paused after 7 days of low activity (every QR code and login then fails until someone presses Resume). Move to Pro (daily backups, 100 GB storage, no pausing) before the first paid wedding, and keep an off-site copy of the `photos` bucket — database backups do not include Storage files.
- [ ] Supabase region: the project is in `ap-northeast-1` (Tokyo), far from Uzbekistan: every API call and photo crosses Asia. Recreating it in `eu-central-1` is cheap while the `photos` bucket is still empty.
- [ ] Eskiz contract → approved Memour templates (login code; "cabinet is open" in uz and ru), then `ESKIZ_USE_TEST_TEMPLATE=false`
- [ ] Eskiz alpha sender name `MEMOUR`
- [ ] Payme merchant — fill `PAYME_MERCHANT_ID/KEY` in `.env`
- [ ] Click merchant — fill `CLICK_SERVICE_ID/MERCHANT_ID/SECRET_KEY` in `.env`
- [ ] 1200×630 OG image (currently uses `memour-logo.png`)
- [ ] Sentry / error tracking (DSN env var)
- [ ] Turn on the retention purge (`RETENTION_PURGE_ENABLED=true`) after checking its first dry-run log — required: the privacy page, Pricing, the guest screen and checkout promise deletion (docs/DEPLOY.md §8)
- [ ] Tests (none written; recommended for OTP + payment webhooks)
- [ ] CD (deploys to the VPS are manual)

---

## License

Proprietary — © Memour. All rights reserved.
