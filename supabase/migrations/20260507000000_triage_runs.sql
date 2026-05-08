-- Idempotency log for the morning-triage cron. Keyed by run_date so the
-- edge function can find (and update in place) today's Notion page instead
-- of creating a duplicate on a re-run or retry.

create table if not exists public.triage_runs (
  run_date date primary key,
  notion_page_id text not null,
  candidate_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
