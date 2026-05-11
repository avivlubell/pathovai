create table if not exists public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id text not null,
  chat_id text,
  user_id text,
  rating text not null check (rating in ('up', 'down')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists message_feedback_user_idx
  on public.message_feedback (user_id, created_at desc);

create index if not exists message_feedback_chat_idx
  on public.message_feedback (chat_id, created_at desc);

create unique index if not exists message_feedback_user_message_uniq
  on public.message_feedback (user_id, message_id);
