import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveAccountByName } from '../_shared/fuzzy-lookup.ts';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const { filter } = body;

  // Build query
  let query = supabase
    .from('deals')
    .select('deal_name, company_name, motion_type, stage, probability, value, expected_close_date, next_milestone, primary_contact, notes, notion_url')
    .order('created_at', { ascending: false });

  // Natural language filters
  if (filter?.stage) {
    query = query.ilike('stage', `%${filter.stage}%`);
  }
  if (filter?.motion_type) {
    query = query.ilike('motion_type', `%${filter.motion_type}%`);
  }

  // Company filter: resolve typos via accounts table first so
  // "Medtronik" -> canonical "Medtronic", then substring-match the
  // deals table on that canonical name. If no account clears the
  // threshold, fall back to raw substring on the user's input.
  let companyMatchInfo: any = undefined;
  if (filter?.company) {
    const resolved = await resolveAccountByName(supabase, String(filter.company));
    if (resolved) {
      query = query.ilike('company_name', `%${resolved.company_name}%`);
      companyMatchInfo = resolved.match_info;
    } else {
      query = query.ilike('company_name', `%${filter.company}%`);
    }
  }

  const { data, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    total: data.length,
    deals: data,
    _match_info: companyMatchInfo,
    summary: {
      by_stage: data.reduce((acc: Record<string, number>, d: any) => {
        acc[d.stage || 'Unknown'] = (acc[d.stage || 'Unknown'] || 0) + 1;
        return acc;
      }, {}),
      by_motion: data.reduce((acc: Record<string, number>, d: any) => {
        acc[d.motion_type || 'Unknown'] = (acc[d.motion_type || 'Unknown'] || 0) + 1;
        return acc;
      }, {}),
      total_value: data.reduce((sum: number, d: any) => sum + (d.value || 0), 0)
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
