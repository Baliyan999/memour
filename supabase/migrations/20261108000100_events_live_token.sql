-- A private link for the live slideshow.
--
-- Until now /e/[id]/live and its feed (GET /api/guest/live-init/[id])
-- answered anyone who knew the event id, and that id is printed on
-- every table's QR card: any guest could open the whole live feed
-- (guest names, tables, voice wishes) from their own phone, at the
-- wedding or afterwards.
--
-- Each event now carries a secret of its own. The feed is served only
-- with ?k=<live_token>; the couple sees the full link in the dashboard
-- and can replace it ("new link", POST /api/couple/event/[id]/live-link),
-- which stops the old one at once.
--
-- 32 hex characters from gen_random_uuid() — 122 random bits from the
-- server's strong random source, built in (no pgcrypto). The app
-- writes the same shape (16 random bytes as hex) when it rotates.
-- ADD COLUMN with a volatile default fills every existing row with its
-- own value in the same statement, so old events get a token too.
--
-- Clients keep their read access to their own events rows (RLS
-- events_owner_select), which is how the couple's dashboard reads the
-- link; nothing guest-facing selects the column. Additive and
-- idempotent: running it twice is harmless.

alter table public.events
  add column if not exists live_token text not null
    default replace(gen_random_uuid()::text, '-', '');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_live_token_format' and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_live_token_format check (live_token ~ '^[0-9a-f]{32}$');
  end if;
end
$$;

comment on column public.events.live_token is
  'Secret of the live slideshow link (/e/<id>/live?k=<token>). Owner-only; rotated by POST /api/couple/event/[id]/live-link.';
