import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  // Accept account_id (canonical) and prospect_id (legacy) for back-compat.
  const account_id: string | undefined = body?.account_id ?? body?.prospect_id;
  const { action_type, decision_mode, context_score, summary } = body;

  // agent_runs.prospect_id is still the column name in the DB (rename deferred to Layer 2).
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      prospect_id: account_id || null,
      action_type: action_type || 'unknown',
      decision_mode: decision_mode || null,
      context_score: context_score || null,
      summary: summary || null,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ success: true, agent_run: data }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
