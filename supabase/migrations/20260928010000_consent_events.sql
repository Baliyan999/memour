-- Consent log: who accepted which document, when and from where.
--
-- Every consent the site asks for is written here by the server, one
-- row per document (shared/legal.ts, server/utils/consent.ts):
--   lead          lead form               privacy
--   login         couple SMS / email      terms, privacy
--   guest_upload  guest welcome screen    terms (guest rules), guest_licence, privacy
--   checkout      before the payment page offer (terms while no offer is published)
-- together with the evidence: document version and text hash, the
-- trusted client IP (getTrustedClientIp — never a client-set header),
-- user agent and locale.
--
-- Append-only. Clients have no access at all (RLS on, no policies, no
-- grants); the server inserts with the service role, and triggers
-- refuse UPDATE, DELETE and TRUNCATE for every role. A retention job
-- (the drafts: three years after the relationship ends) will need a
-- migration of its own.
--
-- No foreign keys on purpose: a record must outlive the lead, event,
-- device binding, payment or auth user it points to.

create table if not exists public.consent_events (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  context      text not null check (context in ('lead', 'login', 'guest_upload', 'checkout')),

  -- who
  subject_type text not null check (subject_type in ('lead', 'couple', 'guest')),
  lead_id      uuid,
  user_id      uuid,
  event_id     uuid,
  device_id    uuid,
  phone        text,
  email        text,
  guest_name   text,

  -- what
  document     text not null check (document in ('privacy', 'terms', 'offer', 'guest_licence')),
  version      text not null,
  text_sha256  text,
  action       text not null default 'granted'
               check (action in ('granted', 'declined', 'withdrawn', 'reaccepted', 'objected')),
  method       text not null check (method in ('checkbox', 'checkbox+otp', 'email_link')),
  locale       text check (locale in ('uz', 'ru')),

  -- evidence
  ip           text,
  user_agent   text,
  payment_id   uuid,
  extra        jsonb not null default '{}'::jsonb,

  -- Every record points at someone.
  constraint consent_events_subject check (
    (subject_type = 'lead' and lead_id is not null)
    or (subject_type = 'couple' and (user_id is not null or email is not null or phone is not null))
    or (subject_type = 'guest' and event_id is not null and device_id is not null)
  )
);

-- The upload endpoint asks "has this device accepted the current
-- versions for this event?" on every upload.
create index if not exists consent_events_guest_idx
  on public.consent_events (event_id, device_id, document)
  where subject_type = 'guest';
create index if not exists consent_events_user_idx
  on public.consent_events (user_id) where user_id is not null;
create index if not exists consent_events_lead_idx
  on public.consent_events (lead_id) where lead_id is not null;

alter table public.consent_events enable row level security;
revoke all on public.consent_events from anon, authenticated;

create or replace function public.consent_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'consent_events is append-only'
    using errcode = 'insufficient_privilege';
end;
$$;
revoke execute on function public.consent_events_append_only() from public, anon, authenticated;

drop trigger if exists consent_events_no_change on public.consent_events;
create trigger consent_events_no_change
  before update or delete on public.consent_events
  for each row execute function public.consent_events_append_only();

drop trigger if exists consent_events_no_truncate on public.consent_events;
create trigger consent_events_no_truncate
  before truncate on public.consent_events
  for each statement execute function public.consent_events_append_only();
