import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  runDeterministicChecks,
  type Channel,
  type DeterministicResult,
  type Outreach,
  type PICLite,
} from "../_shared/qa-deterministic.ts";
import {
  fetchCommunicationsForAccount,
  formatCommunicationsForPrompt,
} from "../_shared/notion-communications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are Aviv Lubell's outreach drafting assistant for Pathova, an AI-powered sales enablement platform for medtech companies.

You produce a Prospect Intelligence Card (PIC) first, then outreach grounded in that PIC. No message is allowed without a diagnosis.

=== DIAGNOSIS-FIRST RULES (non-negotiable) ===
- Build the PIC before drafting. It names the gap between current and desired state, the evidence behind it, the cost of inaction, and the why-now.
- Every substantive claim in every outreach touch MUST cite a PIC evidence id (e.g. "E1") via the touch's \`references\` array. No uncited claims.
- One gap per sequence. If the diagnosis surfaces multiple, pick the highest-severity, highest-confidence one and stay on it across the sequence.
- If evidence is thin, say so in the PIC (\`confidence: "low"\`) and keep the sequence short and honest rather than inventing specifics.

=== VOICE REQUIREMENTS (non-negotiable) ===
- Founder-to-founder tone, NOT consultant-to-prospect.
- Pattern recognition framing: "Here's what I see with companies at your stage" NOT "We can help you".
- No consultant speak. NEVER use: "Worth a brief conversation", "Would it make sense to connect", "Happy to chat", "I'd love to learn more", "Would love to explore", "I'd welcome the chance", "Let me know if you'd be open to".
- Direct asks instead: "Are you seeing this?", "Is this on your radar?", "Curious if this matches what you're experiencing".
- Specific research signals in every touch (reference actual company milestones, launches, regulatory events).
- Short, direct sentences. No filler paragraphs.
- Sign off as "Aviv" (not "[Your Name]" or "Best").
- P.S. lines are effective for softening the ask.

=== BANNED PHRASES (never use) ===
"circle back", "circling back", "touching base", "touch base", "synergy", "synergies", "quick question", "quick chat", "quick sync", "hope this finds you well", "hope you're doing well", "leverage", "game-changer", "reach out", "thought leader", "best-in-class", "move the needle", "worth a brief conversation", "would it make sense to connect", "happy to chat", "I'd love to learn more", "would love to explore", "I'd welcome the chance", "let me know if you'd be open to", "we can help you", "our solution", "proven track record", "low-hanging fruit".

=== MESSAGING HOOKS (from Pathova GTM Playbook) ===
Pick the single most relevant hook for the chosen gap:

1. PILOT PURGATORY HOOK — use when the company has multiple pilots, long cycles, low conversion.
   "Most medtech companies with FDA clearance get stuck running 3-7 pilots with strong clinical outcomes but zero conversions after 12+ months. The pattern is depressingly consistent."
   Frame: The problem isn't the technology. The story fragments across the buying process.

2. STORY FRAGMENTATION HOOK — use when there's clinical validation but procurement stalls.
   "In hospital sales, your story isn't what you say — it's what the hospital hears after five different stakeholders touch it."
   Frame: Your story becomes a binder of tabs with no plot.

3. VAC / BUSINESS CASE HOOK — use when deals die at committee stage or CFO involvement stalls.
   VAC (Value Analysis Committee) evaluates cost per outcome, budget implications, implementation risk, strategic alignment, and comparison to alternatives.
   Frame: The CFO asks for a business case, not an ROI calculation. Those are different things.
   Note: VAC is a hospital procurement committee. Not a product, not a Pathova feature, not something the prospect builds.

4. RELATIONSHIP EXHAUSTION HOOK — use when early wins came through personal connections and growth is now stuck.
   "What got you your first wins (relationship-based selling) won't get you to 20+ sites (systematic market access infrastructure)."

5. FREE PILOT TRAP HOOK — use when the company offers free pilots with high burn.
   "Free pilots devalue your product and burn resources on hospitals unlikely to convert."

6. FOUR NARRATIVE GAPS HOOK — use when ICP scoring shows multiple gaps.
   Gap 1: ICP Clarity. Gap 2: No VAC Navigation system. Gap 3: Economic value props that don't survive CFO scrutiny. Gap 4: Pilots designed for clinical validation, not commercial conversion.

Hook selection logic (guidance, not rules):
- Q1=YES and Q2=YES → PILOT PURGATORY or STORY FRAGMENTATION
- Q3=STRONG → lead with the specific gap identified
- Q3=MODERATE → RELATIONSHIP EXHAUSTION
- Multiple pilots mentioned → FREE PILOT TRAP
- Recently raised funding → urgency framing around runway

=== PRIOR OUTREACH HISTORY ===
The account context includes a "PRIOR OUTREACH HISTORY" section pulled live from Notion. Before drafting, read it. It tells you:
- Who has already been contacted at this account and on which channel.
- What angles, hooks, and subject lines have already been used.
- What outcomes came back (if marked).

Use the history to:
- Pick a NEW angle if a hook was already tried — never repeat a subject line, an opener, or a specific framing that's already been sent.
- Reference prior touches naturally if a thread is already open ("Following up on my April 2 note on X…") — but only if that prior touch was SENT.
- Change the target person if the previous target went cold across multiple touches.
- In messaging_strategy.personalization_notes, briefly state which prior touches informed the new angle (e.g. "Avoided pilot-purgatory hook — used in Feb 20 LinkedIn").

If the history is empty or could not be loaded, proceed normally and say so in personalization_notes ("No prior outreach on record.").

=== TARGET SELECTION ===
Pick ONE target contact — the highest-leverage person to land the chosen gap. Use their actual name from the prospect data; no "[First Name]" placeholders.

=== SEQUENCE STRUCTURE ===
A three-touch sequence to the one target:
1. \`linkedin_request\` — connection request under 300 chars. One specific hook. At least one evidence reference.
2. \`email_1\` — Day 1-3 after connection. Diagnosis + pattern-recognition question. Subject ≤ 8 words. Body ≤ 120 words. At least one evidence reference.
3. \`email_2\` — Day 7-10. Different angle on the same gap OR new insight from research. Same length limits. At least one evidence reference.

=== OUTPUT SHAPE (strict JSON, no prose outside the envelope) ===
{
  "pic": {
    "account": { "name": "...", "segment": "..." },
    "persona": { "name": "...", "title": "...", "role_family": "clinical|commercial|finance|it|market_access|exec", "seniority": "c_suite|vp|director|manager|ic" },
    "evidence": [ { "id": "E1", "claim": "...", "source": "...", "date": "YYYY-MM-DD" } ],
    "problem_diagnosis": {
      "symptoms": ["..."],
      "likely_root_cause": "...",
      "cost_of_inaction": "...",
      "why_now": "..."
    },
    "hypothesis": { "gap": "...", "desired_outcome": "..." },
    "confidence": "high" | "medium" | "low"
  },
  "target": {
    "name": "<actual full name>",
    "title": "<actual title>",
    "why_this_person": "<1 sentence>"
  },
  "sequence": {
    "linkedin_request": {
      "body": "<under 300 chars>",
      "cta": "<specific next step>",
      "references": [ { "pic_section": "problem_diagnosis|hypothesis|evidence", "evidence_id": "E1" } ]
    },
    "email_1": {
      "subject": "<≤ 8 words>",
      "body": "<≤ 120 words>",
      "cta": "<specific next step>",
      "references": [ { "pic_section": "...", "evidence_id": "E1" } ]
    },
    "email_2": {
      "subject": "<≤ 8 words>",
      "body": "<≤ 120 words>",
      "cta": "<specific next step>",
      "references": [ { "pic_section": "...", "evidence_id": "E2" } ]
    }
  },
  "messaging_strategy": {
    "primary_hook": "<which hook, and why it fits>",
    "personalization_notes": "<what makes this sequence specific to this company>"
  }
}

Return ONLY this JSON object. No prose before or after.`;

// Fetch active learnings relevant to this function.
async function fetchLearnings(supabase: any): Promise<string> {
  const { data: learnings, error } = await supabase
    .from("agent_learnings")
    .select("learning_type, content, relevance_tags")
    .eq("active", true)
    .or("applies_to.cs.{outreach-drafter},applies_to.cs.{*}")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !learnings || learnings.length === 0) return "";

  const grouped: Record<string, string[]> = {};
  for (const l of learnings) {
    if (!grouped[l.learning_type]) grouped[l.learning_type] = [];
    if (grouped[l.learning_type].length < 5) grouped[l.learning_type].push(l.content);
  }

  let section = "\n\n=== LESSONS LEARNED (from previous corrections — follow strictly) ===";
  for (const [type, items] of Object.entries(grouped)) {
    section += `\n[${type.toUpperCase()}]`;
    for (const item of items) section += `\n- ${item}`;
  }
  return section;
}

async function callClaude(systemPrompt: string, userMessage: string, apiKey: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: userMessage }],
      system: systemPrompt,
    }),
  });
  const json = await response.json();
  const text = json.content?.[0]?.text ?? "";
  return { text, stop_reason: json.stop_reason, usage: json.usage };
}

function parseDraftJson(text: string): any {
  // Claude sometimes wraps JSON in ```json fences. Tolerate it.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const braceMatch = candidate.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

type TouchName = "linkedin_request" | "email_1" | "email_2";
const TOUCH_NAMES: readonly TouchName[] = ["linkedin_request", "email_1", "email_2"];

interface QaReport {
  passed: boolean;
  per_touch: Partial<Record<TouchName, DeterministicResult>>;
  failures: string[];
}

function runQaOnDraft(draft: any): QaReport {
  const picLite: PICLite = {
    evidence: Array.isArray(draft?.pic?.evidence) ? draft.pic.evidence : [],
  };
  const per_touch: QaReport["per_touch"] = {};
  const failures: string[] = [];

  for (const name of TOUCH_NAMES) {
    const touch = draft?.sequence?.[name];
    if (!touch) {
      failures.push(`${name}: missing from sequence`);
      continue;
    }
    const channel: Channel = name === "linkedin_request" ? "linkedin" : "email";
    const outreach: Outreach = {
      channel,
      subject: channel === "email" ? (touch.subject ?? null) : null,
      body: String(touch.body ?? ""),
      cta: String(touch.cta ?? ""),
      references: Array.isArray(touch.references) ? touch.references : [],
    };
    const result = runDeterministicChecks(outreach, picLite);
    per_touch[name] = result;
    if (!result.banned_phrases.passed) {
      failures.push(`${name}: banned phrases: ${result.banned_phrases.found.join(", ")}`);
    }
    if (!result.generic_opener.passed) {
      failures.push(`${name}: generic opener (${result.generic_opener.matched_pattern})`);
    }
    if (!result.channel_constraints.passed) {
      failures.push(`${name}: ${result.channel_constraints.violations.join("; ")}`);
    }
    if (!result.evidence_cited.passed) {
      const dangling = result.evidence_cited.dangling_references;
      failures.push(
        `${name}: evidence not cited${dangling.length ? ` (dangling: ${dangling.join(", ")})` : ""}`,
      );
    }
  }

  return { passed: failures.length === 0, per_touch, failures };
}

function buildRetryMessage(accountContext: string, previousDraft: any, qa: QaReport): string {
  return [
    `Draft personalized outreach for this account:\n\n${accountContext}`,
    "",
    "Your previous draft failed deterministic QA. Fix the issues and return a full, fresh JSON envelope — do not diff.",
    "",
    "PREVIOUS DRAFT:",
    "```json",
    JSON.stringify(previousDraft, null, 2),
    "```",
    "",
    "QA FAILURES TO ADDRESS:",
    ...qa.failures.map((f) => `- ${f}`),
  ].join("\n");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    // Accept account_id (canonical) and prospect_id (legacy) for back-compat.
    const account_id: string | undefined = body?.account_id ?? body?.prospect_id;
    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", account_id)
      .single();
    if (accountError || !account) {
      throw new Error(`Account not found: ${accountError?.message}`);
    }

    const { data: research } = await supabase
      .from("research_results")
      .select("*")
      .eq("prospect_id", account_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const { data: icpScore } = await supabase
      .from("icp_scores")
      .select("*")
      .eq("prospect_id", account_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const learningsSection = await fetchLearnings(supabase);

    // Prior outreach touches from Notion. Auto-pull so the drafter can
    // reference what's already been said and avoid repeating angles.
    const commsResult = account.notion_page_id
      ? await fetchCommunicationsForAccount(account.notion_page_id, 50)
      : { communications: [], error: "no notion_page_id on account" };
    const commsSection = commsResult.error
      ? `(Could not load prior outreach history: ${commsResult.error})`
      : formatCommunicationsForPrompt(commsResult.communications, 10, 800);

    const accountContext = [
      `Company: ${account.company_name}`,
      account.website ? `Website: ${account.website}` : null,
      research?.research_data ? `Research Intelligence: ${JSON.stringify(research.research_data)}` : null,
      icpScore?.score_data ? `ICP Score Data: ${JSON.stringify(icpScore.score_data)}` : null,
      `=== PRIOR OUTREACH HISTORY (most recent first) ===\n${commsSection}`,
    ].filter(Boolean).join("\n\n");

    const fullSystemPrompt = SYSTEM_PROMPT + learningsSection;

    // First draft.
    const firstUserMessage = `Draft personalized outreach for this account:\n\n${accountContext}`;
    const first = await callClaude(fullSystemPrompt, firstUserMessage, anthropicKey);
    let draft = parseDraftJson(first.text);
    let qa: QaReport = draft
      ? runQaOnDraft(draft)
      : { passed: false, per_touch: {}, failures: ["LLM returned invalid JSON"] };
    let retried = false;
    const usage = { first: first.usage, retry: null as unknown };

    // One retry on QA failure.
    if (!qa.passed) {
      retried = true;
      const retryMessage = buildRetryMessage(accountContext, draft ?? { raw: first.text }, qa);
      const second = await callClaude(fullSystemPrompt, retryMessage, anthropicKey);
      const retryDraft = parseDraftJson(second.text);
      usage.retry = second.usage;
      if (retryDraft) {
        draft = retryDraft;
        qa = runQaOnDraft(retryDraft);
      } else {
        qa.failures.push("retry: LLM returned invalid JSON");
      }
    }

    // Assemble final payload. Attach QA regardless of pass/fail so the caller can see.
    const payload = draft
      ? { ...draft, qa: { ...qa, retried } }
      : { raw_response: first.text, qa: { ...qa, retried } };

    // outreach_drafts.prospect_id is still the column name in the DB (rename deferred to Layer 2).
    const { error: insertError } = await supabase
      .from("outreach_drafts")
      .insert({
        prospect_id: account_id,
        draft_data: payload,
        model_used: MODEL,
        created_at: new Date().toISOString(),
      });
    if (insertError) console.error("Failed to store outreach draft:", insertError);

    await supabase.from("accounts")
      .update({ status: "outreach_drafted" })
      .eq("id", account_id);

    console.info("[outreach-drafter] done", {
      account_id,
      qa_passed: qa.passed,
      retried,
      failures: qa.failures,
      usage,
    });

    return new Response(
      JSON.stringify({ success: true, account_id, data: payload, qa_passed: qa.passed, retried }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
