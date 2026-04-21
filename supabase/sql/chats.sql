-- User-owned chat history. Previously stored in browser localStorage
-- (see the comment at the top of shared_chats.sql) -- moved to Supabase
-- so chats sync across devices.
--
-- Schema notes (PathovAI-specific):
--   * Auth is NextAuth/Google; there is no `users` table, so chats are
--     scoped by `user_email`. Matches the `owner_email` pattern used by
--     shared_chats.
--   * `id` is the UUID the client already assigns to each chat session
--     (kept stable so chat_contexts, shared_chats, and this table all
--     share the same scoping key).
--   * `messages` is JSONB -- full conversation, same shape the frontend
--     already persisted to localStorage.
--   * API routes use the service role key, so RLS is enabled without
--     policies: anon/authenticated have no direct access, service_role
--     bypasses RLS.

create table if not exists public.chats (
  id text primary key,
  user_email text not null,
  title text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chats_user_updated_idx
  on public.chats (user_email, updated_at desc);

alter table public.chats enable row level security;
-- No policies => service_role only.
