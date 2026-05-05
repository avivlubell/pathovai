import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Filter semantics under the post-2026-05-05 schema:
//
//   touch_date         = planned send date (unsent rows only; null once sent)
//   sent_touch_date    = actual send date (sent rows only; null until sent)
//   effective_touch_date = generated coalesce(sent_touch_date, touch_date)
//
// Filters route to the right column by intent:
//   - due_within_days  → planned/upcoming work → touch_date + sent=false
//   - sent_within_days → completed activity → sent_touch_date + sent=true
//   - since_days       → any activity in the last N days (DEPRECATED but
//                        preserved for backwards compat — maps to
//                        effective_touch_date >= cutoff)
//   - before_date / after_date → effective_touch_date (matches sent + planned)

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

  const today = new Date();
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  const applyFilters = (q: any) => {
    if (resolvedAccountId) q = q.eq('account_id', resolvedAccountId);
    if (typeof filter?.sent === 'boolean') q = q.eq('sent', filter.sent);
    if (filter?.channel) q = q.ilike('channel', `%${filter.channel}%`);
    if (filter?.outcome) q = q.ilike('outcome', `%${filter.outcome}%`);

    // Forward-looking: planned touches due within N days. touch_date is
    // populated only on unsent rows post-migration, so the sent=false
    // clause is redundant but kept for clarity.
    if (typeof filter?.due_within_days === 'number') {
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() + Math.max(0, filter.due_within_days));
      q = q.lte('touch_date', isoDate(cutoff)).eq('sent', false);
    }

    // Backward-looking: actual sends in last N days. Routes to
    // sent_touch_date. Implicitly sent=true since unsent rows have null
    // sent_touch_date and the gte filter excludes them.
    if (typeof filter?.sent_within_days === 'number') {
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - Math.max(0, filter.sent_within_days));
      q = q.gte('sent_touch_date', isoDate(cutoff)).eq('sent', true);
    }

    // Combined: any activity (sent or planned) anchored in the last N days.
    // Uses the generated effective_touch_date column.
    if (typeof filter?.since_days === 'number') {
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - Math.max(0, filter.since_days));
      q = q.gte('effective_touch_date', isoDate(cutoff));
    }

    if (filter?.before_date) q = q.lte('effective_touch_date', filter.before_date);
    if (filter?.after_date) q = q.gte('effective_touch_date', filter.after_date);
    return q;
  };

  // ---- 1. Detail rows (limited sample for context) ----
  // Sort by effective_touch_date so sent rows surface alongside planned
  // ones in the right chronological order. Old default sorted by
  // touch_date desc, which buried sent rows at the bottom (null touch_date).
  const detailQuery = applyFilters(
    supabase
      .from('touches')
      .select(
        'notion_page_id, notion_url, account_id, account_name, title, touch_date, sent_touch_date, effective_touch_date, channel, sent, outcome, top_challenges, message, updated_at',
        { count: 'exact' },
      )
      .order('effective_touch_date', { ascending: false, nullsFirst: false })
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
  const rollupQuery = applyFilters(
    supabase
      .from('touches')
      .select('account_id, account_name, touch_date, sent_touch_date, effective_touch_date, sent, channel, outcome'),
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

  // Per-account rollup with oldest/newest dates so the LLM can spot
  // long-stale drafts and identify recently-active accounts. Anchored on
  // effective_touch_date (sent date for sent rows, planned for unsent).
  type AcctRoll = {
    account_id: string | null;
    account_name: string | null;
    count: number;
    sent_count: number;
    oldest_date: string | null;
    newest_date: string | null;
    last_sent_date: string | null;
    next_due_date: string | null;
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
        sent_count: 0,
        oldest_date: null,
        newest_date: null,
        last_sent_date: null,
        next_due_date: null,
        channels: {},
      } as AcctRoll);
    cur.count++;
    if (r.sent) cur.sent_count++;
    const eff = r.effective_touch_date;
    if (eff) {
      if (!cur.oldest_date || eff < cur.oldest_date) cur.oldest_date = eff;
      if (!cur.newest_date || eff > cur.newest_date) cur.newest_date = eff;
    }
    if (r.sent && r.sent_touch_date) {
      if (!cur.last_sent_date || r.sent_touch_date > cur.last_sent_date) {
        cur.last_sent_date = r.sent_touch_date;
      }
    }
    if (!r.sent && r.touch_date) {
      if (!cur.next_due_date || r.touch_date < cur.next_due_date) {
        cur.next_due_date = r.touch_date;
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
        // Anchored on effective_touch_date — actual send for sent, planned
        // for unsent. "oldest_touch_date"/"newest_touch_date" kept as keys
        // for backwards compat with any consumers reading the old shape.
        oldest_touch_date: all.reduce(
          (acc: string | null, r: any) =>
            r.effective_touch_date && (!acc || r.effective_touch_date < acc)
              ? r.effective_touch_date
              : acc,
          null,
        ),
        newest_touch_date: all.reduce(
          (acc: string | null, r: any) =>
            r.effective_touch_date && (!acc || r.effective_touch_date > acc)
              ? r.effective_touch_date
              : acc,
          null,
        ),
        last_sent_date: all.reduce(
          (acc: string | null, r: any) =>
            r.sent && r.sent_touch_date && (!acc || r.sent_touch_date > acc)
              ? r.sent_touch_date
              : acc,
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
