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

const VALID = {
  status: ['To Do', 'Nurture', 'Working', 'Disqualified', 'Completed'],
  pipeline_stage: ['Research', 'Qualify', 'Outreach', 'Engaged', 'Pilot', 'Client', 'Lost', 'Disqualified'],
  icp_tier: ['Tier 1: Priority', 'Tier 2: Qualified', 'Tier 3: Monitor', 'Non-ICP'],
  regulatory_status: ['Pre-FDA', 'FDA Cleared', 'CE Mark Only', 'FDA + CE Mark', 'Post-Market'],
  product_category: [
    'Hardware device',
    'Hardware device / Combination',
    'SaMD / Hardware device / DTx / Clinical AI / Combination / Other',
    'Clinical AI / SaMD',
  ],
  engage_decision: ['Proceed', 'Monitor', 'Defer', 'Disqualify'],
  source: ['Inbound', 'Referral', 'LinkedIn', 'Conference', 'Research', 'Other'],
  timing_status: ['Ready Now', 'Build Mode', 'Monitor', 'Too Mature'],
  validation_status: ['Pain Validated', 'Pain Assumed', 'Wrong Timing', 'Disqualified'],
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

// ---- Markdown -> Notion blocks (lightweight) ----
//
// Handles: heading 1/2/3, bulleted list (- *), numbered list (1.), divider
// (---), paragraph. Inline emphasis (**bold**, *italic*, `code`,
// [link](url)) is reduced to plain text since Notion's annotation model
// is verbose and most users edit prose in Notion. Each block's content
// is capped at 2000 chars (Notion's per-rich_text limit).

function rtBlock(type: string, text: string): any {
  const clean = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
  if (!clean) return null;
  return {
    object: 'block',
    type,
    [type]: {
      rich_text: [{ type: 'text', text: { content: clean.slice(0, 2000) } }],
    },
  };
}

function mdLineToBlock(line: string): any | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let m: RegExpMatchArray | null;
  if ((m = trimmed.match(/^###\s+(.+)$/))) return rtBlock('heading_3', m[1]);
  if ((m = trimmed.match(/^##\s+(.+)$/))) return rtBlock('heading_2', m[1]);
  if ((m = trimmed.match(/^#\s+(.+)$/))) return rtBlock('heading_1', m[1]);
  if ((m = trimmed.match(/^[-*•]\s+(.+)$/))) return rtBlock('bulleted_list_item', m[1]);
  if ((m = trimmed.match(/^\d+\.\s+(.+)$/))) return rtBlock('numbered_list_item', m[1]);
  if (/^[-=*]{3,}$/.test(trimmed)) return { object: 'block', type: 'divider', divider: {} };
  return rtBlock('paragraph', trimmed);
}

function markdownToBlocks(md: string): any[] {
  const blocks: any[] = [];
  for (const line of md.split('\n')) {
    const b = mdLineToBlock(line);
    if (b) blocks.push(b);
  }
  return blocks;
}

// ---- Property update mappers ----
function buildPropertyUpdates(updates: Record<string, any>): Record<string, any> {
  const props: Record<string, any> = {};
  if (updates.status) {
    if (!VALID.status.includes(updates.status)) {
      throw new Error(`status must be one of ${VALID.status.join(' | ')}`);
    }
    props['Status'] = { status: { name: updates.status } };
  }
  if (updates.pipeline_stage) {
    if (!VALID.pipeline_stage.includes(updates.pipeline_stage)) {
      throw new Error(`pipeline_stage must be one of ${VALID.pipeline_stage.join(' | ')}`);
    }
    props['Pipeline Stage'] = { status: { name: updates.pipeline_stage } };
  }
  if (updates.icp_tier) {
    if (!VALID.icp_tier.includes(updates.icp_tier)) {
      throw new Error(`icp_tier must be one of ${VALID.icp_tier.join(' | ')}`);
    }
    props['Pathova ICP Tier'] = { select: { name: updates.icp_tier } };
  }
  if (updates.regulatory_status) {
    if (!VALID.regulatory_status.includes(updates.regulatory_status)) {
      throw new Error(`regulatory_status must be one of ${VALID.regulatory_status.join(' | ')}`);
    }
    props['Regulatory Status'] = { select: { name: updates.regulatory_status } };
  }
  if (updates.product_category) {
    if (!VALID.product_category.includes(updates.product_category)) {
      throw new Error(`product_category must be one of ${VALID.product_category.join(' | ')}`);
    }
    props['Product Category'] = { select: { name: updates.product_category } };
  }
  if (updates.engage_decision) {
    if (!VALID.engage_decision.includes(updates.engage_decision)) {
      throw new Error(`engage_decision must be one of ${VALID.engage_decision.join(' | ')}`);
    }
    props['Engage Decision'] = { select: { name: updates.engage_decision } };
  }
  if (updates.source) {
    if (!VALID.source.includes(updates.source)) {
      throw new Error(`source must be one of ${VALID.source.join(' | ')}`);
    }
    props['Source'] = { select: { name: updates.source } };
  }
  if (updates.timing_status) {
    if (!VALID.timing_status.includes(updates.timing_status)) {
      throw new Error(`timing_status must be one of ${VALID.timing_status.join(' | ')}`);
    }
    props['Timing Status'] = { select: { name: updates.timing_status } };
  }
  if (updates.validation_status) {
    if (!VALID.validation_status.includes(updates.validation_status)) {
      throw new Error(`validation_status must be one of ${VALID.validation_status.join(' | ')}`);
    }
    props['Validation Status'] = { select: { name: updates.validation_status } };
  }
  if (typeof updates.icp_score === 'number') {
    props['ICP Score'] = { number: updates.icp_score };
  }
  if (updates.hq_location) {
    props['HQ Location'] = { rich_text: [{ text: { content: String(updates.hq_location) } }] };
  }
  if (updates.website) props['Website'] = { url: updates.website };
  if (updates.linkedin_url) props['LinkedIn URL'] = { url: updates.linkedin_url };
  if (updates.email) props['Email'] = { email: updates.email };
  if (updates.notes) {
    // Notes is replaced wholesale (not appended). Long-form intel goes
    // into the page body via body_update; Notes is for short scalars.
    props['Notes'] = { rich_text: [{ text: { content: String(updates.notes).slice(0, 2000) } }] };
  }
  if (Array.isArray(updates.therapeutic_area)) {
    props['Therapeutic Area'] = {
      multi_select: updates.therapeutic_area.map((n: string) => ({ name: n })),
    };
  }
  if (Array.isArray(updates.primary_gap)) {
    props['Primary Gap'] = {
      multi_select: updates.primary_gap.map((n: string) => ({ name: n })),
    };
  }
  if (updates.last_touch) {
    props['Last Touch'] = { date: { start: updates.last_touch } };
  }
  if (updates.response_date) {
    props['Response Date'] = { date: { start: updates.response_date } };
  }
  if (updates.next_step_due) {
    props['Next Step Due'] = { date: { start: updates.next_step_due } };
  }
  return props;
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
      property_updates,
      body_update,
    } = input as Record<string, any>;

    const account = await resolveAccount({ account_id, company_name });
    if (!account) {
      return error400(
        `could not resolve account from { account_id: ${account_id}, company_name: ${company_name} }`,
      );
    }
    const oiPageId = dashify(account.notion_page_id);

    if (!property_updates && !body_update) {
      return error400('at least one of property_updates or body_update is required');
    }

    // ---- 0. Supabase-only fields (not mirrored to Notion) ----
    const supabaseOnlyApplied: string[] = [];
    if (property_updates && typeof property_updates.exclude_from_brief === 'boolean') {
      const { error: flagErr } = await supabase
        .from('accounts')
        .update({ exclude_from_brief: property_updates.exclude_from_brief })
        .eq('id', account.id);
      if (flagErr) throw new Error(`exclude_from_brief update: ${flagErr.message}`);
      supabaseOnlyApplied.push('exclude_from_brief');
    }

    // ---- 1. Property updates ----
    const propsApplied: string[] = [];
    if (property_updates) {
      let propsBody: Record<string, any>;
      try {
        propsBody = buildPropertyUpdates(property_updates);
      } catch (validationErr: any) {
        return error400(String(validationErr?.message || validationErr));
      }
      if (Object.keys(propsBody).length > 0) {
        await notion(`/pages/${oiPageId}`, {
          method: 'PATCH',
          body: JSON.stringify({ properties: propsBody }),
        });
        propsApplied.push(...Object.keys(propsBody));
      }
    }

    // ---- 2. Body append ----
    let blocksAppended = 0;
    if (body_update) {
      const mode = body_update.mode || 'append';
      if (mode !== 'append') {
        return error400(`body_update.mode "${mode}" not supported (only "append" in v1)`);
      }
      const md = String(body_update.markdown || '');
      if (!md.trim()) {
        return error400('body_update.markdown is required and must be non-empty');
      }
      const blocks: any[] = [];
      // Optional dated heading prefix.
      if (body_update.heading) {
        const headingBlock = rtBlock('heading_2', String(body_update.heading));
        if (headingBlock) blocks.push(headingBlock);
      }
      blocks.push(...markdownToBlocks(md));

      // Notion caps /children appends at 100 blocks per request. Page in
      // batches of 100 for longer updates.
      const BATCH = 100;
      for (let i = 0; i < blocks.length; i += BATCH) {
        const slice = blocks.slice(i, i + BATCH);
        await notion(`/blocks/${oiPageId}/children`, {
          method: 'PATCH',
          body: JSON.stringify({ children: slice }),
        });
        blocksAppended += slice.length;
      }
    }

    // ---- 3. Re-sync to Supabase so the QB sees the updated state ----
    // Fire-and-forget; the same pattern used in log_outreach_sequence
    // and mark_touch_sent.
    fetch(`${SUPABASE_URL}/functions/v1/sync-prospect-content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify({ notion_page_id: stripDashes(oiPageId) }),
    }).catch((err) => console.warn('[update-account] post-update sync failed:', err));

    return new Response(
      JSON.stringify({
        success: true,
        account: {
          id: account.id,
          company_name: account.company_name,
          notion_page_id: stripDashes(oiPageId),
        },
        properties_updated: [...propsApplied, ...supabaseOnlyApplied],
        body_blocks_appended: blocksAppended,
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
