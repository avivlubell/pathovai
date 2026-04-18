-- Shared chats: read-only snapshots of a chat thread that the owner can
-- send to a teammate or manager via a tokenized link.
--
-- Schema notes (PathovAI-specific):
--   * Chats currently live in the browser's localStorage, so there is no
--     `chats` table to FK against. We store a stable `chat_id` (the
--     localStorage UUID) plus a `messages` JSONB snapshot. The client
--     keeps the snapshot up to date by PATCHing whenever the chat
--     changes -- this honours "Shared views always show the latest
--     version" without requiring server-side chat persistence.
--   * There is also no `users` table (auth is NextAuth/Google), so the
--     owner is identified by `owner_email`. Display name is captured at
--     creation time and shown on the shared view.
--   * Soft-delete via `revoked_at` so revoked links can render a
--     friendly "no longer available" page instead of a generic 404.
--   * `token` is a URL-safe random string (>=21 chars, nanoid-style) so
--     links are not enumerable.

create extension if not exists pgcrypto;

create table if not exists public.shared_chats (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  owner_email text not null,
  owner_display_name text,
  token text not null unique,
  title text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  require_auth boolean not null default true,
  include_context boolean not null default false
);

create index if not exists shared_chats_token_idx
  on public.shared_chats (token);

create index if not exists shared_chats_owner_chat_idx
  on public.shared_chats (owner_email, chat_id);

-- Audit log for views. Owners can later see "Viewed N times" without
-- exposing viewer identities to anyone but themselves. `ip_hash` is a
-- salted hash, never the raw IP, so we don't store PII.
create table if not exists public.shared_chat_views (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  viewer_email text,
  ip_hash text,
  viewed_at timestamptz not null default now()
);

create index if not exists shared_chat_views_token_idx
  on public.shared_chat_views (token);

-- API routes use the service role key, so RLS is unnecessary for the
-- app's own access path. Lock direct anon/authenticated access down so
-- a leaked anon key can't read other people's shared chats by guessing
-- the table name. (Token-based access goes through the API route,
-- which performs the revoked + require_auth checks.)
alter table public.shared_chats enable row level security;
alter table public.shared_chat_views enable row level security;
-- No policies => anon/authenticated have no access; service_role
-- bypasses RLS by default.
