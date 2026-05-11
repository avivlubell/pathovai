-- Hiring Signals — mirrors the "MedTech Commercial Hiring Signals" Notion DB
-- (a3afc5c3298a4391b4a8c07427af4ae3). Each row is one commercial job posting
-- (VP Sales, Director of Market Access, Regional Manager, etc.) flagged as an
-- ICP signal — companies hiring aggressively in commercial roles are often in
-- expansion mode and receptive to GTM infrastructure conversations.
--
-- Synced via supabase/functions/sync-hiring-signals (weekly cron, Monday 6am EDT).
-- Queried by the QB at runtime via query_hiring_signals to surface hiring-based
-- triggers before outreach drafting or prospect prioritization.

create table if not exists public.hiring_signals (
  notion_page_id text primary key,
  notion_url text,
  name text,                              -- job posting title
  company text,
  role text,
  seniority text,                         -- VP / C-Suite / Director / Regional Manager / Account Executive / Other Commercial
  location text,
  icp_signal text,                        -- Strong fit / Possible fit / Monitor
  source text,                            -- LinkedIn / Indeed / News/PR / Other
  job_url text,
  date_found date,
  run_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists hiring_signals_icp_signal_idx
  on public.hiring_signals(icp_signal);
create index if not exists hiring_signals_seniority_idx
  on public.hiring_signals(seniority);
create index if not exists hiring_signals_run_date_idx
  on public.hiring_signals(run_date desc);
create index if not exists hiring_signals_date_found_idx
  on public.hiring_signals(date_found desc);
