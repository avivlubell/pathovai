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

const OI_DATABASE_ID = '040d8d93-3e04-4730-b86e-dc9b045cdb78';
const OI_DATA_SOURCE_ID = '59f9f32c-bf51-4e5f-a469-624eeae388fc';

// Allowed values for each constrained property in OI. Any user-supplied
// value MUST match exactly (case-sensitive). The Notion API will 400 on
// unknown options anyway; pre-validating here gives a cleaner error.
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
  source: ['Inbound', 'Referral', 'LinkedIn', 'Conference', 'Research', 'Other'],
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

// Tier 1+2: Supabase exact and fuzzy name match.
async function findSupabaseDuplicates(name: string): Promise<any[]> {
  const trimmed = name.trim();
  // Exact (case-insensitive) match first.
  const { data: exact } = await supabase
    .from('accounts')
    .select('id, company_name, notion_page_id, notion_url')
    .ilike('company_name', trimmed)
    .limit(5);
  if (exact && exact.length > 0) {
    return exact.map((r: any) => ({ ...r, match_kind: 'exact_name' }));
  }
  // Fuzzy: substring either direction. Catches "Sibel" vs "Sibel Health"
  // and "Sibel Health" vs "Sibel Health, Inc.". Limited to 10 to keep the
  // confirmation list scannable.
  const { data: fuzzy } = await supabase
    .from('accounts')
    .select('id, company_name, notion_page_id, notion_url')
    .or(`company_name.ilike.%${trimmed}%,company_name.ilike.${trimmed}%`)
    .limit(10);
  return (fuzzy || []).map((r: any) => ({ ...r, match_kind: 'fuzzy_name' }));
}

// Tier 3: Notion-side check. Catches the case where someone created an OI
// row in Notion manually and didn't trigger sync — Supabase wouldn't see
// it, but the Notion DB does.
async function findNotionDuplicates(name: string): Promise<any[]> {
  try {
    const res = await notion(`/data_sources/${OI_DATA_SOURCE_ID}/query`, {
      method: 'POST',
      body: JSON.stringify({
        filter: { property: 'Account', title: { contains: name } },
        page_size: 5,
      }),
    });
    return (res.results || []).map((p: any) => ({
      notion_page_id: stripDashes(p.id),
      notion_url: p.url,
      company_name: (p.properties?.Account?.title || []).map((t: any) => t.plain_text).join(''),
      match_kind: 'notion_title_substring',
    }));
  } catch (err) {
    console.warn('[create-account] notion duplicate check failed:', err);
    return [];
  }
}

async function fetchTrigger(triggerId: string): Promise<any | null> {
  const { data } = await supabase
    .from('icp_triggers')
    .select('*')
    .eq('notion_page_id', triggerId.replace(/-/g, ''))
    .maybeSingle();
  return data;
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
      company_name,
      from_icp_trigger_id,
      website,
      linkedin_url,
      hq_location,
      regulatory_status,
      product_category,
      icp_tier,
      source,
      notes,
      icp_score,
      therapeutic_area,
      force_create,
    } = input as Record<string, any>;

    if (typeof company_name !== 'string' || !company_name.trim()) {
      return error400('company_name is required');
    }
    const name = company_name.trim();

    // Validate select-typed inputs against the schema's allowed values.
    if (regulatory_status && !VALID.regulatory_status.includes(regulatory_status)) {
      return error400(`regulatory_status must be one of ${VALID.regulatory_status.join(' | ')}`);
    }
    if (product_category && !VALID.product_category.includes(product_category)) {
      return error400(`product_category must be one of ${VALID.product_category.join(' | ')}`);
    }
    if (icp_tier && !VALID.icp_tier.includes(icp_tier)) {
      return error400(`icp_tier must be one of ${VALID.icp_tier.join(' | ')}`);
    }
    if (source && !VALID.source.includes(source)) {
      return error400(`source must be one of ${VALID.source.join(' | ')}`);
    }

    // Optionally seed defaults from an ICP Trigger row so users can promote
    // a flagged company without re-typing fields.
    let triggerSeed: Record<string, any> = {};
    if (from_icp_trigger_id) {
      const trig = await fetchTrigger(from_icp_trigger_id);
      if (!trig) {
        return error400(`from_icp_trigger_id ${from_icp_trigger_id} not found in icp_triggers table`);
      }
      triggerSeed = {
        hq_location: hq_location || trig.headquarters || null,
        website: website || trig.company_url || null,
        linkedin_url: linkedin_url || trig.linkedin_url || null,
        // Note: trigger's fda_status / icp_tier / device_category use a
        // different vocabulary than OI's selects. We intentionally don't
        // map them automatically — pass them explicitly if you want them
        // set on creation.
      };
    }

    // ---- Duplicate detection (skipped if force_create=true) ----
    if (!force_create) {
      const supaDups = await findSupabaseDuplicates(name);
      if (supaDups.some((d: any) => d.match_kind === 'exact_name')) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'duplicate_detected',
            duplicates: supaDups,
            hint:
              `An account with this exact name already exists. Use the existing account_id, ` +
              `or pass force_create: true if you really mean to create a second row.`,
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const notionDups = await findNotionDuplicates(name);
      const allDups = [...supaDups, ...notionDups];
      // Dedupe by notion_page_id since a Notion match may also be in Supabase
      const seenIds = new Set<string>();
      const uniqueDups = allDups.filter((d) => {
        if (seenIds.has(d.notion_page_id)) return false;
        seenIds.add(d.notion_page_id);
        return true;
      });

      if (uniqueDups.length > 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'possible_duplicates',
            duplicates: uniqueDups,
            hint:
              `Found ${uniqueDups.length} possible duplicate${uniqueDups.length === 1 ? '' : 's'}. ` +
              `Confirm with the user that this is genuinely a different company before creating, ` +
              `then re-call with force_create: true. Otherwise use the existing account_id.`,
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // ---- Build Notion properties ----
    const props: Record<string, any> = {
      Account: { title: [{ text: { content: name } }] },
      Status: { status: { name: 'To Do' } },
      'Pipeline Stage': { status: { name: 'Research' } },
    };
    const effectiveWebsite = website ?? triggerSeed.website;
    const effectiveLinkedin = linkedin_url ?? triggerSeed.linkedin_url;
    const effectiveLocation = hq_location ?? triggerSeed.hq_location;
    if (effectiveWebsite) props['Website'] = { url: effectiveWebsite };
    if (effectiveLinkedin) props['LinkedIn URL'] = { url: effectiveLinkedin };
    if (effectiveLocation) {
      props['HQ Location'] = { rich_text: [{ text: { content: effectiveLocation } }] };
    }
    if (regulatory_status) props['Regulatory Status'] = { select: { name: regulatory_status } };
    if (product_category) props['Product Category'] = { select: { name: product_category } };
    if (icp_tier) props['Pathova ICP Tier'] = { select: { name: icp_tier } };
    if (source) props['Source'] = { select: { name: source } };
    if (notes) props['Notes'] = { rich_text: [{ text: { content: notes } }] };
    if (typeof icp_score === 'number') props['ICP Score'] = { number: icp_score };
    if (Array.isArray(therapeutic_area) && therapeutic_area.length > 0) {
      props['Therapeutic Area'] = { multi_select: therapeutic_area.map((n: string) => ({ name: n })) };
    }

    // ---- Create the Notion page ----
    const created = await notion('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { data_source_id: OI_DATA_SOURCE_ID },
        properties: props,
      }),
    });
    const newPageId: string = created.id;
    const newPageUrl: string = created.url;
    const newPageIdNoDashes = stripDashes(newPageId);

    // ---- Direct upsert to accounts using the data we already have from
    //      Notion's create response. Avoids the read-after-write
    //      consistency lag that affects sync-prospect-content's roundtrip
    //      fetch. The QB gets a usable account_id back immediately;
    //      page-body sync (research_output etc.) is fired-and-forgot
    //      below since it's a non-blocking enrichment.
    const accountRow: Record<string, any> = {
      notion_page_id: newPageIdNoDashes,
      notion_url: newPageUrl,
      company_name: name,
      research_status: 'pending',
      last_researched: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (effectiveWebsite) accountRow.website_url = effectiveWebsite;
    if (effectiveLinkedin) accountRow.linkedin_url = effectiveLinkedin;
    if (effectiveLocation) accountRow.hq_location = effectiveLocation;
    if (regulatory_status) accountRow.fda_status = regulatory_status;
    if (product_category) accountRow.product_category = product_category;
    if (icp_tier) accountRow.tier = icp_tier;
    if (typeof icp_score === 'number') accountRow.icp_score = icp_score;
    if (Array.isArray(therapeutic_area) && therapeutic_area.length > 0) accountRow.therapeutic_area = therapeutic_area;

    const { data: inserted, error: insertErr } = await supabase
      .from('accounts')
      .upsert(accountRow, { onConflict: 'notion_page_id' })
      .select('id')
      .single();

    let syncedAccountId: string | null = inserted?.id ?? null;
    if (insertErr) {
      console.warn('[create-account] direct upsert failed:', insertErr.message);
    }

    // Fire-and-forget the full sync so page-body sections + any other
    // Notion properties land in research_output asynchronously. Doesn't
    // block the response — by the time anything reads the row, Notion's
    // consistency lag is past.
    fetch(`${SUPABASE_URL}/functions/v1/sync-prospect-content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify({ notion_page_id: newPageIdNoDashes }),
    }).catch((err) => console.warn('[create-account] async full-sync failed:', err));

    return new Response(
      JSON.stringify({
        success: true,
        account: {
          id: syncedAccountId,
          notion_page_id: newPageIdNoDashes,
          notion_url: newPageUrl,
          company_name: name,
        },
        fields_set: Object.keys(props),
        seeded_from_trigger: from_icp_trigger_id || null,
        synced_to_supabase: syncedAccountId !== null,
        next_step:
          'You can now invoke prospect_researcher / icp_scorer / outreach_drafter / risk_assessor ' +
          'against this account_id, or query/log touches with it.',
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
