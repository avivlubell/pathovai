-- Fuzzy name matching for accounts and contacts.
--
-- The agent is sensitive to spelling. Before this, every lookup used
-- `ilike '%q%'` -- a substring match with no typo tolerance, so
-- "Medtronik" would miss "Medtronic". This migration adds:
--   1. pg_trgm extension + GIN trigram indexes on the name columns
--      used by the Quarterback's lookup tools.
--   2. An `aliases` text[] column on accounts so we can teach the
--      system known variants ("JNJ" -> "Johnson & Johnson", "BD" ->
--      "Becton Dickinson") that trigram similarity won't catch on its
--      own.
--   3. Two RPC functions (`fuzzy_find_accounts`, `fuzzy_find_contacts`)
--      returning ranked candidates by similarity score, which the edge
--      functions call via supabase.rpc(). Scoring is case-insensitive
--      (pg_trgm lowercases before extracting trigrams).
--
-- Threshold notes: pg_trgm's default similarity threshold is 0.3. We
-- expose `min_score` so callers can tune per use case (sync flows want
-- stricter matching to avoid false links; chat lookups want looser).

create extension if not exists pg_trgm;

-- Aliases column. Default empty array so existing rows remain valid.
alter table if exists public.accounts
  add column if not exists aliases text[] not null default '{}';

-- Trigram indexes. GIN over gin_trgm_ops accelerates both the `%`
-- operator and `similarity()` ordering.
create index if not exists accounts_company_name_trgm_idx
  on public.accounts using gin (company_name gin_trgm_ops);

create index if not exists contacts_full_name_trgm_idx
  on public.contacts using gin (full_name gin_trgm_ops);

-- Optional: also index deals.company_name so query-deals can do
-- similarity lookups without a join.
create index if not exists deals_company_name_trgm_idx
  on public.deals using gin (company_name gin_trgm_ops);

-- RPC: fuzzy account lookup.
--
-- Scores each account as the max of (similarity against company_name,
-- max similarity against any entry in aliases). Returns top N above
-- the threshold, sorted by score descending. `matched_on` tells the
-- caller whether the win came from the canonical name or an alias,
-- which is useful for UI confirmations ("interpreted 'JNJ' as alias
-- for Johnson & Johnson -- correct?").
create or replace function public.fuzzy_find_accounts(
  q text,
  match_limit int default 5,
  min_score float default 0.3
)
returns table (
  id uuid,
  company_name text,
  score real,
  matched_on text
)
language sql
stable
as $$
  with scored as (
    select
      a.id,
      a.company_name,
      similarity(a.company_name, q) as name_score,
      coalesce((
        select max(similarity(alias, q))
        from unnest(a.aliases) as alias
      ), 0) as alias_score
    from public.accounts a
  )
  select
    s.id,
    s.company_name,
    greatest(s.name_score, s.alias_score)::real as score,
    case when s.name_score >= s.alias_score then 'company_name' else 'alias' end as matched_on
  from scored s
  where greatest(s.name_score, s.alias_score) >= min_score
  order by score desc, s.company_name asc
  limit match_limit;
$$;

-- RPC: fuzzy contact lookup.
create or replace function public.fuzzy_find_contacts(
  q text,
  match_limit int default 5,
  min_score float default 0.3
)
returns table (
  id uuid,
  full_name text,
  company_name text,
  account_id uuid,
  score real
)
language sql
stable
as $$
  select
    c.id,
    c.full_name,
    c.company_name,
    c.account_id,
    similarity(c.full_name, q)::real as score
  from public.contacts c
  where similarity(c.full_name, q) >= min_score
  order by score desc, c.full_name asc
  limit match_limit;
$$;

-- Grants: edge functions use service_role which bypasses RLS, but
-- keep execute grants tidy for anyone hitting these via PostgREST.
grant execute on function public.fuzzy_find_accounts(text, int, float) to service_role;
grant execute on function public.fuzzy_find_contacts(text, int, float) to service_role;
