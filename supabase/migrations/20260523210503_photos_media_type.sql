
-- Generalize the photos table to hold any guest-submitted media:
-- photo, video clip (3-15s), voice message (3-60s).
-- Existing rows default to 'photo' so the existing code keeps working.
alter table public.photos
  add column if not exists media_type text not null default 'photo'
    check (media_type in ('photo','video','voice'));
alter table public.photos
  add column if not exists duration_ms integer;

create index if not exists photos_media_type_idx on public.photos(event_id, media_type);
