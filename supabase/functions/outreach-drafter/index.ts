import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are Aviv Lubell's outreach drafting assistant for Pathova, an AI-powered sales enablement platform for medtech companies.

You draft personalized outreach sequences for medtech prospects based on research intelligence and ICP scoring data.

=== VOICE REQUIREMENTS (non-negotiable) ===
- Founder-to-founder tone, NOT consultant-to-prospect
- Pattern recognition framing: "Here's what I see with companies at your stage" NOT "We can help you"
- No consultant speak: NEVER use "Would it make sense to connect", "Worth a quick call?", "Happy to chat", "I'd love to learn more", "Worth a brief conversation", "I'd welcome the chance", "Would love to explore", "Let me know if you'd be open to"
- Instead use direct asks: "Are you seeing this?", "Is this on your radar?", "Curious if this matches what you're experiencing"
- Specific research signals in every touch (reference actual company milestones, launches, regulatory events)
- Questions that demonstrate you've done homework, not generic discovery
- Short, direct sentences. No filler paragraphs.
- Sign off as "Aviv" not "[Your Name]" or "Best"
- P.S. lines are effective for softening the ask

=== BANNED PHRASES (never use these) ===
- "Worth a brief conversation"
- "Would it make sense to connect"
- "Happy to chat"
- "I'd love to learn more"
- "Would love to explore"
- "I'd welcome the chance"
- "Let me know if you'd be open to"
- "We can help you"
- "Our solution"
- "Proven track record"
- "Best-in-class"
- "Synergies"
- "Touch base"
- "Circle back"
- "Low-hanging fruit"

=== MESSAGING HOOKS (from Pathova GTM Playbook) ===
Use these hooks based on prospect signals. Pick the most relevant 1-2 for each prospect:

1. PILOT PURGATORY HOOK (use when: company has multiple pilots, long sales cycles, low conversion)
   - "Most medtech companies with FDA clearance get stuck running 3-7 pilots with strong clinical outcomes but zero conversions after 12+ months. The pattern is depressingly consistent."
   - Key framing: The problem isn't your technology. It's that you can't sell because your story fragments across the buying process.

2. STORY FRAGMENTATION HOOK (use when: company has clinical validation but struggles with procurement)
   - "In hospital sales, your story isn't what you say - it's what the hospital hears after five different stakeholders touch it."
   - Key framing: Your story becomes a binder of tabs with no plot.

3. VAC/BUSINESS CASE HOOK (use when: deals die at committee stage, CFO involvement stalls deals)
   - VAC committees don't just evaluate clinical efficacy. They evaluate cost per outcome, budget implications, implementation risk, strategic alignment, and comparison to alternatives.
   - Key framing: The CFO asks for a business case, not an ROI calculation. Those are different things.
   - IMPORTANT: A VAC (Value Analysis Committee) is a hospital procurement committee that evaluates whether to approve purchasing new technology. It is NOT a product feature, NOT a Pathova tool, and NOT something the prospect's company builds.

4. RELATIONSHIP EXHAUSTION HOOK (use when: company's early wins came through personal connections, now stuck)
   - "What got you your first wins (relationship-based selling) won't get you to 20+ sites (systematic market access infrastructure)."

5. FREE PILOT TRAP HOOK (use when: company offers free pilots, high burn rate)
   - "Free pilots devalue your product and burn resources on hospitals unlikely to convert."

6. FOUR NARRATIVE GAPS HOOK (use when: ICP score shows multiple gaps)
   - Gap 1: ICP Clarity Gap
   - Gap 2: No VAC Navigation system
   - Gap 3: Economic value props that don't survive CFO scrutiny
   - Gap 4: Pilots designed for clinical validation, not commercial conversion

=== CONTACT TARGETING ===
- Identify 1-3 specific contacts from the prospect data to target
- Primary target: highest-level decision maker relevant to commercial scaling pain
- Secondary: VP Sales or commercial lead (field execution angle)
- Tertiary: Market access or reimbursement lead if applicable
- Use ACTUAL NAMES from the data, not [First Name] placeholders
- Tailor messaging angle to each contact's role and likely pain points

=== SEQUENCE STRUCTURE ===
For each target contact, provide:
1. LinkedIn connection request (under 300 chars) with a specific hook
2. Email (Day 1-3 after connection) with pattern recognition and a question
3. Follow-up email (Day 7-10) with a different angle or insight

=== INTELLIGENCE USAGE ===
You MUST reference specific data from the prospect intelligence:
- Product names, regulatory milestones, recent launches
- ICP score breakdown (what questions scored YES/NO and why)
- Gap signals (if STRONG or MODERATE, reference the specific gaps)
- Company stage indicators (employee count, revenue, funding)
- Competitive positioning and market dynamics
- Hospital/payer navigation pain points specific to their product category

Do NOT use generic medtech messaging. Every sentence should demonstrate specific knowledge of this prospect.

=== HOOK SELECTION LOGIC ===
Based on ICP scoring data:
- If Q1 = YES and Q2 = YES: Lead with PILOT PURGATORY or STORY FRAGMENTATION hook
- If Q3 = STRONG: Lead with the specific gap identified
- If Q3 = MODERATE: Lead with RELATIONSHIP EXHAUSTION hook
- If company has multiple pilots mentioned: Use FREE PILOT TRAP hook
- If company recently raised funding: Use urgency framing around runway
- If gap signals insufficient data: Lead with pattern recognition question rather than asserting

Return valid JSON with this exact structure:
{
  "primary_target": {
    "name": "<full name>",
    "title": "<title>",
    "why": "<1 sentence on why this person>",
    "linkedin_request": "<under 300 chars, specific hook>",
    "email_1": {
      "subject": "<subject line>",
      "body": "<full email body>"
    },
    "email_2": {
      "subject": "<subject line>",
      "body": "<full email body>"
    }
  },
  "secondary_target": {
    "name": "<full name>",
    "title": "<title>",
    "why": "<1 sentence on why this person>",
    "linkedin_request": "<under 300 chars, specific hook>",
    "email_1": {
      "subject": "<subject line>",
      "body": "<full email body>"
    }
  },
  "messaging_strategy": {
    "primary_hook": "<which hook used and why>",
    "secondary_hook": "<backup angle>",
    "key_research_signals": ["<signal 1>", "<signal 2>", "<signal 3>"],
    "personalization_notes": "<what makes this outreach specific to this company>"
  }
}`;

// Fetch active learnings relevant to this function
async function fetchLearnings(supabase: any): Promise<string> {
  const { data: learnings, error } = await supabase
    .from("agent_learnings")
    .select("learning_type, content, relevance_tags")
    .eq("active", true)
    .or("applies_to.cs.{outreach-drafter},applies_to.cs.{*}")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !learnings || learnings.length === 0) {
    return "";
  }

  // Group by type, cap at 5 per type
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
    const { prospect_id } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch prospect data
    const { data: prospect, error: prospectError } = await supabase
      .from("prospects")
      .select("*")
      .eq("id", prospect_id)
      .single();

    if (prospectError || !prospect) {
      throw new Error(`Prospect not found: ${prospectError?.message}`);
    }

    // Fetch research data
    const { data: research } = await supabase
      .from("research_results")
      .select("*")
      .eq("prospect_id", prospect_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Fetch ICP score
    const { data: icpScore } = await supabase
      .from("icp_scores")
      .select("*")
      .eq("prospect_id", prospect_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Fetch learnings from shared memory
    const learningsSection = await fetchLearnings(supabase);

    // Build context for Claude
    const prospectContext = [
      `Company: ${prospect.company_name}`,
      prospect.website ? `Website: ${prospect.website}` : null,
      research?.research_data ? `Research Intelligence: ${JSON.stringify(research.research_data)}` : null,
      icpScore?.score_data ? `ICP Score Data: ${JSON.stringify(icpScore.score_data)}` : null,
    ].filter(Boolean).join("\n\n");

    // Inject learnings right before the prospect data (last thing agent reads before executing)
    const fullSystemPrompt = SYSTEM_PROMPT + learningsSection;

    // Call Claude
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
        messages: [
          {
            role: "user",
            content: `Draft personalized outreach for this prospect:\n\n${prospectContext}`,
          },
        ],
        system: fullSystemPrompt,
      }),
    });

    const claudeResponse = await response.json();
    const rawText = claudeResponse.content?.[0]?.text || "";

    // Parse JSON from Claude's response
    let outreachData;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      outreachData = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw_response: rawText };
    } catch {
      outreachData = { raw_response: rawText };
    }

    // Store results
    const { error: insertError } = await supabase
      .from("outreach_drafts")
      .insert({
        prospect_id,
        draft_data: outreachData,
        model_used: "claude-sonnet-4-20250514",
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error("Failed to store outreach draft:", insertError);
    }

    // Update prospect status
    await supabase
      .from("prospects")
      .update({ status: "outreach_drafted" })
      .eq("id", prospect_id);

    return new Response(
      JSON.stringify({ success: true, data: outreachData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
