// mark-intelligence-cited — flips used_in_outreach=true and stamps last_cited
// on the industry_intelligence rows the caller cites in an outreach.
//
// Background: used_in_outreach and last_cited are Supabase-owned operational
// state. sync-intelligence (as of migration 20260503) intentionally does NOT
// pull these from Notion, so writing them here is durable across syncs.
//
// Caller pattern: log-outreach-touch / log-outreach-sequence pass the
// intelligence_notion_page_ids the QB referenced when composing the touch.
// The function accepts dashed or undashed Notion IDs and normalizes to
// the undashed form used as the primary key.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const stripDashes = (id: string): string => id.replace(/-/g, '');
const todayIso = (): string => new Date().toISOString().slice(0, 10);

function error400(message: string): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const input = await req.json().catch(() => ({}));
    const { intelligence_notion_page_ids, cited_at } = input as {
      intelligence_notion_page_ids?: unknown;
      cited_at?: unknown;
    };

    if (!Array.isArray(intelligence_notion_page_ids)) {
      return error400('intelligence_notion_page_ids (string[]) is required');
    }

    // Normalize: strip dashes, drop empties, dedupe. Reject non-strings explicitly
    // rather than silently coercing — a number or null in the array is a caller bug.
    const ids: string[] = [];
    for (const raw of intelligence_notion_page_ids) {
      if (typeof raw !== 'string') {
        return error400('intelligence_notion_page_ids must contain only strings');
      }
      const stripped = stripDashes(raw).trim();
      if (stripped.length === 32 && !ids.includes(stripped)) ids.push(stripped);
    }

    if (ids.length === 0) {
      return new Response(
        JSON.stringify({ success: true, updated: 0, not_found: [], requested: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let effectiveCitedAt: string;
    if (cited_at === undefined || cited_at === null) {
      effectiveCitedAt = todayIso();
    } else if (typeof cited_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cited_at)) {
      effectiveCitedAt = cited_at;
    } else {
      return error400('cited_at must be an ISO date YYYY-MM-DD');
    }

    const { data, error } = await supabase
      .from('industry_intelligence')
      .update({
        used_in_outreach: true,
        last_cited: effectiveCitedAt,
        updated_at: new Date().toISOString(),
      })
      .in('notion_page_id', ids)
      .select('notion_page_id');

    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const updatedIds = (data || []).map((r: any) => r.notion_page_id);
    const notFound = ids.filter((id) => !updatedIds.includes(id));

    return new Response(
      JSON.stringify({
        success: true,
        requested: ids.length,
        updated: updatedIds.length,
        cited_at: effectiveCitedAt,
        updated_ids: updatedIds,
        not_found: notFound,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
