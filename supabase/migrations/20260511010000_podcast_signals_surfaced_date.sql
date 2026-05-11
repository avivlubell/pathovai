-- Add surfaced_date to podcast_signals — the date the signal was added to
-- the Notion database (i.e. when it was reviewed and logged), distinct from
-- air_date (when the episode originally aired). Lets the QB weight recently-
-- surfaced signals higher even if the underlying episode is old.
--
-- Set once on INSERT via DEFAULT CURRENT_DATE; never overwritten by the
-- sync function (sync-podcast-signals omits this column from upsert records).

alter table public.podcast_signals
  add column if not exists surfaced_date date default current_date;

-- Backfill existing rows from created_at.
update public.podcast_signals
set surfaced_date = created_at::date
where surfaced_date is null;

create index if not exists podcast_signals_surfaced_date_idx
  on public.podcast_signals(surfaced_date desc);
