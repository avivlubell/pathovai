-- Add therapeutic_area to accounts for AI Imaging Operator routing.
-- Mirrors the "Therapeutic Area" multi_select property in the OI Notion database.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS therapeutic_area text[];

-- Index for contains/overlap queries (e.g. WHERE 'AI Imaging' = ANY(therapeutic_area))
CREATE INDEX IF NOT EXISTS idx_accounts_therapeutic_area ON accounts USING gin(therapeutic_area);
