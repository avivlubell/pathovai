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
"circle back", "circling back", "touching base", "touch base", "synergy", "synergies", "quick question", "quick chat", "quick sync", "hope this finds you well", "hope you're doing well", "leverage", "game-changer", "reach out", "thought leader", "best-in-class", "move the needle", "worth a brief conversation", "worth connecting", "would it make sense to connect", "happy to chat", "I'd love to learn more", "would love to explore", "I'd welcome the chance", "let me know if you'd be open to", "we can help you", "our solution", "proven track record", "low-hanging fruit".

=== ILLUSTRATIVE vs. CITED DATA ===
Pattern statements that describe industry tendencies are welcome and are a core part of the Keenan/Donovan-style provocation we use ("Most medtech companies at your stage run 3-7 pilots with zero conversions after 12 months"). They are frames, not benchmarks.

What is NOT allowed inside a draft going to a prospect:
- Specific fabricated customer outcomes presented as fact ("Company X hit 3 of 7 pilots converted in 6 months") unless that outcome came from a verified proof asset in the account/KB context.
- Numeric claims about the prospect themselves that aren't in the evidence array (e.g. invented CAC, runway, headcount, conversion rates).
- Statistics attributed to named third parties (McKinsey, KLAS, etc.) unless present in the evidence or KB context.

Rule of thumb: industry patterns = OK. Specific named outcomes = must be cited evidence. When in doubt, phrase as a pattern ("the typical pattern is…") rather than a claim ("our client hit…").

=== FOUNDER LEVERAGE FRAMING ===
Pathova scales the founder; it does not replace them. The founder stays in the room. What changes is that the tribal knowledge in founder/exec heads gets codified so the rest of the team can run the same play.

- Preferred phrasing in body: "scale what the founder already does", "codify the playbook that's working", "the next hire can run the play you built".
- Banned in body text: "without the founder in the room", "founder-independent", "replace the founder", "acquire customers without you in every deal", pejorative uses of "founder-dependent".
- OK in a P.S. line or the \`messaging_strategy.positioning_angle\` field: naming the concept as "democratize the tribal knowledge in exec heads." Keep it a frame, not a bullet-point pitch.
- **The founder is not the ceiling; the uncodified playbook is.** Do not frame the founder (their time, bandwidth, presence, or involvement) as the growth bottleneck. The ceiling is that the playbook driving wins hasn't been extracted from exec heads into something the team can run. Say "growth is capped by what hasn't been codified yet" — not "growth is capped by founder bandwidth."

If the chosen hook is FOUNDER_LED_CEILING, this framing matters most — the fix is systematizing what the founder does, not excluding them.

=== DIAGNOSTIC RIGOR ===
Three checks to run before writing:

1. **Confidence calibration.** Set PIC \`confidence\` based on whether the evidence *directly* supports the premise the chosen hook depends on.
   - \`high\`: evidence in the prospect context (research, comms, past interactions) directly confirms the premise. Example: hook is PILOT_PURGATORY and evidence array lists 5 active pilots with no conversions.
   - \`medium\`: premise is plausible given adjacent evidence but not directly confirmed. Example: hook is FREE_PILOT_TRAP, evidence shows EU traction + a US pilot at Providence, but nothing confirms the US pilots are unpaid. Flag this in \`personalization_notes\`: "Hook X is used as an investigative probe — premise not yet confirmed by evidence."
   - \`low\`: choosing a hook against contradictory or near-zero evidence. Reconsider hook selection.
   Default to \`medium\` when in doubt. \`high\` is earned by evidence, not by confidence in the framing.

2. **Patterns, not benchmarks.** When citing industry stats or tendencies, phrase as a pattern, never a benchmark.
   - OK: "the typical pattern is single-digit pilot-to-contract conversion", "most companies at this stage see 12-24 month cycles", "three of seven pilots converting is roughly the pattern we see".
   - NOT OK: "conversion rates are 15%", "the math is brutal: $50K pilots at 15% conversion", "industry conversion is 12%".
   Numeric industry claims read as verified benchmarks even when the intent is illustrative. If you want to anchor with a number, introduce it with "typically", "roughly", "the pattern we keep seeing is around…" so the reader cannot mistake it for a cited stat.

3. **No unfired-gun urgency.** Do not invoke urgency triggers (funding timeline, runway, board pressure, Series B, investor pressure) without naming the specific trigger from the evidence.
   - NOT OK: "the funding timeline makes this urgent", "given your runway this matters", "your board is watching".
   - OK only when the evidence array contains the specific trigger: "your Series B timing means…", "with 14 months of runway reported in [source]…", "the October board update mentioning commercial traction…".
   If the evidence does not name the trigger, delete the line. A vague urgency P.S. is worse than no P.S. at all.

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

4. FOUNDER_LED_CEILING HOOK — use when early wins came through personal connections and the founder-led model has hit a scalability ceiling.
   "What got you your first wins (relationship-based selling) won't get you to 20+ sites (systematic market access infrastructure)."

5. FREE PILOT TRAP HOOK — use when the company offers free pilots with high burn.
   "Free pilots devalue your product and burn resources on hospitals unlikely to convert."

6. FOUR NARRATIVE GAPS HOOK — use when ICP scoring shows multiple gaps.
   Gap 1: ICP Clarity. Gap 2: No VAC Navigation system. Gap 3: Economic value props that don't survive CFO scrutiny. Gap 4: Pilots designed for clinical validation, not commercial conversion.

Hook selection logic (guidance, not rules):
- Q1=YES and Q2=YES → PILOT PURGATORY or STORY FRAGMENTATION
- Q3=STRONG → lead with the specific gap identified
- Q3=MODERATE → FOUNDER_LED_CEILING
- Multiple pilots mentioned → FREE PILOT TRAP
- Recently raised funding → urgency framing around runway

=== PRIOR OUTREACH HISTORY ===
The account context includes a "PRIOR OUTREACH HISTORY" section pulled live from Notion. Each touch is tagged with an \`angles_used\` line listing heuristically detected hooks (e.g. PILOT_PURGATORY, VAC_BUSINESS_CASE, EU_US_PROCUREMENT_GAP, PROVIDENCE_HOOK, FUNDING_TIMELINE_URGENCY, POST_FDA_CONVERSION_WALL). A summary line \`SEQUENCE-LEVEL ANGLES ALREADY USED\` aggregates them for the whole sequence.

Before drafting, read it. It tells you:
- Who has already been contacted at this account and on which channel.
- Which angles/hooks have already been sent (via the tags).
- What outcomes came back (if marked).

Rules for using the history:
1. **Do not reuse any hook listed in SEQUENCE-LEVEL ANGLES ALREADY USED.** Pick a genuinely different hook from the MESSAGING HOOKS list, or a materially new angle. Rephrasing the same angle in new words counts as reuse — the prospect already saw that frame and chose not to respond.
2. **Specific named anchors count as hooks.** If PROVIDENCE_HOOK is flagged, do not lead with Providence again. If POST_FDA_CONVERSION_WALL is flagged, do not open with "5-6 months post-FDA" framing again.
3. **If the last 3+ touches used overlapping angles and got no response, the angle is exhausted.** Switch to a structurally different hook (e.g. from pattern-diagnosis hooks to VAC_BUSINESS_CASE or FREE_PILOT_TRAP).
4. **Reference prior touches naturally only when opening a thread** ("Following up on my April 2 note…") — and only if that prior touch was SENT.
5. **Change target person only after the primary target has gone cold across multiple touches.** Prefer sticking with the original target and diversifying angle first; pivot targets as a last resort, not a first move.
6. **In \`messaging_strategy.personalization_notes\`:** list the used hooks you explicitly avoided and the new hook you selected, with one sentence on why the new one is a real pivot (not a rephrase).

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

function companyNamesMatch(expected: string, actual: string): boolean {
  const tokenize = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["inc", "llc", "ltd", "corp", "the", "and", "for"].includes(w));
  const a = tokenize(expected);
  const b = tokenize(actual);
  if (a.length === 0 || b.length === 0) return true; // can't check, don't block
  const bSet = new Set(b);
  return a.some((t) => bSet.has(t));
}

function runQaOnDraft(draft: any, expectedCompanyName: string): QaReport {
  const picLite: PICLite = {
    evidence: Array.isArray(draft?.pic?.evidence) ? draft.pic.evidence : [],
  };
  const per_touch: QaReport["per_touch"] = {};
  const failures: string[] = [];

  const draftedCompany: string = draft?.pic?.account?.name ?? "";
  if (draftedCompany && !companyNamesMatch(expectedCompanyName, draftedCompany)) {
    failures.push(
      `company_mismatch: draft is for "${draftedCompany}" but account is "${expectedCompanyName}" — discard this output, do not show to user`,
    );
  }

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
      ? runQaOnDraft(draft, account.company_name)
      : { passed: false, per_touch: {}, failures: ["LLM returned invalid JSON"] };
    let retried = false;
    const usage = { first: first.usage, retry: null as unknown };

    // One retry on QA failure — but not for company mismatch, which retrying won't fix.
    const hasCompanyMismatch = qa.failures.some((f) => f.startsWith("company_mismatch:"));
    if (!qa.passed && !hasCompanyMismatch) {
      retried = true;
      const retryMessage = buildRetryMessage(accountContext, draft ?? { raw: first.text }, qa);
      const second = await callClaude(fullSystemPrompt, retryMessage, anthropicKey);
      const retryDraft = parseDraftJson(second.text);
      usage.retry = second.usage;
      if (retryDraft) {
        draft = retryDraft;
        qa = runQaOnDraft(retryDraft, account.company_name);
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
