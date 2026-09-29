# Applying the database migrations to prod

For the owner only. Prod project: `izleuhctwdheavkuzdhr`.

Six new migrations:

| File | Effect in prod |
|---|---|
| `20260928000000_branding_bucket.sql` | No-op: the `branding` bucket already exists (it was created by hand). It exists so a fresh project gets the bucket too. |
| `20260928000100_security_hardening.sql` | Closes the hole where a logged-in couple could activate or upgrade their event without paying, create free active events, delete an event together with its payments, repoint `photos.storage_path` at any object in the private bucket, and write branding past the server's limits — all straight through the REST API with the public anon key and their own session. Clients become read-only; payments can no longer be cascade-deleted; storage limits; `events.purged_at` for the retention task; Luxury events keep their media 12 months (wedding + 365 days) instead of 180 days, since expiry now really deletes; the expiry date is recomputed when the wedding date or tier changes; deleting a couple's account also clears the event's `owner_phone`. |

| `20260928000200_purge_otps_cron.sql` | A daily pg_cron job (`memour_purge_otps`, 03:17 UTC) deletes login-code rows (`phone_otps`, `admin_otps`: phone / email, IP, user agent) older than 7 days. The login limits only look at the last hour. |
| `20260928000300_payments_unique_paid.sql` | Unique indexes: at most one settled provider payment per event, one row per provider transaction. Closes the last double-charge race (Payme and Click completing at the same instant). Fails if prod already has such duplicates — pre-check 5. |
| `20260928010000_consent_events.sql` | New append-only table `consent_events`: who accepted which legal text, when and from where (lead form, couple login, guest welcome screen, checkout). No client access; UPDATE / DELETE / TRUNCATE refused. Nothing else changes. **The app of this release needs it:** without the table every lead, login, first guest upload and checkout fails, because a consent that can't be recorded stops the action. |
| `20260928020000_leads_plan_tier.sql` | New nullable column `leads.plan_tier`: the tier a visitor picked on a Pricing card before sending the lead form. `/admin/leads` shows it and "→ create event" pre-selects it. Existing rows stay `NULL`. **The app of this release needs it:** without the column every lead form submission fails. |

The twelve older files in `supabase/migrations/` are prod's own history, under the same versions (only the two bootstrap `UPDATE`s that named the founding admin are left out of the repo). `supabase db push` sees them as already applied and doesn't run them again.

## Order: migration first, then the app

The hardening migration is compatible with the app that runs **now** (main @ 35e1833), and the consent table and `leads.plan_tier` are invisible to it (a new table and a nullable column the old app never touches). The app never writes to the database from the browser. Every write goes through a server endpoint on the service role, which RLS and grants don't restrict. This was checked by running main's own build against a hardened local copy of the schema: couple phone-OTP login, dashboard, event page, branding save, moderation, payment gate, guest photo and voice upload, `/api/photo`, and admin login with Telegram 2FA all worked.

1. **Apply the migrations** (below). The hardening closes the hole right away.
2. **Deploy the app** (docs/DEPLOY.md). It brings the retention task, scheduled daily at 03:00 in `nuxt.config.ts`; check that the deployed `.output/server/chunks/tasks/cleanup-archives.mjs` exists. Leave `RETENTION_PURGE_ENABLED` unset for the first night only, so the task does one dry run — then it is required (DEPLOY.md §8 step 6). `app/types/database.types.ts` in the repo already has `events.purged_at`.

**SVG QR logos.** The `branding` bucket stops accepting SVG. The app in this release offers PNG, JPEG and WebP only and answers an SVG with "unsupported format"; the app still running *before* the deploy lets an admin pick an SVG and then shows a misleading "couldn't send, check your connection". Between migration and deploy, tell admins to use PNG, JPEG or WebP. The one SVG logo already stored (event `660d104c…`) keeps working, because bucket limits only apply to new uploads; replace it with a PNG when convenient.

**What the migration changes in prod data** (4 events today):

| Event | Now | After |
|---|---|---|
| `660d104c…` Luxury, wedding 2026-05-30 | expires 2026-11-26 (old 180-day default) | 2027-05-30 (wedding + 365) |
| `71335038…` Pro, active, wedding 2026-05-23 | **no expiry** (created before the expiry trigger existed): never archived, never purged | 2026-11-19 (wedding + 180) |
| `05f16196…`, `5d922aa2…` Basic drafts | wedding + 180 | unchanged |

`71335038…` («Алиса и Дамир») is the demo event used for read-only smoke checks. From 2026-11-19 pg_cron archives it: the guest page stops accepting uploads, and once the purge is enabled its media is deleted. If it should stay a live demo, give it a later date after the migration (an explicit date is kept):
```sql
update public.events set archive_expires_at = '2027-12-31' where id::text like '71335038%';
```

## Pre-checks (read-only, SQL editor)

```sql
-- 1. History is exactly the 12 known migrations, ending with guest_devices_binding
select version, name from supabase_migrations.schema_migrations order by version;

-- 2. No hand-made policy drift: expect exactly these 7 rows
--    admins_self_select, branding_via_owner, events_owner_modify, events_owner_select,
--    payments_owner_select, photos_owner_select, photos_owner_update
select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2;

-- 3. The two FKs the migration recreates exist under these names: expect 2 rows, both ON DELETE CASCADE
select conname, pg_get_constraintdef(oid) from pg_constraint
where conname in ('payments_event_id_fkey', 'events_owner_id_fkey');

-- 4. What is stored now (the limits only affect new uploads)
select bucket_id, metadata->>'mimetype' as mime, count(*), max((metadata->>'size')::bigint) as max_bytes
from storage.objects group by 1, 2 order by 1, 2;

-- 5. No duplicates the payment indexes would refuse: expect 0 rows from each
select event_id, count(*) from public.payments
where status = 'paid' and provider_transaction_id is not null group by 1 having count(*) > 1;
select provider, provider_transaction_id, count(*) from public.payments
where provider_transaction_id is not null group by 1, 2 having count(*) > 1;
```

If check 1 or 2 shows anything else, stop and compare with `supabase/migrations/` first. Someone changed prod by hand. If check 5 returns rows, a couple really paid twice: refund one of them with the provider and mark that row `refunded` before applying `20260928000300`.

**Backup first.** The Free plan has no backups at all. From the repo root, on the branch that contains the migrations (needs Docker; `link` asks for the DB password from Dashboard → Project Settings → Database):

```bash
npx supabase login
npx supabase link --project-ref izleuhctwdheavkuzdhr
npx supabase db dump --linked -f prod-schema-$(date +%F).sql
npx supabase db dump --linked --data-only -f prod-data-$(date +%F).sql
```

Storage files are not in these dumps. Today that doesn't matter: `photos` is empty and `branding` holds 2 files.

## Apply

**Option A — CLI (recommended).** Same shell as the backup (already linked):

```bash
npx supabase migration list      # 12 rows with Local = Remote, 6 rows with Remote empty
npx supabase db push --dry-run   # must list exactly the 6 new files
npx supabase db push
```

**Option B — SQL editor.** Paste and run `20260928000000_branding_bucket.sql`, `20260928000100_security_hardening.sql`, `20260928000200_purge_otps_cron.sql`, `20260928000300_payments_unique_paid.sql`, `20260928010000_consent_events.sql` and `20260928020000_leads_plan_tier.sql`, in that order, each as a whole. Then record them in the history so a later `db push` doesn't run them again:

```bash
npx supabase migration repair --status applied 20260928000000 20260928000100 20260928000200 20260928000300 20260928010000 20260928020000
```

All six migrations are idempotent. Running one twice is harmless.

## Post-checks

```sql
-- Policies: 5 rows, all SELECT, all {authenticated}
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by 1, 2;

-- Client grants: only SELECT, only on admins, branding, events, payments, photos
select table_name, grantee, string_agg(privilege_type, ',') from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated') group by 1, 2 order by 1, 2;

-- FKs: payments → events ON DELETE RESTRICT, events.owner_id → auth.users ON DELETE SET NULL
select conname, pg_get_constraintdef(oid) from pg_constraint
where conname in ('payments_event_id_fkey', 'events_owner_id_fkey');

-- Buckets: photos 31457280 + 9 media types, branding 8388608 + jpeg/png/webp
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

-- The hourly archive job still works (runs as postgres)
select public.archive_expired_events();

-- Retention days per event: 365 for Luxury, 180 for the rest, no NULLs
-- (today: basic 180, basic 180, luxury 365, pro 180)
select plan_tier, archive_expires_at::date - wedding_date as days from public.events order by 1;

-- Triggers on events: events_release_owner_phone, events_set_archive_expiry
-- (UPDATE OF wedding_date, plan_tier, archive_expires_at), events_set_updated_at
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'public.events'::regclass and not tgisinternal order by 1;

-- Cron: memour_archive_expired_events (0 * * * *) and memour_purge_otps (17 3 * * *)
select jobname, schedule from cron.job order by 1;

-- Payments: payments_one_paid_per_event and payments_provider_tx_unique (both UNIQUE, partial)
select indexname, indexdef from pg_indexes where tablename = 'payments' order by 1;

-- Consent log: RLS on, no client grants, the two append-only triggers
select relrowsecurity from pg_class where oid = 'public.consent_events'::regclass;   -- true
select grantee, privilege_type from information_schema.role_table_grants
where table_name = 'consent_events' and grantee in ('anon', 'authenticated');       -- 0 rows
select tgname from pg_trigger where tgrelid = 'public.consent_events'::regclass and not tgisinternal;
-- consent_events_no_change, consent_events_no_truncate

-- Leads: the Pricing tier column
select data_type from information_schema.columns where table_name = 'leads' and column_name = 'plan_tier';  -- text
```

Then, in the app:
- Couple dashboard, one event page and the branding page open.
- `/admin` opens after login.
- `https://memour.uz/api/health` and `https://memour.uz/api/health?deep=1` both answer `{"ok":true}` (after the app deploy).
- Optionally, confirm the hole is closed. Log in as a test couple, then in devtools take the access token from the `sb-…-auth-token` cookie:
  ```bash
  curl -i -X PATCH "https://izleuhctwdheavkuzdhr.supabase.co/rest/v1/events?id=eq.<test event id>" \
    -H "apikey: <anon key>" -H "Authorization: Bearer <access token>" \
    -H "Content-Type: application/json" -d '{"plan_tier":"luxury"}'
  # expect 403 "permission denied for table events"; before the migration this was 200
  ```
- Dashboard → Advisors: the `auth_rls_initplan`, `multiple_permissive_policies`, `function_search_path_mutable` and `unindexed_foreign_keys` warnings for these tables are gone.

## Rollback

The two small migrations roll back on their own, without touching the hardening:

```sql
begin;
select cron.unschedule('memour_purge_otps');
drop index if exists public.payments_one_paid_per_event;
drop index if exists public.payments_provider_tx_unique;
delete from supabase_migrations.schema_migrations where version in ('20260928000200', '20260928000300');
commit;
```

The hardening only if the app breaks in a way that can't wait for a fix. **This re-opens the hole.** Roll back the two small ones above first, then run this in the SQL editor:

```sql
begin;

-- policies: back to the original set
drop policy if exists branding_owner_select on public.branding;
drop policy if exists events_owner_select   on public.events;
drop policy if exists photos_owner_select   on public.photos;
drop policy if exists payments_owner_select on public.payments;
drop policy if exists admins_self_select    on public.admins;
create policy events_owner_select on public.events
  for select using (auth.uid() = owner_id);
create policy events_owner_modify on public.events
  for all using (auth.uid() = owner_id);
create policy branding_via_owner on public.branding
  for all using (exists (select 1 from public.events e
                         where e.id = branding.event_id and e.owner_id = auth.uid()));
create policy photos_owner_select on public.photos
  for select using (exists (select 1 from public.events e
                            where e.id = photos.event_id and e.owner_id = auth.uid()));
create policy photos_owner_update on public.photos
  for update using (exists (select 1 from public.events e
                            where e.id = photos.event_id and e.owner_id = auth.uid()));
create policy payments_owner_select on public.payments
  for select using (exists (select 1 from public.events e
                            where e.id = payments.event_id and e.owner_id = auth.uid()));
create policy admins_self_select on public.admins
  for select using (auth.uid() = user_id);

-- grants: Supabase defaults
grant all on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
grant execute on function public.archive_expired_events() to public, anon, authenticated;
alter function public.set_updated_at()         reset search_path;
alter function public.archive_expired_events() reset search_path;
create or replace function public.set_event_archive_expiry()
returns trigger language plpgsql as $$
begin
  if new.archive_expires_at is null then
    new.archive_expires_at := (new.wedding_date::timestamptz + interval '180 days');
  end if;
  return new;
end;
$$;
drop trigger if exists events_set_archive_expiry on public.events;
create trigger events_set_archive_expiry
  before insert or update of wedding_date on public.events
  for each row execute function public.set_event_archive_expiry();
drop trigger if exists events_release_owner_phone on public.events;
drop function if exists public.release_detached_owner_phone();

-- foreign keys: back to cascade
alter table public.payments
  drop constraint if exists payments_event_id_fkey,
  add constraint payments_event_id_fkey
    foreign key (event_id) references public.events(id) on delete cascade;
alter table public.events
  drop constraint if exists events_owner_id_fkey,
  add constraint events_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete cascade;

drop index if exists public.leads_converted_event_idx;
drop index if exists public.referral_attributions_ref_idx;
drop index if exists public.referral_attributions_lead_idx;
drop index if exists public.referral_attributions_event_idx;

-- storage limits off
update storage.buckets set file_size_limit = null, allowed_mime_types = null
  where id in ('photos', 'branding');

-- events.purged_at is left in place: harmless, and it records purges already done.
-- Expiry dates the migration filled in or moved up keep their new value (it only means longer storage).

delete from supabase_migrations.schema_migrations where version = '20260928000100';
commit;
```

This was tested on a local copy. After the rollback the catalog (policies, grants, default privileges, FKs, function ACLs and bodies, triggers, indexes, buckets) matches the pre-migration state; the only difference is the extra `purged_at` column. Re-applying the migration afterwards works.

## After the migration: operations

- **Login-code trail.** `phone_otps` / `admin_otps` rows older than 7 days are deleted every night by `memour_purge_otps`.
- **Retention.** After the deploy the task logs a dry run once a day: `[retention] dry run, would purge event <id>: N objects, M photo rows`, then `[retention] done {…}`. Once the first lines look right, set `RETENTION_PURGE_ENABLED=true` in the server env and restart — required, the site's texts promise the deletion (DEPLOY.md §8). From then on, media of events past `archive_expires_at` (wedding + 180 days, 365 for Luxury) is deleted for good. The event row, its branding text and its payments stay.
- **Deleting a couple's account.** Deleting the auth user no longer wipes their events and payments: `events.owner_id` becomes NULL, and the `events_release_owner_phone` trigger clears `owner_phone` in the same step. Without that, phone login (which claims unowned events by `owner_phone`) would hand the wedding and every guest photo to whoever gets that number next. To also remove their media right away, archive their events and let the task purge them (an explicitly written `archive_expires_at` is kept):
  ```sql
  update public.events set status = 'archived', archive_expires_at = now(), owner_phone = null
  where id in (…);
  ```
  `owner_phone = null` is already done by the trigger once the user is deleted; it's there for when you run this first.
- **Changing an event's wedding date or tier** (admin edit, upgrade) recomputes `archive_expires_at` from the new values. To set a custom date instead, write `archive_expires_at` in the same `UPDATE`.
- **Deleting an event that has payments** now fails (`violates foreign key constraint payments_event_id_fkey`). That is intended: archive it instead.
