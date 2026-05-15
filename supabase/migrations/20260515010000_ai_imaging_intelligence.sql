-- AI Imaging Intelligence: dynamic signal table for the AI Imaging Operator.
-- Populated weekly by sync-ai-imaging-intelligence (Perplexity + Claude scan).
-- Queried at invocation time by the ai-imaging-operator edge function.

create table if not exists public.ai_imaging_intelligence (
  id uuid primary key default gen_random_uuid(),
  signal_type text not null check (signal_type in (
    'cms_reimbursement',
    'fda_regulatory',
    'funding_company',
    'clinical_conference',
    'stakeholder_org'
  )),
  signal_date date,
  raw_signal text not null,
  company_name text,
  use_case text,
  commercial_implication text not null,
  triggered_action text not null,
  urgency text not null check (urgency in ('immediate', 'this_week', 'this_month', 'monitor')),
  source_url text,
  expires_at date,
  created_at timestamptz not null default now()
);

create index ai_imaging_intelligence_signal_type_idx
  on public.ai_imaging_intelligence (signal_type);

create index ai_imaging_intelligence_company_idx
  on public.ai_imaging_intelligence (lower(company_name))
  where company_name is not null;

create index ai_imaging_intelligence_created_at_idx
  on public.ai_imaging_intelligence (created_at desc);

create index ai_imaging_intelligence_urgency_idx
  on public.ai_imaging_intelligence (urgency);

alter table public.ai_imaging_intelligence enable row level security;

create policy "service_role_full_access" on public.ai_imaging_intelligence
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
