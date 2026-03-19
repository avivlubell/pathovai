import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const { prospect_id, company_name } = body;

  let data, error;

  if (prospect_id) {
    ({ data, error } = await supabase
      .from('prospects')
      .select('*')
      .eq('id', prospect_id)
      .single());
  } else if (company_name) {
    ({ data, error } = await supabase
      .from('prospects')
      .select('*')
      .ilike('company_name', `%${company_name}%`)
      .limit(1)
      .single());
  } else {
    return new Response(JSON.stringify({ error: 'Must provide prospect_id or company_name' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.code === 'PGRST116' ? 404 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
});
