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
- **Secrets** — `.env` is never committed. Get the values from Albert through a secure channel (not chat/email). `.env.example` documents every key.

## Setup

See [README → Local dev](./README.md#local-dev). Supabase free tier is enough for development — or ask Albert for access to the shared dev project.
