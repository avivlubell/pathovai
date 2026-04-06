-- Run this in the Supabase SQL Editor to create the content_drafts table.

create table if not exists content_drafts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete set null,
  topic text,
  post_type text default 'post',
  draft_data jsonb not null,
  model_used text,
  created_at timestamptz default now()
);
