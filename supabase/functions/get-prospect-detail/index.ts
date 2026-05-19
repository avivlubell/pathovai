import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveAccountByName } from '../_shared/fuzzy-lookup.ts';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  // Accept account_id (canonical) and prospect_id (legacy) for back-compat.
  const account_id: string | undefined = body?.account_id ?? body?.prospect_id;
  const company_name: string | undefined = body?.company_name;

  if (!account_id && !company_name) {
    return new Response(JSON.stringify({ error: 'Must provide account_id or company_name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let resolvedId: string | undefined = account_id;
  let matchInfo: any = undefined;

  if (!resolvedId && company_name) {
    const resolved = await resolveAccountByName(supabase, company_name);
    if (!resolved) {
      return new Response(
        JSON.stringify({
          error: 'No account matched that name',
          query: company_name,
          hint: 'Try search_accounts_and_contacts to browse similar names.',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    resolvedId = resolved.id;
    matchInfo = resolved.match_info;
  }

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', resolvedId)
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.code === 'PGRST116' ? 404 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Strip large blobs — research_output and deepdive_output can be 8k+ tokens
  // and flood the QB context window on every account lookup. The QB only needs
  // metadata for routing decisions; the full report is loaded by the managers
  // that actually need it (icp-scorer, outreach-drafter).
  const { research_output, deepdive_output, icp_score_breakdown, ...metadata } = data;

  // Expose freshness timestamps as a top-level block so the QB can make
  // conditional delegation decisions without parsing the full row.
  const _freshness = {
    last_researched: data.last_researched ?? null,
    last_scored_at: data.last_scored_at ?? null,
    research_status: data.research_status ?? null,
    icp_tier: data.icp_tier ?? null,
    icp_score: data.icp_score ?? null,
  };

  const payload = { ...metadata, _freshness, ...(matchInfo ? { _match_info: matchInfo } : {}) };

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' }
  });
});
