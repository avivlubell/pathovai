import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY")!;
const JINA_API_KEY = Deno.env.get("JINA_API_KEY") || "";
const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1`;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// How many jobs to process per cron run. Keep low — each job takes ~40-60s.
const BATCH_SIZE = 2;

// ── Research prompt (condensed triage format) ─────────────────────────────────
const TRIAGE_PROMPT = `You are a B2B intelligence researcher for a MedTech GTM advisory firm.
Research [COMPANY_NAME] and extract the following ICP pre-qualification signals.

For each field: give the fact + source URL. If you cannot find it, emit a GAP block.

GAP BLOCK FORMAT:
<<<GAP>>>
field: <field name>
why_not_found: <one line>
go_to_url: <single best URL to visit>
comet_prompt: <paste-ready, specific extraction instruction>
<<<END GAP>>>

FIELDS TO EXTRACT:

1. COMPANY_OVERVIEW
What does the company do? Product category (SaMD / Hardware device / DTx / Clinical AI / Services / Other). Target customer. Copy verbatim from their website About or homepage.

2. FDA_STATUS
FDA 510(k) cleared / De Novo / PMA / Pending / Not applicable / Unknown.
If cleared: clearance date, K-number, device classification. Source URL required.

3. FUNDING
Total capital raised. Most recent round: type, amount, date, lead investor.
If bootstrapped or no data found, say so explicitly.

4. COMMERCIAL_TRACTION
Named customer/pilot hospitals or health systems mentioned publicly.
Exact count of pilot or customer sites if stated. Copy verbatim.

5. TEAM_SIGNALS
LinkedIn employee count. Any VP Sales, CRO, Director of Market Access, or commercial leadership hired in the last 12 months? Names + titles if found.

6. ICP_HYPOTHESIS
In 2-3 sentences: what is the most likely commercial gap this company faces right now?
Focus on: pilot-to-paid conversion, sales team scaling, reimbursement pathway clarity, or commercial leadership gaps. Ground in what you found above — do not speculate.

RULES:
- Never guess or infer. Only state what you found with a source URL.
- For every field you cannot find: emit a GAP block. Do not write "NOT FOUND".
- Return exactly the 6 fields above, in order.`;

// ── GAP block parser ──────────────────────────────────────────────────────────
interface GapTask {
  id: string;
  field: string;
  url: string;
  prompt: string;
}

function parseGapBlocks(text: string): GapTask[] {
  const tasks: GapTask[] = [];
  const pattern = /<<<GAP>>>([\s\S]*?)<<<END GAP>>>/g;
  let match;
  let idx = 0;
  while ((match = pattern.exec(text)) !== null) {
    const block = match[1];
    const field = block.match(/field:\s*(.+)/)?.[1]?.trim() ?? "";
    const url = block.match(/go_to_url:\s*(.+)/)?.[1]?.trim() ?? "";
    const promptMatch = block.match(/comet_prompt:\s*([\s\S]*?)(?=\n(?:field:|why_not_found:|go_to_url:|comet_prompt:|<<<)|$)/);
    const prompt = promptMatch?.[1]?.trim() ?? field;
    if (field && url) {
      const slug = field.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
      tasks.push({ id: `${slug}_${idx++}`, field, url, prompt });
    }
  }
  return tasks;
}

// ── Jina + Perplexity fetchers (mirrors fetch-gap-content logic) ──────────────
const LINKEDIN_HOSTS = ["linkedin.com/", "lnkd.in/"];
const LOGIN_WALL_SIGNALS = [
  "sign in to continue", "log in to view", "create an account",
  "join linkedin", "you must be logged in", "please log in", "please sign in",
];

function isLinkedIn(url: string) {
  return LINKEDIN_HOSTS.some((h) => url.toLowerCase().includes(h));
}
function isLoginWall(content: string) {
  const lower = content.toLowerCase();
  return LOGIN_WALL_SIGNALS.some((s) => lower.includes(s));
}

async function fetchViaJina(url: string): Promise<{ ok: boolean; content: string }> {
  const headers: Record<string, string> = { Accept: "text/plain", "X-No-Cache": "true" };
  if (JINA_API_KEY) headers["Authorization"] = `Bearer ${JINA_API_KEY}`;
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, content: `HTTP ${res.status}` };
    const text = (await res.text()).trim();
    if (text.length < 200 || isLoginWall(text)) return { ok: false, content: text.slice(0, 200) };
    return { ok: true, content: text.slice(0, 6000) };
  } catch (e: unknown) {
    return { ok: false, content: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchViaPerplexity(prompt: string): Promise<{ ok: boolean; content: string }> {
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${PERPLEXITY_API_KEY}` },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "Research assistant. Answer with specific sourced facts. Be concise." },
          { role: "user", content: prompt },
        ],
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, content: `Perplexity ${res.status}` };
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "";
    return { ok: !!content, content };
  } catch (e: unknown) {
    return { ok: false, content: e instanceof Error ? e.message : String(e) };
  }
}

async function resolveGap(gap: GapTask): Promise<{ field: string; content: string; source: string }> {
  if (isLinkedIn(gap.url)) {
    const r = await fetchViaPerplexity(gap.prompt);
    return { field: gap.field, content: r.content, source: r.ok ? "perplexity" : "failed" };
  }
  const jina = await fetchViaJina(gap.url);
  if (jina.ok) return { field: gap.field, content: jina.content, source: "jina" };
  const px = await fetchViaPerplexity(gap.prompt);
  return { field: gap.field, content: px.content, source: px.ok ? "perplexity" : "failed" };
}

// ── Main research call ────────────────────────────────────────────────────────
async function researchCompany(companyName: string): Promise<string> {
  const prompt = TRIAGE_PROMPT.replace(/\[COMPANY_NAME\]/g, companyName);
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${PERPLEXITY_API_KEY}` },
    body: JSON.stringify({
      model: "sonar-pro",
      max_tokens: 4000,
      temperature: 0.0,
      return_citations: true,
      search_recency_filter: "year",
      web_search_options: { search_context_size: "high" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Research this company: ${companyName}` },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Perplexity error ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Process one job ───────────────────────────────────────────────────────────
async function processJob(job: { id: string; company_name: string; triggered_by: string }) {
  await supabase
    .from("research_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", job.id);

  try {
    // 1. Perplexity triage research
    const rawResearch = await researchCompany(job.company_name);

    // 2. Parse and resolve GAP blocks
    const gaps = parseGapBlocks(rawResearch);
    let enrichedResearch = rawResearch;

    if (gaps.length > 0) {
      const resolved = await Promise.all(gaps.map(resolveGap));
      for (const r of resolved) {
        if (r.source !== "failed" && r.content) {
          // Append resolved content after the GAP block
          const gapPattern = new RegExp(
            `<<<GAP>>>\\s*field:\\s*${r.field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?<<<END GAP>>>`,
            "i"
          );
          const replacement = `[FETCHED via ${r.source}]\n${r.content}\n[/FETCHED]`;
          enrichedResearch = enrichedResearch.replace(gapPattern, replacement);
        }
      }
    }

    // 3. Save to knowledge base
    const kbContent = `# Auto-Research: ${job.company_name}\n\nTriggered by: ${job.triggered_by}\nResearched: ${new Date().toISOString()}\n\n${enrichedResearch}`;
    const { data: kb, error: kbErr } = await supabase
      .from("knowledge_base")
      .insert({
        title: `Auto-Research: ${job.company_name}`,
        content: kbContent,
        document_type: "research_note",
        tags: ["auto-research", "pending-review", job.triggered_by, job.company_name.toLowerCase()],
        metadata: {
          company_name: job.company_name,
          triggered_by: job.triggered_by,
          gaps_found: gaps.length,
          gaps_resolved: gaps.length - (gaps.length > 0 ? (await Promise.all(gaps.map(resolveGap))).filter((r) => r.source === "failed").length : 0),
          researched_at: new Date().toISOString(),
        },
      })
      .select("id")
      .single();

    if (kbErr) throw new Error(`KB insert failed: ${kbErr.message}`);

    await supabase
      .from("research_jobs")
      .update({
        status: "complete",
        result_kb_id: kb.id,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.info(`[drain] Completed: ${job.company_name} → kb/${kb.id}`);
    return { ok: true, company: job.company_name, kb_id: kb.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[drain] Failed: ${job.company_name} — ${msg}`);
    await supabase
      .from("research_jobs")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    return { ok: false, company: job.company_name, error: msg };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (_req: Request) => {
  const startTime = Date.now();
  try {
    // Pick up pending jobs (oldest first)
    const { data: jobs, error } = await supabase
      .from("research_jobs")
      .select("id, company_name, triggered_by")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw new Error(error.message);
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "Queue empty" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const results = [];
    for (const job of jobs) {
      results.push(await processJob(job));
      // Small pause between companies to avoid Perplexity rate limits
      if (jobs.length > 1) await new Promise((r) => setTimeout(r, 2000));
    }

    return new Response(
      JSON.stringify({
        processed: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        duration_ms: Date.now() - startTime,
        results,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
