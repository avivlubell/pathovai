import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const NOTION_TOKEN = Deno.env.get('NOTION_INTEGRATION_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Multi-data-source DBs require API version >= 2025-09-03.
const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2025-09-03',
  'Content-Type': 'application/json',
};

const TOUCHES_DATA_SOURCE_ID = 'b10de04e-db6d-4c40-ae84-c4298743fe5b';

const VALID_CHANNELS = ['Email', 'LinkedIn', 'Phone', 'Intro', 'Meeting'];
const VALID_NEXT_STEPS = [
  'LinkedIn Inmail',
  'eMail',
  'Linkedin DM',
  'LinkedIn Connection Request',
  'Schedule meeting',
  'LinkedIn Interaction',
];

const dashify = (id: string): string => {
  const s = id.replace(/-/g, '');
  if (s.length !== 32) return id;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const addDaysIso = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

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

async function resolveAccount(input: {
  account_id?: string;
  company_name?: string;
}): Promise<{ id: string; company_name: string; notion_page_id: string } | null> {
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
      channel,
      message,
      sent,
      touch_date,
      title,
      outcome,
      top_challenges,
      next_touch_in_days,
      next_touch_channel,
    } = input as Record<string, any>;

    // Validate the basics. The QB should never call this without explicit user
    // confirmation — guard anyway.
    if (!channel) return error400('channel is required');
    if (!VALID_CHANNELS.includes(channel)) {
      return error400(`channel must be one of ${VALID_CHANNELS.join(', ')}`);
    }
    if (typeof message !== 'string' || !message.trim()) {
      return error400('message is required');
    }
    if (typeof sent !== 'boolean') return error400('sent (boolean) is required');
    const effectiveDateForValidation = touch_date || todayIso();
    if (sent && effectiveDateForValidation > todayIso()) {
      return error400(
        `sent cannot be true for a future touch_date (${effectiveDateForValidation} > today ${todayIso()}). ` +
        `Set sent=false for planned future touches — Sent=true is reserved for touches already executed.`,
      );
    }
    if (next_touch_channel && !VALID_NEXT_STEPS.includes(next_touch_channel)) {
      return error400(`next_touch_channel must be one of ${VALID_NEXT_STEPS.join(', ')}`);
    }

    const account = await resolveAccount({ account_id, company_name });
    if (!account) {
      return error400(
        `could not resolve account from { account_id: ${account_id}, company_name: ${company_name} }`,
      );
    }

    const oiPageId = dashify(account.notion_page_id);
    const effectiveDate = touch_date || todayIso();
    const effectiveTitle =
      title || `${account.company_name} - ${channel} - ${effectiveDate}`;

    // 1. Create the Notion touch page. Date routing under post-2026-05-05
    //    schema:
    //    - sent=true → write Sent Touch Date, leave Touch Date null
    //      (Touch Date is forward-looking only; a sent row has no plan)
    //    - sent=false → write Touch Date as the planned send date,
    //      leave Sent Touch Date null
    const touchProps: Record<string, any> = {
      Title: { title: [{ text: { content: effectiveTitle } }] },
      'Related Outreach': { relation: [{ id: oiPageId }] },
      Channel: { select: { name: channel } },
      Sent: { checkbox: sent },
      // Property name has a trailing space — preserved as-is to match the DB.
      'Message ': { rich_text: [{ text: { content: message } }] },
    };
    if (sent) {
      touchProps['Sent Touch Date'] = { date: { start: effectiveDate } };
    } else {
      touchProps['Touch Date'] = { date: { start: effectiveDate } };
    }
    if (outcome) touchProps['Outcome'] = { select: { name: outcome } };
    if (Array.isArray(top_challenges) && top_challenges.length > 0) {
      touchProps['Top Challenges'] = {
        multi_select: top_challenges.map((c: string) => ({ name: c })),
      };
    }

    const createdTouch = await notion('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { data_source_id: TOUCHES_DATA_SOURCE_ID },
        properties: touchProps,
      }),
    });
    const touchPageId: string = createdTouch.id;
    const touchUrl: string = createdTouch.url;

    // 2. Update the parent OI page. Fetch it first so we can honor the
    //    "Status auto-advance only if currently To Do" rule without overwriting
    //    other states.
    const oiPage = await notion(`/pages/${oiPageId}`);
    const currentStatus = oiPage?.properties?.Status?.status?.name ?? null;

    const oiUpdates: Record<string, any> = {};
    if (sent) {
      oiUpdates['Last Touch'] = { date: { start: effectiveDate } };
      if (currentStatus === 'To Do') {
        oiUpdates['Status'] = { status: { name: 'Working' } };
      }
    }
    if (typeof next_touch_in_days === 'number') {
      oiUpdates['Next Step Due'] = {
        date: { start: addDaysIso(Math.max(0, next_touch_in_days)) },
      };
    }
    if (next_touch_channel) {
      oiUpdates['Next Step'] = { select: { name: next_touch_channel } };
    }

    let oiUpdated: any = null;
    if (Object.keys(oiUpdates).length > 0) {
      oiUpdated = await notion(`/pages/${oiPageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties: oiUpdates }),
      });
      // Re-sync the parent account so Supabase reflects Last Touch / Status
      // / Next Step / Next Step Due. Without this, get_account_detail and
      // search_accounts_and_contacts return stale state to the QB.
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/sync-prospect-content`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_KEY}`,
            apikey: SUPABASE_KEY,
          },
          body: JSON.stringify({ notion_page_id: oiPageId.replace(/-/g, '') }),
        });
      } catch (syncErr) {
        console.warn('[log-outreach-touch] post-update OI sync failed:', syncErr);
      }
    }

    // 3. Sync the new touch back to Supabase so query_touches sees it.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/sync-touch-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ notion_page_id: touchPageId.replace(/-/g, '') }),
      });
    } catch (syncErr) {
      console.warn('[log-outreach-touch] post-create sync failed:', syncErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        touch: {
          notion_page_id: touchPageId,
          notion_url: touchUrl,
          title: effectiveTitle,
          channel,
          // touch_date is set only on unsent rows (planned date); sent rows
          // populate sent_touch_date instead. effectiveDate carries the
          // user-supplied date in either case.
          touch_date: sent ? null : effectiveDate,
          sent_touch_date: sent ? effectiveDate : null,
          sent,
        },
        account: {
          id: account.id,
          company_name: account.company_name,
          notion_page_id: oiPageId,
        },
        oi_updates_applied: Object.keys(oiUpdates),
        status_advanced_from_to_do: !!(sent && currentStatus === 'To Do'),
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
