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
- **DB types** — `app/types/database.types.ts` is generated. Never edit by hand. After any schema migration, regenerate:
  ```bash
  supabase gen types typescript --project-id <ref> > app/types/database.types.ts
  ```
  A stale types file breaks typecheck (and CI) for everyone.
- **Server endpoints** — Nitro handlers in `server/api/`, validation with zod, errors via `createError` with a `data.code` machine code (localized client-side).
- **Secrets** — `.env` is never committed and never shared. Each developer runs their own Supabase project and fills `.env` with their own values; `.env.example` documents every key. Production credentials stay with the repo owner.

## Setup

See [README → Local dev](./README.md#local-dev). Create your own free Supabase project and apply the migrations listed in [README → Database](./README.md#database) — you get a fully working local environment without any shared credentials. Eskiz/Telegram/Payme are optional in dev (the app falls back gracefully without them).
