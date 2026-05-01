-- Industry Intelligence — mirrors two Notion databases nested under the
-- "📡 Market Intelligence Briefings" page (34caff2ec2228181a7dac7494addce59):
--   • Intelligence Scans   → public.intelligence_scans   (parent, one per weekly scan)
--       Notion DB:  1fd4e59e2dde4e90a0f326cb80dbe83e
--       Data source: 6bf52d17-0064-425d-b810-de7afbfef8df
--   • Industry Intelligence → public.industry_intelligence (one per signal)
--       Notion DB:  d0c5b57b71b9437697a5b700ca309c0b
--       Data source: cf6f531b-9273-4fc7-892d-4c63c5f73e4b
--
-- Synced via supabase/functions/sync-intelligence (full pull-all-rows pattern,
-- same as sync-companies). Two-pass: scans first, then items with their
-- scan_notion_page_id resolved from the Notion relation.
--
-- The QB queries industry_intelligence at runtime via the
-- query_industry_intelligence tool (filtered by category / tags / recency)
-- as a precondition before invoke_outreach_drafter.

create table if not exists public.intelligence_scans (
  notion_page_id text primary key,
  notion_url text,
  scan_id integer,                        -- Notion auto_increment_id
  title text,
  scan_date date,
  executive_summary text,
  weekly_messaging_angles text,
  top_categories text[] default '{}'::text[],
  icp_relevance text,                     -- high / medium / low
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists intelligence_scans_scan_date_idx
  on public.intelligence_scans(scan_date desc);
create index if not exists intelligence_scans_top_categories_idx
  on public.intelligence_scans using gin(top_categories);

create table if not exists public.industry_intelligence (
  notion_page_id text primary key,
  notion_url text,
  title text,
  category text,                          -- single-select
  signal_type text,                       -- Tailwind / Headwind / Event / Mixed
  source_publication text,
  source_url text,
  source_date date,
  what_happened text,
  so_what text,
  therapeutic_area text[] default '{}'::text[],
  icp_stage text[] default '{}'::text[],
  buyer_persona text[] default '{}'::text[],
  topic_tags text[] default '{}'::text[],
  urgency_window text,                    -- This week / 30-60 days / Quarter / Standing
  scan_notion_page_id text
    references public.intelligence_scans(notion_page_id) on delete set null,
  used_in_outreach boolean default false,
  last_cited date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists industry_intelligence_category_idx
  on public.industry_intelligence(category);
create index if not exists industry_intelligence_signal_type_idx
  on public.industry_intelligence(signal_type);
create index if not exists industry_intelligence_source_date_idx
  on public.industry_intelligence(source_date desc);
create index if not exists industry_intelligence_scan_id_idx
  on public.industry_intelligence(scan_notion_page_id);
create index if not exists industry_intelligence_therapeutic_area_idx
  on public.industry_intelligence using gin(therapeutic_area);
create index if not exists industry_intelligence_topic_tags_idx
  on public.industry_intelligence using gin(topic_tags);
create index if not exists industry_intelligence_icp_stage_idx
  on public.industry_intelligence using gin(icp_stage);
