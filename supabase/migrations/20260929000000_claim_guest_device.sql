-- Guest limit per event. Each tier promises a number of guests
-- (Basic 50, Pro 150, Premium 300, Luxury 500 — shared/plans.ts); a
-- guest is one browser bound to the event, i.e. one guest_devices row.
-- The app picks the number from the event's tier and calls this
-- function whenever a device it has never seen joins an event
-- (/api/guest/binding, /api/guest/upload). The function only makes
-- "count, then insert" atomic, so two new guests arriving at the same
-- moment can't both take the last place.
--
--   claim_guest_device(event, device, table, max_devices, guest_name)
--     'existing'       the device already has a row for this event —
--                      never refused, whatever the limit (nothing written)
--     'created'        a new row with zeroed counters
--     'limit_reached'  the event already has max_devices devices
--                      (nothing written)
--
-- A per-event advisory lock serialises the claims of one event; other
-- events and devices already in don't wait for it. Server only: the
-- guest endpoints call it with the service role, like every other
-- guest_devices write. Additive and idempotent.

create or replace function public.claim_guest_device(
  p_event_id     uuid,
  p_device_id    text,
  p_table_number integer,
  p_max_devices  integer,
  p_guest_name   text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_devices integer;
begin
  if p_max_devices is null then
    raise exception 'claim_guest_device: max_devices is required';
  end if;

  if exists (select 1 from public.guest_devices
             where event_id = p_event_id and device_id = p_device_id) then
    return 'existing';
  end if;

  -- Held until this transaction ends. Every statement below takes a
  -- fresh snapshot, so it sees the rows of the claims that ran first.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('memour.claim_guest_device:' || p_event_id::text, 0));

  -- The same device may have been let in by a parallel request (a
  -- double tap) while we waited.
  if exists (select 1 from public.guest_devices
             where event_id = p_event_id and device_id = p_device_id) then
    return 'existing';
  end if;

  select count(*) into v_devices from public.guest_devices where event_id = p_event_id;
  if v_devices >= p_max_devices then
    return 'limit_reached';
  end if;

  insert into public.guest_devices (device_id, event_id, table_number, guest_name)
  values (p_device_id, p_event_id, p_table_number, p_guest_name);
  return 'created';
end;
$$;

revoke all on function public.claim_guest_device(uuid, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_guest_device(uuid, text, integer, integer, text)
  to service_role;

-- PostgREST picks the new function up without a restart.
notify pgrst, 'reload schema';
