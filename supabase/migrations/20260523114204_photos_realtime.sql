
-- Enable Postgres logical replication for photos so Supabase Realtime
-- broadcasts INSERT events to subscribed clients (the live slideshow).
alter publication supabase_realtime add table public.photos;
