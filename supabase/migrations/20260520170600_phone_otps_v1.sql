
-- Phone OTP storage. Codes are stored hashed (sha256) so a leak of
-- this table can't reveal one-time codes still in flight. The hash
-- includes the phone number so the same code for two different
-- phones produces different hashes.
create table if not exists public.phone_otps (
  phone        text not null,
  code_hash    text not null,
  attempts     int  not null default 0,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  ip           text,
  user_agent   text,
  consumed_at  timestamptz,
  primary key (phone, code_hash)
);
create index if not exists phone_otps_phone_idx on public.phone_otps(phone, expires_at);
alter table public.phone_otps enable row level security;
-- No client-side policies: only the service-role server reads/writes
-- this table. RLS being on with no policies blocks all anon/auth
-- access by default.
