import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const { query } = body;

  // Search accounts
  let dbQuery = supabase
    .from('accounts')
    .select('id, company_name, tier, icp_score, fda_status, product_category, hq_country, research_status, outreach_status, funding_stage, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (query) {
    dbQuery = dbQuery.or(
      `company_name.ilike.%${query}%,product_category.ilike.%${query}%,hq_country.ilike.%${query}%,tier.ilike.%${query}%`
    );
  }

  const { data, error } = await dbQuery;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Also search contacts
  let contactsQuery = supabase
    .from('contacts')
    .select('id, full_name, title, email, phone, linkedin_url, contact_type, relationship_status, company_name, account_id')
    .limit(50);

  if (query) {
    contactsQuery = contactsQuery.or(
      `full_name.ilike.%${query}%,email.ilike.%${query}%,title.ilike.%${query}%,company_name.ilike.%${query}%`
    );
  }

  const { data: contacts } = await contactsQuery;

  return new Response(JSON.stringify({
    total: data.length,
    prospects: data,
    contacts: contacts || [],
    contacts_total: (contacts || []).length,
    summary: {
      by_tier: data.reduce((acc: Record<string, number>, p: any) => {
        acc[p.tier || 'Unscored'] = (acc[p.tier || 'Unscored'] || 0) + 1;
        return acc;
      }, {}),
      by_fda_status: data.reduce((acc: Record<string, number>, p: any) => {
        acc[p.fda_status || 'Unknown'] = (acc[p.fda_status || 'Unknown'] || 0) + 1;
        return acc;
      }, {})
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
