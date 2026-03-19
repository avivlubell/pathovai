import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const { prospect_id, action_type, decision_mode, context_score, summary } = body;

  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      prospect_id: prospect_id || null,
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
