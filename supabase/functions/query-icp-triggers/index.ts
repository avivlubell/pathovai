import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const { filter, limit } = body;
  const effectiveLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);

  let query = supabase
    .from('icp_triggers')
    .select('company_name, company_url, notion_url, headquarters, icp_tier, icp_score, confidence, fda_status, trigger_types, last_round_type, last_round_amount, date_found, clearance_date, outreach_status, summary, source')
    .order('date_found', { ascending: false, nullsFirst: false })
    .limit(effectiveLimit);

  if (filter?.tier) {
    query = query.ilike('icp_tier', `%${filter.tier}%`);
  }
  if (filter?.outreach_status) {
    query = query.ilike('outreach_status', `%${filter.outreach_status}%`);
  }
  if (filter?.fda_status) {
    query = query.ilike('fda_status', `%${filter.fda_status}%`);
  }
  if (filter?.trigger_type) {
    query = query.contains('trigger_types', [filter.trigger_type]);
  }
  if (filter?.company) {
    query = query.ilike('company_name', `%${filter.company}%`);
  }
  if (filter?.since_days) {
    const days = Math.max(Number(filter.since_days) || 0, 0);
    if (days > 0) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      query = query.gte('date_found', cutoff);
    }
  }

  const { data, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = data || [];
  const byTier = rows.reduce((acc: Record<string, number>, r: any) => {
    const k = r.icp_tier || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const byTriggerType = rows.reduce((acc: Record<string, number>, r: any) => {
    for (const t of r.trigger_types || []) acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const byOutreach = rows.reduce((acc: Record<string, number>, r: any) => {
    const k = r.outreach_status || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return new Response(JSON.stringify({
    total: rows.length,
    limit: effectiveLimit,
    triggers: rows,
    summary: {
      by_tier: byTier,
      by_trigger_type: byTriggerType,
      by_outreach_status: byOutreach,
    },
  }), { headers: { 'Content-Type': 'application/json' } });
});
