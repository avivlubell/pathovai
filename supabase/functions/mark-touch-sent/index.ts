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

const VALID_OUTCOMES = [
  'Meeting Booked',
  'No Response',
  'Disqualified',
  'Warm Follow-up',
  'Referred',
  'Nurture',
  'Connection Request Pending',
  'Connected on LinkedIn',
];

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
    console.warn('[mark-touch-sent] post-mark sync failed:', err);
  }
}

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
    const { touch_id, outcome, sent_date } = input as Record<string, any>;

    if (!touch_id) return error400('touch_id is required (Notion page ID of the touch)');
    if (outcome && !VALID_OUTCOMES.includes(outcome)) {
      return error400(`outcome must be one of ${VALID_OUTCOMES.join(', ')}`);
    }
    if (sent_date && !/^\d{4}-\d{2}-\d{2}$/.test(sent_date)) {
      return error400('sent_date must be ISO date YYYY-MM-DD');
    }

    const touchPageId = dashify(touch_id);

    // 1. Re-pull the touch from Notion. Per the agreed contract, Notion is
    //    source of truth for the body — Aviv may have polished the draft
    //    after the QB wrote it, and we want to log what actually went out.
    const touchPage = await notion(`/pages/${touchPageId}`);
    if (touchPage.in_trash || touchPage.archived) {
      return error400('cannot mark a trashed/archived touch as sent');
    }
    const props = touchPage.properties || {};
    const channel = props['Channel']?.select?.name ?? null;
    const currentTouchDate = props['Touch Date']?.date?.start ?? null;
    const relatedOutreach = (props['Related Outreach']?.relation || []) as Array<{ id: string }>;
    const oiPageId = relatedOutreach[0]?.id ? dashify(relatedOutreach[0].id) : null;

    if (!oiPageId) {
      return error400('touch has no Related Outreach (parent account) — cannot advance OI');
    }

    // 2. PATCH the touch: Sent=true, Touch Date <- sent_date if provided,
    //    Outcome <- outcome if provided.
    const touchUpdates: Record<string, any> = {
      Sent: { checkbox: true },
    };
    if (sent_date) touchUpdates['Touch Date'] = { date: { start: sent_date } };
    if (outcome) touchUpdates['Outcome'] = { select: { name: outcome } };

    await notion(`/pages/${touchPageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: touchUpdates }),
    });
    await syncTouch(touchPageId);

    const effectiveSentDate = sent_date || currentTouchDate;

    // 3. Look up the parent account in Supabase to get the account UUID for
    //    the Next-Step lookup. (The Notion oiPageId is the page ID; account
    //    lookups in Supabase use accounts.id, joined via accounts.notion_page_id.)
    const oiPageIdNoDashes = stripDashes(oiPageId);
    const { data: account } = await supabase
      .from('accounts')
      .select('id, company_name')
      .eq('notion_page_id', oiPageIdNoDashes)
      .maybeSingle();

    // 4. Pull current OI status (need it to decide the To Do -> Working
    //    advance) and the next-up unsent touch (post-mark, so this touch is
    //    excluded since we just synced it as Sent=true).
    const oiPage = await notion(`/pages/${oiPageId}`);
    const currentStatus = oiPage?.properties?.Status?.status?.name ?? null;

    let nextUnsent: { touch_date: string; channel: string | null } | null = null;
    if (account?.id) {
      const { data: nextRows } = await supabase
        .from('touches')
        .select('touch_date, channel, notion_page_id')
        .eq('account_id', account.id)
        .eq('sent', false)
        .order('touch_date', { ascending: true, nullsFirst: false })
        .limit(1);
      if (nextRows && nextRows.length > 0) nextUnsent = nextRows[0] as any;
    }

    // 5. Build OI updates — rolling pointer.
    const oiUpdates: Record<string, any> = {
      'Last Touch': effectiveSentDate ? { date: { start: effectiveSentDate } } : { date: null },
    };
    if (currentStatus === 'To Do') {
      oiUpdates['Status'] = { status: { name: 'Working' } };
    }
    if (nextUnsent && nextUnsent.touch_date) {
      oiUpdates['Next Step Due'] = { date: { start: nextUnsent.touch_date } };
      const ns = NEXT_STEP_FROM_CHANNEL[nextUnsent.channel || ''] || null;
      if (ns) oiUpdates['Next Step'] = { select: { name: ns } };
    } else {
      // Sequence done — clear pointers so the OI row stops claiming a queued next step.
      oiUpdates['Next Step Due'] = { date: null };
      oiUpdates['Next Step'] = { select: null };
    }

    await notion(`/pages/${oiPageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: oiUpdates }),
    });

    // 6. If outcome is "Meeting Booked", surface the queued siblings so the
    //    QB can ask the user whether to cancel them. We do NOT auto-cancel.
    let queuedToCancel: any[] = [];
    if (outcome === 'Meeting Booked' && account?.id) {
      const { data: queued } = await supabase
        .from('touches')
        .select('notion_page_id, notion_url, title, channel, touch_date')
        .eq('account_id', account.id)
        .eq('sent', false)
        .order('touch_date', { ascending: true, nullsFirst: false });
      queuedToCancel = queued || [];
    }

    return new Response(
      JSON.stringify({
        success: true,
        touch: {
          notion_page_id: stripDashes(touchPageId),
          notion_url: touchPage.url,
          channel,
          sent_date: effectiveSentDate,
          outcome: outcome || null,
        },
        account: account
          ? { id: account.id, company_name: account.company_name }
          : { id: null, company_name: null },
        oi_updates_applied: Object.keys(oiUpdates),
        status_advanced_from_to_do: currentStatus === 'To Do',
        next_unsent: nextUnsent,
        queued_to_cancel: queuedToCancel,
        queued_to_cancel_note:
          queuedToCancel.length > 0
            ? `Outcome was "Meeting Booked" — ${queuedToCancel.length} queued touch(es) remain on this account. Ask the user whether to cancel them via cancel_queued_touches before they auto-surface in "Touches Due".`
            : null,
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
