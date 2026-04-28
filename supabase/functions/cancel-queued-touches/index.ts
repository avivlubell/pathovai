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
    const { account_id, company_name, touch_ids } = input as Record<string, any>;

    // Two modes:
    //  - touch_ids: cancel specific touches (whitelist; safest)
    //  - account_id/company_name (no touch_ids): cancel ALL unsent touches for that account
    let targets: { notion_page_id: string }[] = [];

    if (Array.isArray(touch_ids) && touch_ids.length > 0) {
      // Filter to only unsent rows actually present in our touches table.
      const stripped = touch_ids.map((id: string) => stripDashes(id));
      const { data } = await supabase
        .from('touches')
        .select('notion_page_id, sent')
        .in('notion_page_id', stripped);
      const unsent = (data || []).filter((r: any) => !r.sent);
      if (unsent.length === 0) {
        return new Response(
          JSON.stringify({ success: true, cancelled: 0, note: 'no unsent touches matched the provided ids' }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      targets = unsent;
    } else if (account_id || company_name) {
      const account = await resolveAccount({ account_id, company_name });
      if (!account) {
        return error400(
          `could not resolve account from { account_id: ${account_id}, company_name: ${company_name} }`,
        );
      }
      const { data } = await supabase
        .from('touches')
        .select('notion_page_id')
        .eq('account_id', account.id)
        .eq('sent', false);
      targets = data || [];
    } else {
      return error400('either touch_ids[] or one of account_id/company_name is required');
    }

    if (targets.length === 0) {
      return new Response(
        JSON.stringify({ success: true, cancelled: 0, note: 'nothing to cancel' }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (targets.length > 25) {
      return error400(
        `refusing to cancel ${targets.length} touches in one call — bulk cancel cap is 25 per safety budget. Pass an explicit touch_ids[] subset to override.`,
      );
    }

    // Trash each touch in Notion. Then delete from Supabase. Notion's "delete"
    // is actually moving to trash (restorable), which is the right blast radius
    // for an accept-then-cancel flow.
    const results: any[] = [];
    for (const t of targets) {
      const pageId = dashify(t.notion_page_id);
      try {
        await notion(`/pages/${pageId}`, {
          method: 'PATCH',
          body: JSON.stringify({ in_trash: true }),
        });
        await supabase.from('touches').delete().eq('notion_page_id', t.notion_page_id);
        results.push({ notion_page_id: t.notion_page_id, cancelled: true });
      } catch (err: any) {
        results.push({
          notion_page_id: t.notion_page_id,
          cancelled: false,
          error: String(err?.message || err),
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        cancelled: results.filter((r) => r.cancelled).length,
        failed: results.filter((r) => !r.cancelled).length,
        details: results,
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
