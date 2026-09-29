
-- Admin role hierarchy. 'super' admins can add/remove other admins.
-- 'admin' has the same operational access (events, leads, referrals,
-- QR PDFs) but cannot touch the admin team itself.
alter table public.admins
  add column if not exists role text not null default 'admin'
    check (role in ('super', 'admin'));

-- Bootstrap: mark the founding admin as super so they can invite
-- their teammates.
-- prod-only bootstrap removed from the repo
