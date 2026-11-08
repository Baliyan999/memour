-- The team can pause guest uploads for one event — the couple asked for
-- a break, or the QR code ended up somewhere it shouldn't — without
-- archiving it or moving its date. While it is true, POST
-- /api/guest/upload refuses with 423 uploads_paused and the guest page
-- says so instead of showing the camera; the live slideshow, the
-- couple's dashboard and everything else keep working. Set from the
-- admin event page (PATCH /api/admin/events/[id]).
--
-- Additive and idempotent: every existing event keeps taking uploads.

alter table public.events
  add column if not exists uploads_paused boolean not null default false;
