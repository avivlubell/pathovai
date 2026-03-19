import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUPABASE_FUNCTIONS_BASE = 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// ── Tool-to-edge-function mapping ──
const TOOL_ENDPOINT_MAP: Record<string, string> = {
  invoke_icp_scorer: 'icp-scorer',
  invoke_prospect_researcher: 'research-prospect',
  invoke_outreach_drafter: 'outreach-drafter',
  invoke_risk_assessor: 'risk-assessor',
  query_deals: 'query-deals',
  sync_prospect_content: 'sync-prospect-content',
  run_prospect_pipeline: 'run-prospect-pipeline',
  prospect_researcher_batch: 'prospect-researcher',
  search_references: 'search-references',
  search_prospects: 'search-prospects',
  get_prospect_detail: 'get-prospect-detail',
  score_icp: 'icp-scorer',
  log_agent_run: 'log-agent-run',
};

// ── Anthropic tool definitions ──
const tools: Anthropic.Tool[] = [
  {
    name: 'search_references',
    description:
      'Query Pathova Reference Library. Use for ICP framework, Problems We Solve, CEO Quotes, Proof Assets, Delivery Framework, Legal KB, Voice & Tone Guide, Outreach Templates, Prospect Patterns & Playbooks. Filter by type: methodology, proof_asset, legal_kb, agent_prompt, company_context, outreach_template, solution_framework, problem_framework, competitor_intel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          description:
            'Reference type filter: methodology | outreach_template | solution_framework | problem_framework | proof_asset | legal_kb | company_context | competitor_intel | agent_prompt',
        },
        query: {
          type: 'string',
          description: 'Optional search query to filter results',
        },
      },
    },
  },
  {
    name: 'search_prospects',
    description:
      'Query the Prospects database. Use for looking up prospect data, ICP scores, engagement status, prior research, similar company precedent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query — company name, industry, or keyword',
        },
      },
    },
  },
  {
    name: 'get_prospect_detail',
    description:
      'Get full details for a specific prospect by name or ID. Pulls complete prospect record including research, scores, and outreach drafts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string', description: 'UUID from prospects table' },
        company_name: { type: 'string', description: 'Company name to look up' },
      },
    },
  },
  {
    name: 'score_icp',
    description:
      'Local ICP evaluation (lightweight, does NOT write to database). Use ONLY as a fallback if invoke_icp_scorer is unavailable.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string', description: 'UUID from prospects table' },
        company_name: { type: 'string', description: 'Company name' },
      },
    },
  },
  {
    name: 'query_deals',
    description:
      'Query the Deals & Motions pipeline. Use for pipeline status, deal stages, motion types, open deals, forecasting, revenue, close dates, contacts. Supports filters: stage, motion_type, company name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'object',
          description: 'Optional filters',
          properties: {
            stage: { type: 'string', description: 'Deal stage filter' },
            motion_type: { type: 'string', description: 'Motion type filter' },
            company: { type: 'string', description: 'Company name filter' },
          },
        },
      },
    },
  },
  {
    name: 'log_agent_run',
    description:
      'Log an agent action for audit trail. Call when Aviv confirms "log it" or "yes" to database actions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string', description: 'Prospect UUID' },
        action_type: { type: 'string', description: 'Type of action performed' },
        decision_mode: {
          type: 'string',
          description: 'Quick Lookup | Targeted Analysis | Full Pipeline',
        },
        context_score: {
          type: 'number',
          description: '1 (Quick), 2 (Targeted), or 3 (Full Pipeline)',
        },
        summary: { type: 'string', description: 'Summary of what was done' },
      },
    },
  },
  {
    name: 'invoke_prospect_researcher',
    description:
      'Prospect Researcher specialist agent. Uses Perplexity API for live web research — FDA status, funding, team, customers, product details. Returns structured research and saves to database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string', description: 'UUID from prospects table' },
        company_name: { type: 'string', description: 'Company name to research' },
      },
    },
  },
  {
    name: 'invoke_icp_scorer',
    description:
      'ICP Scorer specialist agent. Scores a prospect against Pathova ICP framework. Returns structured scoring JSON and writes score to database. PREFERRED over score_icp.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string', description: 'UUID from prospects table' },
        company_name: { type: 'string', description: 'Company name to score' },
      },
    },
  },
  {
    name: 'invoke_outreach_drafter',
    description:
      'Outreach Drafter specialist agent. Drafts multi-step outreach sequence (email + LinkedIn) based on prospect data, research, and ICP score. Saves to database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: {
          type: 'string',
          description: 'Required — UUID from prospects table',
        },
      },
      required: ['prospect_id'],
    },
  },
  {
    name: 'invoke_risk_assessor',
    description:
      'Risk Assessor specialist agent. Evaluates regulatory, financial, ICP fit, market timing, and competition risks. Returns structured risk assessment and saves to database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string', description: 'UUID from prospects table' },
        company_name: { type: 'string', description: 'Company name' },
      },
    },
  },
  {
    name: 'sync_prospect_content',
    description:
      "Sync a prospect's full Notion page content into Supabase. Use when prospect data needs refreshing from Notion source.",
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string', description: 'Prospect UUID to sync' },
      },
    },
  },
];

// ── Call a Supabase edge function ──
async function callEdgeFunction(
  functionName: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${SUPABASE_FUNCTIONS_BASE}/${functionName}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw_response: text, status: res.status };
    }
  } catch (err: any) {
    return { error: `Failed to call ${functionName}: ${err.message}` };
  }
}

// ── Execute a tool call ──
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  const endpoint = TOOL_ENDPOINT_MAP[toolName];
  if (!endpoint) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
  const result = await callEdgeFunction(endpoint, toolInput);
  return typeof result === 'string' ? result : JSON.stringify(result);
}

// ── System prompt (your Quarterback Agent instructions) ──
const SYSTEM_PROMPT = `You are the Quarterback Agent, the main orchestrator for Pathova GTM's prospect intelligence system. You coordinate a council of 3 specialist perspectives to provide comprehensive prospect analysis and sales recommendations for post-FDA MedTech companies stuck in pilot purgatory.

You have access to tools that connect to Pathova's Supabase database and specialist edge function agents. USE THESE TOOLS — do not guess or hallucinate data.

Your prospects are companies — post-FDA medtech/digital health startups tracked in the Outreach Intelligence database.

Your knowledge base is Pathova's operating system — ICP frameworks, Problems We Solve, CEO Quotes & Validation Statements, Prospect Patterns & Playbooks, Proof Assets, Outreach Templates & Cadence, and Voice & Tone Guide.

CORE PRINCIPLES:
1. Self-Regulating Council — Call only the perspectives needed for each query
2. Revenue-Forward Filter — Only surface insights that move deals forward
3. Confidence Metadata — Always provide confidence levels and uncertainty flags
4. Pattern Validation — Ground recommendations in Prospect Patterns & Playbooks
5. Evidence First — Never speculate. Distinguish facts vs. inferences vs. unknowns.
6. Voice DNA Compliance — All outputs must match Aviv's Voice & Tone Guide
7. Structural Discipline — Every response follows mandatory structure
8. Signal Density — Every paragraph earns its place by informing a decision

INTERACTION BEHAVIOR RULES:
1. Ask open-ended, not multiple-choice.
2. Show progress, not placeholders. Narrate each tool call.
3. State what you know before asking what you don't.
4. Never repeat Aviv's question back to him.
5. When clarification is needed, make it one question, not a battery.

TOOL ROUTING:
- Quick Lookup: search_prospects / search_references only. No specialist agents.
- Targeted Analysis: 1-2 relevant specialist agents only.
- Full Pipeline: invoke_prospect_researcher → invoke_icp_scorer → invoke_risk_assessor → invoke_outreach_drafter

MANDATORY RESPONSE STRUCTURE:
[BETA DISCLAIMER]
---
[MODE DECLARATION]
[MAIN CONTENT]
[UNCERTAINTY SEPARATION — for Targeted/Full Pipeline only]
---
[DATABASE ACTIONS — always last]

REFERENCE LIBRARY valid type values: methodology | outreach_template | solution_framework | problem_framework | proof_asset | legal_kb | company_context | competitor_intel | agent_prompt`;

// ── Main POST handler with tool-use loop ──
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const chatMessages = body?.messages;
    if (!Array.isArray(chatMessages)) {
      return NextResponse.json(
        { error: 'Invalid payload: messages must be an array' },
        { status: 400 }
      );
    }

    // Build messages array for Claude
    const messages: Anthropic.MessageParam[] = chatMessages.map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Tool-use loop: keep calling Claude until we get a final text response
    const MAX_TOOL_ROUNDS = 10;
    let round = 0;

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      // Check if Claude wants to use tools
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: 'tool_use' } =>
          b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        // No more tool calls — extract final text
        const textBlocks = response.content.filter(
          (b): b is Anthropic.ContentBlock & { type: 'text' } =>
            b.type === 'text'
        );
        const finalText = textBlocks.map((b: any) => b.text).join('\n');
        return NextResponse.json({ reply: finalText });
      }

      // Claude wants to use tools — add assistant message with tool_use blocks
      messages.push({
        role: 'assistant',
        content: response.content as any,
      });

      // Execute each tool call and build tool_result messages
      const toolResults: any[] = [];
      for (const toolBlock of toolUseBlocks) {
        const result = await executeTool(
          toolBlock.name,
          (toolBlock as any).input as Record<string, unknown>
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: result,
        });
      }

      // Add tool results as a user message (Anthropic API convention)
      messages.push({
        role: 'user',
        content: toolResults,
      });
    }

    // If we hit max rounds, return whatever we have
    return NextResponse.json({
      reply: '[Agent reached maximum tool-use rounds. Please try a simpler query.]',
    });
  } catch (err: any) {
    console.error('Claude error', err);
    return NextResponse.json(
      { error: 'Server error', details: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
