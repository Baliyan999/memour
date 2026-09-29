-- At most one settled provider payment per event, and one row per
-- provider transaction.
--
-- Checkout and both webhooks already refuse a second charge; what they
-- can't close alone is Payme and Click completing at the same instant.
-- With these indexes the second write fails, the provider gets an error
-- and reverses the charge instead of taking the money twice.
--
-- Rows without a provider transaction (admin 'manual' payments, the old
-- dev-fallback rows) are not covered: they never moved money through a
-- provider.

create unique index if not exists payments_one_paid_per_event
  on public.payments(event_id)
  where status = 'paid' and provider_transaction_id is not null;

create unique index if not exists payments_provider_tx_unique
  on public.payments(provider, provider_transaction_id)
  where provider_transaction_id is not null;
