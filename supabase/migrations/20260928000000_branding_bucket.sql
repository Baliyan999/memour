
-- Public `branding` bucket: couple cover photos (/api/couple/branding)
-- and QR-PDF logos (/api/admin/qr-settings). In prod it was created by
-- hand in the dashboard (2026-05-23) and never had a migration, so a
-- fresh project came up without it. No-op where it already exists.
insert into storage.buckets (id, name, public)
  values ('branding', 'branding', true)
  on conflict (id) do nothing;
