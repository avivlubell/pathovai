import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const { query } = body;

  let dbQuery = supabase
    .from('prospects')
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

  return new Response(JSON.stringify({
    total: data.length,
    prospects: data,
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
