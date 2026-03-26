import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const RISK_SYSTEM_PROMPT = `You are Pathova's Risk Assessment Specialist — an expert analyst focused exclusively on identifying commercial, financial, and operational risks for medtech prospect companies.

Your ONLY job is to assess risks that would affect whether Pathova should engage with this prospect. You do not score ICP fit, draft outreach, or make engagement recommendations — you surface risks.

RISK CATEGORIES TO EVALUATE:
1. Capital Risk: Funding recency, burn rate signals, runway indicators. Seed-only with no follow-on 36+ months = RED FLAG.
2. Operational Risk: Team size trends (growth vs contraction), leadership stability, hiring patterns.
3. Commercial Viability Risk: Revenue signals, contract evidence, pilot-to-paid conversion patterns.
4. Regulatory Risk: FDA pathway complexity, pending vs cleared, competitive regulatory landscape.
5. Engagement Risk: Decision-maker accessibility, prior outreach history, response patterns, academic vs commercial CEO identity.
6. Market Timing Risk: Competitive pressure, reimbursement landscape, market window indicators.

You must return valid JSON:
{
  "company_name": "<name>",
  "overall_risk_score": <1-10>,
  "risk_level": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
  "confidence": <0.0-1.0>,
  "risks": [
    {
      "category": "ategory name>",
      "severity": "LOW" | "MODERATE" | "HIGH" | "CRITICAL",
      "finding": "<specific finding>",
      "evidence": "<what data supports this>",
      "mitigation": "<how to mitigate or what to verify>"
    }
  ],
  "go_no_go_signal": "GO" | "GO_WITH_CAUTION" | "PAUSE" | "NO_GO",
  "critical_unknowns": ["<unknown1>", "<unknown2>"],
  "recommendation": "<1-2 sentence summary>"
}

Be direct. Flag hard signals. Do not soften bad news.`;

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        },
      });
    }

    const { prospect_id, company_name } = await req.json();

    if (!prospect_id && !company_name) {
      return new Response(
        JSON.stringify({ error: "Must provide prospect_id or company_name" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let prospectQuery = supabase.from("prospects").select("*");
    if (prospect_id) {
      prospectQuery = prospectQuery.eq("id", prospect_id);
    } else {
      prospectQuery = prospectQuery.ilike("company_name", `%${company_name}%`);
    }
    const { data: prospect, error: prospectError } = await prospectQuery.single();

    if (prospectError || !prospect) {
      return new Response(
        JSON.stringify({ error: "Prospect not found", details: prospectError?.message }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: patterns } = await supabase
      .from("reference_library")
      .select("content")
      .or("title.ilike.%pattern%,title.ilike.%risk%,title.ilike.%playbook%")
      .limit(3);

        // Fetch agent learnings
    const { data: learnings } = await supabase
      .from('agent_learnings')
      .select('content')
      .eq('active', true)
      .or('applies_to.cs.{risk-assessor},applies_to.cs.{all}');
    const lessonsBlock = learnings && learnings.length > 0
      ? '\n\n=== LESSONS LEARNED ===\n' + learnings.map(l => '- ' + l.content).join('\n')
      : '';

    
    const userMessage = `## PROSPECT DATA
Company: ${prospect.company_name}
FDA Status: ${prospect.fda_status || "Unknown"}
Product Category: ${prospect.product_category || "Unknown"}
Tier: ${prospect.tier || "Unscored"}
ICP Score: ${prospect.icp_score || "None"}
Funding Stage: ${prospect.funding_stage || "Unknown"}
Company Size: ${prospect.company_size || "Unknown"}
Outreach Status: ${prospect.outreach_status || "Not started"}
CEO/Founder: ${prospect.ceo_name || "Unknown"}

## RESEARCH ON FILE
${prospect.research_raw ? prospect.research_raw.substring(0, 4000) : "No research on file."}

## ICP SCORE BREAKDOWN
${prospect.icp_score_breakdown ? JSON.stringify(prospect.icp_score_breakdown, null, 2) : "No scoring data available."}

## PATTERN CONTEXT
${(patterns || []).map(p => p.content?.substring(0, 1000)).join("\n\n") || "No pattern data available."}

---
${lessonsBlock}

Assess all risks for this prospect. Return ONLY valid JSON.`;

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: RISK_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      return new Response(
        JSON.stringify({ error: "Anthropic API error", details: errText }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const anthropicData = await anthropicResponse.json();
    const rawText = anthropicData.content[0]?.text || "";

    let assessment;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      assessment = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw_response: rawText };
    } catch {
      assessment = { raw_response: rawText, parse_error: true };
    }

        // Persist risk assessment to database
    const { error: updateError } = await supabase
      .from('prospects')
      .update({ risk_assessment: assessment })
      .eq('id', prospect.id);

    if (updateError) {
      console.error('Failed to persist risk assessment:', updateError);
    }


    return new Response(
      JSON.stringify({
        prospect_id: prospect.id,
        company_name: prospect.company_name,
        assessment,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
