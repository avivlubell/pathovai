import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveAccountByName } from '../_shared/fuzzy-lookup.ts';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  // Accept account_id (canonical) and prospect_id (legacy) for back-compat.
  const account_id: string | undefined = body?.account_id ?? body?.prospect_id;
  const company_name: string | undefined = body?.company_name;

  if (!account_id && !company_name) {
    return new Response(JSON.stringify({ error: 'Must provide account_id or company_name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let resolvedId: string | undefined = account_id;
  let matchInfo: any = undefined;

  if (!resolvedId && company_name) {
    const resolved = await resolveAccountByName(supabase, company_name);
    if (!resolved) {
      return new Response(
        JSON.stringify({
          error: 'No account matched that name',
          query: company_name,
          hint: 'Try search_accounts_and_contacts to browse similar names.',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    resolvedId = resolved.id;
    matchInfo = resolved.match_info;
  }

  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', resolvedId)
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.code === 'PGRST116' ? 404 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const payload = matchInfo ? { ...data, _match_info: matchInfo } : data;

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' }
  });
});
