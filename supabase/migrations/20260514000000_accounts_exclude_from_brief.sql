-- Adds a flag to suppress an account from morning triage briefs.
-- Set by the QB when the user says "never include X in briefs / morning brief".
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS exclude_from_brief BOOLEAN NOT NULL DEFAULT false;
