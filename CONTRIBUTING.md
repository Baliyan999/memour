# Contributing

Small team, simple rules.

## Workflow

1. Branch off `main`: `feat/<what>`, `fix/<what>`, `docs/<what>`.
2. Open a PR to `main` — even for small changes. No direct pushes to `main`.
3. CI (typecheck + build) must be green before merge.
4. One reviewer approval is enough. Keep PRs small and focused.

## Before you push

```bash
pnpm exec nuxt typecheck
pnpm build
```

Both must pass — CI runs exactly these two.

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
