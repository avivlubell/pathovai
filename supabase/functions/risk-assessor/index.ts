import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAccountByName } from "../_shared/fuzzy-lookup.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const RISK_SYSTEM_PROMPT = `You are Pathova's Risk Assessment Specialist — an expert analyst focused exclusively on identifying commercial, financial, and operational risks for medtech companies.

Your ONLY job is to assess risks that would affect whether Pathova should engage with this account. You do not score ICP fit, draft outreach, or make engagement recommendations — you surface risks.

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

    const body = await req.json();
    // Accept account_id (canonical) and prospect_id (legacy) for back-compat.
    const account_id: string | undefined = body?.account_id ?? body?.prospect_id;
    const company_name: string | undefined = body?.company_name;

    if (!account_id && !company_name) {
      return new Response(
        JSON.stringify({ error: "Must provide account_id or company_name" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let resolvedId: string | undefined = account_id;
    let matchInfo: any = undefined;
    if (!resolvedId && company_name) {
      const resolved = await resolveAccountByName(supabase, company_name);
      if (!resolved) {
        return new Response(
          JSON.stringify({ error: "Account not found", query: company_name }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      resolvedId = resolved.id;
      matchInfo = resolved.match_info;
    }

    let { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", resolvedId)
      .single();

    // Fallback: if UUID lookup failed but we have a company_name, retry
    // by name. Covers the case where the QB passes a stale/hallucinated
    // UUID alongside a valid name.
    if ((!account || accountError) && company_name) {
      const resolved = await resolveAccountByName(supabase, company_name);
      if (resolved) {
        const retry = await supabase
          .from("accounts")
          .select("*")
          .eq("id", resolved.id)
          .single();
        if (retry.data) {
          account = retry.data;
          accountError = null;
          matchInfo = resolved.match_info;
        }
      }
    }

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: "Account not found", details: accountError?.message }),
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

    
    const userMessage = `## ACCOUNT DATA
Company: ${account.company_name}
FDA Status: ${account.fda_status || "Unknown"}
Product Category: ${account.product_category || "Unknown"}
Tier: ${account.tier || "Unscored"}
ICP Score: ${account.icp_score || "None"}
Funding Stage: ${account.funding_stage || "Unknown"}
Company Size: ${account.company_size || "Unknown"}
Outreach Status: ${account.outreach_status || "Not started"}
CEO/Founder: ${account.ceo_name || "Unknown"}

## RESEARCH ON FILE
${account.research_raw ? account.research_raw.substring(0, 4000) : "No research on file."}

## ICP SCORE BREAKDOWN
${account.icp_score_breakdown ? JSON.stringify(account.icp_score_breakdown, null, 2) : "No scoring data available."}

## PATTERN CONTEXT
${(patterns || []).map(p => p.content?.substring(0, 1000)).join("\n\n") || "No pattern data available."}

---
${lessonsBlock}

Assess all risks for this account. Return ONLY valid JSON.`;

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
        system: [
          {
            type: "text",
            text: RISK_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
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
      .from('accounts')
      .update({ risk_assessment: assessment })
      .eq('id', account.id);

    if (updateError) {
      console.error('Failed to persist risk assessment:', updateError);
    }


    return new Response(
      JSON.stringify({
        account_id: account.id,
        company_name: account.company_name,
        _match_info: matchInfo,
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
