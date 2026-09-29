
-- Telegram chat ID per admin — second factor for password-based
-- login. After the password is verified, we send a 6-digit code to
-- this chat via the Memour bot. Without a chat ID an admin cannot
-- log in, so the super-admin must set it when inviting teammates.
alter table public.admins
  add column if not exists telegram_chat_id text;

-- Bootstrap: founding admin's known chat ID.
-- prod-only bootstrap removed from the repo

-- OTPs for admin 2FA. Mirrors phone_otps shape but keyed by email
-- since admin auth uses email + password. Codes expire in 10
-- minutes and we cap brute-force attempts via the `attempts` column.
create table if not exists public.admin_otps (
  email        text not null,
  code_hash    text not null,
  attempts     int  not null default 0,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  ip           text,
  user_agent   text,
  consumed_at  timestamptz,
  primary key (email, code_hash)
);
create index if not exists admin_otps_email_idx on public.admin_otps(email, expires_at);
alter table public.admin_otps enable row level security;
-- No client-side policies: only the service-role server reads/writes.
