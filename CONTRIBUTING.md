# Contributing

Small team, simple rules.

## Workflow

1. Branch off `main`: `feat/<what>`, `fix/<what>`, `docs/<what>`.
2. Open a PR to `main` — even for small changes. No direct pushes to `main`.
3. CI (typecheck + build, migrations, unit and e2e tests) must be green before merge.
4. One reviewer approval is enough. Keep PRs small and focused.

## Before you push

```bash
pnpm exec nuxt typecheck
pnpm build
pnpm test
```

All three must pass. CI also applies the migrations to a fresh database and runs the e2e smoke tests ([Tests](#tests)).

## Conventions

- **Commit messages** — lowercase, area prefix: `guest capture: …`, `qr pdf: …`, `admin: …`.
- **i18n** — every user-facing string goes to `i18n/locales/ru.json` **and** `uz.json`. Never hardcode text in components.
- **Schema changes** — only as a new file in `supabase/migrations/` (`npx supabase migration new <name>`), never by hand in a dashboard. Old migrations are never edited: prod has already run them.
- **DB types** — `app/types/database.types.ts` is generated. Never edit by hand. After any schema migration, regenerate:
  ```bash
  npx supabase gen types typescript --local > app/types/database.types.ts
  ```
  A stale types file breaks typecheck (and CI) for everyone.
- **No client-side writes** — the browser client (`useSupabaseClient`) only reads; RLS gives clients SELECT on their own rows and nothing else. Writes go through a server endpoint on the service role.
- **Server endpoints** — Nitro handlers in `server/api/`, validation with zod, errors via `createError` with a `data.code` machine code (localized client-side).
- **Secrets** — `.env` is never committed and never shared. Each developer runs their own Supabase (the local stack, or a hosted project of their own) and fills `.env` with their own values; `.env.example` documents every key. Production credentials stay with the repo owner.

## Setup

Needs Docker (Docker Desktop / OrbStack) for the local Supabase stack.

```bash
pnpm install
npx supabase start                 # Postgres, Auth, Storage, Realtime; applies supabase/migrations
npx supabase status -o env         # API_URL, ANON_KEY, SERVICE_ROLE_KEY for .env
cp .env.example .env
#   NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#   NUXT_PUBLIC_SUPABASE_KEY=<ANON_KEY>
#   SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
pnpm dev
```

Local URLs: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, Mailpit (all auth emails) `http://127.0.0.1:54324`, Postgres `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

- **Couple login** — use the email tab; the code/link arrives in Mailpit. Phone login needs your own Eskiz credentials.
- **Admin** — create a user in Studio (Authentication → Add user, with a password), then:
  ```sql
  insert into public.admins (user_id, role, telegram_chat_id)
  select id, 'super', '<your Telegram chat id>' from auth.users where email = 'you@example.com';
  ```
  Admin login sends a 2FA code to that chat, so set `TELEGRAM_BOT_TOKEN` to a bot of your own and `/start` it once.
- **Schema work** — `npx supabase migration new <name>`, write the SQL, `npx supabase db reset` to re-apply everything from scratch, regenerate the types, commit both.
- **Stop** — `npx supabase stop` (data kept) or `npx supabase stop --no-backup` (wiped).

No shared credentials are needed at any point. A hosted project of your own works too: `npx supabase link --project-ref <your ref>` + `npx supabase db push`. Never link or push to the prod project — the owner applies prod migrations ([docs/PROD-DB-APPLY.md](./docs/PROD-DB-APPLY.md)). Eskiz/Payme/Click are optional in dev (the app falls back gracefully without them).

## Tests

**Tests never touch production.** The e2e harness refuses any Supabase or Mailpit URL that isn't on your machine, the app under test gets fake Telegram/Eskiz credentials, and a fetch mock preloaded into it answers every SMS and Telegram call locally and blocks every other outbound host. Never point `API_URL` or the keys at a hosted project.

### Unit (`tests/unit`, Vitest)

```bash
pnpm test
```

Pure logic only: tiers (`shared/plans.ts`, and that the pricing copy matches them), prices, the upload window, the error contract on both sides, file sniffing, bot texts, consents, phone and rate-limit helpers. No database, no network, no Nuxt app: the `#shared` / `~` / `~~` aliases resolve to the real folders, and the few auto-imports the code calls (`createError`, `getRequestHeader`, `useRuntimeConfig`) are shimmed in `tests/unit/setup.ts`. A test that needs the database mocks `#supabase/server` (see `guest-quota.test.ts`).

### E2E (`tests/e2e`, Playwright, Chromium)

They run the **built** app against your local stack:

```bash
npx supabase start                            # local stack incl. Mailpit (:54324)
set -a; eval "$(npx supabase status -o env)"; set +a   # API_URL, ANON_KEY, SERVICE_ROLE_KEY
pnpm build
pnpm exec playwright install chromium         # once (or E2E_CHROMIUM_CHANNEL=chrome to use your Chrome)
pnpm test:e2e
```

- The global setup builds nothing: it fails with a clear message if `.output/` is missing or the variables aren't set, then starts `.output/server/index.mjs` on `E2E_PORT` (default 3100) with `tests/e2e/harness/mock-fetch.mjs` preloaded, and stops it after the run.
- Logs of the last run: `test-results/e2e-run/server.log` (the app) and `test-results/e2e-run/mock.jsonl` (every SMS / Telegram message the app tried to send). A failed test leaves a trace: `pnpm exec playwright show-trace test-results/<test>/trace.zip`.
- The browser reaches only `localhost`; fonts and CDNs are blocked.

**Adding a scenario** — a new `tests/e2e/<name>.spec.ts`:

```ts
import { expect, test } from './harness/fixtures'
import { t } from './harness/messages'
import { gotoHydrated } from './harness/pages'

test('…', async ({ page, seed }) => {
  const event = await seed.event({ plan_tier: 'premium' })   // active, wedding today
  await gotoHydrated(page, `/uz/e/${event.id}?t=1`)          // waits for hydration before typing
  await expect(page.getByText(t('uz', 'guest.welcome.eyebrow'))).toBeVisible()
})
```

- Seed only through `seed` (`event()`, `user()`, `admin()`), and name things with `seed.name()` / `seed.email()`: every row gets the test's unique `e2e-xxxxxxxx` prefix and is deleted after the test — storage objects, events (photos, guest devices, branding cascade), leads, admin login codes, auth users, emails. `consent_events` is append-only by design, so the consent records a test writes stay.
- Assert visible text with `t(locale, key)` from `i18n/locales`, never with copied strings.
- Codes and notifications: `waitForMock(toTelegramChat(chatId))` (`harness/mock-log.ts`); auth emails: `waitForMail(address)` (`harness/mailbox.ts`).
- Keep scenarios smoke-level, independent of each other and of what else is in the database.
