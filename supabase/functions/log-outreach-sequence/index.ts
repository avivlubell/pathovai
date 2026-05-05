import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const NOTION_TOKEN = Deno.env.get('NOTION_INTEGRATION_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2025-09-03',
  'Content-Type': 'application/json',
};

const TOUCHES_DATA_SOURCE_ID = 'b10de04e-db6d-4c40-ae84-c4298743fe5b';
const VALID_CHANNELS = ['Email', 'LinkedIn', 'Phone', 'Intro', 'Meeting'];

// Heuristic mapping from Touches.Channel (5 values) to OI.Next Step (6 values).
// LinkedIn is genuinely ambiguous — defaults to "Linkedin DM"; the caller can
// override per-call via next_step_override.
const NEXT_STEP_FROM_CHANNEL: Record<string, string> = {
  Email: 'eMail',
  LinkedIn: 'Linkedin DM',
  Meeting: 'Schedule meeting',
};

const dashify = (id: string): string => {
  const s = id.replace(/-/g, '');
  if (s.length !== 32) return id;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const stripDashes = (id: string): string => id.replace(/-/g, '');
const todayIso = (): string => new Date().toISOString().slice(0, 10);

async function notion(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { ...NOTION_HEADERS, ...(init.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok || data.object === 'error') {
    throw new Error(`Notion ${path}: ${data.code || res.status} ${data.message || ''}`);
  }
  return data;
}

async function resolveAccount(input: { account_id?: string; company_name?: string }) {
  if (input.account_id) {
    const { data } = await supabase
      .from('accounts')
      .select('id, company_name, notion_page_id')
      .eq('id', input.account_id)
      .maybeSingle();
    if (data?.notion_page_id) return data;
  }
  if (input.company_name) {
    const { data } = await supabase
      .from('accounts')
      .select('id, company_name, notion_page_id')
      .ilike('company_name', `%${input.company_name}%`)
      .order('company_name', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data?.notion_page_id) return data;
  }
  return null;
}

async function syncTouch(touchPageId: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/sync-touch-content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify({ notion_page_id: stripDashes(touchPageId) }),
    });
  } catch (err) {
    console.warn('[log-outreach-sequence] post-create sync failed:', err);
  }
}

// After we PATCH the parent OI page in Notion (Last Touch, Status, Next Step,
// Next Step Due), the Supabase accounts row is stale until we re-sync.
// Without this, get_account_detail / search_accounts_and_contacts would
// return stale Status/Next Step/Last Touch to the QB.
async function syncAccount(oiPageId: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/sync-prospect-content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify({ notion_page_id: stripDashes(oiPageId) }),
    });
  } catch (err) {
    console.warn('[log-outreach-sequence] post-update OI sync failed:', err);
  }
}

type TouchInput = {
  channel: string;
  message: string;
  sent?: boolean;
  touch_date?: string;
  title?: string;
  outcome?: string;
  top_challenges?: string[];
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const input = await req.json();
    const {
      account_id,
      company_name,
      touches,
      next_step_override,
    } = input as Record<string, any>;

    if (!Array.isArray(touches) || touches.length === 0) {
      return error400('touches[] is required and must contain at least 1 entry');
    }
    if (touches.length > 10) {
      return error400('refusing to log >10 touches in one call — split into multiple calls if intentional');
    }

    // Validate every touch up-front so we don't half-write the sequence.
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i] as TouchInput;
      if (!t.channel || !VALID_CHANNELS.includes(t.channel)) {
        return error400(`touches[${i}].channel must be one of ${VALID_CHANNELS.join(', ')}`);
      }
      if (typeof t.message !== 'string' || !t.message.trim()) {
        return error400(`touches[${i}].message is required`);
      }
      if (t.sent != null && typeof t.sent !== 'boolean') {
        return error400(`touches[${i}].sent must be boolean if provided`);
      }
      if (t.touch_date && !/^\d{4}-\d{2}-\d{2}$/.test(t.touch_date)) {
        return error400(`touches[${i}].touch_date must be ISO date YYYY-MM-DD`);
      }
    }

    const account = await resolveAccount({ account_id, company_name });
    if (!account) {
      return error400(
        `could not resolve account from { account_id: ${account_id}, company_name: ${company_name} }`,
      );
    }
    const oiPageId = dashify(account.notion_page_id);

    // Normalize each touch.
    const norm = touches.map((t: TouchInput) => ({
      ...t,
      sent: t.sent ?? false,
      touch_date: t.touch_date || todayIso(),
      title: t.title || `${account.company_name} - ${t.channel} - ${t.touch_date || todayIso()}`,
    }));

    // ---- Idempotency check ----
    // For each touch, see if an UNSENT row with the same (account_id, channel,
    // touch_date) already exists in Supabase. If so, skip it. Sent rows are
    // never treated as duplicates — they're history.
    const existing = await supabase
      .from('touches')
      .select('notion_page_id, channel, touch_date, sent')
      .eq('account_id', account.id)
      .eq('sent', false);
    const existingKey = (channel: string, date: string) => `${channel}::${date}`;
    const existingSet = new Set(
      (existing.data || []).map((r: any) => existingKey(r.channel, r.touch_date)),
    );

    // ---- Create touches ----
    const results: any[] = [];
    for (const t of norm) {
      const key = existingKey(t.channel, t.touch_date);
      if (existingSet.has(key)) {
        results.push({
          created: false,
          skipped_reason: 'idempotent: an unsent touch with the same channel and date already exists',
          channel: t.channel,
          touch_date: t.touch_date,
        });
        continue;
      }

      // Date routing under post-2026-05-05 schema: sent=true writes the
      // actual send date to Sent Touch Date and leaves Touch Date null
      // (Touch Date is forward-looking only). sent=false writes the
      // planned date to Touch Date.
      const props: Record<string, any> = {
        Title: { title: [{ text: { content: t.title } }] },
        'Related Outreach': { relation: [{ id: oiPageId }] },
        Channel: { select: { name: t.channel } },
        Sent: { checkbox: t.sent },
        // Property name has a trailing space — preserved as-is to match the DB.
        'Message ': { rich_text: [{ text: { content: t.message } }] },
      };
      if (t.sent) {
        props['Sent Touch Date'] = { date: { start: t.touch_date } };
      } else {
        props['Touch Date'] = { date: { start: t.touch_date } };
      }
      if (t.outcome) props['Outcome'] = { select: { name: t.outcome } };
      if (Array.isArray(t.top_challenges) && t.top_challenges.length > 0) {
        props['Top Challenges'] = {
          multi_select: t.top_challenges.map((c: string) => ({ name: c })),
        };
      }

      try {
        const created = await notion('/pages', {
          method: 'POST',
          body: JSON.stringify({
            parent: { data_source_id: TOUCHES_DATA_SOURCE_ID },
            properties: props,
          }),
        });
        await syncTouch(created.id);
        results.push({
          created: true,
          notion_page_id: created.id,
          notion_url: created.url,
          channel: t.channel,
          // touch_date populated only on unsent rows (planned date);
          // sent rows populate sent_touch_date instead.
          touch_date: t.sent ? null : t.touch_date,
          sent_touch_date: t.sent ? t.touch_date : null,
          sent: t.sent,
          title: t.title,
        });
        // Add to existing-set so a duplicate within the same input array is also caught.
        existingSet.add(key);
      } catch (err: any) {
        results.push({
          created: false,
          skipped_reason: `notion_create_failed: ${err?.message || err}`,
          channel: t.channel,
          touch_date: t.touch_date,
        });
      }
    }

    // ---- Update parent OI ----
    // Recompute Next Step Due/Next Step from the FULL set of unsent touches
    // (existing + just-created). Status only advances if any touch in this
    // call was sent=true (drafted ≠ sent rule).
    const refreshed = await supabase
      .from('touches')
      .select('touch_date, channel')
      .eq('account_id', account.id)
      .eq('sent', false)
      .order('touch_date', { ascending: true, nullsFirst: false });
    const earliestUnsent = (refreshed.data || []).find((r: any) => r.touch_date);

    const oiPage = await notion(`/pages/${oiPageId}`);
    const currentStatus = oiPage?.properties?.Status?.status?.name ?? null;

    const oiUpdates: Record<string, any> = {};
    if (earliestUnsent) {
      oiUpdates['Next Step Due'] = { date: { start: earliestUnsent.touch_date } };
      const nextStepValue =
        next_step_override || NEXT_STEP_FROM_CHANNEL[earliestUnsent.channel] || null;
      if (nextStepValue) {
        oiUpdates['Next Step'] = { select: { name: nextStepValue } };
      }
    }

    const sentTouchesInBatch = norm.filter((t) => t.sent);
    if (sentTouchesInBatch.length > 0) {
      const latestSentDate = sentTouchesInBatch
        .map((t) => t.touch_date)
        .sort()
        .reverse()[0];
      oiUpdates['Last Touch'] = { date: { start: latestSentDate } };
      if (currentStatus === 'To Do') {
        oiUpdates['Status'] = { status: { name: 'Working' } };
      }
    }

    if (Object.keys(oiUpdates).length > 0) {
      await notion(`/pages/${oiPageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties: oiUpdates }),
      });
      await syncAccount(oiPageId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        account: {
          id: account.id,
          company_name: account.company_name,
          notion_page_id: oiPageId,
        },
        touches_input: norm.length,
        touches_created: results.filter((r) => r.created).length,
        touches_skipped: results.filter((r) => !r.created).length,
        touches: results,
        oi_updates_applied: Object.keys(oiUpdates),
        next_step_due: earliestUnsent?.touch_date || null,
        status_advanced_from_to_do: !!(sentTouchesInBatch.length && currentStatus === 'To Do'),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: String(err?.message || err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});

function error400(message: string): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}
