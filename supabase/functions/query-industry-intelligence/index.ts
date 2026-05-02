// query-industry-intelligence — Supabase mirror of the Industry Intelligence
// Notion DB. Filters by category, signal_type, therapeutic_area, topic_tags,
// icp_stage, urgency_window, qb_impact_type, evidence_strength, confidence,
// and recency. Used as a precondition before invoke_outreach_drafter (see
// prompt.txt: INDUSTRY INTELLIGENCE PRECONDITION).
//
// Reads from the active_industry_intelligence view by default (excludes
// expired signals). Pass include_expired=true to fall back to the base table.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SELECT_COLUMNS = [
  'notion_page_id', 'notion_url', 'title', 'category', 'signal_type',
  'source_publication', 'source_url', 'source_date', 'what_happened', 'so_what',
  'therapeutic_area', 'icp_stage', 'buyer_persona', 'topic_tags',
  'urgency_window', 'scan_notion_page_id',
  'qb_feature_deltas', 'qb_impact_type', 'recommended_outreach_trigger',
  'expiration_date', 'evidence_strength', 'confidence_score',
  'geography', 'affected_company_or_segment',
].join(', ');

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const {
    category,
    signal_type,
    therapeutic_area,
    topic_tags,
    icp_stage,
    buyer_persona,
    urgency_window,
    qb_impact_type,
    evidence_strength,
    min_confidence,
    include_expired,
    recency_days,
    query: q,
    limit,
  } = body;

  const effectiveLimit = Math.min(Math.max(Number(limit) || 5, 1), 25);
  const effectiveRecencyDays = Number(recency_days) >= 0
    ? Number(recency_days)
    : 60;

  const sourceTable = include_expired === true
    ? 'industry_intelligence'
    : 'active_industry_intelligence';

  let query = supabase
    .from(sourceTable)
    .select(SELECT_COLUMNS)
    .order('confidence_score', { ascending: false, nullsFirst: false })
    .order('source_date', { ascending: false, nullsFirst: false })
    .limit(effectiveLimit);

  if (category) query = query.eq('category', category);
  if (signal_type) query = query.eq('signal_type', signal_type);
  if (urgency_window) query = query.eq('urgency_window', urgency_window);
  if (qb_impact_type) query = query.eq('qb_impact_type', qb_impact_type);
  if (evidence_strength) query = query.eq('evidence_strength', evidence_strength);

  if (Number.isFinite(Number(min_confidence))) {
    query = query.gte('confidence_score', Number(min_confidence));
  }

  if (Array.isArray(therapeutic_area) && therapeutic_area.length > 0) {
    query = query.overlaps('therapeutic_area', therapeutic_area);
  }
  if (Array.isArray(topic_tags) && topic_tags.length > 0) {
    query = query.overlaps('topic_tags', topic_tags);
  }
  if (Array.isArray(icp_stage) && icp_stage.length > 0) {
    query = query.overlaps('icp_stage', icp_stage);
  }
  if (Array.isArray(buyer_persona) && buyer_persona.length > 0) {
    query = query.overlaps('buyer_persona', buyer_persona);
  }

  if (effectiveRecencyDays > 0) {
    const cutoff = new Date(Date.now() - effectiveRecencyDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    query = query.gte('source_date', cutoff);
  }

  if (typeof q === 'string' && q.trim()) {
    const term = q.trim().replace(/[%_]/g, ''); // strip ILIKE wildcards
    query = query.or(
      `title.ilike.%${term}%,what_happened.ilike.%${term}%,so_what.ilike.%${term}%`
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
  const byCategory = rows.reduce((acc: Record<string, number>, r: any) => {
    const k = r.category || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const byImpact = rows.reduce((acc: Record<string, number>, r: any) => {
    const k = r.qb_impact_type || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return new Response(
    JSON.stringify({
      total: rows.length,
      limit: effectiveLimit,
      recency_days: effectiveRecencyDays,
      include_expired: include_expired === true,
      source: sourceTable,
      items: rows,
      summary: {
        by_signal_type: bySignal,
        by_category: byCategory,
        by_qb_impact_type: byImpact,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
