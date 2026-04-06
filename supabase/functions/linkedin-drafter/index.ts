import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are Aviv Lubell's LinkedIn content strategist for Pathova GTM.

You write thought leadership posts that Aviv publishes on his own LinkedIn. The goal is to attract post-FDA medtech founders who are stuck in pilot purgatory — people who recognize themselves in the content and reach out.

=== AVIV'S VOICE (non-negotiable) ===
- Founder-to-founder. Not advisor-to-founder, not consultant-to-client.
- Commercially sharp. Every sentence earns its place.
- Direct and blunt in a helpful way. No hedging.
- Pattern recognition framing: "Here's what I keep seeing" not "Companies should consider"
- Use "I" not "we". This is Aviv's personal LinkedIn.
- No emoji. No exclamation marks. No flattery.
- No corporate speak: no "leverage", "synergies", "best-in-class", "proven track record", "thought leader"
- Short sentences. Hard stops. Not lists dressed up as paragraphs.

=== THE ICP (who needs to recognize themselves) ===
Post-FDA medtech companies stuck in the pilot-to-paid gap:
- FDA clearance in hand, but commercial traction isn't coming
- Running 3-7 pilots with strong clinical outcomes, zero commercial conversions after 12+ months
- Early wins came through personal relationships — now those are exhausted
- VAC (Value Analysis Committee) approvals stall deals at the committee stage
- Clinical story is strong; commercial story fragments across stakeholders
- Founders are technically excellent but operating without a systematic market access infrastructure

=== CORE THEMES (use these as the intellectual backbone) ===

1. PILOT PURGATORY
The gap between "clinical proof" and "commercial proof" is not a product problem — it's a market access infrastructure problem. Most medtech companies are trying to solve a GTM problem with more clinical evidence.

2. STORY FRAGMENTATION
In hospital sales, your story isn't what you say — it's what the hospital hears after five different stakeholders have touched it. By the time your value prop reaches the CFO, it's unrecognizable.

3. VAC NAVIGATION
VAC committees don't evaluate clinical efficacy. They evaluate cost per outcome, budget implications, implementation risk, strategic fit, and comparison to alternatives. A pitch designed for the clinician will fail at committee.

4. RELATIONSHIP EXHAUSTION
What got you your first 3 wins (warm relationships) won't get you to 20 sites. At some point personal networks run dry and you need a repeatable system.

5. THE BUSINESS CASE vs ROI DISTINCTION
The CFO doesn't want an ROI calculator. They want a business case — which is a different document with a different structure and a different logic.

=== POST STRUCTURE ===
Line 1 (HOOK): Tension, counterintuitive claim, or pattern observation. This must stop the scroll.
  - Good: "Most medtech companies with FDA clearance never get their second customer."
  - Good: "Clinicians love your product. Procurement kills the deal. These are different problems."
  - Bad: "I've been thinking about something important in medtech..."
  - Bad: "Here's what I learned from working with medtech companies:"

Lines 2-3: The "see more" break. First expansion — make them want to click.

Body: The insight. Specific. Grounded. Not generic advice.
  - Reference actual dynamics (VAC structure, hospital procurement timelines, FDA clearance reality)
  - Use specific numbers when possible ("12+ months", "3-7 pilots", "5 stakeholders")
  - Name the pattern, not just the problem

Closing: A question or a call to reflect. Not a CTA to book a call.
  - Good: "Is this what's happening in your pipeline?"
  - Good: "The question isn't whether your technology works. It's whether your commercial infrastructure does."
  - Bad: "Drop a comment below!" or "DM me to learn more"

Hashtags: 3-5 max. Relevant. At the very end, separated by a line break.

=== IF ACCOUNT CONTEXT IS PROVIDED ===
You may be given signals from a specific prospect account (their research data, product category,
FDA status, funding stage). Use these signals to make the content feel timely and specific — but
do NOT name the company. The post should feel like Aviv observed a pattern, not like he's writing
about one specific company. The account context makes it resonant, not targeted.

=== OUTPUT FORMAT ===
Return valid JSON with this exact structure:

{
  "primary_post": {
    "hook": "<line 1 — the scroll-stopper>",
    "body": "<full post text, ready to copy-paste, including hook>",
    "hashtags": ["#medtech", "..."],
    "character_count": 0
  },
  "variant": {
    "hook": "<alternate angle on the same theme>",
    "body": "<full alternate post, ready to copy-paste>",
    "hashtags": ["#medtech", "..."],
    "character_count": 0
  },
  "strategy": {
    "theme_used": "<which core theme this draws on>",
    "why_this_hook": "<why this hook stops the scroll for the ICP>",
    "icp_signals_used": ["<signal 1>", "<signal 2>"],
    "follow_up_angle": "<what to post next to build a thread of thinking>"
  }
}`;

async function fetchLearnings(supabase: any): Promise<string> {
  const { data: learnings, error } = await supabase
    .from("agent_learnings")
    .select("learning_type, content, relevance_tags")
    .eq("active", true)
    .or("applies_to.cs.{linkedin-drafter},applies_to.cs.{*}")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !learnings || learnings.length === 0) return "";

  const grouped: Record<string, string[]> = {};
  for (const l of learnings) {
    if (!grouped[l.learning_type]) grouped[l.learning_type] = [];
    if (grouped[l.learning_type].length < 5) {
      grouped[l.learning_type].push(l.content);
    }
  }

  let section = "\n\n=== LESSONS LEARNED (from previous corrections — follow these strictly) ===";
  for (const [type, items] of Object.entries(grouped)) {
    section += `\n[${type.toUpperCase()}]`;
    for (const item of items) {
      section += `\n- ${item}`;
    }
  }
  return section;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { account_id, topic, post_type = "post" } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch Pathova reference context (company voice, proof assets, ICP methodology)
    const { data: references } = await supabase
      .from("reference_library")
      .select("type, title, content")
      .in("type", ["company_context", "proof_asset", "methodology"])
      .order("created_at", { ascending: false })
      .limit(20);

    // Optionally fetch account data for context-shaping
    let accountContext = "";
    if (account_id) {
      const { data: account } = await supabase
        .from("accounts")
        .select("company_name, product_category, fda_status, funding_stage, employee_count, icp_score_breakdown, research_output, icp_tier, tier")
        .eq("id", account_id)
        .single();

      if (account) {
        const signals = [
          account.product_category ? `Product category: ${account.product_category}` : null,
          account.fda_status ? `FDA status: ${account.fda_status}` : null,
          account.funding_stage ? `Funding stage: ${account.funding_stage}` : null,
          account.employee_count ? `Employee count: ${account.employee_count}` : null,
          account.icp_tier ? `ICP tier: ${account.icp_tier}` : null,
          account.icp_score_breakdown ? `ICP breakdown: ${JSON.stringify(account.icp_score_breakdown)}` : null,
          account.research_output ? `Research signals: ${JSON.stringify(account.research_output).slice(0, 2000)}` : null,
        ].filter(Boolean).join("\n");

        accountContext = `\n\n=== ACCOUNT CONTEXT (shape content around these signals, do not name the company) ===\n${signals}`;
      }
    }

    // Build reference context
    const referenceContext = references && references.length > 0
      ? "\n\n=== PATHOVA REFERENCE CONTEXT ===\n" + references.map((r: any) =>
          `[${r.type.toUpperCase()}] ${r.title}:\n${r.content}`
        ).join("\n\n---\n\n")
      : "";

    const learningsSection = await fetchLearnings(supabase);
    const fullSystemPrompt = SYSTEM_PROMPT + learningsSection;

    const userMessage = [
      topic ? `Topic/angle: ${topic}` : "Draft a thought leadership post on a theme most relevant to the current ICP moment.",
      `Post type: ${post_type}`,
      referenceContext,
      accountContext,
    ].filter(Boolean).join("\n");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: fullSystemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const claudeResponse = await response.json();
    const rawText = claudeResponse.content?.[0]?.text || "";

    let draftData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      draftData = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw_response: rawText };
    } catch {
      draftData = { raw_response: rawText };
    }

    // Compute character counts
    if (draftData.primary_post?.body) {
      draftData.primary_post.character_count = draftData.primary_post.body.length;
    }
    if (draftData.variant?.body) {
      draftData.variant.character_count = draftData.variant.body.length;
    }

    // Save to content_drafts table
    const { error: insertError } = await supabase
      .from("content_drafts")
      .insert({
        account_id: account_id || null,
        topic: topic || null,
        post_type,
        draft_data: draftData,
        model_used: "claude-sonnet-4-20250514",
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error("Failed to store content draft:", insertError);
    }

    return new Response(
      JSON.stringify({ success: true, data: draftData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
