-- Per-conversation context: notes + uploaded attachments scoped to a
-- single chat_id. Run against the Supabase project before rolling out
-- the Context drawer. chat_id is the UUID the client assigns to each
-- chat session (see ChatSession.id on the frontend); it is not an FK
-- because chat rows live in client-side storage, but contexts and
-- attachments share that id as a scoping key.

create table if not exists public.chat_contexts (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null unique,
  user_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_contexts_user_idx
  on public.chat_contexts (user_id, updated_at desc);

create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  user_id text,
  file_name text not null,
  file_size bigint not null default 0,
  mime_type text,
  storage_path text not null,
  extracted_text text,
  created_at timestamptz not null default now()
);

create index if not exists chat_attachments_chat_idx
  on public.chat_attachments (chat_id, created_at asc);

-- Private storage bucket for uploaded context files. The backend uses
-- the service role key to read/write, so RLS policies are not needed
-- on storage.objects for this feature.
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;
