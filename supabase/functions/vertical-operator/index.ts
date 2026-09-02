// vertical-operator — generic replacement for ai-imaging-operator.
// Invoked by the Quarterback with an explicit vertical_slug (resolved from
// account.therapeutic_area / product_category via vertical_classification_rules
// upstream). Loads that vertical's operator system prompt + knowledge base from
// Supabase instead of hardcoding one vertical's expertise in this file. Adding a
// new vertical means inserting rows (verticals, vertical_operators,
// vertical_competitive, vertical_economics, vertical_roi_models,
// vertical_procurement, vertical_intelligence) — not shipping a new function.
// Never writes to DB. Output format is defined by each vertical's own
// operator_system_prompt (ai-imaging's asks for COMPANY / FAILURE MODE /
// TIMING URGENCY / OUTREACH HOOK / SIGNAL BASIS / GAPS).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callClaude(systemPrompt: string, userMessage: string, model: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return data?.content?.[0]?.text ?? "";
}

async function fetchKnowledgeContext(
  verticalId: string,
  companyName: string,
  useCase?: string,
  institutionType?: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Is this prospect in our competitive knowledge base?
  const { data: selfRows } = await supabase
    .from("vertical_competitive")
    .select("company_name, use_case, commercial_stage, is_pathova_disqualifier, disqualifier_reason, total_funding_usd, competitive_notes")
    .eq("vertical_id", verticalId)
    .ilike("company_name", `%${companyName}%`)
    .limit(3);

  if (selfRows && selfRows.length > 0) {
    const rows = selfRows.map((r) => {
      const funding = r.total_funding_usd ? ` | $${Math.round(r.total_funding_usd / 1e6)}M raised` : "";
      const dis = r.is_pathova_disqualifier ? `\n  DISQUALIFIER: ${r.disqualifier_reason}` : "";
      return `${r.company_name} (${r.use_case}): ${r.commercial_stage}${funding}${dis}\n  ${r.competitive_notes ?? ""}`;
    }).join("\n\n");
    parts.push(`PROSPECT IN COMPETITIVE KNOWLEDGE BASE:\n${rows}`);
  }

  // 2. Use-case-specific context (economics + competitive landscape + ROI)
  if (useCase) {
    const { data: econRow } = await supabase
      .from("vertical_economics")
      .select("use_case, use_case_label, cpt_code, cpt_category, cpt_medicare_covered, cpt_notes, ntap_status, ntap_company, ntap_fy_approved, ntap_expiry, ntap_rejection_reason, has_cost_justification_gap, gap_commercial_impact, billed_under, roi_narrative")
      .eq("vertical_id", verticalId)
      .ilike("use_case_label", `%${useCase}%`)
      .limit(1)
      .maybeSingle();

    if (econRow) {
      const cpt = econRow.cpt_code
        ? `${econRow.cpt_code} (${econRow.cpt_category}) — Medicare: ${econRow.cpt_medicare_covered ? "covered" : "NOT covered"}${econRow.cpt_notes ? ". " + econRow.cpt_notes : ""}`
        : "None";
      const ntapParts: string[] = [econRow.ntap_status === "none" ? "None applied" : econRow.ntap_status];
      if (econRow.ntap_company) ntapParts.push(econRow.ntap_company);
      if (econRow.ntap_fy_approved) ntapParts.push(`FY${econRow.ntap_fy_approved}${econRow.ntap_expiry ? "–" + econRow.ntap_expiry : ""}`);
      if (econRow.ntap_rejection_reason) ntapParts.push(`Rejection: ${econRow.ntap_rejection_reason}`);
      const ntap = ntapParts.join(" — ");

      parts.push(
        `ECONOMICS — ${econRow.use_case_label}:\n` +
        `CPT: ${cpt}\n` +
        `NTAP: ${ntap}\n` +
        `Cost justification gap: ${econRow.has_cost_justification_gap}\n` +
        `Commercial impact of gap: ${econRow.gap_commercial_impact}\n` +
        `Billed under: ${econRow.billed_under ?? "N/A"}\n` +
        `CFO ROI narrative for this use case: ${econRow.roi_narrative}`
      );

      const { data: competitors } = await supabase
        .from("vertical_competitive")
        .select("company_name, commercial_stage, total_funding_usd, contract_track_record, reimbursement_status, competitive_notes")
        .eq("vertical_id", verticalId)
        .eq("use_case", econRow.use_case)
        .not("company_name", "ilike", `%${companyName}%`)
        .order("total_funding_usd", { ascending: false, nullsFirst: false })
        .limit(5);

      if (competitors && competitors.length > 0) {
        const rows = competitors.map((r) => {
          const f = r.total_funding_usd ? `$${Math.round(r.total_funding_usd / 1e6)}M` : "?";
          return `${r.company_name}: ${r.commercial_stage} | ${f} raised | Contracts: ${r.contract_track_record} | Reimbursement: ${r.reimbursement_status}`;
        }).join("\n");
        parts.push(`COMPETITIVE LANDSCAPE — ${econRow.use_case_label}:\n${rows}`);
      }

      const { data: useCaseRoi } = await supabase
        .from("vertical_roi_models")
        .select("roi_type, title, content, primary_metric, defensibility")
        .eq("vertical_id", verticalId)
        .in("roi_type", ["approved", "sub_12_month_path"])
        .ilike("use_case", `%${econRow.use_case}%`)
        .limit(2);

      if (useCaseRoi && useCaseRoi.length > 0) {
        const rows = useCaseRoi.map((r) =>
          `[${r.roi_type.toUpperCase()}] ${r.title} (${r.defensibility} defensibility):\n${r.content.slice(0, 500)}`
        ).join("\n\n");
        parts.push(`ROI MODELS — ${econRow.use_case_label}:\n${rows}`);
      }
    }
  }

  // 3. Procurement intelligence filtered by institution type
  const instClause = institutionType
    ? `institution_type.eq.all,institution_type.eq.${institutionType}`
    : "institution_type.eq.all";

  const { data: procurement } = await supabase
    .from("vertical_procurement")
    .select("title, content, outreach_application")
    .eq("vertical_id", verticalId)
    .or(instClause)
    .limit(5);

  if (procurement && procurement.length > 0) {
    const rows = procurement.map((r) =>
      `${r.title}:\n${r.content.slice(0, 450)}\nOutreach application: ${r.outreach_application ?? ""}`
    ).join("\n\n");
    parts.push(`PROCUREMENT INTELLIGENCE:\n${rows}`);
  }

  // 4. Universal ROI models (use_case = null — apply to all use cases in this vertical)
  const { data: universalRoi } = await supabase
    .from("vertical_roi_models")
    .select("roi_type, title, content, primary_metric, defensibility")
    .eq("vertical_id", verticalId)
    .in("roi_type", ["approved", "sub_12_month_path", "dismissed", "data_inputs"])
    .is("use_case", null)
    .limit(5);

  if (universalRoi && universalRoi.length > 0) {
    const rows = universalRoi.map((r) =>
      `[${r.roi_type.toUpperCase()}] ${r.title} (${r.defensibility ?? "?"} defensibility):\n${r.content.slice(0, 400)}`
    ).join("\n\n");
    parts.push(`ROI INTELLIGENCE — UNIVERSAL:\n${rows}`);
  }

  return parts.join("\n\n" + "─".repeat(50) + "\n\n");
}

async function fetchDynamicSignals(verticalId: string, companyName: string): Promise<string> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: general } = await supabase
    .from("vertical_intelligence")
    .select("signal_type, signal_date, raw_signal, commercial_implication, triggered_action, urgency, company_name")
    .eq("vertical_id", verticalId)
    .is("company_name", null)
    .gte("created_at", thirtyDaysAgo)
    .order("urgency", { ascending: true })
    .order("signal_date", { ascending: false })
    .limit(10);

  const { data: companySpecific } = await supabase
    .from("vertical_intelligence")
    .select("signal_type, signal_date, raw_signal, commercial_implication, triggered_action, urgency, company_name")
    .eq("vertical_id", verticalId)
    .ilike("company_name", `%${companyName}%`)
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(5);

  const rows = [...(companySpecific ?? []), ...(general ?? [])];
  if (rows.length === 0) return "No recent market signals available for this vertical.";

  return rows
    .map((r) => {
      const dateStr = r.signal_date ?? "recent";
      const co = r.company_name ? ` [${r.company_name}]` : " [market-wide]";
      return `[${r.signal_type}${co} — ${dateStr} — urgency: ${r.urgency}]\nSignal: ${r.raw_signal}\nCommercial implication: ${r.commercial_implication}\nTriggered action: ${r.triggered_action}`;
    })
    .join("\n\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { vertical_slug, company_name, context = {} } = body;

    if (!vertical_slug) {
      return new Response(
        JSON.stringify({ error: "vertical_slug is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!company_name) {
      return new Response(
        JSON.stringify({ error: "company_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: vertical } = await supabase
      .from("verticals")
      .select("id, name, status")
      .eq("slug", vertical_slug)
      .maybeSingle();

    if (!vertical) {
      return new Response(
        JSON.stringify({ error: `Unknown vertical_slug: ${vertical_slug}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: operatorConfig } = await supabase
      .from("vertical_operators")
      .select("operator_system_prompt, operator_model")
      .eq("vertical_id", vertical.id)
      .maybeSingle();

    if (!operatorConfig) {
      return new Response(
        JSON.stringify({ error: `No operator configured for vertical: ${vertical_slug}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [dynamicSignals, knowledgeContext] = await Promise.all([
      fetchDynamicSignals(vertical.id, company_name),
      fetchKnowledgeContext(
        vertical.id,
        company_name,
        context.use_case as string | undefined,
        context.institution_type as string | undefined,
      ),
    ]);

    const contextLines: string[] = [];
    if (context.funding_stage) contextLines.push(`Funding stage: ${context.funding_stage}`);
    if (context.headcount != null) contextLines.push(`Headcount: ${context.headcount}`);
    if (context.fda_status) contextLines.push(`FDA status: ${context.fda_status}`);
    if (context.research_summary) contextLines.push(`Research summary: ${context.research_summary}`);
    if (context.use_case) contextLines.push(`Indication / use case: ${context.use_case}`);
    if (context.institution_type) contextLines.push(`Target institution type: ${context.institution_type}`);
    if (context.public_signals) contextLines.push(`Public signals: ${context.public_signals}`);
    if (Array.isArray(context.pilot_announcements) && context.pilot_announcements.length > 0) {
      contextLines.push(`Pilot announcements:\n${context.pilot_announcements.map((p: string) => `- ${p}`).join("\n")}`);
    }
    if (Array.isArray(context.hiring_signals) && context.hiring_signals.length > 0) {
      contextLines.push(`Hiring signals:\n${context.hiring_signals.map((h: string) => `- ${h}`).join("\n")}`);
    }

    const userMessage = [
      `Assess this company and return the structured brief.`,
      ``,
      `COMPANY: ${company_name}`,
      ``,
      contextLines.length > 0
        ? `QUARTERBACK CONTEXT:\n${contextLines.join("\n")}`
        : "QUARTERBACK CONTEXT: Limited — return diagnosis based on available signals with explicit gaps noted.",
      ...(knowledgeContext
        ? [``, `KNOWLEDGE LAYER (economics, competitive, procurement, ROI frameworks):`, knowledgeContext]
        : []),
      ``,
      `DYNAMIC MARKET SIGNALS (last 30 days):`,
      dynamicSignals,
    ].join("\n");

    const brief = await callClaude(operatorConfig.operator_system_prompt, userMessage, operatorConfig.operator_model);

    return new Response(
      JSON.stringify({ success: true, brief, company_name, vertical: vertical_slug }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("vertical-operator error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
