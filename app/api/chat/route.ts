export const maxDuration = 300;
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './system-prompt';
import { gmailTool, executeGmailTool } from './gmail-tools';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUPABASE_FUNCTIONS_BASE = 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const TOOL_ENDPOINT_MAP: Record<string, string> = {
  invoke_icp_scorer: 'icp-scorer',
    invoke_prospect_researcher: 'prospect-researcher',
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
    process_document: 'process-document',
  ingest_to_kb: 'ingest-to-kb',
};

const tools: Anthropic.Tool[] = [
  {
    name: 'search_references',
    description: 'Query Pathova Reference Library. Filter by type: methodology, proof_asset, legal_kb, agent_prompt, company_context, outreach_template, solution_framework, problem_framework, competitor_intel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Reference type filter' },
        query: { type: 'string', description: 'Optional search query' },
      },
    },
  },
  {
    name: 'search_prospects',
    description: 'Query the Prospects database for prospect data, ICP scores, engagement status, prior research.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query -- company name, industry, or keyword' },
      },
    },
  },
  {
    name: 'get_prospect_detail',
    description: 'Get full details for a specific prospect by name or ID.',
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
    description: 'Local ICP evaluation (fallback only -- prefer invoke_icp_scorer).',
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
    description: 'Query the Deals & Motions pipeline. Supports filters: stage, motion_type, company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'object',
          description: 'Optional filters',
          properties: {
            stage: { type: 'string' },
            motion_type: { type: 'string' },
            company: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'log_agent_run',
    description: 'Log an agent action for audit trail.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string' },
        action_type: { type: 'string' },
        decision_mode: { type: 'string' },
        context_score: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
  {
    name: 'invoke_prospect_researcher',
    description: 'Prospect Researcher specialist agent. Uses Perplexity API for live web research.',
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
    description: 'ICP Scorer specialist agent. Scores prospect against Pathova ICP framework. Writes to database.',
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
    description: 'Outreach Drafter specialist agent. Drafts multi-step outreach sequence.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string', description: 'Required -- UUID from prospects table' },
      },
      required: ['prospect_id'],
    },
  },
  {
    name: 'invoke_risk_assessor',
    description: 'Risk Assessor specialist agent. Evaluates regulatory, financial, ICP fit, market timing risks.',
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
    description: 'Sync a prospect full Notion page content into Supabase.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'string', description: 'Prospect UUID to sync' },
      },
    },
  },
      {
    name: 'process_document',
    description: 'Process and classify a document for intent-first handling. Determines document type (case_study, white_paper, battle_card, roi_calculator, clinical_summary, regulatory_brief, email_sequence, call_script, objection_handler, competitive_analysis) and generates intent-aligned content with we-framing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        document_text: { type: 'string', description: 'Raw document text to process' },
        document_type: { type: 'string', description: 'Optional: override auto-classification with specific doc type' },
        prospect_id: { type: 'string', description: 'Optional: prospect UUID for context' },
        intent: { type: 'string', description: 'User intent or goal for the document' },
      },
      required: ['document_text'],
    },
  },
  {
    name: 'ingest_to_kb',
    description: 'Save a processed document to the Pathova knowledge base. Stores document with metadata, type classification, and vector embeddings for retrieval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Processed document content' },
        document_type: { type: 'string', description: 'Classification: case_study, white_paper, battle_card, etc.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for categorization' },
        prospect_id: { type: 'string', description: 'Optional: linked prospect UUID' },
        source_url: { type: 'string', description: 'Optional: original source URL' },
      },
      required: ['title', 'content', 'document_type'],
    },
  },
gmailTool,
];

async function callEdgeFunction(
  functionName: string,
  body: Record<string, unknown>,
  retries = 2
): Promise<unknown> {
  const url = `${SUPABASE_FUNCTIONS_BASE}/${functionName}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
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
      // Retry on rate limit
      if (res.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      try {
        return JSON.parse(text);
      } catch {
        return { raw_response: text, status: res.status };
      }
    } catch (err: any) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      return { error: `Failed to call ${functionName}: ${err.message}` };
    }
  }
}

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

// Helper: extract human-readable reply from QB JSON envelope or plain text
function extractReply(finalText: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(finalText);
  } catch {
    // Not JSON — return plain text directly (conversational turn)
    return finalText;
  }

  // If it's a JSON envelope, extract the readable content
  const content = parsed?.content;
  if (content) {
    const parts: string[] = [];
    if (content.beta_disclaimer) parts.push(content.beta_disclaimer);
    if (content.mode_declaration) parts.push(content.mode_declaration);
    if (content.main_content) parts.push(content.main_content);

    const unc = content.uncertainty_separation;
    if (unc) {
      if (Array.isArray(unc.what_we_know) && unc.what_we_know.length > 0) {
        parts.push('**What We Know (Verified)**');
        unc.what_we_know.forEach((item: string) => parts.push(`- ${item}`));
      }
      if (Array.isArray(unc.what_were_inferring) && unc.what_were_inferring.length > 0) {
        parts.push("**What We're Inferring**");
        unc.what_were_inferring.forEach((item: string) => parts.push(`- ${item}`));
      }
      if (Array.isArray(unc.what_we_dont_know) && unc.what_we_dont_know.length > 0) {
        parts.push("**What We Don't Know (Gaps)**");
        unc.what_we_dont_know.forEach((item: string) => parts.push(`- ${item}`));
      }
    }

    if (content.database_actions) parts.push('---\n' + content.database_actions);

    if (parts.length > 0) return parts.join('\n\n');
  }

  // Fallback: if parsed but no content field, stringify it
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
}

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
      const accessToken = body?.accessToken;

    const messages: Anthropic.MessageParam[] = chatMessages.map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

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

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: 'tool_use' } =>
          b.type === 'tool_use'
      );

      // Only process tool calls if there ARE tool_use blocks AND stop_reason is tool_use
      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        const textBlocks = response.content.filter(
          (b): b is Anthropic.ContentBlock & { type: 'text' } =>
            b.type === 'text'
        );
        const finalText = textBlocks.map((b: any) => b.text).join('\n');

        // Extract readable reply from JSON envelope or plain text
        const reply = extractReply(finalText);
        return NextResponse.json({ reply });
      }

      messages.push({
        role: 'assistant',
        content: response.content as any,
      });

      const toolResults: any[] = [];
      for (const toolBlock of toolUseBlocks) {
                const gmailResult = await executeGmailTool(toolBlock.name, (toolBlock as any).input, accessToken);
          const result = gmailResult !== null ? gmailResult : await executeTool(
          toolBlock.name,
          (toolBlock as any).input as Record<string, unknown>
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: result,
        });
      }

      messages.push({
        role: 'user',
        content: toolResults,
      });
    }

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
