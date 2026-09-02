-- vertical_operators: the vertical-specific "brain" for the generic
-- vertical-operator and sync-vertical-intelligence edge functions (Phase 2).
-- ai-imaging-operator/index.ts and sync-ai-imaging-intelligence/index.ts each
-- hardcode a large system prompt in TS. This table makes that prompt content
-- data, one row per vertical, so a new vertical is a row insert instead of a
-- new edge function. Seeded here with the existing imaging prompts, copied
-- verbatim — no behavior change for the AI Imaging vertical.

create table public.vertical_operators (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null unique references public.verticals(id) on delete cascade,
  operator_system_prompt text not null,
  operator_model text not null default 'claude-sonnet-4-6',
  classifier_system_prompt text not null,
  classifier_model text not null default 'claude-haiku-4-5-20251001',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vertical_operators is
  'One row per vertical: the operator system prompt (used by vertical-operator to produce a commercial brief) '
  'and the classifier system prompt (used by sync-vertical-intelligence to score raw market signals). '
  'Adding vertical #2 means writing these two prompts and inserting a row, not shipping new edge function code.';

alter table public.vertical_operators enable row level security;
create policy service_role_full_access on public.vertical_operators
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
