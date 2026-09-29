
-- Security hardening.
--
-- The browser holds the anon key plus the couple's JWT, so anything
-- RLS allows is reachable straight through PostgREST, around every
-- check the Nitro endpoints make. The old write policies let a couple
-- flip their own event to status='active' / plan_tier='luxury' without
-- paying, insert free active events, delete an event together with its
-- payments, point photos.storage_path at any object in the private
-- bucket, and write branding past the zod limits.
--
-- The app never writes these tables from the client: every write goes
-- through a server endpoint on the service role (which bypasses RLS
-- and grants). So clients get read access to their own rows and
-- nothing else. If a client-side write is ever needed, grant the
-- specific columns and add a policy WITH CHECK — never FOR ALL.

-- 1. Drop the write policies ---------------------------------------------
drop policy if exists events_owner_modify on public.events;
drop policy if exists photos_owner_update on public.photos;
drop policy if exists branding_via_owner  on public.branding;

-- 2. Read policies: owner-only, `authenticated` only ---------------------
-- `(select auth.uid())` is evaluated once per statement instead of
-- once per row (Supabase advisor: auth_rls_initplan).
drop policy if exists events_owner_select on public.events;
create policy events_owner_select on public.events
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists branding_owner_select on public.branding;
create policy branding_owner_select on public.branding
  for select to authenticated
  using (
    exists (select 1 from public.events e
            where e.id = branding.event_id and e.owner_id = (select auth.uid()))
  );

drop policy if exists photos_owner_select on public.photos;
create policy photos_owner_select on public.photos
  for select to authenticated
  using (
    exists (select 1 from public.events e
            where e.id = photos.event_id and e.owner_id = (select auth.uid()))
  );

drop policy if exists payments_owner_select on public.payments;
create policy payments_owner_select on public.payments
  for select to authenticated
  using (
    exists (select 1 from public.events e
            where e.id = payments.event_id and e.owner_id = (select auth.uid()))
  );

drop policy if exists admins_self_select on public.admins;
create policy admins_self_select on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 3. Table privileges ----------------------------------------------------
-- RLS is the gate, grants are the second lock: no client role can
-- write any public table, even if a permissive policy slips in later.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;

-- Server-only tables (no policies at all): no client access whatsoever.
revoke all on public.phone_otps, public.admin_otps, public.guest_devices,
              public.leads, public.referrals, public.referral_attributions
  from anon, authenticated;

-- Tables created by later migrations start write-closed for clients too.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables from anon, authenticated;

-- pg_cron runs this as the table owner; nobody needs it over RPC.
revoke execute on function public.archive_expired_events() from public, anon, authenticated;

-- Pin search_path on the trigger/cron functions (advisor:
-- function_search_path_mutable). They only reference pg_catalog and
-- schema-qualified public objects. set_event_archive_expiry() is
-- redefined with it in section 6.
alter function public.set_updated_at()         set search_path = '';
alter function public.archive_expired_events() set search_path = '';

-- 4. Keep business records when events or accounts go away --------------
-- Payments are the ledger Payme/Click reconcile against: deleting an
-- event must not silently take them along.
alter table public.payments
  drop constraint if exists payments_event_id_fkey,
  add constraint payments_event_id_fkey
    foreign key (event_id) references public.events(id) on delete restrict;

-- Deleting a couple's auth user detaches their events instead of
-- wiping events, photos and (now) failing on payments. Media is
-- removed by the retention task (server/tasks/cleanup-archives.ts).
alter table public.events
  drop constraint if exists events_owner_id_fkey,
  add constraint events_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete set null;

-- Unindexed foreign keys (advisor: unindexed_foreign_keys).
create index if not exists leads_converted_event_idx       on public.leads(converted_event_id);
create index if not exists referral_attributions_ref_idx   on public.referral_attributions(referral_id);
create index if not exists referral_attributions_lead_idx  on public.referral_attributions(lead_id);
create index if not exists referral_attributions_event_idx on public.referral_attributions(event_id);

-- 5. Storage limits ------------------------------------------------------
-- Mirrors the server-side allow-lists: LIMITS in
-- server/api/guest/upload.post.ts (photos: 6 MB photo, 30 MB video,
-- 5 MB voice; thumbnails are JPEG) and ALLOWED_MIME in
-- server/api/couple/branding/[id].post.ts (8 MB cover). Raster only in
-- the public bucket: an SVG there is served from our storage domain
-- and can carry script. Widen these together with the server lists.
update storage.buckets
  set file_size_limit    = 30 * 1024 * 1024,
      allowed_mime_types = array[
        'image/jpeg', 'image/png', 'image/webp',
        'video/webm', 'video/mp4',
        'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'
      ]
  where id = 'photos';

update storage.buckets
  set file_size_limit    = 8 * 1024 * 1024,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = 'branding';

-- 6. Retention -----------------------------------------------------------
-- Set by the retention task (server/tasks/cleanup-archives.ts) once an
-- expired event's media has been deleted from Storage and its photos
-- rows removed.
alter table public.events
  add column if not exists purged_at timestamptz;

-- Now that expiry really deletes media, it must never come before what
-- was sold: Luxury includes 12 months of storage. Every other tier
-- keeps the 180 days the privacy policy states (Basic/Pro advertise
-- less, so they get more, never less).
--
-- The date follows the event: it is recomputed when the wedding is
-- moved or the tier changes (admin edit, upgrade), otherwise a
-- postponed wedding would be archived before it happens and an
-- upgrade would keep the old tier's term. A date written explicitly
-- in the same statement wins (e.g. an early purge on request), and a
-- NULL is always refilled: an event without a date would be kept
-- forever.
create or replace function public.set_event_archive_expiry()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.archive_expires_at is null
     or (tg_op = 'UPDATE'
         and (new.wedding_date is distinct from old.wedding_date
              or new.plan_tier is distinct from old.plan_tier)
         and new.archive_expires_at is not distinct from old.archive_expires_at) then
    new.archive_expires_at := new.wedding_date::timestamptz
      + case when new.plan_tier = 'luxury' then interval '365 days' else interval '180 days' end;
  end if;
  return new;
end;
$$;

drop trigger if exists events_set_archive_expiry on public.events;
create trigger events_set_archive_expiry
  before insert or update of wedding_date, plan_tier, archive_expires_at on public.events
  for each row execute function public.set_event_archive_expiry();

-- Existing events: fill missing dates, and move up every date that is
-- shorter than the tier's term (Luxury still on the old 180-day
-- default, weddings moved later under the old trigger). Never shortens.
update public.events
  set archive_expires_at = wedding_date::timestamptz
    + case when plan_tier = 'luxury' then interval '365 days' else interval '180 days' end
  where purged_at is null
    and (archive_expires_at is null
         or archive_expires_at < wedding_date::timestamptz
              + case when plan_tier = 'luxury' then interval '365 days' else interval '180 days' end);

-- 7. Detached events can't be claimed again -----------------------------
-- /api/auth/phone/verify hands every event with owner_phone = <phone>
-- and no owner to whoever logs in with that phone. Once the owner's
-- account is deleted (owner_id → NULL via the FK above), the number
-- may belong to someone else, so the phone goes too. An explicit
-- reassignment (owner_id and owner_phone changed together) is kept.
create or replace function public.release_detached_owner_phone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.owner_id is not null and new.owner_id is null
     and new.owner_phone is not distinct from old.owner_phone then
    new.owner_phone := null;
  end if;
  return new;
end;
$$;

drop trigger if exists events_release_owner_phone on public.events;
create trigger events_release_owner_phone
  before update of owner_id on public.events
  for each row execute function public.release_detached_owner_phone();
