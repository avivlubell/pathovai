-- Industry Intelligence — QB scoring fields added by the scanner.
-- Mirrors new properties on the Industry Intelligence Notion DB
-- (data source cf6f531b-9273-4fc7-892d-4c63c5f73e4b):
--
--   QB Feature Deltas (JSON)      -> qb_feature_deltas (jsonb)
--   QB Impact Type                -> qb_impact_type (text)
--   Recommended Outreach Trigger  -> recommended_outreach_trigger (text)
--   Expiration Date               -> expiration_date (date)
--   Evidence Strength             -> evidence_strength (text)
--   Confidence Score              -> confidence_score (smallint, 1-5)
--   Geography                     -> geography (text)
--   Affected Company or Segment   -> affected_company_or_segment (text)
--
-- Bucket vocabulary inside qb_feature_deltas is open — the scanner picks
-- bucket names per signal (e.g. "Reimbursement Tailwind", "Urgency to Act",
-- "Investor Pressure"), so no enum/CHECK on bucket. Each entry shape:
--   { bucket: text, direction: 'up'|'down'|'neutral',
--     magnitude: 'low'|'medium'|'high'|null, explanation: text }

alter table public.industry_intelligence
  add column if not exists qb_feature_deltas jsonb default '[]'::jsonb,
  add column if not exists qb_impact_type text,
  add column if not exists recommended_outreach_trigger text,
  add column if not exists expiration_date date,
  add column if not exists evidence_strength text,
  add column if not exists confidence_score smallint,
  add column if not exists geography text,
  add column if not exists affected_company_or_segment text;

create index if not exists industry_intelligence_qb_impact_type_idx
  on public.industry_intelligence(qb_impact_type);
create index if not exists industry_intelligence_expiration_date_idx
  on public.industry_intelligence(expiration_date);
create index if not exists industry_intelligence_evidence_strength_idx
  on public.industry_intelligence(evidence_strength);
create index if not exists industry_intelligence_confidence_score_idx
  on public.industry_intelligence(confidence_score desc);

-- Default view for the QB: filters out expired signals and ranks by
-- confidence then recency. query-industry-intelligence reads from this
-- by default; pass include_expired=true to fall back to the base table.
create or replace view public.active_industry_intelligence as
select *
from public.industry_intelligence
where expiration_date is null or expiration_date >= current_date;
