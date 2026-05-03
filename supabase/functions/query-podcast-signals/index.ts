// query-podcast-signals — Supabase mirror of the "Podcast Intelligence —
// Signal Feed" Notion DB. Filters by signal_type, show, icp_relevance,
// recency, and free-text. Used by the QB to add voice-of-buyer / voice-of-
// investor credibility to outreach drafts and category-level questions.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const {
    signal_type,
    show,
    icp_relevance,
    recency_days,
    query: q,
    limit,
  } = body;

  const effectiveLimit = Math.min(Math.max(Number(limit) || 5, 1), 25);
  const effectiveRecencyDays = Number(recency_days) >= 0
    ? Number(recency_days)
    : 180;

  let query = supabase
    .from('podcast_signals')
    .select(
      'notion_page_id, notion_url, title, show, guest_name, guest_company, air_date, source_url, signal_type, icp_relevance, content_angle, key_insight'
    )
    .order('air_date', { ascending: false, nullsFirst: false })
    .limit(effectiveLimit);

  if (signal_type) query = query.eq('signal_type', signal_type);
  if (show) query = query.eq('show', show);
  if (icp_relevance) query = query.eq('icp_relevance', icp_relevance);

  if (effectiveRecencyDays > 0) {
    const cutoff = new Date(Date.now() - effectiveRecencyDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    query = query.gte('air_date', cutoff);
  }

  if (typeof q === 'string' && q.trim()) {
    const term = q.trim().replace(/[%_]/g, '');
    query = query.or(
      `title.ilike.%${term}%,key_insight.ilike.%${term}%,content_angle.ilike.%${term}%,guest_company.ilike.%${term}%`
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
    const k = r.signal_type || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const byShow = rows.reduce((acc: Record<string, number>, r: any) => {
    const k = r.show || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return new Response(
    JSON.stringify({
      total: rows.length,
      limit: effectiveLimit,
      recency_days: effectiveRecencyDays,
      items: rows,
      summary: {
        by_signal_type: bySignal,
        by_show: byShow,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
