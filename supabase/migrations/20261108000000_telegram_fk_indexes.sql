-- Supabase performance advisor: unindexed foreign keys — cover them so event/user deletes don't scan these tables for the cascade.

create index if not exists telegram_chat_links_user_idx
  on public.telegram_chat_links (user_id);

create index if not exists telegram_link_tokens_event_idx
  on public.telegram_link_tokens (event_id);

create index if not exists telegram_link_tokens_user_idx
  on public.telegram_link_tokens (user_id);
