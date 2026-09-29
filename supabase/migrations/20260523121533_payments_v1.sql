
create table if not exists public.payments (
  id                      uuid primary key default gen_random_uuid(),
  event_id                uuid not null references public.events(id) on delete cascade,
  provider                text not null check (provider in ('payme','click','manual')),
  amount                  integer not null,  -- minor units (tiyin)
  currency                text   not null default 'UZS',
  status                  text   not null default 'pending'
                            check (status in ('pending','paid','failed','refunded','cancelled')),
  provider_transaction_id text,
  metadata                jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists payments_event_idx     on public.payments(event_id);
create index if not exists payments_provider_txid on public.payments(provider, provider_transaction_id);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;
-- Owners can read their own payments; writes are all server-side via
-- service-role from /api/payments/* handlers.
drop policy if exists payments_owner_select on public.payments;
create policy payments_owner_select on public.payments
  for select using (
    exists (select 1 from public.events e
            where e.id = payments.event_id and e.owner_id = auth.uid())
  );
