import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const NOTION_TOKEN = Deno.env.get('NOTION_INTEGRATION_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HUNTER_API_KEY = Deno.env.get('HUNTER_API_KEY') || '';;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2025-09-03',
  'Content-Type': 'application/json',
};

const CONTACTS_DATA_SOURCE_ID = 'ba85524b-78ae-4dcb-9679-de6c6cd818eb';

const VALID = {
  contact_type: ['CEO', 'CFO', 'CRO', 'VP Sales', 'VP Clinical', 'Physician Champion', 'Procurement', 'Other'],
  relationship_status: [
    'Identified',
    'Researched',
    'Outreach',
    'Connected',
    'Engaged',
    'Active Relationship',
    'Unresponsive',
    'Disqualified',
  ],
  communication_channels: ['Email', 'LinkedIn', 'Phone', 'In-Person', 'Referral'],
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

async function findSupabaseDuplicates(accountId: string, name: string, email?: string): Promise<any[]> {
  // Tier 1: exact name match within the same account.
  const { data: exact } = await supabase
    .from('contacts')
    .select('id, full_name, email, account_id, company_name, notion_page_id')
    .eq('account_id', accountId)
    .ilike('full_name', name.trim())
    .limit(5);
  if (exact && exact.length > 0) {
    return exact.map((r: any) => ({ ...r, match_kind: 'exact_name_same_account' }));
  }
  // Tier 2: fuzzy name match within the same account.
  const { data: fuzzy } = await supabase
    .from('contacts')
    .select('id, full_name, email, account_id, company_name, notion_page_id')
    .eq('account_id', accountId)
    .or(`full_name.ilike.%${name.trim()}%,full_name.ilike.${name.trim()}%`)
    .limit(10);
  const fuzzyMatches = (fuzzy || []).map((r: any) => ({ ...r, match_kind: 'fuzzy_name_same_account' }));

  // Tier 3: email match anywhere (could be the same person at a new company).
  const emailMatches: any[] = [];
  if (email) {
    const { data: byEmail } = await supabase
      .from('contacts')
      .select('id, full_name, email, account_id, company_name, notion_page_id')
      .eq('email', email.trim().toLowerCase())
      .limit(5);
    emailMatches.push(...(byEmail || []).map((r: any) => ({ ...r, match_kind: 'email_match_any_account' })));
  }
  return [...fuzzyMatches, ...emailMatches];
}

async function verifyEmailWithHunter(email: string): Promise<{ status: string; score: number; result: string } | null> {
  if (!HUNTER_API_KEY) return null;
  try {
    const params = new URLSearchParams({ email, api_key: HUNTER_API_KEY });
    const res = await fetch(`https://api.hunter.io/v2/email-verifier?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const d = json?.data;
    if (!d) return null;
    return { status: d.status, score: d.score, result: d.result };
  } catch {
    return null;
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
    const {
      full_name,
      account_id,
      company_name,
      title,
      email,
      phone,
      linkedin_url,
      notes,
      contact_type,
      relationship_status,
      communication_channels,
      is_primary,
      force_create,
    } = input as Record<string, any>;

    if (typeof full_name !== 'string' || !full_name.trim()) {
      return error400('full_name is required');
    }
    const name = full_name.trim();

    if (contact_type && !VALID.contact_type.includes(contact_type)) {
      return error400(`contact_type must be one of ${VALID.contact_type.join(' | ')}`);
    }
    if (relationship_status && !VALID.relationship_status.includes(relationship_status)) {
      return error400(`relationship_status must be one of ${VALID.relationship_status.join(' | ')}`);
    }
    if (Array.isArray(communication_channels)) {
      const invalid = communication_channels.filter((c: string) => !VALID.communication_channels.includes(c));
      if (invalid.length > 0) {
        return error400(`communication_channels must be from: ${VALID.communication_channels.join(' | ')}. Invalid: ${invalid.join(', ')}`);
      }
    }

    const account = await resolveAccount({ account_id, company_name });
    if (!account) {
      return error400(
        `could not resolve account from { account_id: ${account_id}, company_name: ${company_name} }`,
      );
    }

    if (!force_create) {
      const dups = await findSupabaseDuplicates(account.id, name, email);
      if (dups.some((d: any) => d.match_kind === 'exact_name_same_account')) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'duplicate_detected',
            duplicates: dups,
            hint: `A contact with this exact name already exists on ${account.company_name}. Use the existing contact_id, or pass force_create: true to create a second row.`,
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (dups.length > 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'possible_duplicates',
            duplicates: dups,
            hint:
              `Found ${dups.length} possible duplicate${dups.length === 1 ? '' : 's'}. Confirm with the user that this is genuinely a different person before creating, then re-call with force_create: true. Email matches across accounts may indicate the person changed jobs.`,
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // ---- Verify email with Hunter.io (best-effort, non-blocking) ----
    let emailVerification: { status: string; score: number; result: string } | null = null;
    if (email) {
      emailVerification = await verifyEmailWithHunter(String(email).toLowerCase().trim());
    }

    // ---- Build Notion properties ----
    const props: Record<string, any> = {
      Name: { title: [{ text: { content: name } }] },
      'Relationship Status': {
        status: { name: relationship_status || 'Identified' },
      },
    };
    if (title) props['Title'] = { rich_text: [{ text: { content: title } }] };
    if (email) props['Email'] = { email };
    if (phone) props['Phone'] = { phone_number: phone };
    if (linkedin_url) props['LinkedIn'] = { url: linkedin_url };
    if (notes) props['Notes'] = { rich_text: [{ text: { content: notes } }] };
    if (contact_type) props['Contact Type'] = { select: { name: contact_type } };
    if (Array.isArray(communication_channels) && communication_channels.length > 0) {
      props['Communication Channel'] = {
        multi_select: communication_channels.map((c: string) => ({ name: c })),
      };
    }

    // ---- Create the Notion contact page ----
    const created = await notion('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { data_source_id: CONTACTS_DATA_SOURCE_ID },
        properties: props,
      }),
    });
    const contactPageId: string = created.id;
    const contactUrl: string = created.url;
    const contactPageIdNoDashes = stripDashes(contactPageId);

    // ---- Link the contact to the OI account ----
    // OI's Contacts relation is one-way (no back-relation on the Contacts
    // side), so we have to fetch the OI page's existing Contacts list and
    // append. Notion's PATCH on a relation field REPLACES the array, so
    // we can't just patch with the new id alone.
    const oiPageId = dashify(account.notion_page_id);
    let linkedToOi = false;
    try {
      const oiPage = await notion(`/pages/${oiPageId}`);
      const existing = (oiPage.properties?.Contacts?.relation || []) as Array<{ id: string }>;
      const existingIds = new Set(existing.map((r) => r.id));
      existingIds.add(contactPageId);
      await notion(`/pages/${oiPageId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            Contacts: { relation: Array.from(existingIds).map((id) => ({ id })) },
          },
        }),
      });
      linkedToOi = true;
    } catch (linkErr) {
      console.warn('[create-contact] failed to link contact to OI Contacts relation:', linkErr);
    }

    // ---- Direct upsert to Supabase contacts ----
    // Same pattern as create_account: avoid Notion read-after-write lag
    // by using the data we already have. The QB needs a usable contact_id
    // back from this call.
    const contactRow: Record<string, any> = {
      notion_page_id: contactPageIdNoDashes,
      account_id: account.id,
      company_name: account.company_name,
      full_name: name,
      title: title || null,
      email: email ? String(email).toLowerCase() : null,
      phone: phone || null,
      linkedin_url: linkedin_url || null,
      notes: notes || null,
      contact_type: contact_type || null,
      relationship_status: relationship_status || 'Identified',
      communication_channels: Array.isArray(communication_channels) ? communication_channels : null,
      is_primary: !!is_primary,
      email_verified: emailVerification ? emailVerification.score >= 70 && emailVerification.status !== 'invalid' : null,
      email_score: emailVerification?.score ?? null,
      email_status: emailVerification?.status ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('contacts')
      .upsert(contactRow, { onConflict: 'notion_page_id' })
      .select('id')
      .single();

    if (insertErr) {
      console.warn('[create-contact] direct upsert failed:', insertErr.message);
    }

    // Fire-and-forget: re-sync the OI account so its Supabase row reflects
    // the updated Contacts list. Doesn't block the response.
    fetch(`${SUPABASE_URL}/functions/v1/sync-prospect-content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify({ notion_page_id: stripDashes(oiPageId) }),
    }).catch((err) => console.warn('[create-contact] async OI re-sync failed:', err));

    return new Response(
      JSON.stringify({
        success: true,
        contact: {
          id: inserted?.id ?? null,
          notion_page_id: contactPageIdNoDashes,
          notion_url: contactUrl,
          full_name: name,
          email: contactRow.email,
          email_verified: contactRow.email_verified,
          email_score: contactRow.email_score,
          email_status: contactRow.email_status,
        },
        account: {
          id: account.id,
          company_name: account.company_name,
        },
        linked_to_oi: linkedToOi,
        synced_to_supabase: !!inserted?.id,
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
