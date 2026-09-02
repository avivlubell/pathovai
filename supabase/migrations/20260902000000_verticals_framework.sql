-- Vertical framework: generalizes the AI Imaging Operator's one-off pattern
-- (dedicated tables + dedicated edge function per vertical) into a data-driven
-- model. AI Imaging becomes the first seeded vertical under the medtech
-- category, not a hardcoded special case. Adding a new vertical becomes a
-- row insert, not new code.
--
-- Phase 1 of 3: schema only. The existing ai_imaging_* tables and the
-- ai-imaging-operator / sync-ai-imaging-intelligence edge functions are left
-- untouched and keep serving production unchanged. Phase 2 generalizes those
-- edge functions (vertical-operator / sync-vertical-intelligence) to read
-- from the tables created here, then the ai_imaging_* tables get dropped in
-- a follow-up migration. Phase 3 moves the static BUYER PERSONA PLAYBOOK
-- content out of prompt.txt into vertical_playbooks.

-- ============================================================
-- verticals: the vertical registry
-- ============================================================

create table public.verticals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null,            -- groups verticals under a market, e.g. 'medtech'
  status text not null default 'draft' check (status in ('active', 'draft', 'archived')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.verticals is
  'Vertical registry. A vertical is a market segment with its own buyer playbook, competitive intel, '
  'and economics model — e.g. AI Diagnostic Imaging under the medtech category. Adding a vertical is a row insert.';

insert into public.verticals (slug, name, category, status, description) values
  ('ai-imaging', 'AI Diagnostic Imaging', 'medtech', 'active',
   'Radiology/imaging AI software companies selling into hospital imaging departments. Migrated from the original hardcoded AI Imaging Operator.'),
  ('medtech-general', 'General MedTech', 'medtech', 'draft',
   'Fallback vertical for post-clearance MedTech accounts not yet mapped to a specific vertical.');

-- ============================================================
-- vertical_classification_rules: maps existing Notion-synced account fields
-- (therapeutic_area, product_category) to a vertical, so accounts don't need
-- a new Notion property or sync rewrite yet. Revisit in Phase 2 whether
-- accounts need a first-class vertical_id column instead.
-- ============================================================

create table public.vertical_classification_rules (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references public.verticals(id) on delete cascade,
  match_field text not null check (match_field in ('therapeutic_area', 'product_category')),
  match_value text not null,
  created_at timestamptz not null default now(),
  unique (match_field, match_value)
);

insert into public.vertical_classification_rules (vertical_id, match_field, match_value)
select id, 'therapeutic_area', v
from public.verticals, unnest(array['AI Imaging', 'Imaging AI', 'Radiology', 'Radiology AI']) as v
where slug = 'ai-imaging';

-- ============================================================
-- vertical_playbooks: buyer archetypes, qualification signals, objection
-- maps — the content currently hardcoded as static prose in prompt.txt's
-- BUYER PERSONA PLAYBOOK section. One row per (vertical, section). Left
-- empty here; populated in Phase 3 when that prompt content is migrated.
-- ============================================================

create table public.vertical_playbooks (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references public.verticals(id) on delete cascade,
  section text not null check (section in (
    'buyer_archetype', 'qualification_signal', 'disqualification_signal',
    'objection', 'signal_to_action'
  )),
  title text not null,
  content text not null,
  display_order integer not null default 0,
  is_verified boolean not null default true,
  last_updated date not null default current_date,
  created_at timestamptz not null default now()
);

create index vertical_playbooks_vertical_idx on public.vertical_playbooks (vertical_id, section, display_order);

-- ============================================================
-- vertical_signal_sources: replaces the hardcoded Perplexity query list in
-- sync-ai-imaging-intelligence/index.ts. One row per (vertical, signal_type).
-- Left empty here; Phase 2 seeds it from that file's existing queries when
-- sync-vertical-intelligence replaces sync-ai-imaging-intelligence.
-- ============================================================

create table public.vertical_signal_sources (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references public.verticals(id) on delete cascade,
  signal_type text not null,
  query_template text not null,
  classifier_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (vertical_id, signal_type)
);

-- ============================================================
-- vertical_intelligence: generalized ai_imaging_intelligence.
-- Weekly-synced market signals, now vertical-scoped instead of imaging-only.
-- Existing rows are copied in (source table is untouched).
-- ============================================================

create table public.vertical_intelligence (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references public.verticals(id) on delete cascade,
  signal_type text not null check (signal_type in (
    'cms_reimbursement', 'fda_regulatory', 'funding_company', 'clinical_conference', 'stakeholder_org'
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

insert into public.vertical_intelligence (
  vertical_id, signal_type, signal_date, raw_signal, company_name, use_case,
  commercial_implication, triggered_action, urgency, source_url, expires_at, created_at
)
select
  (select id from public.verticals where slug = 'ai-imaging'),
  signal_type, signal_date, raw_signal, company_name, use_case,
  commercial_implication, triggered_action, urgency, source_url, expires_at, created_at
from public.ai_imaging_intelligence;

create index vertical_intelligence_vertical_idx on public.vertical_intelligence (vertical_id);
create index vertical_intelligence_signal_type_idx on public.vertical_intelligence (signal_type);
create index vertical_intelligence_company_idx on public.vertical_intelligence (lower(company_name)) where company_name is not null;
create index vertical_intelligence_created_at_idx on public.vertical_intelligence (created_at desc);
create index vertical_intelligence_urgency_idx on public.vertical_intelligence (urgency);

-- ============================================================
-- vertical_competitive: generalized ai_imaging_competitive.
-- Existing rows are copied in (source table is untouched).
-- ============================================================

create table public.vertical_competitive (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references public.verticals(id) on delete cascade,
  company_name text not null,
  use_case text not null,
  commercial_stage text not null,
  is_pathova_disqualifier boolean not null default false,
  disqualifier_reason text,
  total_funding_usd bigint,
  last_round_type text,
  last_round_date date,
  ttm_revenue_usd bigint,
  revenue_signal text,
  fda_cleared boolean,
  reimbursement_status text,
  contract_track_record text,
  contract_notes text,
  competitive_notes text,
  metadata jsonb not null default '{}'::jsonb,
  last_updated date not null,
  is_verified boolean not null default true
);

insert into public.vertical_competitive (
  vertical_id, company_name, use_case, commercial_stage, is_pathova_disqualifier,
  disqualifier_reason, total_funding_usd, last_round_type, last_round_date,
  ttm_revenue_usd, revenue_signal, fda_cleared, reimbursement_status,
  contract_track_record, contract_notes, competitive_notes, last_updated, is_verified
)
select
  (select id from public.verticals where slug = 'ai-imaging'),
  company_name, indication, commercial_stage, is_pathova_disqualifier,
  disqualifier_reason, total_funding_usd, last_round_type, last_round_date,
  ttm_revenue_usd, revenue_signal, fda_cleared, reimbursement_status,
  contract_track_record, contract_notes, competitive_notes, last_updated, is_verified
from public.ai_imaging_competitive;

create index vertical_competitive_vertical_idx on public.vertical_competitive (vertical_id);
create index vertical_competitive_disqualifier_idx on public.vertical_competitive (is_pathova_disqualifier);
create index vertical_competitive_stage_idx on public.vertical_competitive (commercial_stage);
create index vertical_competitive_name_idx on public.vertical_competitive (lower(company_name));

-- ============================================================
-- vertical_economics: generalized ai_imaging_reimbursement. Healthcare-
-- specific fields (cpt_code, ntap_*, tcet_*) stay as nullable columns since
-- medtech verticals are the only ones populated today; a non-healthcare
-- vertical leaves them null and uses `metadata` for its own cost-argument
-- structure instead of forcing a schema change per vertical.
-- Existing rows are copied in (source table is untouched).
-- ============================================================

create table public.vertical_economics (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references public.verticals(id) on delete cascade,
  use_case text not null,
  use_case_label text not null,
  cpt_code text,
  cpt_category text,
  cpt_description text,
  cpt_medicare_covered boolean default false,
  cpt_notes text,
  ntap_status text,
  ntap_company text,
  ntap_fy_approved text,
  ntap_expiry text,
  ntap_max_payment_usd integer,
  ntap_rejection_reason text,
  has_cost_justification_gap boolean not null default true,
  gap_commercial_impact text not null,
  tcet_eligible boolean,
  tcet_notes text,
  billed_under text,
  billing_notes text,
  roi_narrative text not null,
  metadata jsonb not null default '{}'::jsonb,
  last_updated date not null,
  source_notes text,
  is_verified boolean default true
);

insert into public.vertical_economics (
  vertical_id, use_case, use_case_label, cpt_code, cpt_category, cpt_description,
  cpt_medicare_covered, cpt_notes, ntap_status, ntap_company, ntap_fy_approved,
  ntap_expiry, ntap_max_payment_usd, ntap_rejection_reason, has_cost_justification_gap,
  gap_commercial_impact, tcet_eligible, tcet_notes, billed_under, billing_notes,
  roi_narrative, last_updated, source_notes, is_verified
)
select
  (select id from public.verticals where slug = 'ai-imaging'),
  indication, indication_label, cpt_code, cpt_category, cpt_description,
  cpt_medicare_covered, cpt_notes, ntap_status, ntap_company, ntap_fy_approved,
  ntap_expiry, ntap_max_payment_usd, ntap_rejection_reason, has_reimbursement_gap,
  gap_commercial_impact, tcet_eligible, tcet_notes, billed_under, billing_notes,
  roi_narrative, last_updated, source_notes, is_verified
from public.ai_imaging_reimbursement;

create index vertical_economics_vertical_idx on public.vertical_economics (vertical_id);
create index vertical_economics_use_case_idx on public.vertical_economics (use_case);
create index vertical_economics_gap_idx on public.vertical_economics (has_cost_justification_gap);
create index vertical_economics_label_idx on public.vertical_economics (lower(use_case_label));

-- ============================================================
-- vertical_roi_models: generalized ai_imaging_roi_models.
-- Existing rows are copied in (source table is untouched).
-- ============================================================

create table public.vertical_roi_models (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references public.verticals(id) on delete cascade,
  use_case text,
  institution_type text,
  roi_type text not null,
  title text not null,
  content text not null,
  primary_metric text,
  defensibility text,
  defensibility_notes text,
  last_updated date not null,
  is_verified boolean default true
);

insert into public.vertical_roi_models (
  vertical_id, use_case, institution_type, roi_type, title, content,
  primary_metric, defensibility, defensibility_notes, last_updated, is_verified
)
select
  (select id from public.verticals where slug = 'ai-imaging'),
  indication, institution_type, roi_type, title, content,
  primary_metric, defensibility, defensibility_notes, last_updated, is_verified
from public.ai_imaging_roi_models;

create index vertical_roi_models_vertical_idx on public.vertical_roi_models (vertical_id);
create index vertical_roi_models_use_case_idx on public.vertical_roi_models (use_case);
create index vertical_roi_models_institution_idx on public.vertical_roi_models (institution_type);

-- ============================================================
-- vertical_procurement: generalized ai_imaging_procurement.
-- Existing rows are copied in (source table is untouched).
-- ============================================================

create table public.vertical_procurement (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references public.verticals(id) on delete cascade,
  institution_type text not null,
  topic text not null,
  title text not null,
  content text not null,
  failure_mode_relevance text[],
  outreach_application text,
  last_updated date not null,
  is_verified boolean default true
);

insert into public.vertical_procurement (
  vertical_id, institution_type, topic, title, content,
  failure_mode_relevance, outreach_application, last_updated, is_verified
)
select
  (select id from public.verticals where slug = 'ai-imaging'),
  institution_type, topic, title, content,
  failure_mode_relevance, outreach_application, last_updated, is_verified
from public.ai_imaging_procurement;

create index vertical_procurement_vertical_idx on public.vertical_procurement (vertical_id);
create index vertical_procurement_institution_idx on public.vertical_procurement (institution_type);
create index vertical_procurement_topic_idx on public.vertical_procurement (topic);
create index vertical_procurement_failure_mode_idx on public.vertical_procurement using gin(failure_mode_relevance);

-- ============================================================
-- Row level security — service role only, matching every other table here.
-- ============================================================

alter table public.verticals enable row level security;
create policy service_role_full_access on public.verticals using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

alter table public.vertical_classification_rules enable row level security;
create policy service_role_full_access on public.vertical_classification_rules using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

alter table public.vertical_playbooks enable row level security;
create policy service_role_full_access on public.vertical_playbooks using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

alter table public.vertical_signal_sources enable row level security;
create policy service_role_full_access on public.vertical_signal_sources using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

alter table public.vertical_intelligence enable row level security;
create policy service_role_full_access on public.vertical_intelligence using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

alter table public.vertical_competitive enable row level security;
create policy service_role_full_access on public.vertical_competitive using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

alter table public.vertical_economics enable row level security;
create policy service_role_full_access on public.vertical_economics using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

alter table public.vertical_roi_models enable row level security;
create policy service_role_full_access on public.vertical_roi_models using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

alter table public.vertical_procurement enable row level security;
create policy service_role_full_access on public.vertical_procurement using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
