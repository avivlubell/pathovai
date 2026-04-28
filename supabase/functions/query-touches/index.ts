import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json().catch(() => ({}));
  const { filter, limit } = body;
  const effectiveLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);

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

  // Apply identical filters to a query builder. Used twice: once for the
  // detail row sample (with limit), once for the unbounded rollup.
  const today = new Date();
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  type QB = ReturnType<typeof supabase.from>;
  const applyFilters = (q: any) => {
    if (resolvedAccountId) q = q.eq('account_id', resolvedAccountId);
    if (typeof filter?.sent === 'boolean') q = q.eq('sent', filter.sent);
    if (filter?.channel) q = q.ilike('channel', `%${filter.channel}%`);
    if (filter?.outcome) q = q.ilike('outcome', `%${filter.outcome}%`);
    if (typeof filter?.due_within_days === 'number') {
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() + Math.max(0, filter.due_within_days));
      q = q.lte('touch_date', isoDate(cutoff)).eq('sent', false);
    }
    if (typeof filter?.since_days === 'number') {
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - Math.max(0, filter.since_days));
      q = q.gte('touch_date', isoDate(cutoff));
    }
    if (filter?.before_date) q = q.lte('touch_date', filter.before_date);
    if (filter?.after_date) q = q.gte('touch_date', filter.after_date);
    return q;
  };

  // ---- 1. Detail rows (limited sample for context) ----
  const detailQuery = applyFilters(
    supabase
      .from('touches')
      .select(
        'notion_page_id, notion_url, account_id, account_name, title, touch_date, channel, sent, outcome, top_challenges, message, updated_at',
        { count: 'exact' },
      )
      .order('touch_date', { ascending: false, nullsFirst: false })
      .limit(effectiveLimit),
  );

  const { data: rows, count: totalMatching, error } = await detailQuery;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---- 2. Lightweight rollup query (no limit, minimal columns) ----
  // This is what the LLM should rely on for "how many", "by account", etc.
  // The detail rows above are a sample for narrative context only.
  const rollupQuery = applyFilters(
    supabase
      .from('touches')
      .select('account_id, account_name, touch_date, sent, channel, outcome'),
  );
  const { data: allMatchingForRollup } = await rollupQuery;

  const all = allMatchingForRollup || [];
  const sentCount = all.filter((r: any) => r.sent).length;

  const byChannel = all.reduce((acc: Record<string, number>, r: any) => {
    const k = r.channel || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const byOutcome = all.reduce((acc: Record<string, number>, r: any) => {
    const k = r.outcome || 'Pending';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // Per-account rollup with oldest/newest touch dates so the LLM can spot
  // long-stale drafts without scanning every row.
  type AcctRoll = {
    account_id: string | null;
    account_name: string | null;
    count: number;
    oldest_touch_date: string | null;
    newest_touch_date: string | null;
    channels: Record<string, number>;
  };
  const byAccountMap = new Map<string, AcctRoll>();
  for (const r of all as any[]) {
    const key = r.account_id || `__unlinked__:${r.account_name || ''}`;
    const cur =
      byAccountMap.get(key) ||
      ({
        account_id: r.account_id,
        account_name: r.account_name,
        count: 0,
        oldest_touch_date: null,
        newest_touch_date: null,
        channels: {},
      } as AcctRoll);
    cur.count++;
    if (r.touch_date) {
      if (!cur.oldest_touch_date || r.touch_date < cur.oldest_touch_date) {
        cur.oldest_touch_date = r.touch_date;
      }
      if (!cur.newest_touch_date || r.touch_date > cur.newest_touch_date) {
        cur.newest_touch_date = r.touch_date;
      }
    }
    if (r.channel) cur.channels[r.channel] = (cur.channels[r.channel] || 0) + 1;
    byAccountMap.set(key, cur);
  }
  const byAccount = Array.from(byAccountMap.values()).sort((a, b) => b.count - a.count);

  return new Response(
    JSON.stringify({
      total_matching: totalMatching ?? all.length,
      total_returned: rows?.length ?? 0,
      truncated: (totalMatching ?? 0) > (rows?.length ?? 0),
      limit: effectiveLimit,
      resolved_account: resolvedAccountId
        ? { id: resolvedAccountId, name: resolvedAccountName }
        : null,
      touches: rows || [],
      summary: {
        sent: sentCount,
        unsent: all.length - sentCount,
        accounts: byAccountMap.size,
        oldest_touch_date: all.reduce(
          (acc: string | null, r: any) =>
            r.touch_date && (!acc || r.touch_date < acc) ? r.touch_date : acc,
          null,
        ),
        newest_touch_date: all.reduce(
          (acc: string | null, r: any) =>
            r.touch_date && (!acc || r.touch_date > acc) ? r.touch_date : acc,
          null,
        ),
        by_channel: byChannel,
        by_outcome: byOutcome,
        by_account: byAccount,
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
