
-- When the admin creates an event for a couple they know by phone
-- (more common in UZ than email), we store the phone here. After the
-- couple does their first phone OTP login, the verify endpoint
-- claims any event whose owner_phone matches their phone and sets
-- owner_id accordingly.
alter table public.events add column if not exists owner_phone text;
create index if not exists events_owner_phone_idx on public.events(owner_phone)
  where owner_phone is not null;
