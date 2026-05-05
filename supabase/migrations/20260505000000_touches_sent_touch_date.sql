-- Add sent_touch_date to mirror the new Notion schema where Touch Date
-- (planned-only, cleared after send) and Sent Touch Date (actual send date,
-- manual) are separate properties. See ops migration plan 2026-05-05.
--
-- Pre-migration: touch_date carried both meanings and Sent Touch Date in
-- Notion was a formula. After the Notion data migration, sent rows have
-- empty Touch Date and a manual Sent Touch Date — this column captures the
-- latter so Supabase can preserve the planned-vs-sent distinction.

alter table public.touches
  add column if not exists sent_touch_date date;

create index if not exists touches_sent_touch_date_idx
  on public.touches(sent_touch_date);

-- Sent-only history queries (e.g. "what did we send in the last 30 days")
-- filter sent=true and order by sent_touch_date desc. Partial index keeps
-- it small and skips the unsent half of the table.
create index if not exists touches_sent_history_idx
  on public.touches(account_id, sent_touch_date desc)
  where sent = true;

-- Effective date: actual send date for sent rows, planned date for unsent.
-- Lets query-touches sort and roll up "the date this row is anchored to"
-- without expressing coalesce() in PostgREST (which it doesn't natively
-- support in order/filter clauses). Stored generated column so it can be
-- indexed and used by views.
alter table public.touches
  add column if not exists effective_touch_date date
  generated always as (coalesce(sent_touch_date, touch_date)) stored;

create index if not exists touches_effective_date_idx
  on public.touches(effective_touch_date desc nulls last);
