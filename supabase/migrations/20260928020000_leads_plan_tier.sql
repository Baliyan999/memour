-- The tier a visitor picked on a Pricing card before sending the lead
-- form. /api/lead stores it here (it used to go into `notes`, in
-- Russian, which the admin never saw); /admin/leads shows it and
-- "→ create event" pre-selects it. NULL when the visitor came to the
-- form without picking a card.

alter table public.leads
  add column if not exists plan_tier text
    check (plan_tier in ('basic', 'pro', 'premium', 'luxury'));
