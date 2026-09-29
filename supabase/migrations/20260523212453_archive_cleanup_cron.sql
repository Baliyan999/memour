
-- Set archive_expires_at = wedding_date + 180 days on every new
-- event, and on status transitions to 'active' if it wasn't set.
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

-- Background cleanup function — flips expired events to 'archived'.
-- Actual storage deletion is left to a separate edge function so we
-- can recover photos in case of a mistaken archive.
create or replace function public.archive_expired_events()
returns void language sql as $$
  update public.events
  set status = 'archived'
  where status = 'active'
    and archive_expires_at is not null
    and archive_expires_at < now();
$$;

-- Schedule via pg_cron — runs every hour. Free Supabase plans include
-- pg_cron (the extension is preinstalled).
create extension if not exists pg_cron with schema extensions;

-- Drop any existing schedule with the same name to make this rerunnable.
do $$
begin
  perform cron.unschedule('memour_archive_expired_events');
exception when others then
  -- no-op if it didn't exist
end;
$$;

select cron.schedule(
  'memour_archive_expired_events',
  '0 * * * *',
  $$select public.archive_expired_events();$$
);
