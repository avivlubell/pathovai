import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();

    // Two modes: structured input or natural language
    // Mode 1: Structured — pass fields directly
    // Mode 2: Natural language — pass { feedback: "...", agent_source?: "...", context?: {...} }
    //         and Claude structures it into the schema

    if (body.feedback) {
      // Natural language mode: let Claude parse the feedback
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: `You structure user feedback into a learning record for an AI agent memory system.

Return valid JSON with these fields:
- learning_type: one of "banned_phrase", "correction", "preference", "domain_knowledge", "pattern"
- content: the learning stated clearly and concisely as an instruction the agent should follow
- applies_to: array of function names this applies to, or ["*"] if universal. Known functions: "icp-scorer", "outreach-drafter", "prospect-researcher", "risk-assessor"
- relevance_tags: array of short lowercase tags for semantic filtering (e.g., ["vac", "hospital_procurement", "outreach_framing"])

Return ONLY the JSON object, no explanation.`,
          messages: [
            {
              role: "user",
              content: `Structure this feedback into a learning record:\n\n${body.feedback}${body.agent_source ? `\n\nThis came from the ${body.agent_source} function.` : ""}${body.context ? `\n\nContext: ${JSON.stringify(body.context)}` : ""}`,
            },
          ],
        }),
      });

      const claudeResponse = await response.json();
      const rawText = claudeResponse.content?.[0]?.text || "";
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error("Claude failed to structure the feedback");
      }

      const structured = JSON.parse(jsonMatch[0]);

      const { data, error } = await supabase
        .from("agent_learnings")
        .insert({
          created_by: body.created_by || "aviv",
          agent_source: body.agent_source || null,
          learning_type: structured.learning_type,
          content: structured.content,
          context: body.context || null,
          applies_to: structured.applies_to,
          relevance_tags: structured.relevance_tags || [],
          active: true,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, learning: data, structured_from: "natural_language" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Structured mode: direct insert
      const { learning_type, content, applies_to, relevance_tags, agent_source, context, created_by } = body;

      if (!learning_type || !content) {
        throw new Error("Required fields: learning_type, content");
      }

      const { data, error } = await supabase
        .from("agent_learnings")
        .insert({
          created_by: created_by || "aviv",
          agent_source: agent_source || null,
          learning_type,
          content,
          context: context || null,
          applies_to: applies_to || ["*"],
          relevance_tags: relevance_tags || [],
          active: true,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, learning: data, structured_from: "direct" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
