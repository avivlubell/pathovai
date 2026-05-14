-- Add severity and status fields to agent_learnings for priority-weighted retrieval.
--
-- severity: distinguishes hard rules (score math, named entity corrections) from
--   soft preferences (framing, voice) so agents can load the right slice.
-- status: allows deprecating junk/duplicate rows without deleting them.

ALTER TABLE agent_learnings
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'preference'
    CHECK (severity IN ('hard_rule', 'preference', 'observation')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'canonical'
    CHECK (status IN ('canonical', 'draft', 'deprecated'));

-- corrections and banned_phrases are non-negotiable by definition
UPDATE agent_learnings
SET severity = 'hard_rule'
WHERE learning_type IN ('correction', 'banned_phrase')
  AND status = 'canonical';

-- domain_knowledge records are factual ground truth, treat as hard rules
UPDATE agent_learnings
SET severity = 'hard_rule'
WHERE learning_type = 'domain_knowledge'
  AND status = 'canonical';

-- deprecate known test/junk rows
UPDATE agent_learnings
SET status = 'deprecated'
WHERE content ILIKE '%automated test%'
   OR content ILIKE '%safe to delete%';

-- v_canonical_learnings: active, non-deprecated rows, deduplicated on
-- (applies_to, learning_type, first 120 chars of content) keeping the most recent.
CREATE OR REPLACE VIEW v_canonical_learnings AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY applies_to::text, learning_type, LEFT(TRIM(content), 120)
      ORDER BY created_at DESC
    ) AS rn
  FROM agent_learnings
  WHERE active = true AND status = 'canonical'
)
SELECT
  id, agent_source, learning_type, content, context,
  applies_to, relevance_tags, severity, status, created_at
FROM ranked
WHERE rn = 1;
