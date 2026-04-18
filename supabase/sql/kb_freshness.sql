-- KB freshness RPC for the header indicator. Returns the OLDEST of the
-- per-table MAX(updated_at) across the knowledge-base tables -- this is
-- the "weakest link" timestamp that actually limits how fresh an answer
-- can be -- plus the total number of indexed records.
--
-- COALESCE(updated_at, created_at) guards against rows that haven't
-- been touched since insert (created_at is set on every Supabase row).

create or replace function public.kb_freshness()
returns table (last_updated_at timestamptz, record_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with per_table as (
    select
      max(coalesce(updated_at, created_at)) as latest,
      count(*)::bigint as n
    from public.reference_library
    union all
    select
      max(coalesce(updated_at, created_at)) as latest,
      count(*)::bigint as n
    from public.knowledge_base
    union all
    select
      max(coalesce(updated_at, created_at)) as latest,
      count(*)::bigint as n
    from public.agent_learnings
  )
  select
    min(latest) as last_updated_at,
    coalesce(sum(n), 0)::bigint as record_count
  from per_table;
$$;

-- Allow the service role (used by the API route) to call it. The
-- function is SECURITY DEFINER so the caller does not need direct
-- table privileges, but we still grant explicitly for clarity.
grant execute on function public.kb_freshness() to service_role;
grant execute on function public.kb_freshness() to anon;
grant execute on function public.kb_freshness() to authenticated;
