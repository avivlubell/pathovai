-- ICP Trigger Monitor — mirror of Notion database 7b8f71ab2d8a45bd84f075ae0a6d6f88.
-- Synced daily by supabase/functions/sync-icp-triggers, on pg_cron at 8am America/New_York.

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

-- ---------------------------------------------------------------------------
-- Daily schedule via pg_cron. Requires extensions: pg_cron, pg_net, supabase_vault.
-- Enable them once in the dashboard (Database → Extensions) if not already on.
-- ---------------------------------------------------------------------------

-- One-time: store the project URL and service role key in Vault so the cron job
-- can invoke the edge function without hardcoding secrets. Run these once,
-- replacing the placeholders, then delete or comment out.
--
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

-- Unschedule any prior version of this job before re-creating (idempotent).
select cron.unschedule('sync-icp-triggers-daily')
where exists (select 1 from cron.job where jobname = 'sync-icp-triggers-daily');

-- pg_cron on this Supabase instance doesn't accept CRON_TZ= prefixes, so the
-- schedule is in UTC. 12:00 UTC == 8am EDT (summer) / 7am EST (winter).
-- Adjust to '0 13 * * *' if you prefer 8am EST-aligned year-round instead.
select cron.schedule(
  'sync-icp-triggers-daily',
  '0 12 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-icp-triggers',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
