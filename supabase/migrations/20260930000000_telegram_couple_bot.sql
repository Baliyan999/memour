-- The couple's Telegram bot (Pro and up, shared/plans.ts): the same
-- Memour bot that already sends the team's alerts and admin codes now
-- also writes to couples who connect their chat from the dashboard —
-- a digest of new guest uploads, "payment received" and the reminders
-- to download the archive 30 and 7 days before it is deleted.
--
--   telegram_link_tokens    one-time deep-link tokens. The dashboard
--                           asks for one (POST /api/couple/telegram/
--                           link/[eventId]) and opens
--                           t.me/<bot>?start=<token>; the webhook
--                           consumes it on "/start <token>". Only the
--                           sha256 of the token is stored, so a
--                           database read can't be turned into a link.
--                           15 minutes, single use.
--   telegram_chat_links     which chat gets which event's news. A chat
--                           may follow several events and both partners
--                           may connect their own chats. Disconnecting
--                           (/stop, blocking the bot, "Uzish" in the
--                           dashboard, a chat Telegram says is gone)
--                           keeps an anonymous row — chat id, name and
--                           username are cleared, the privacy page
--                           says the chat id is kept only until then.
--   telegram_notifications  one row per event and one-off message, so
--                           the daily reminder task and the activation
--                           notice never send the same thing twice. The
--                           archive reminders are forgotten when the
--                           event's archive_expires_at moves (trigger
--                           events_telegram_archive_moved), so a new
--                           date gets its own reminders.
--
-- Server only: RLS on, no policies, no grants for anon / authenticated.
-- The app reads and writes with the service role. Additive and
-- idempotent: running it twice is harmless.

-- 1. Deep-link tokens ----------------------------------------------------
create table if not exists public.telegram_link_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  locale     text not null check (locale in ('uz', 'ru')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- The daily task deletes tokens a day after they expire.
create index if not exists telegram_link_tokens_expires_idx
  on public.telegram_link_tokens (expires_at);

alter table public.telegram_link_tokens enable row level security;
revoke all on public.telegram_link_tokens from anon, authenticated;

-- 2. Connected chats -----------------------------------------------------
create table if not exists public.telegram_chat_links (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  -- The couple's account that pressed "Connect"; deleting the account
  -- disconnects its chats.
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- NULL once disconnected (with the name and username): the unique
  -- key below then only binds connected chats, and a chat that comes
  -- back gets a fresh row.
  chat_id       bigint,
  first_name    text check (char_length(first_name) <= 128),
  username      text check (char_length(username) <= 64),
  locale        text not null default 'uz' check (locale in ('uz', 'ru')),
  linked_at     timestamptz not null default now(),
  unlinked_at   timestamptz,
  unlink_reason text check (unlink_reason in ('stop', 'blocked', 'dashboard', 'unreachable', 'expired')),
  constraint telegram_chat_links_event_chat_key unique (event_id, chat_id),
  constraint telegram_chat_links_state check (
    (unlinked_at is null and chat_id is not null)
    or (unlinked_at is not null and chat_id is null and first_name is null and username is null)
  )
);

-- /stop and "the bot was blocked" look a chat up across all events.
create index if not exists telegram_chat_links_chat_idx
  on public.telegram_chat_links (chat_id) where unlinked_at is null;

alter table public.telegram_chat_links enable row level security;
revoke all on public.telegram_chat_links from anon, authenticated;

-- 3. One-off messages already sent ---------------------------------------
create table if not exists public.telegram_notifications (
  event_id uuid not null references public.events (id) on delete cascade,
  kind     text not null check (kind in ('archive_30d', 'archive_7d', 'activated')),
  sent_at  timestamptz not null default now(),
  primary key (event_id, kind)
);

alter table public.telegram_notifications enable row level security;
revoke all on public.telegram_notifications from anon, authenticated;

-- A reminder belongs to the date it announced. When archive_expires_at
-- moves (an upgrade to Luxury, the wedding moved, an early purge on
-- request) the sent archive reminders are forgotten, so the daily task
-- reminds again before the new date. An AFTER trigger without a column
-- list: the date is usually recomputed by events_set_archive_expiry
-- (BEFORE), which "UPDATE OF archive_expires_at" would not see.
create or replace function public.telegram_forget_archive_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.telegram_notifications
    where event_id = new.id and kind in ('archive_30d', 'archive_7d');
  return null;
end;
$$;

revoke execute on function public.telegram_forget_archive_reminders() from public, anon, authenticated;

drop trigger if exists events_telegram_archive_moved on public.events;
create trigger events_telegram_archive_moved
  after update on public.events
  for each row
  when (old.archive_expires_at is distinct from new.archive_expires_at)
  execute function public.telegram_forget_archive_reminders();

-- PostgREST picks the new tables up without a restart.
notify pgrst, 'reload schema';
