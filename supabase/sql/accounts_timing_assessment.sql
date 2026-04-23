-- Add timing_assessment column used by sync-prospect-content.
--
-- supabase/functions/sync-prospect-content/index.ts pulls the "Tier 2
-- Angle/Extraction" section out of the Notion page body and upserts it
-- into accounts.timing_assessment. The column was never migrated, so
-- every sync failed with:
--   "Could not find the 'timing_assessment' column of 'accounts' in
--    the schema cache"
--
-- Idempotent; safe to re-run.

alter table if exists public.accounts
  add column if not exists timing_assessment text;
