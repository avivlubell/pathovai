import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const { type, query } = body;

  let dbQuery = supabase
    .from('reference_library')
    .select('id, type, title, content, tags, client, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (type) {
    dbQuery = dbQuery.ilike('type', `%${type}%`);
  }

  if (query) {
    dbQuery = dbQuery.or(
      `title.ilike.%${query}%,content.ilike.%${query}%`
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
    references: data
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
