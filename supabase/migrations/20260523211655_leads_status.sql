
alter table public.leads
  add column if not exists status text not null default 'new'
    check (status in ('new','contacted','won','lost')),
  add column if not exists converted_event_id uuid references public.events(id) on delete set null,
  add column if not exists notes text;

create index if not exists leads_status_idx on public.leads(status);
