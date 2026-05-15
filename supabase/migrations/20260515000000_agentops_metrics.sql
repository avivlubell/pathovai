-- AgentOps observability tables.
--
-- tool_metrics: per-tool-call latency and success. Answers "what is P95 latency
--   for invoke_prospect_researcher?" and "which tools fail most often?"
-- pic_accuracy_events: verifier flag/strip counts per session. Answers "what
--   fraction of sessions have zero verifier flags?" (factual accuracy rate).

CREATE TABLE IF NOT EXISTS tool_metrics (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   text,
  tool_name    text        NOT NULL,
  duration_ms  integer     NOT NULL,
  success      boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tool_metrics_session_idx     ON tool_metrics(session_id);
CREATE INDEX tool_metrics_tool_name_idx   ON tool_metrics(tool_name);
CREATE INDEX tool_metrics_created_at_idx  ON tool_metrics(created_at);

CREATE TABLE IF NOT EXISTS pic_accuracy_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   text,
  flag_count   integer     NOT NULL DEFAULT 0,
  strip_count  integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pic_accuracy_events_session_idx    ON pic_accuracy_events(session_id);
CREATE INDEX pic_accuracy_events_created_at_idx ON pic_accuracy_events(created_at);
