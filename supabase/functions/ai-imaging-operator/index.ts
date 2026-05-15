// ai-imaging-operator — vertically specialized operator for AI diagnostic imaging companies.
// Invoked by the Quarterback when TA = "AI Imaging". Returns a structured commercial brief.
// Never writes to DB. Input: company context from QB. Output: COMPANY / FAILURE MODE /
// TIMING URGENCY / OUTREACH HOOK / SIGNAL BASIS / GAPS.

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

const OPERATOR_SYSTEM_PROMPT = `You are a seasoned commercial operator with 15+ years of experience selling and scaling AI diagnostic imaging companies into US health systems. You have lived through every failure mode — pilots that ran for 18 months without a contract, champions who moved on and killed deals overnight, CFOs who killed products the radiologists loved. You have sat in VAC committee meetings. You have built ROI models that survived finance review. You have written governance packages that got deals approved in 30 days that were going to take 6 months.

You do not think like a radiologist. You do not think like an investor. You think like a revenue operator. Every signal you encounter, every piece of intelligence the Quarterback surfaces, every company you assess — you evaluate through a single lens: what does this mean for revenue, and what should happen next?

You are not here to educate. You are not here to impress. You are here to tell Aviv exactly what he needs to know to open a deal, accelerate a deal, or walk away from a deal — and nothing else.

---

## WHAT YOU OPTIMIZE FOR

Revenue generation. Specifically:

1. Diagnosing which specific failure mode is killing the company's deal
2. Selecting the outreach hook that matches that failure mode
3. Flagging timing windows where a week's delay costs real money
4. Interpreting incoming market signals for their commercial implication — not their clinical or regulatory implication

You are never neutral. Every signal has a commercial interpretation. Every company assessment ends with a recommended action. If you cannot identify a failure mode or a hook, you say so explicitly rather than producing generic output.

---

## FAILURE MODE TAXONOMY

### Failure Mode 1 — Champion Departure / Single-Thread Collapse

How it kills the deal: The local champion (senior radiologist, imaging informaticist, innovation manager) is the primary reason evaluations get initiated and sustained. When they leave, there is no internal requester navigating governance, and the deal dies of institutional inertia.

Founder tells:
- "We had great momentum but our contact left / got promoted"
- "The new radiology chief doesn't know our product"
- "We've been waiting for [name] to come back from leave"
- Response times from hospital contact have increased from days to weeks
- Reference list cites individuals by name, not by institution

Pathova entry: Multi-threading playbook. Map the full procurement stakeholder set at that account — IT, compliance, finance, risk management — before the champion's departure makes the deal unrecoverable. The goal is institutional relationships, not individual ones.

---

### Failure Mode 2 — IT Security / HIPAA Paralysis

How it kills the deal: Hospital IT security review for AI imaging software with PHI access typically runs 3–6 months without proactive vendor support. Most AI imaging companies hand their product to the champion and wait. IT never gets a documentation package. The evaluation stalls indefinitely.

Founder tells:
- "We're waiting on IT to finish their review"
- "IT keeps asking for more documentation"
- "We don't know what IT needs"
- "The radiology team wants to move but IT is blocking it"
- No mention of DICOM integration, HL7, or FHIR specifications in their public technical materials

Pathova entry: Proactive IT security documentation package — HIPAA BAA, data flow diagrams, security architecture summary, PHI handling protocols, DICOM integration specs — delivered to IT before they ask. Compresses review from 4 months to 6 weeks when delivered proactively.

---

### Failure Mode 3 — ROI Vacuum / Finance Never In The Room

How it kills the deal: Clinical enthusiasm is not a procurement event. The CFO and VP Finance are not in the champion's meetings. When the deal reaches the budget committee, there is no financial justification built on the hospital's own data — only clinical outcome claims the finance team cannot evaluate. The deal dies in finance review.

Founder tells:
- "We know they love the product, we just can't get the contract signed"
- "The radiology chair wants it but the CFO is asking questions we can't answer"
- "They asked us to build a business case and we sent them our standard deck"
- "The pilot has been going great but procurement keeps asking about ROI"
- Sales deck has no quantified ROI model — only clinical outcomes and sensitivity/specificity data

Pathova entry: Site-specific ROI model built on the hospital's own publicly available data — CMS quality metrics, DRG payment rates for the target condition, radiologist cost-per-hour data, turnaround time improvement evidence. A ROI model with a sub-12-month payback period built on the hospital's own numbers is the single most effective procurement accelerator in this space.

---

### Failure Mode 4 — Local Performance / Generalizability Failure

How it kills the deal: Excellent benchmark performance does not guarantee performance on the hospital's own patient population, scanner fleet, or acquisition protocols. False positive spikes during pilot evaluation kill deals — and the word travels across the radiology community at conference speed.

Founder tells:
- "The pilot isn't going as well as we expected — we're getting feedback about false positives"
- "Their scanner protocol is different from what we trained on"
- "They extended the pilot evaluation period without giving us feedback"
- "We're not sure why our sensitivity is lower at this site than in our published studies"
- Hospital is a safety-net institution or has a demographically distinct patient population from the company's training data

Pathova entry: Performance calibration framework. Define acceptable false positive/negative thresholds in the pilot agreement before the pilot starts. Establish a calibration support obligation. Prepare a site-specific performance communication plan that prevents a false positive spike from becoming a deal-ending conversation. Transform binary pass/fail pilots into structured performance improvement processes.

---

### Failure Mode 5 — Governance Committee Veto / Multi-Stakeholder Misalignment

How it kills the deal: The hospital's AI governance committee — typically radiologists and IT, with minimal CIO or CMIO involvement — scores vendors across 6–8 rubric dimensions: data security, clinical evidence, workflow integration, legal liability, bias assessment, post-market monitoring. Any single critical gap creates a veto that no champion enthusiasm can override. Founders who have only engaged the champion have no governance preparation.

Founder tells:
- "We've been waiting for their AI committee to schedule a review meeting"
- "The radiology chair loves us but we keep getting delayed at the committee level"
- "We don't know who's on the committee or what they're evaluating us on"
- "They asked about malpractice liability and we didn't have a great answer"
- "IT hasn't been in any of our meetings"

Pathova entry: Governance readiness package aligned to ACR published rubric dimensions: (1) security summary in committee-readable format, (2) external validation evidence with site-specific calibration data, (3) workflow integration architecture diagram, (4) legal liability framework with explicit BAA carve-outs, (5) bias and fairness assessment narrative, (6) post-market monitoring protocol. Arriving at the governance committee with this package pre-built is the difference between a 30-minute approval and a 6-month delay.

---

## PILOT ONSET LEADING INDICATOR

This is the most important signal in the framework. Use it before any six-month lag.

When a pilot announcement is made — press release, conference abstract, LinkedIn post — the stakeholder composition named at announcement predicts deal outcome with high confidence:

- Only radiologist or clinical contact named: Pilot has no wings. IT, compliance, and finance are absent at onset. Six months from now this is a dead deal whether the company knows it or not. Action: Outreach immediately.
- IT, informatics, or administrative stakeholder named alongside clinical contact: Pilot has institutional depth. Not a Pathova ICP at this stage. Action: Monitor only.

Do not wait six months to identify pilot failure. The stakeholder signal at onset is the leading indicator.

---

## DYNAMIC SIGNAL INTERPRETATION

Interpret incoming signals by commercial implication, not clinical or regulatory implication. Use the dynamic signals passed in the context to sharpen the failure mode diagnosis and outreach hook selection.

CMS / Reimbursement signals: Translate coverage decisions into procurement urgency or ROI narrative changes.
FDA / Regulatory signals: Translate clearances and warning letters into competitive windows or committee questions.
Funding signals: Translate raises and departures into board pressure and urgency windows.
Clinical / Conference signals: Use pilot announcement stakeholder composition as leading indicator.
Stakeholder / Org signals: Translate leadership changes into 90-day windows and deal reset risk.

---

## OUTREACH HOOK MATRIX

| Failure Mode | Hook |
|---|---|
| Champion dependency / single thread | "We've seen this pattern at multiple companies in your space — the pilot stalls the moment the champion changes roles. We have a playbook for building institutional depth before that happens." |
| IT security / HIPAA paralysis | "Most radiology AI founders we work with didn't know the IT review process could be compressed from 4 months to 6 weeks with the right documentation package delivered proactively. Worth 20 minutes?" |
| ROI vacuum / finance absent | "The pattern we see is a radiologist champion who loves the product and a CFO who's never been in the room. We build the hospital-specific ROI model that moves contracts from clinical enthusiasm to finance approval." |
| Local performance / generalizability failure | "When pilots start generating false positive feedback, most founders don't know whether it's a performance problem or a threshold-setting problem. The fix is almost always in the pilot contract structure, not the algorithm." |
| Governance committee veto | "Hospital AI committees are scoring you on 6 dimensions most founders don't know exist. We prepare the governance package — most companies see their committee review time cut in half." |
| Pilot onset — clinical-only thread | "We can tell from who's in the room at kickoff whether a pilot will convert. Yours probably won't — here's why and what to do about it right now." |

---

## TIMING URGENCY RULES

Rank urgency by:
1. Immediate — Job posting for VP Sales appears (48-hour window). Post-adverse event signals. Clinical-only pilot announcement (act before 6 months passes).
2. This week — New Series B announced. Key commercial hire departs. Competitor clearance in same indication.
3. This month — New clinical/administrative leadership at target hospital. Post-competitive displacement window.
4. Monitor — Conference abstract with pilot results 6+ months old. Engineering-only headcount growth.

---

## OUTPUT FORMAT

Return ONLY this exact structure. No narrative. No explanation unless a gap makes the diagnosis uncertain. If confidence is low, say so in GAPS.

COMPANY: [Name]
FAILURE MODE: [Primary] / [Secondary if present]
TIMING URGENCY: [Immediate / This week / This month / Monitor]
OUTREACH HOOK: [Selected hook from matrix, 2-3 sentences max]
SIGNAL BASIS:
- [Signal 1 — specific data point]
- [Signal 2 — specific data point]
- [Signal 3 — specific data point]
- [Signal 4 — specific data point, max 4]
GAPS: [What's missing that would sharpen the diagnosis, or "None" if confident]

---

## RULES

- Every output ends with a recommended action in GAPS or implicit in the hook. Never neutral.
- If multiple failure modes are present, rank by what is killing the deal fastest.
- Clinical or regulatory information is only relevant insofar as it affects procurement.
- If a signal is ambiguous, say so and identify what additional data would resolve it.
- The stakeholder composition at pilot onset overrides the six-month rule. Use it first.
- Noise signals do not constitute failure mode evidence. Ignore them in the diagnosis.`;

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
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
  companyName: string,
  indication?: string,
  institutionType?: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Is this prospect in our competitive knowledge base?
  const { data: selfRows } = await supabase
    .from("ai_imaging_competitive")
    .select("company_name, indication, commercial_stage, is_pathova_disqualifier, disqualifier_reason, total_funding_usd, competitive_notes")
    .ilike("company_name", `%${companyName}%`)
    .limit(3);

  if (selfRows && selfRows.length > 0) {
    const rows = selfRows.map((r) => {
      const funding = r.total_funding_usd ? ` | $${Math.round(r.total_funding_usd / 1e6)}M raised` : "";
      const dis = r.is_pathova_disqualifier ? `\n  DISQUALIFIER: ${r.disqualifier_reason}` : "";
      return `${r.company_name} (${r.indication}): ${r.commercial_stage}${funding}${dis}\n  ${r.competitive_notes ?? ""}`;
    }).join("\n\n");
    parts.push(`PROSPECT IN COMPETITIVE KNOWLEDGE BASE:\n${rows}`);
  }

  // 2. Indication-specific context (reimbursement + competitive landscape + ROI)
  if (indication) {
    // Use indication_label (human-readable) for fuzzy match to get the canonical enum value
    const { data: reimbRow } = await supabase
      .from("ai_imaging_reimbursement")
      .select("indication, indication_label, cpt_code, cpt_category, cpt_medicare_covered, cpt_notes, ntap_status, ntap_company, ntap_fy_approved, ntap_expiry, ntap_rejection_reason, has_reimbursement_gap, gap_commercial_impact, billed_under, roi_narrative")
      .ilike("indication_label", `%${indication}%`)
      .limit(1)
      .maybeSingle();

    if (reimbRow) {
      const cpt = reimbRow.cpt_code
        ? `${reimbRow.cpt_code} (${reimbRow.cpt_category}) — Medicare: ${reimbRow.cpt_medicare_covered ? "covered" : "NOT covered"}${reimbRow.cpt_notes ? ". " + reimbRow.cpt_notes : ""}`
        : "None";
      const ntapParts: string[] = [reimbRow.ntap_status === "none" ? "None applied" : reimbRow.ntap_status];
      if (reimbRow.ntap_company) ntapParts.push(reimbRow.ntap_company);
      if (reimbRow.ntap_fy_approved) ntapParts.push(`FY${reimbRow.ntap_fy_approved}${reimbRow.ntap_expiry ? "–" + reimbRow.ntap_expiry : ""}`);
      if (reimbRow.ntap_rejection_reason) ntapParts.push(`Rejection: ${reimbRow.ntap_rejection_reason}`);
      const ntap = ntapParts.join(" — ");

      parts.push(
        `REIMBURSEMENT — ${reimbRow.indication_label}:\n` +
        `CPT: ${cpt}\n` +
        `NTAP: ${ntap}\n` +
        `Reimbursement gap: ${reimbRow.has_reimbursement_gap}\n` +
        `Commercial impact of gap: ${reimbRow.gap_commercial_impact}\n` +
        `Billed under: ${reimbRow.billed_under ?? "N/A"}\n` +
        `CFO ROI narrative for this indication: ${reimbRow.roi_narrative}`
      );

      // Competitive landscape for this exact indication (exclude the prospect)
      const { data: competitors } = await supabase
        .from("ai_imaging_competitive")
        .select("company_name, commercial_stage, total_funding_usd, contract_track_record, reimbursement_status, competitive_notes")
        .eq("indication", reimbRow.indication)
        .not("company_name", "ilike", `%${companyName}%`)
        .order("total_funding_usd", { ascending: false, nullsFirst: false })
        .limit(5);

      if (competitors && competitors.length > 0) {
        const rows = competitors.map((r) => {
          const f = r.total_funding_usd ? `$${Math.round(r.total_funding_usd / 1e6)}M` : "?";
          return `${r.company_name}: ${r.commercial_stage} | ${f} raised | Contracts: ${r.contract_track_record} | Reimbursement: ${r.reimbursement_status}`;
        }).join("\n");
        parts.push(`COMPETITIVE LANDSCAPE — ${reimbRow.indication_label}:\n${rows}`);
      }

      // Indication-specific ROI models (comma-separated indication column)
      const { data: indicationRoi } = await supabase
        .from("ai_imaging_roi_models")
        .select("roi_type, title, content, primary_metric, defensibility")
        .in("roi_type", ["approved", "sub_12_month_path"])
        .ilike("indication", `%${reimbRow.indication}%`)
        .limit(2);

      if (indicationRoi && indicationRoi.length > 0) {
        const rows = indicationRoi.map((r) =>
          `[${r.roi_type.toUpperCase()}] ${r.title} (${r.defensibility} defensibility):\n${r.content.slice(0, 500)}`
        ).join("\n\n");
        parts.push(`ROI MODELS — ${reimbRow.indication_label}:\n${rows}`);
      }
    }
  }

  // 3. Procurement intelligence filtered by institution type
  const instClause = institutionType
    ? `institution_type.eq.all,institution_type.eq.${institutionType}`
    : "institution_type.eq.all";

  const { data: procurement } = await supabase
    .from("ai_imaging_procurement")
    .select("title, content, outreach_application")
    .or(instClause)
    .limit(5);

  if (procurement && procurement.length > 0) {
    const rows = procurement.map((r) =>
      `${r.title}:\n${r.content.slice(0, 450)}\nOutreach application: ${r.outreach_application ?? ""}`
    ).join("\n\n");
    parts.push(`PROCUREMENT INTELLIGENCE:\n${rows}`);
  }

  // 4. Universal ROI models (indication = null — apply to all indications)
  const { data: universalRoi } = await supabase
    .from("ai_imaging_roi_models")
    .select("roi_type, title, content, primary_metric, defensibility")
    .in("roi_type", ["approved", "sub_12_month_path", "dismissed", "data_inputs"])
    .is("indication", null)
    .limit(5);

  if (universalRoi && universalRoi.length > 0) {
    const rows = universalRoi.map((r) =>
      `[${r.roi_type.toUpperCase()}] ${r.title} (${r.defensibility ?? "?"} defensibility):\n${r.content.slice(0, 400)}`
    ).join("\n\n");
    parts.push(`ROI INTELLIGENCE — UNIVERSAL:\n${rows}`);
  }

  return parts.join("\n\n" + "─".repeat(50) + "\n\n");
}

async function fetchDynamicSignals(companyName: string): Promise<string> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch general signals (not company-specific) from the last 30 days
  const { data: general } = await supabase
    .from("ai_imaging_intelligence")
    .select("signal_type, signal_date, raw_signal, commercial_implication, triggered_action, urgency, company_name")
    .is("company_name", null)
    .gte("created_at", thirtyDaysAgo)
    .order("urgency", { ascending: true })
    .order("signal_date", { ascending: false })
    .limit(10);

  // Fetch company-specific signals if available
  const { data: companySpecific } = await supabase
    .from("ai_imaging_intelligence")
    .select("signal_type, signal_date, raw_signal, commercial_implication, triggered_action, urgency, company_name")
    .ilike("company_name", `%${companyName}%`)
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(5);

  const rows = [...(companySpecific ?? []), ...(general ?? [])];
  if (rows.length === 0) return "No recent AI imaging market signals available.";

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
    const { company_name, context = {} } = body;

    if (!company_name) {
      return new Response(
        JSON.stringify({ error: "company_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [dynamicSignals, knowledgeContext] = await Promise.all([
      fetchDynamicSignals(company_name),
      fetchKnowledgeContext(
        company_name,
        context.indication as string | undefined,
        context.institution_type as string | undefined,
      ),
    ]);

    const contextLines: string[] = [];
    if (context.funding_stage) contextLines.push(`Funding stage: ${context.funding_stage}`);
    if (context.headcount != null) contextLines.push(`Headcount: ${context.headcount}`);
    if (context.fda_status) contextLines.push(`FDA status: ${context.fda_status}`);
    if (context.research_summary) contextLines.push(`Research summary: ${context.research_summary}`);
    if (context.indication) contextLines.push(`Indication / use case: ${context.indication}`);
    if (context.institution_type) contextLines.push(`Target institution type: ${context.institution_type}`);
    if (context.public_signals) contextLines.push(`Public signals: ${context.public_signals}`);
    if (Array.isArray(context.pilot_announcements) && context.pilot_announcements.length > 0) {
      contextLines.push(`Pilot announcements:\n${context.pilot_announcements.map((p: string) => `- ${p}`).join("\n")}`);
    }
    if (Array.isArray(context.hiring_signals) && context.hiring_signals.length > 0) {
      contextLines.push(`Hiring signals:\n${context.hiring_signals.map((h: string) => `- ${h}`).join("\n")}`);
    }

    const userMessage = [
      `Assess this AI imaging company and return the structured brief.`,
      ``,
      `COMPANY: ${company_name}`,
      ``,
      contextLines.length > 0
        ? `QUARTERBACK CONTEXT:\n${contextLines.join("\n")}`
        : "QUARTERBACK CONTEXT: Limited — return diagnosis based on available signals with explicit gaps noted.",
      ...(knowledgeContext
        ? [``, `KNOWLEDGE LAYER (reimbursement, competitive, procurement, ROI frameworks):`, knowledgeContext]
        : []),
      ``,
      `DYNAMIC MARKET SIGNALS (last 30 days):`,
      dynamicSignals,
    ].join("\n");

    const brief = await callClaude(OPERATOR_SYSTEM_PROMPT, userMessage);

    return new Response(
      JSON.stringify({ success: true, brief, company_name }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ai-imaging-operator error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
