import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// === TIER LOGIC (deterministic - Claude never assigns tiers) ===
function computeTier(q1: string, q2: string, q3: string, q4: string): { tier: string; is_icp: boolean } {
  if (q4 !== "NONE") return { tier: "Non-ICP", is_icp: false };
  if (q1 === "NO") return { tier: "Non-ICP", is_icp: false };
  if (q2 === "TOO_EARLY") return { tier: "Non-ICP", is_icp: false };
  if (q2 === "TOO_MATURE") return { tier: "Tier 3: Monitor", is_icp: false };
  if (q2 === "YES" && q3 === "STRONG") return { tier: "Tier 1: Priority", is_icp: true };
  if (q2 === "YES" && q3 === "MODERATE") return { tier: "Tier 2: Qualified", is_icp: true };
  if (q2 === "YES" && q3 === "NONE") return { tier: "Tier 3: Monitor", is_icp: false };
  return { tier: "Tier 3: Monitor", is_icp: false };
}

const SYSTEM_PROMPT = `You are Pathova's ICP Classification Agent. You answer exactly 4 questions about a company based ONLY on the data provided. You do not strategize, draft outreach, or do anything else.

CRITICAL RULES:
1. For each question, you MUST quote specific evidence from the PROSPECT DATA. Use exact names, numbers, and phrases from the data.
2. If the data does not contain enough information to answer a question confidently, say "INSUFFICIENT DATA" and explain what is missing.
3. Do NOT invent hospital names, partnership names, employee names, dates, revenue figures, or any facts not present in the PROSPECT DATA.
4. Your job is CLASSIFICATION, not scoring. Answer each question with the specified options only.

You must return valid JSON with this exact structure:
{
  "company_name": "<name>",
  "q1_right_industry": {
    "answer": "YES" or "NO",
    "evidence": "<quote from data>"
  },
  "q2_right_stage": {
    "answer": "YES" or "TOO_EARLY" or "TOO_MATURE",
    "evidence": "<quote from data>",
    "maturity_signals": ["<list specific signals if TOO_MATURE>"]
  },
  "q3_gap_signals": {
    "answer": "STRONG" or "MODERATE" or "NONE",
    "signals_found": ["<list each signal with evidence>"],
    "signals_absent": ["<list signals checked but not found>"]
  },
  "q4_disqualifiers": {
    "answer": "NONE" or list of disqualifiers,
    "evidence": "<quote from data if any disqualifier found>"
  },
  "confidence": <0.0-1.0>,
  "data_gaps": ["<list important missing information>"]
}`;

Deno.serve(async (req) => {
  try {
    const { prospect_id, company_name: inputName } = await req.json();

    // --- Lookup prospect ---
    let prospect: any = null;
    if (prospect_id) {
      const { data } = await supabase.from("prospects").select("*").eq("id", prospect_id).single();
      prospect = data;
    } else if (inputName) {
      const { data } = await supabase.from("prospects").select("*").ilike("company_name", `%${inputName}%`).single();
      prospect = data;
    }
    if (!prospect) {
      return new Response(JSON.stringify({ error: "Prospect not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    // --- Load ICP framework from reference_library ---
    const { data: icpRefs } = await supabase
      .from("reference_library")
      .select("content")
      .eq("id", "972c281a-ef08-4eaa-9ff7-993528bb8e43");
    const icpFramework = icpRefs?.map((r: any) => r.content).join("\n\n") || "";

    // --- Build prospect data for Claude ---
      const researchData = prospect.research_output || prospect.research_summary || "No research data available";
    const prospectContext = `
## PROSPECT DATA
Company: ${prospect.company_name}
Website: ${prospect.website_url || "Unknown"}
Industry/Category: ${prospect.product_category || "Unknown"}
Description: ${prospect.description || "Unknown"}
FDA Status: ${prospect.fda_status || "Unknown"}
Funding: ${prospect.funding_stage || "Unknown"}
Employee Count: ${prospect.employee_count || "Unknown"}
Location: ${prospect.hq_location || "Unknown"}

## RESEARCH DATA
${typeof researchData === "string" ? researchData : JSON.stringify(researchData, null, 2)}

## ICP FRAMEWORK REFERENCE
${icpFramework}

Answer the 4 classification questions based ONLY on the above data.`;

    // --- Call Claude ---
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prospectContext }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return new Response(JSON.stringify({ error: "Anthropic API error", details: errText }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    const result = await response.json();
    const rawText = result.content?.[0]?.text || "";

    // --- Parse Claude's JSON response ---
    let scoring: any;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      scoring = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      console.error("JSON parse error:", e, "Raw:", rawText);
      return new Response(JSON.stringify({ error: "Failed to parse scorer response", raw: rawText }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    if (!scoring) {
      return new Response(JSON.stringify({ error: "No scoring data returned", raw: rawText }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    // === DETERMINISTIC TIER ASSIGNMENT (Claude never decides this) ===
    const q1 = scoring.q1_right_industry?.answer || "NO";
    const q2 = scoring.q2_right_stage?.answer || "TOO_EARLY";
    const q3 = scoring.q3_gap_signals?.answer || "NONE";
    const q4 = scoring.q4_disqualifiers?.answer || "NONE";
    const q4Normalized = Array.isArray(q4) ? (q4.length > 0 ? q4.join(", ") : "NONE") : q4;

    const { tier, is_icp } = computeTier(q1, q2, q3, q4Normalized);

    // Simple numeric score for DB compatibility: Priority=3, Qualified=2, Monitor=1, Non-ICP=0
    const tierScore: Record<string, number> = { "Tier 1: Priority": 3, "Tier 2: Qualified": 2, "Tier 3: Monitor": 1, "Non-ICP": 0 };
    const numericScore = tierScore[tier] ?? 0;

    // === DB UPDATE ===
    const updatePayload = {
      icp_score: numericScore,
      icp_score_breakdown: {
        q1_right_industry: scoring.q1_right_industry,
        q2_right_stage: scoring.q2_right_stage,
        q3_gap_signals: scoring.q3_gap_signals,
        q4_disqualifiers: scoring.q4_disqualifiers,
      },
      icp_tier: tier,
      tier: tier,
      is_icp: is_icp,
      status: is_icp ? "active_target" : (tier === "Tier 3: Monitor" ? "monitor" : "disqualified"),
      confidence: scoring.confidence || null,
      updated_at: new Date().toISOString(),
    };

    const { data: updateData, error: updateError } = await supabase
      .from("prospects")
      .update(updatePayload)
      .eq("id", prospect.id)
      .select();

    if (updateError) {
      console.error("DB update error:", updateError);
    } else {
      console.log("ICP update result:", JSON.stringify({ updateData }));
    }

    // === RETURN RESPONSE ===
    return new Response(JSON.stringify({
      company_name: prospect.company_name,
      framework: "Pathova ICP v3.0 (4-Question Classification)",
      classification: {
        q1_right_industry: { answer: q1, evidence: scoring.q1_right_industry?.evidence },
        q2_right_stage: { answer: q2, evidence: scoring.q2_right_stage?.evidence, maturity_signals: scoring.q2_right_stage?.maturity_signals },
        q3_gap_signals: { answer: q3, signals_found: scoring.q3_gap_signals?.signals_found, signals_absent: scoring.q3_gap_signals?.signals_absent },
        q4_disqualifiers: { answer: q4Normalized, evidence: scoring.q4_disqualifiers?.evidence },
      },
      tier: tier,
      is_icp: is_icp,
      icp_score: numericScore,
      confidence: scoring.confidence,
      data_gaps: scoring.data_gaps || [],
      updated_in_db: !updateError,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: "Internal error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
