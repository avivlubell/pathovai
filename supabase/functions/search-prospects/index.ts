import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fuzzyFindAccounts, fuzzyFindContacts } from '../_shared/fuzzy-lookup.ts';

const ACCOUNT_COLUMNS = 'id, company_name, tier, icp_score, fda_status, product_category, hq_country, research_status, outreach_status, funding_stage, created_at';
const CONTACT_COLUMNS = 'id, full_name, title, email, phone, linkedin_url, contact_type, relationship_status, company_name, account_id';

// Search blends two signals:
//   1. Trigram similarity on company_name / full_name so typos hit.
//   2. ilike substring on ancillary fields (industry, region, tier,
//      title, email) so keyword searches like "cardiology" or
//      "founder" still work.
// Account results are deduped and the similarity score is returned
// alongside each row so the agent can see match confidence.
Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const { query } = body;

  const accountMap = new Map<string, any>();
  let contactResults: any[] = [];

  if (query && typeof query === 'string' && query.trim()) {
    const q = query.trim();

    // 1. Fuzzy name matches (accounts + contacts).
    const [fuzzyAccounts, fuzzyContacts] = await Promise.all([
      fuzzyFindAccounts(supabase, q, { limit: 25, minScore: 0.3 }),
      fuzzyFindContacts(supabase, q, { limit: 25, minScore: 0.3 }),
    ]);

    if (fuzzyAccounts.length > 0) {
      const ids = fuzzyAccounts.map(m => m.id);
      const { data } = await supabase
        .from('accounts')
        .select(ACCOUNT_COLUMNS)
        .in('id', ids);
      const byId = new Map((data || []).map((r: any) => [r.id, r]));
      for (const match of fuzzyAccounts) {
        const row = byId.get(match.id);
        if (row) {
          accountMap.set(row.id, {
            ...row,
            _match_score: match.score,
            _matched_on: match.matched_on,
          });
        }
      }
    }

    // 2. Substring sweep on ancillary fields to keep keyword searches
    // working (e.g., "cardiology" -> product_category match).
    const { data: ilikeAccounts } = await supabase
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .or(
        `product_category.ilike.%${q}%,hq_country.ilike.%${q}%,tier.ilike.%${q}%`,
      )
      .limit(25);
    for (const row of ilikeAccounts || []) {
      if (!accountMap.has(row.id)) {
        accountMap.set(row.id, { ...row, _match_score: null, _matched_on: 'keyword' });
      }
    }

    // Contacts: fuzzy on name + substring on ancillary fields.
    const contactById = new Map<string, any>();
    if (fuzzyContacts.length > 0) {
      const ids = fuzzyContacts.map(m => m.id);
      const { data } = await supabase
        .from('contacts')
        .select(CONTACT_COLUMNS)
        .in('id', ids);
      const byId = new Map((data || []).map((r: any) => [r.id, r]));
      for (const match of fuzzyContacts) {
        const row = byId.get(match.id);
        if (row) {
          contactById.set(row.id, { ...row, _match_score: match.score });
        }
      }
    }
    const { data: ilikeContacts } = await supabase
      .from('contacts')
      .select(CONTACT_COLUMNS)
      .or(
        `email.ilike.%${q}%,title.ilike.%${q}%,company_name.ilike.%${q}%`,
      )
      .limit(25);
    for (const row of ilikeContacts || []) {
      if (!contactById.has(row.id)) {
        contactById.set(row.id, { ...row, _match_score: null });
      }
    }
    contactResults = Array.from(contactById.values());
  } else {
    // No query: return recent accounts + contacts (legacy behavior).
    const { data } = await supabase
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(50);
    for (const row of data || []) accountMap.set(row.id, row);

    const { data: contacts } = await supabase
      .from('contacts')
      .select(CONTACT_COLUMNS)
      .limit(50);
    contactResults = contacts || [];
  }

  const accountResults = Array.from(accountMap.values()).sort(
    (a: any, b: any) => (b._match_score ?? -1) - (a._match_score ?? -1),
  );

  return new Response(JSON.stringify({
    total: accountResults.length,
    prospects: accountResults,
    contacts: contactResults,
    contacts_total: contactResults.length,
    summary: {
      by_tier: accountResults.reduce((acc: Record<string, number>, p: any) => {
        acc[p.tier || 'Unscored'] = (acc[p.tier || 'Unscored'] || 0) + 1;
        return acc;
      }, {}),
      by_fda_status: accountResults.reduce((acc: Record<string, number>, p: any) => {
        acc[p.fda_status || 'Unknown'] = (acc[p.fda_status || 'Unknown'] || 0) + 1;
        return acc;
      }, {}),
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
