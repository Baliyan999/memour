-- Login-code trail retention.
--
-- phone_otps / admin_otps keep the phone or email, the IP and the user
-- agent of every login attempt. A code lives 5–10 minutes and the abuse
-- limits only count the last hour, so keep a week for incident review
-- and drop the rest daily (03:17 UTC, pg_cron's clock).

create extension if not exists pg_cron with schema extensions;

-- Drop any existing schedule with the same name to make this rerunnable.
do $$
begin
  perform cron.unschedule('memour_purge_otps');
exception when others then
  -- no-op if it didn't exist
end;
$$;

select cron.schedule(
  'memour_purge_otps',
  '17 3 * * *',
  $$delete from public.phone_otps where created_at < now() - interval '7 days';
    delete from public.admin_otps where created_at < now() - interval '7 days';$$
);
