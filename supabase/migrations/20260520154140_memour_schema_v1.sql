
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text not null,
  wedding_date    date,
  guests_estimate integer,
  source          text default 'landing',
  locale          text default 'uz',
  created_at      timestamptz not null default now()
);
alter table public.leads enable row level security;

create table if not exists public.events (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid references auth.users(id) on delete cascade,
  couple_names       text not null,
  wedding_date       date not null,
  venue_name         text,
  venue_lat          double precision,
  venue_lng          double precision,
  geofence_radius    integer default 120,
  status             text not null default 'draft'
                       check (status in ('draft','active','archived')),
  plan_tier          text default 'basic'
                       check (plan_tier in ('basic','pro','premium','luxury')),
  table_count        integer default 10,
  qr_pdf_path        text,
  archive_expires_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create index if not exists events_owner_idx  on public.events(owner_id);
create index if not exists events_status_idx on public.events(status);
alter table public.events enable row level security;
drop policy if exists events_owner_select on public.events;
drop policy if exists events_owner_modify on public.events;
create policy events_owner_select on public.events
  for select using (auth.uid() = owner_id);
create policy events_owner_modify on public.events
  for all using (auth.uid() = owner_id);

create table if not exists public.branding (
  event_id       uuid primary key references public.events(id) on delete cascade,
  bride_name     text,
  groom_name     text,
  cover_photo    text,
  accent_color   text default '#a67c52',
  greeting_text  text,
  updated_at     timestamptz not null default now()
);
drop trigger if exists branding_set_updated_at on public.branding;
create trigger branding_set_updated_at before update on public.branding
  for each row execute function public.set_updated_at();
alter table public.branding enable row level security;
drop policy if exists branding_via_owner on public.branding;
create policy branding_via_owner on public.branding
  for all using (
    exists (select 1 from public.events e
            where e.id = branding.event_id and e.owner_id = auth.uid())
  );

create table if not exists public.photos (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  storage_path    text not null,
  thumbnail_path  text,
  guest_name      text,
  guest_table     integer,
  mime_type       text,
  size_bytes      bigint,
  is_hidden       boolean not null default false,
  is_highlight    boolean not null default false,
  uploaded_at     timestamptz not null default now()
);
create index if not exists photos_event_idx   on public.photos(event_id);
create index if not exists photos_visible_idx on public.photos(event_id, is_hidden)
  where not is_hidden;
alter table public.photos enable row level security;
drop policy if exists photos_owner_select on public.photos;
drop policy if exists photos_owner_update on public.photos;
create policy photos_owner_select on public.photos
  for select using (
    exists (select 1 from public.events e
            where e.id = photos.event_id and e.owner_id = auth.uid())
  );
create policy photos_owner_update on public.photos
  for update using (
    exists (select 1 from public.events e
            where e.id = photos.event_id and e.owner_id = auth.uid())
  );

create table if not exists public.admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists admins_self_select on public.admins;
create policy admins_self_select on public.admins
  for select using (auth.uid() = user_id);

create table if not exists public.referrals (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  partner_name    text,
  partner_phone   text,
  commission_pct  numeric(5,2) default 10.00,
  created_at      timestamptz not null default now()
);
create table if not exists public.referral_attributions (
  id            uuid primary key default gen_random_uuid(),
  referral_id   uuid not null references public.referrals(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete set null,
  event_id      uuid references public.events(id) on delete set null,
  attributed_at timestamptz not null default now()
);
alter table public.referrals enable row level security;
alter table public.referral_attributions enable row level security;

insert into storage.buckets (id, name, public)
  values ('photos', 'photos', false)
  on conflict do nothing;
