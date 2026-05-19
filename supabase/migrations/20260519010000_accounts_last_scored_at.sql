-- Add last_scored_at to accounts so the QB can skip re-running ICP scoring
-- on freshly-scored accounts. The icp-scorer edge function writes this on
-- every successful scoring run. Previously only updated_at was written,
-- which is not scoring-specific.

alter table public.accounts
  add column if not exists last_scored_at timestamptz;
