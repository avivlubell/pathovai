-- ICP Trigger Monitor — mirror of Notion database 7b8f71ab2d8a45bd84f075ae0a6d6f88.
-- Synced daily by supabase/functions/sync-icp-triggers.

create table if not exists public.icp_triggers (
  notion_page_id text primary key,
  notion_url text,

  company_name text not null,
  company_url text,
  linkedin_url text,
  headquarters text,

  founder_name text,
  founder_role text,
  founder_linkedin text,

  total_funding text,
  last_round_amount text,
  last_round_type text,
  investors text,
  employee_count text,
  estimated_runway text,

  fda_status text,
  fda_510k_number text,
  device_category text,
  clearance_date date,
  clinical_evidence_quality text,

  pilot_sites text,
  commercial_team text,
  job_postings_summary text,

  icp_score text,
  icp_tier text,
  icp_clarity_gap text,
  confidence text,
  conversion_evidence text,

  trigger_types text[],
  pain_signals text,
  summary text,

  outreach_status text,
  source text,
  date_found date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now()
);

create index if not exists icp_triggers_tier_idx on public.icp_triggers (icp_tier);
create index if not exists icp_triggers_date_found_idx on public.icp_triggers (date_found desc);
create index if not exists icp_triggers_outreach_status_idx on public.icp_triggers (outreach_status);
