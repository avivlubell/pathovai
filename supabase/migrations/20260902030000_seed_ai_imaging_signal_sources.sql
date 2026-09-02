-- Seed vertical_signal_sources for the ai-imaging vertical with the exact
-- Perplexity queries currently hardcoded in sync-ai-imaging-intelligence/index.ts
-- (SCAN_QUERIES). Copied verbatim, no edits. sync-vertical-intelligence reads
-- these instead of a hardcoded query list.

insert into public.vertical_signal_sources (vertical_id, signal_type, query_template)
select id, signal_type, query_template
from public.verticals, (values
  ('cms_reimbursement', 'AI diagnostic imaging CMS LCD NCD reimbursement coverage 2025 2026 radiology CPT code NTAP approval'),
  ('fda_regulatory', 'AI radiology imaging 510k clearance De Novo FDA approval 2025 2026 chest X-ray mammography stroke detection pathology'),
  ('funding_company', 'AI medical imaging startup Series A Series B funding 2025 2026 diagnostic radiology VP Sales CCO hire OR depart'),
  ('clinical_conference', 'RSNA HIMSS 2025 2026 AI imaging pilot hospital abstract announcement radiology AI evaluation site'),
  ('stakeholder_org', 'hospital radiology AI governance committee chief radiologist CIO CMO appointment 2025 2026 health system AI policy')
) as q(signal_type, query_template)
where slug = 'ai-imaging';
