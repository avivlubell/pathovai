import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchIcpTriggers(company_name: string): Promise<any[]> {
  const { data } = await supabase
    .from("icp_triggers")
    .select("company_name, icp_tier, trigger_types, fda_status, summary, date_found, source")
    .ilike("company_name", `%${company_name}%`)
    .limit(5);
  return data || [];
}

async function fetchIndustryIntelligence(topic: string, therapeutic_area?: string[]): Promise<any[]> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let q = supabase
    .from("industry_intelligence")
    .select("title, category, signal_type, source_publication, source_date, what_happened, so_what, urgency_window, source_url")
    .order("source_date", { ascending: false })
    .gte("source_date", cutoff)
    .limit(5);
  if (topic) {
    const t = topic.replace(/[%_]/g, "");
    q = q.or(`title.ilike.%${t}%,what_happened.ilike.%${t}%,so_what.ilike.%${t}%`);
  }
  if (Array.isArray(therapeutic_area) && therapeutic_area.length > 0) {
    q = q.overlaps("therapeutic_area", therapeutic_area);
  }
  const { data } = await q;
  return data || [];
}

async function fetchPodcastSignals(topic: string): Promise<any[]> {
  let q = supabase
    .from("podcast_signals")
    .select("title, show, guest_name, guest_company, air_date, key_insight, content_angle, signal_type, icp_relevance, source_url")
    .eq("icp_relevance", "High")
    .order("air_date", { ascending: false })
    .limit(5);
  if (topic) {
    const t = topic.replace(/[%_]/g, "");
    q = q.or(`title.ilike.%${t}%,key_insight.ilike.%${t}%,content_angle.ilike.%${t}%,guest_company.ilike.%${t}%`);
  }
  const { data } = await q;
  return data || [];
}

async function fetchClinicalTrials(company_name: string, indication?: string): Promise<any[]> {
  const params = new URLSearchParams({
    format: "json",
    pageSize: "5",
    fields: "NCTId|BriefTitle|OverallStatus|Phase|StartDate|CompletionDate|LeadSponsorName|BriefSummary|Condition",
  });
  if (indication) params.set("query.cond", indication);
  if (company_name) params.set("query.lead", company_name);
  const res = await fetch(`https://clinicaltrials.gov/api/v2/studies?${params}`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.studies || []).map((s: any) => {
    const p = s.protocolSection || {};
    return {
      nct_id: p.identificationModule?.nctId,
      title: p.identificationModule?.briefTitle,
      status: p.statusModule?.overallStatus,
      phase: p.designModule?.phases,
      sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name,
      conditions: p.conditionsModule?.conditions,
      summary: (p.descriptionModule?.briefSummary || "").slice(0, 300),
    };
  });
}

async function fetchCmsCoverage(query: string, cms_type = "ncd"): Promise<any[]> {
  const endpoint = cms_type === "lcd"
    ? "https://api.coverage.cms.gov/v1/reports/local-coverage-final-lcds/"
    : "https://api.coverage.cms.gov/v1/reports/national-coverage-ncd/";
  const res = await fetch(`${endpoint}?${new URLSearchParams({ search: query, page_size: "5" })}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

async function fetchIcd10(terms: string): Promise<any[]> {
  const res = await fetch(
    `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?${new URLSearchParams({ terms, maxList: "10", sf: "code,name", df: "code,name", cf: "code" })}`
  );
  if (!res.ok) return [];
  const [, codes, , displayPairs] = await res.json() as [number, string[], null, string[][]];
  return (codes || []).map((code: string, i: number) => ({ code, description: displayPairs?.[i]?.[1] ?? "" }));
}

async function fetchFdaClearances(company_name: string, device_keyword?: string): Promise<any[]> {
  const clauses: string[] = [];
  if (company_name) clauses.push(`applicant:"${company_name.replace(/"/g, "")}"`);
  if (device_keyword) clauses.push(`device_name:"${device_keyword.replace(/"/g, "")}"`);
  const params = new URLSearchParams({ search: clauses.join("+AND+"), limit: "5" });
  const res = await fetch(`https://api.fda.gov/device/510k.json?${params}`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.results || []).map((r: any) => ({
    k_number: r.k_number,
    applicant: r.applicant,
    device_name: r.device_name,
    decision_date: r.decision_date,
    decision: r.decision_description,
    product_code: r.product_code,
    specialty: r.advisory_committee_description,
    summary: (r.statement_or_summary || "").slice(0, 300),
  }));
}

const SYNTHESIS_PROMPT = `You are a MedTech commercial intelligence analyst. Signals from multiple sources have been collected about a target company. Find convergence patterns and surface the most credible, actionable insight for outreach. Be specific — cite the actual source and fact. No generic MedTech commentary.

Output ONLY valid JSON in this shape:
{
  "convergence": [
    { "theme": "one-line finding where 2+ sources agree", "evidence": ["source_name: specific fact"], "strength": "strong|moderate|weak" }
  ],
  "hook": { "angle": "the strongest outreach angle", "lead_with": "the specific fact or quote to open with", "why_now": "timing rationale from the signals" },
  "anchors": [
    { "source": "source name", "fact": "specific citable fact", "url": "url if present or null" }
  ],
  "gaps": ["what wasn't found or is missing that would help"]
}

COMPANY: {COMPANY}
TOPIC / INDICATION: {TOPIC}

SIGNALS:
{SIGNALS}`;

const SOURCE_FETCHERS: Record<string, (body: any) => Promise<any[]>> = {
  icp_triggers: (b) => fetchIcpTriggers(b.company_name),
  industry_intelligence: (b) => fetchIndustryIntelligence(b.topic || b.indication || b.company_name, b.therapeutic_area),
  podcast_signals: (b) => fetchPodcastSignals(b.topic || b.indication || b.company_name),
  clinical_trials: (b) => fetchClinicalTrials(b.company_name, b.indication),
  cms_coverage: (b) => fetchCmsCoverage(b.indication || b.topic || b.company_name, b.cms_type),
  icd10: (b) => fetchIcd10(b.indication || b.topic || b.company_name),
  fda_clearances: (b) => fetchFdaClearances(b.company_name, b.device_keyword),
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const body = await req.json().catch(() => ({}));
  const { company_name, sources } = body;

  if (!company_name || !Array.isArray(sources) || sources.length === 0) {
    return new Response(JSON.stringify({ error: "company_name and sources[] are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const selectedSources = (sources as string[]).filter((s) => s in SOURCE_FETCHERS);
  const results = await Promise.allSettled(selectedSources.map((s) => SOURCE_FETCHERS[s](body)));

  const collected: Record<string, any[]> = {};
  selectedSources.forEach((source, i) => {
    const r = results[i];
    collected[source] = r.status === "fulfilled" ? r.value : [];
  });

  const signalText = Object.entries(collected)
    .filter(([, items]) => items.length > 0)
    .map(([src, items]) => `=== ${src.replace(/_/g, " ").toUpperCase()} ===\n${JSON.stringify(items, null, 2)}`)
    .join("\n\n");

  const signalCounts = Object.fromEntries(selectedSources.map((s) => [s, collected[s]?.length || 0]));

  if (!signalText) {
    return new Response(JSON.stringify({
      company_name,
      sources_queried: selectedSources,
      signal_counts: signalCounts,
      convergence: [],
      hook: null,
      anchors: [],
      gaps: ["No signals returned from any selected source"],
    }), { headers: { "Content-Type": "application/json", ...CORS } });
  }

  const prompt = SYNTHESIS_PROMPT
    .replace("{COMPANY}", company_name)
    .replace("{TOPIC}", body.indication || body.topic || "MedTech commercial")
    .replace("{SIGNALS}", signalText);

  let synthesis: any = { convergence: [], hook: null, anchors: [], gaps: [] };
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    synthesis = JSON.parse((msg.content[0] as any).text);
  } catch {
    synthesis.gaps = ["Synthesis step failed — raw signals included below"];
  }

  return new Response(JSON.stringify({
    company_name,
    indication: body.indication || null,
    sources_queried: selectedSources,
    signal_counts: signalCounts,
    ...synthesis,
    _raw: collected,
  }), { headers: { "Content-Type": "application/json", ...CORS } });
});
