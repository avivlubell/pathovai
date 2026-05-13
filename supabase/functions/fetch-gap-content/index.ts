import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY")!;
const JINA_API_KEY = Deno.env.get("JINA_API_KEY") || "";

interface GapTask {
  id: string;
  field: string;
  url: string;
  prompt: string;
}

interface GapResult {
  id: string;
  field: string;
  source: "jina" | "perplexity" | "failed";
  content: string;
  url_used: string;
  jina_failure?: string;
  error?: string;
}

const LINKEDIN_HOSTS = ["linkedin.com/", "lnkd.in/"];
const LOGIN_WALL_SIGNALS = [
  "sign in to continue",
  "log in to view",
  "create an account",
  "join linkedin",
  "you must be logged in",
  "authentication required",
  "please log in",
  "please sign in",
  "sign in with",
  "access denied",
];

function isLinkedIn(url: string): boolean {
  return LINKEDIN_HOSTS.some((h) => url.toLowerCase().includes(h));
}

function isLoginWall(content: string): boolean {
  const lower = content.toLowerCase();
  return LOGIN_WALL_SIGNALS.some((s) => lower.includes(s));
}

async function fetchViaJina(
  url: string
): Promise<{ ok: boolean; content: string }> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-No-Cache": "true",
  };
  if (JINA_API_KEY) {
    headers["Authorization"] = `Bearer ${JINA_API_KEY}`;
  }

  try {
    const res = await fetch(jinaUrl, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return { ok: false, content: `HTTP ${res.status} from Jina` };
    }
    const text = await res.text();
    const trimmed = text.trim();
    if (trimmed.length < 200 || isLoginWall(trimmed)) {
      return {
        ok: false,
        content: trimmed.slice(0, 300),
      };
    }
    return { ok: true, content: trimmed.slice(0, 8000) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, content: msg };
  }
}

// Convert a Comet browser instruction into a clean Perplexity search query.
// comet_prompts are written for a logged-in browser ("Go to LinkedIn and extract..."),
// not for a search engine. Stripping the navigation layer leaves the factual ask.
function toSearchQuery(field: string, cometPrompt: string): string {
  const cleaned = cometPrompt
    .replace(/^(?:Go to|Open|Navigate to|Visit|Access)\s+[^\n.]+[\n.]\s*/gi, "")
    .replace(/\bExtract[:\s]+/gi, "")
    .replace(/\bReturn[:\s]+/gi, "")
    .replace(/\bList[:\s]+/gi, "")
    .replace(/\(\d+\)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned.length > 20 ? cleaned : field).slice(0, 400);
}

async function fetchViaPerplexity(
  prompt: string
): Promise<{ ok: boolean; content: string }> {
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a research assistant. Answer with specific, sourced facts. Be concise.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      return { ok: false, content: `Perplexity error: ${res.status}` };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content || "";
    return { ok: !!content, content };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, content: msg };
  }
}

async function resolveGap(gap: GapTask): Promise<GapResult> {
  const searchQuery = toSearchQuery(gap.field, gap.prompt);

  // LinkedIn: skip Jina entirely — always gated behind login
  if (isLinkedIn(gap.url)) {
    const result = await fetchViaPerplexity(searchQuery);
    return {
      id: gap.id,
      field: gap.field,
      source: result.ok ? "perplexity" : "failed",
      content: result.content,
      url_used: gap.url,
      ...(result.ok ? {} : { error: "Perplexity returned no content" }),
    };
  }

  // Try Jina first
  const jina = await fetchViaJina(gap.url);
  if (jina.ok) {
    return {
      id: gap.id,
      field: gap.field,
      source: "jina",
      content: jina.content,
      url_used: `https://r.jina.ai/${gap.url}`,
    };
  }

  // Jina failed — fall back to Perplexity with cleaned search query
  const perplexity = await fetchViaPerplexity(searchQuery);
  return {
    id: gap.id,
    field: gap.field,
    source: perplexity.ok ? "perplexity" : "failed",
    content: perplexity.content,
    url_used: gap.url,
    jina_failure: jina.content,
    ...(perplexity.ok
      ? {}
      : { error: "Both Jina and Perplexity returned no usable content" }),
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as { gaps?: GapTask[] };
    const { gaps } = body;

    if (!Array.isArray(gaps) || gaps.length === 0) {
      return new Response(
        JSON.stringify({ error: "gaps must be a non-empty array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cap at 10 gaps per call to stay within timeout budget
    const capped = gaps.slice(0, 10);
    const results = await Promise.all(capped.map(resolveGap));

    const resolved = results.filter((r) => r.source !== "failed").length;
    const failed = results.filter((r) => r.source === "failed").length;

    return new Response(
      JSON.stringify({ resolved, failed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
