// sync-vertical-intelligence — generic replacement for sync-ai-imaging-intelligence.
// One cron trigger processes every active vertical's signal sources (loaded from
// vertical_signal_sources) instead of one hardcoded query list for one vertical.
// For each (vertical, signal_type): calls Perplexity for fresh market signals,
// classifies them with that vertical's own classifier_system_prompt (from
// vertical_operators), then upserts into vertical_intelligence tagged by
// vertical_id. Adding a new vertical's signal sources is a data insert; this
// function picks them up on its next scheduled run automatically.

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

interface SignalSource {
  vertical_id: string;
  vertical_slug: string;
  signal_type: string;
  query_template: string;
  classifier_system_prompt: string;
  classifier_model: string;
}

const VALID_URGENCY = new Set(["immediate", "this_week", "this_month", "monitor"]);

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

async function classifySignals(rawText: string, classifierSystemPrompt: string, classifierModel: string): Promise<RawSignal[]> {
  if (!rawText.trim()) return [];

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: classifierModel,
      max_tokens: 4096,
      system: classifierSystemPrompt,
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

function validateRow(row: RawSignal, validSignalTypes: Set<string>): boolean {
  return (
    validSignalTypes.has(row.signal_type) &&
    VALID_URGENCY.has(row.urgency) &&
    typeof row.raw_signal === "string" &&
    row.raw_signal.length > 10 &&
    typeof row.commercial_implication === "string" &&
    row.commercial_implication.length > 10 &&
    typeof row.triggered_action === "string" &&
    row.triggered_action.length > 10
  );
}

async function processSource(
  source: SignalSource,
  validSignalTypes: Set<string>,
): Promise<{ vertical: string; query_type: string; fetched: number; inserted: number; errors: string[] }> {
  const entry = { vertical: source.vertical_slug, query_type: source.signal_type, fetched: 0, inserted: 0, errors: [] as string[] };

  try {
    const raw = await callPerplexity(source.query_template);
    if (!raw.trim()) {
      entry.errors.push("Perplexity returned empty response");
      return entry;
    }

    const signals = await classifySignals(raw, source.classifier_system_prompt, source.classifier_model);
    entry.fetched = signals.length;

    const valid = signals.filter((s) => validateRow(s, validSignalTypes));
    if (valid.length === 0) {
      entry.errors.push("No valid signals after classification");
      return entry;
    }

    const normalizeDate = (d: string | null): string | null => {
      if (!d) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
      return null;
    };

    const rows = valid.map((s) => ({
      vertical_id: source.vertical_id,
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

    const { error: insertErr } = await supabase.from("vertical_intelligence").insert(rows);

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

async function loadActiveSignalSources(): Promise<SignalSource[]> {
  const { data, error } = await supabase
    .from("vertical_signal_sources")
    .select(`
      vertical_id,
      signal_type,
      query_template,
      is_active,
      verticals!inner ( slug, status ),
      vertical_operators:vertical_operators!inner ( classifier_system_prompt, classifier_model )
    `)
    .eq("is_active", true)
    .eq("verticals.status", "active");

  if (error) throw new Error(`Failed to load signal sources: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    vertical_id: row.vertical_id,
    vertical_slug: row.verticals.slug,
    signal_type: row.signal_type,
    query_template: row.query_template,
    classifier_system_prompt: row.vertical_operators.classifier_system_prompt,
    classifier_model: row.vertical_operators.classifier_model,
  }));
}

// vertical_intelligence.signal_type carries a fixed CHECK constraint (see
// migration 20260902000000). Every active vertical's signal sources must use
// one of these five types today; widen the constraint before adding a new one.
const VALID_SIGNAL_TYPES = new Set([
  "cms_reimbursement",
  "fda_regulatory",
  "funding_company",
  "clinical_conference",
  "stakeholder_org",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sources = await loadActiveSignalSources();

    const [results] = await Promise.all([
      Promise.all(sources.map((s) => processSource(s, VALID_SIGNAL_TYPES))),
      supabase.from("vertical_intelligence").delete().lt("expires_at", new Date().toISOString().split("T")[0]),
    ]);

    const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
    console.info(`sync-vertical-intelligence complete: ${totalInserted} signals inserted across ${results.length} (vertical, signal_type) sources`);

    return new Response(
      JSON.stringify({ success: true, results, total_inserted: totalInserted }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("sync-vertical-intelligence error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
