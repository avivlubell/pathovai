-- Podcast Signals — mirrors the "Podcast Intelligence — Signal Feed" Notion DB
-- (120c558ae84d4556badec345119300b6). Each row is one insight pulled from a
-- MedTech podcast episode (Medsider, State of MedTech, LSI, etc.) tagged with
-- a signal_type that captures *why* it matters: Buyer Psychology, Commercial
-- Pattern, Category Signal, Investor Framing, Objection, Trigger Event.
--
-- Distinct from industry_intelligence:
--   • industry_intelligence = news/events from the world (RAPID, M&A, FDA)
--   • podcast_signals       = voice-of-buyer / voice-of-investor patterns
--                             (how operators actually talk, what they object
--                             to, how investors frame the category)
--
-- Synced via supabase/functions/sync-podcast-signals.
-- Queried by the QB at runtime via query_podcast_signals as a credibility /
-- authority layer for outreach drafting and category-level questions.

create table if not exists public.podcast_signals (
  notion_page_id text primary key,
  notion_url text,
  title text,
  show text,                              -- single-select: Medsider, State of MedTech, LSI, etc.
  guest_name text,
  guest_company text,
  air_date date,
  source_url text,
  signal_type text,                       -- Buyer Psychology / Commercial Pattern / Category Signal / Investor Framing / Objection / Trigger Event
  icp_relevance text,                     -- High / Medium / Low
  content_angle text,
  key_insight text,
  used_in_content boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_synced_at timestamptz default now()
);

create index if not exists podcast_signals_signal_type_idx
  on public.podcast_signals(signal_type);
create index if not exists podcast_signals_show_idx
  on public.podcast_signals(show);
create index if not exists podcast_signals_icp_relevance_idx
  on public.podcast_signals(icp_relevance);
create index if not exists podcast_signals_air_date_idx
  on public.podcast_signals(air_date desc);
