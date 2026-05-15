// sync-ai-imaging-intelligence — weekly scan pipeline.
// Calls Perplexity for fresh AI imaging market signals across 5 signal types,
// runs each batch through Claude to extract commercial implications,
// then upserts into ai_imaging_intelligence. Runs Monday 7:00 AM EDT via cron.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLASSIFIER_SYSTEM_PROMPT = `You are a commercial intelligence classifier for Pathova GTM, a firm that helps post-FDA AI diagnostic imaging companies sell into US health systems.

You receive raw market signals (news, regulatory actions, funding rounds, conference abstracts, job postings). For each signal, extract the commercial implication and triggered action from Pathova's perspective — what does this mean for AI imaging company revenue, and what should Pathova do?

Return a JSON array. Each element:
{
  "signal_type": "cms_reimbursement" | "fda_regulatory" | "funding_company" | "clinical_conference" | "stakeholder_org",
  "signal_date": "YYYY-MM-DD or null",
  "raw_signal": "1-3 sentence factual description of what happened",
  "company_name": "company name if signal is company-specific, null if market-wide",
  "use_case": "the AI imaging use case (e.g. chest X-ray triage, mammography, stroke detection) or null",
  "commercial_implication": "what this means for AI imaging company revenue — specific, not generic",
  "triggered_action": "the exact action Pathova should take or recommend to an ICP company — specific",
  "urgency": "immediate" | "this_week" | "this_month" | "monitor",
  "source_url": "URL if available, null otherwise"
}

Urgency rules:
- immediate: job posting for VP Sales, post-adverse event signals, clinical-only pilot announcement
- this_week: new Series B, key commercial hire departing, competitor clearance in same indication
- this_month: new clinical/admin leadership at target hospital, reimbursement change affecting active accounts
- monitor: everything else

Only include signals that are commercially relevant to AI diagnostic imaging companies. Discard signals about:
- pure research with no commercial pathway
- non-US markets with no US implications
- companies clearly outside diagnostic imaging AI

Return ONLY valid JSON. No explanation, no prose.`;

interface RawSignal {
  signal_type: string;
  signal_date: string | null;
  raw_signal: string;
  company_name: string | null;
  use_case: string | null;
  commercial_implication: string;
  triggered_action: string;
  urgency: string;
  source_url: string | null;
}

const SCAN_QUERIES = [
  {
    type: "cms_reimbursement",
    query: "AI diagnostic imaging CMS LCD NCD reimbursement coverage 2025 2026 radiology CPT code NTAP approval",
  },
  {
    type: "fda_regulatory",
    query: "AI radiology imaging 510k clearance De Novo FDA approval 2025 2026 chest X-ray mammography stroke detection pathology",
  },
  {
    type: "funding_company",
    query: "AI medical imaging startup Series A Series B funding 2025 2026 diagnostic radiology VP Sales CCO hire OR depart",
  },
  {
    type: "clinical_conference",
    query: "RSNA HIMSS 2025 2026 AI imaging pilot hospital abstract announcement radiology AI evaluation site",
  },
  {
    type: "stakeholder_org",
    query: "hospital radiology AI governance committee chief radiologist CIO CMO appointment 2025 2026 health system AI policy",
  },
];

async function callPerplexity(query: string): Promise<string> {
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: "sonar-pro",
      max_tokens: 4000,
      temperature: 0.0,
      return_citations: true,
      search_recency_filter: "week",
      web_search_options: { search_context_size: "medium" },
      messages: [
        {
          role: "system",
          content:
            "You are a market intelligence researcher. Return factual, recent news items relevant to the query. Focus on commercially significant events only. List each item as: [DATE if known] [ENTITY/COMPANY] — [what happened] — [source URL if available]. Be concise and factual.",
        },
        { role: "user", content: query },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Perplexity error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

async function classifySignals(rawText: string): Promise<RawSignal[]> {
  if (!rawText.trim()) return [];

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Classify these signals:\n\n${rawText}` }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const text: string = data?.content?.[0]?.text ?? "[]";

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Claude sometimes wraps JSON in markdown fences
    const match = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (match) {
      try {
        const inner = JSON.parse(match[1]);
        return Array.isArray(inner) ? inner : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}

const VALID_SIGNAL_TYPES = new Set([
  "cms_reimbursement",
  "fda_regulatory",
  "funding_company",
  "clinical_conference",
  "stakeholder_org",
]);

const VALID_URGENCY = new Set(["immediate", "this_week", "this_month", "monitor"]);

function validateRow(row: RawSignal): boolean {
  return (
    VALID_SIGNAL_TYPES.has(row.signal_type) &&
    VALID_URGENCY.has(row.urgency) &&
    typeof row.raw_signal === "string" &&
    row.raw_signal.length > 10 &&
    typeof row.commercial_implication === "string" &&
    row.commercial_implication.length > 10 &&
    typeof row.triggered_action === "string" &&
    row.triggered_action.length > 10
  );
}

async function processScan(
  scan: { type: string; query: string }
): Promise<{ query_type: string; fetched: number; inserted: number; errors: string[] }> {
  const entry = { query_type: scan.type, fetched: 0, inserted: 0, errors: [] as string[] };

  try {
    const raw = await callPerplexity(scan.query);
    if (!raw.trim()) {
      entry.errors.push("Perplexity returned empty response");
      return entry;
    }

    const signals = await classifySignals(raw);
    entry.fetched = signals.length;

    const valid = signals.filter(validateRow);
    if (valid.length === 0) {
      entry.errors.push("No valid signals after classification");
      return entry;
    }

    const normalizeDate = (d: string | null): string | null => {
      if (!d) return null;
      // Accept YYYY-MM-DD; pad YYYY-MM to first of month; reject anything else
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
      return null;
    };

    const rows = valid.map((s) => ({
      signal_type: s.signal_type,
      signal_date: normalizeDate(s.signal_date),
      raw_signal: s.raw_signal.slice(0, 2000),
      company_name: s.company_name ?? null,
      use_case: s.use_case ?? null,
      commercial_implication: s.commercial_implication.slice(0, 1000),
      triggered_action: s.triggered_action.slice(0, 1000),
      urgency: s.urgency,
      source_url: s.source_url ?? null,
      expires_at: s.company_name
        ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
        : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    }));

    const { error: insertErr } = await supabase
      .from("ai_imaging_intelligence")
      .insert(rows);

    if (insertErr) {
      entry.errors.push(`Insert error: ${insertErr.message}`);
    } else {
      entry.inserted = rows.length;
    }
  } catch (err) {
    entry.errors.push(String(err));
  }

  return entry;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Run all 5 scan types in parallel to stay within edge function timeout
  const [results] = await Promise.all([
    Promise.all(SCAN_QUERIES.map(processScan)),
    // Purge expired rows concurrently
    supabase
      .from("ai_imaging_intelligence")
      .delete()
      .lt("expires_at", new Date().toISOString().split("T")[0]),
  ]);

  const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
  console.info(`sync-ai-imaging-intelligence complete: ${totalInserted} signals inserted across ${results.length} scan types`);

  return new Response(
    JSON.stringify({ success: true, results, total_inserted: totalInserted }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
