-- Outreach Touches — mirror of Notion database bc4daa1322f24e46aadde4b6b0a25ab5.
-- Synced via supabase/functions/sync-touch-content (triggered by Notion Sync URL
-- click → /api/sync route). Touches are the per-message rows; the parent
-- account lives in `accounts` and is reached via the Related Outreach relation
-- in Notion, resolved here as touches.account_id.

create table if not exists public.touches (
  notion_page_id text primary key,
  notion_url text,

  -- Resolved from the Notion "Related Outreach" relation. Nullable — a touch
  -- can exist before the parent account has been synced (or for ad-hoc rows
  -- that don't link to an account at all).
  account_id uuid references public.accounts(id) on delete set null,
  account_name text,
  related_outreach_page_id text,

  -- Notion "Contact (Main)" relation — stored as the page ID; we don't have
  -- a contacts table to FK into yet.
  contact_notion_page_id text,

  title text,
  -- Forward-looking: planned send date for unsent rows; null after send.
  touch_date date,
  -- Actual send date; null until the row is marked sent.
  sent_touch_date date,
  -- Generated: actual send date if sent, else planned. Lets queries sort
  -- and roll up by "the date this row is anchored to" without expressing
  -- coalesce() in PostgREST.
  effective_touch_date date generated always as (coalesce(sent_touch_date, touch_date)) stored,
  channel text,
  sent boolean default false,
  outcome text,
  top_challenges text[] default '{}'::text[],
  message text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists touches_account_id_idx on public.touches(account_id);
create index if not exists touches_touch_date_idx on public.touches(touch_date);
create index if not exists touches_sent_touch_date_idx on public.touches(sent_touch_date);
create index if not exists touches_effective_date_idx
  on public.touches(effective_touch_date desc nulls last);
create index if not exists touches_sent_idx on public.touches(sent);

-- Open-touches view — the Quarterback's "what do I owe this week" query.
create index if not exists touches_open_due_idx
  on public.touches(account_id, touch_date)
  where sent = false;

-- Sent history — "what did we send in the last N days" queries.
create index if not exists touches_sent_history_idx
  on public.touches(account_id, sent_touch_date desc)
  where sent = true;
