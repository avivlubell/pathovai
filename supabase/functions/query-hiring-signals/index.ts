// query-hiring-signals — Supabase mirror of the "MedTech Commercial Hiring
// Signals" Notion DB. Filters by icp_signal, seniority, company, recency, and
// free-text. Used by the QB to surface commercial hiring activity as a
// prospect prioritization signal or outreach hook.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const {
    icp_signal,
    seniority,
    company,
    since_days,
    query: q,
    limit,
  } = body;

  const effectiveLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const effectiveSinceDays = Number(since_days) >= 0 ? Number(since_days) : 90;

  let query = supabase
    .from('hiring_signals')
    .select(
      'notion_page_id, notion_url, name, company, role, seniority, location, icp_signal, source, job_url, date_found, run_date, notes'
    )
    .order('run_date', { ascending: false, nullsFirst: false })
    .order('date_found', { ascending: false, nullsFirst: false })
    .limit(effectiveLimit);

  if (icp_signal) query = query.eq('icp_signal', icp_signal);
  if (seniority) query = query.eq('seniority', seniority);

  if (effectiveSinceDays > 0) {
    const cutoff = new Date(Date.now() - effectiveSinceDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    query = query.gte('run_date', cutoff);
  }

  if (typeof company === 'string' && company.trim()) {
    query = query.ilike('company', `%${company.trim().replace(/[%_]/g, '')}%`);
  }

  if (typeof q === 'string' && q.trim()) {
    const term = q.trim().replace(/[%_]/g, '');
    query = query.or(
      `name.ilike.%${term}%,company.ilike.%${term}%,role.ilike.%${term}%,notes.ilike.%${term}%,location.ilike.%${term}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = data || [];

  const bySignal = rows.reduce((acc: Record<string, number>, r: any) => {
    const k = r.icp_signal || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const bySeniority = rows.reduce((acc: Record<string, number>, r: any) => {
    const k = r.seniority || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return new Response(
    JSON.stringify({
      total: rows.length,
      limit: effectiveLimit,
      since_days: effectiveSinceDays,
      items: rows,
      summary: {
        by_icp_signal: bySignal,
        by_seniority: bySeniority,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
