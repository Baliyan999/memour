# Memour — notes for AI coding agents

Wedding photo sharing for Uzbekistan (memour.uz). Guests scan a QR code and shoot photos, video clips and voice messages in the browser, with no app. The couple gets a live album, a slideshow and a ZIP; the team runs a back office.

- **Stack:** Nuxt 4 + Nitro + Supabase (Postgres, Auth, Storage, Realtime), Tailwind v4, zod, @nuxtjs/i18n.
- **Production:** one Node process behind nginx on a VPS.
- **Languages:** Uzbek (default, `/uz`) and Russian (`/ru`).

This file holds the rules. Background is in `README.md` (architecture, database, retention, bot, consents), `CONTRIBUTING.md` (setup, conventions), `docs/DEPLOY.md` (server runbook) and `docs/PROD-DB-APPLY.md` (prod migrations). The owner also keeps a private handover document (state of the project, roadmap, budget, real server layout). It is not in git, so ask the owner for it.

## Commands

```bash
pnpm install
npx supabase start            # local stack in Docker, applies supabase/migrations
pnpm dev                      # http://localhost:3000 — SMS codes print to the server console, emails go to Mailpit (:54324)

pnpm exec nuxt typecheck      # CI runs exactly these two; both must pass
pnpm build

npx supabase migration new <name>
npx supabase db reset         # re-apply all migrations from scratch
npx supabase gen types typescript --local > app/types/database.types.ts

pnpm test                     # unit tests (Vitest)
pnpm test:e2e                 # e2e smoke on the built app — needs `pnpm build` and the local stack's env (CONTRIBUTING.md → Tests)

scripts/deploy.sh deploy --dry-run   # deploy plan; then `deploy`, `rollback`, `status` (docs/DEPLOY.md)
node --env-file=.env scripts/telegram-setup.mjs --dry-run   # bot webhook/commands; also --info
```

Tests cover pure logic and a smoke path through the main flows; they don't replace looking. Verify UI changes in the running app in both locales, at 344 px wide and on desktop, before calling them done, and add an e2e scenario when you add a flow.

## Where things live

| Path | What it is |
|---|---|
| `app/pages/` | Landing (`index.vue`), legal pages, guest event page and slideshow (`e/[id]/`), couple area (`dashboard/`), back office (`admin/`) |
| `server/api/` | Every endpoint. Writes happen only here, on the service role. |
| `server/utils/errors.ts` | `fail()` / `failZod()` — the error contract for every endpoint |
| `server/tasks/` + `nuxt.config.ts` (`scheduledTasks`) | In-process cron: archive cleanup at 03:00, Telegram reminders at 05:00 UTC |
| `shared/plans.ts` | **Single source of truth for the tiers** (quotas, guests per event, features). The server enforces it. The pricing copy in `i18n` (`pricing.*`) must promise exactly this; change the two together. |
| `shared/legal.ts` | Legal document versions. Consents are recorded in `consent_events`. |
| `server/utils/telegram-texts.ts` | What the bot says, in uz and ru. Not part of `i18n`. |
| `i18n/locales/{uz,ru}.json` | Every string the site shows |
| `supabase/migrations/` | Schema, RLS, buckets and cron. This is the source of truth for the database. |
| `app/types/database.types.ts` | Generated. Never edit by hand. |

## Rules

1. **The site only promises what the code does.** Every line on the landing page, in pricing and in the legal pages must match real behaviour; consumer-protection law applies. If a feature isn't built, mark it «скоро / tez orada» or don't mention it. Check copy against the code before you change either one.
2. **Errors only in the site's language.**
   - Server: `fail(status, 'snake_case_code', { field?, params? })` or `failZod(...)`.
   - Client: `useErrorMessage(scope)` turns the code into `t('errors.<code>')`.
   - Never show raw zod, Supabase or HTTP text, or "Network error", in the UI.
   - Every new code needs a translation in both locales.
3. **Uzbek first, Russian second.**
   - Every user-facing string goes into both `uz.json` and `ru.json`. Never hardcode text in components.
   - Uzbek uses the ASCII apostrophe (`o'`, `g'`).
   - Landing copy breaks easily at 344 px, so check it there.
4. **The browser never writes to the database.** `useSupabaseClient` only reads, and RLS grants clients only SELECT on their own rows. Any write is a server endpoint with zod validation.
5. **Migrations:**
   - Add a new file; never edit a migration that has already been applied.
   - Apply it to the prod database **before** deploying the code that needs it.
   - Regenerate `database.types.ts` in the same change. A stale types file once kept CI red for two months.
6. **Git:**
   - One branch per change (`feat/…`, `fix/…`, `docs/…`).
   - Changes land in `main` only by squash merge; `main` is what runs in production.
   - Commit subjects are lowercase with an area prefix: `tiers: …`, `landing: …`, `telegram: …`.
7. **The repo is public.** Never commit `.env`, keys or tokens, personal data, the contents of `_private/`, or legal drafts. Secrets are read at runtime only (`server/plugins/env-check.ts`). Never put one in public `runtimeConfig` or in the build.
8. **Run one instance only.** Rate limits, digest timers and scheduled tasks live in process memory. Scaling out needs that state moved to Redis or the database first.
9. **PostgREST returns at most 1000 rows.** Read lists page by page.
10. **Motion follows Apple's approach:** springs, interruptible gestures, and respect for `prefers-reduced-motion`. The tone is premium and wedding-like, never flashy.

## Production safety

- Work against your own Supabase: the local stack, or a hosted project of your own. Don't run `supabase link`, `supabase db push` or SQL against the prod project unless the owner asks for that exact action.
- **A valid POST in production sends real, paid SMS (Eskiz) and real Telegram messages to real couples.** Smoke-test prod only with GET requests or deliberately invalid payloads.
- Before anything destructive in production, ask the owner first and have a backup and a rollback plan ready. That covers deleting data, rotating keys, changing env flags and running migrations.
- The Supabase MCP `apply_migration` records the current timestamp as the migration version. Right after it, set the version in `supabase_migrations.schema_migrations` to the one in the file name. Otherwise `supabase db push` will apply the migration a second time.
- On the server, don't use `pkill -f` or `pgrep -f` inside `ssh '…'`: the pattern matches the ssh command line itself and kills your own session. Stop processes by their saved pid.
- If the bot token, the webhook secret or the domain changes, re-run `scripts/telegram-setup.mjs`.
- Deploy only with `scripts/deploy.sh` and only after the migrations it lists are applied to prod. It refuses otherwise; don't work around the guard.
