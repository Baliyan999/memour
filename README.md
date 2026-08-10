# Memour

Wedding photo SaaS — QR codes on guest tables, browser-native camera, real-time slideshow, couple dashboard.

**Live:** https://memour.uz (not yet deployed)
**Stack:** Nuxt 4 · Vue 3 · Tailwind v4 · Supabase (Postgres + Auth + Storage + Realtime) · Eskiz SMS · Telegram Bot · Payme / Click

---

## What it does

A couple buys a wedding tier on the landing → admin creates the event → couple logs into the dashboard with a phone OTP → downloads a printable PDF with one QR code per table → on the wedding day guests scan their table's QR, open a branded landing in the browser, take photos directly (no app to install) → photos stream to a live slideshow on the venue projector → after the wedding the couple swipes through to moderate and downloads everything as a ZIP.

---

## Local dev

```bash
pnpm install
cp .env.example .env   # fill in your own values
pnpm dev               # → http://localhost:3000
```

Required services:
- Supabase project (free plan is fine for dev)
- Eskiz.uz account in **Test mode** (still works — code shown in DEV banner)
- Telegram bot (optional — lead notifications)
- Payme / Click merchant (optional — payments fall back to dev mode without credentials)

### Env vars

See [`.env.example`](./.env.example). Bare minimum to boot:

```env
NUXT_PUBLIC_SITE_URL=http://localhost:3000
NUXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NUXT_PUBLIC_SUPABASE_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

---

## Database

Migrations were applied via Supabase MCP during development. To replicate on a fresh project, run these in `SQL Editor`:

1. `memour_schema_v1` — events, leads, photos, branding, admins, referrals, attributions
2. `phone_otps_v1` — OTP storage
3. `events_owner_phone` — phone-based event ownership claim
4. `photos_realtime` — enables Realtime on photos table
5. `photos_media_type` — photo / video / voice classification + duration
6. `payments_v1` — transactions
7. `leads_status` — lead workflow (new/contacted/won/lost)

Storage buckets: `photos` (private) and `branding` (public). Created by the migrations.

Authentication → URL Configuration:
- Site URL = `http://localhost:3000` (or your prod domain)
- Redirect URLs include `http://localhost:3000/**`

Regenerate TypeScript types after schema changes:
```bash
# via Supabase CLI
supabase gen types typescript --project-id <ref> > app/types/database.types.ts
```

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
    privacy.vue           # Privacy policy (ru/uz)
    terms.vue             # Terms of use (ru/uz)
    e/[id].vue            # Guest event page (camera)
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
    lead.post.ts
  utils/                  # eskiz, telegram, phone-otp, rate-limit, pricing
  assets/fonts/           # Manrope.ttf (PDF Cyrillic support)
```

---

## Deploy

### Vercel (recommended)

1. Push the repo to GitHub.
2. New Project on vercel.com → Import.
3. Build settings: framework **Nuxt**, no overrides.
4. Environment variables — copy everything from `.env`. Update `NUXT_PUBLIC_SITE_URL` to your production domain.
5. Deploy.
6. In Supabase → Auth → URL Configuration, add your Vercel preview + production URLs to the Redirect URLs allowlist.

### VPS

```bash
pnpm build                            # → .output/
node .output/server/index.mjs         # plain node, port 3000
```

Reverse-proxy via nginx/caddy with your domain. Set env vars in your process manager (systemd, PM2).

### Domain

Whatever domain you use (e.g. `memour.uz`), update:
- `NUXT_PUBLIC_SITE_URL`
- Supabase Auth → Redirect URLs
- Payme / Click merchant return URL config

---

## Production readiness

Done:
- [x] Phone OTP login (Eskiz)
- [x] Couple/admin auth + RLS
- [x] Guest camera (photo/video/voice) + geofence + ±18h window
- [x] Live slideshow with Supabase Realtime
- [x] QR PDF generation (PDFKit + Manrope Cyrillic)
- [x] ZIP archive streaming (archiver)
- [x] Swipe moderation
- [x] Payme + Click checkout + JSON-RPC/REST webhooks
- [x] Telegram outbound notifications (lead + new photo, debounced)
- [x] Sharp-based thumbnail generation + EXIF strip
- [x] Upload progress UI (XHR-based)
- [x] Rate limiting on guest upload (30/min per IP)
- [x] Privacy + Terms pages (ru/uz)
- [x] Branded 404 page
- [x] Custom error codes with localized messages

Pending (require your action — external services):
- [ ] Eskiz contract → custom SMS template (`ESKIZ_USE_TEST_TEMPLATE=false`)
- [ ] Eskiz alpha sender name `MEMOUR`
- [ ] Payme merchant — fill `PAYME_MERCHANT_ID/KEY` in `.env`
- [ ] Click merchant — fill `CLICK_SERVICE_ID/MERCHANT_ID/SECRET_KEY` in `.env`
- [ ] 1200×630 OG image (currently uses `memour-logo.png`)
- [ ] Sentry / error tracking (DSN env var)
- [ ] Scheduled job for archive_expires_at cleanup
- [ ] Tests (none written; recommended for OTP + payment webhooks)
- [ ] CI/CD on GitHub Actions

---

## License

Proprietary — © Memour. All rights reserved.
