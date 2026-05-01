-- Companies — mirror of Notion 🏢 Companies database (5de708d0857543cb8e25714d82cee7b8).
-- Synced via supabase/functions/sync-companies (full pull-all-rows pattern, like
-- sync-contacts). Companies is the canonical "truth about the company" record:
-- durable, slowly-changing facts (ICP Tier, regulatory, reimbursement, funding,
-- therapeutic area). Accounts (separately) is the "current motion" record.
-- Accounts join to companies via accounts.company_notion_page_id, populated by
-- sync-prospect-content once it's updated to read the OI page's Company relation.

create table if not exists public.companies (
  notion_page_id text primary key,
  notion_url text,
  company_name text,

  -- ICP & gap classification
  icp_tier text,
  primary_gap text[] default '{}'::text[],
  therapeutic_area text[] default '{}'::text[],

  -- Regulatory & reimbursement
  regulatory_status text,
  ce_mark_status text,
  coverage_status text,
  mac_variability text,
  cpt_code text,
  reimbursement_notes text,

  -- Trial & traction
  pivotal_trial_status text,
  number_of_paying_hospitals numeric,

  -- Funding & company size
  funding_stage text,
  lead_investor_type text,
  total_funding_raised numeric,
  employee_count numeric,
  estimated_runway_months numeric,

  -- Pipeline
  status text,
  source text,
  next_action text,
  research_summary text,

  -- Web
  website text,

  -- Timestamps
  last_activity date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists companies_company_name_idx on public.companies(company_name);
create index if not exists companies_icp_tier_idx on public.companies(icp_tier);
create index if not exists companies_status_idx on public.companies(status);

-- accounts.company_notion_page_id — hard FK to companies. Nullable until
-- sync-prospect-content (Step 2) is updated to read the OI page's Company relation
-- and backfill is run. on delete set null so deleting a Companies record doesn't
-- break the account.
alter table public.accounts
  add column if not exists company_notion_page_id text
  references public.companies(notion_page_id) on delete set null;

create index if not exists accounts_company_notion_page_id_idx
  on public.accounts(company_notion_page_id);
