import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json().catch(() => ({}));
  const { filter, limit } = body;
  const effectiveLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

  // Resolve account_name → account_id if the caller gave a name and not a UUID.
  let resolvedAccountId: string | null = filter?.account_id ?? null;
  let resolvedAccountName: string | null = null;
  if (!resolvedAccountId && filter?.account_name) {
    const { data: acct } = await supabase
      .from('accounts')
      .select('id, company_name')
      .ilike('company_name', `%${filter.account_name}%`)
      .limit(1)
      .maybeSingle();
    if (acct) {
      resolvedAccountId = acct.id;
      resolvedAccountName = acct.company_name;
    }
  }

  let query = supabase
    .from('touches')
    .select(
      'notion_page_id, notion_url, account_id, account_name, title, touch_date, channel, sent, outcome, top_challenges, message, updated_at',
    )
    .order('touch_date', { ascending: false, nullsFirst: false })
    .limit(effectiveLimit);

  if (resolvedAccountId) {
    query = query.eq('account_id', resolvedAccountId);
  }
  if (typeof filter?.sent === 'boolean') {
    query = query.eq('sent', filter.sent);
  }
  if (filter?.channel) {
    query = query.ilike('channel', `%${filter.channel}%`);
  }
  if (filter?.outcome) {
    query = query.ilike('outcome', `%${filter.outcome}%`);
  }

  const today = new Date();
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  if (typeof filter?.due_within_days === 'number') {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + Math.max(0, filter.due_within_days));
    query = query.lte('touch_date', isoDate(cutoff)).eq('sent', false);
  }
  if (typeof filter?.since_days === 'number') {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - Math.max(0, filter.since_days));
    query = query.gte('touch_date', isoDate(cutoff));
  }
  if (filter?.before_date) {
    query = query.lte('touch_date', filter.before_date);
  }
  if (filter?.after_date) {
    query = query.gte('touch_date', filter.after_date);
  }

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = data || [];
  const byChannel = rows.reduce((acc: Record<string, number>, r: any) => {
    const k = r.channel || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const byOutcome = rows.reduce((acc: Record<string, number>, r: any) => {
    const k = r.outcome || 'Pending';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const sentCount = rows.filter((r: any) => r.sent).length;

  return new Response(
    JSON.stringify({
      total: rows.length,
      limit: effectiveLimit,
      resolved_account: resolvedAccountId
        ? { id: resolvedAccountId, name: resolvedAccountName }
        : null,
      touches: rows,
      summary: {
        sent: sentCount,
        unsent: rows.length - sentCount,
        by_channel: byChannel,
        by_outcome: byOutcome,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
