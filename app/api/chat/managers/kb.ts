import type Anthropic from '@anthropic-ai/sdk';
import type { ManagerConfig } from './types';
import { SKILL_INDEX } from '../../../../lib/skills';

const SYSTEM_PROMPT = `You are the KB Manager for Pathova GTM. You manage the knowledge base, reference library, and operational tooling.

The Quarterback Agent delegates tasks to you with a task packet. Execute and return full results.

## Tool Usage

**search_references**: Search the Pathova Reference Library (methodology, proof assets, legal KB, company context, outreach templates, solution/problem frameworks, competitor intel). Use document_type filter to narrow by category.

**search_kb**: Search saved research notes, triage results, intel documents. Filter by document_type and tags. For morning triage results: document_type="research_note", tags=["morning-triage"].

**ingest_to_kb**: Save text to the knowledge base. WRITE TOOL — only call when task instructs "save", "ingest", "add to KB". Required: title, content, document_type.

**process_document**: Process and classify an actual uploaded file before saving. Only for real file uploads, not pasted text.

**load_skill**: Load the full procedure brief for a specialist tool. Available skills: ${Object.keys(SKILL_INDEX).join(', ')}.

**log_agent_run**: Log an agent action for audit trail. Pass account_id for the related company.

**queue_research**: Queue one or more companies for overnight background research. Results land in the KB with tag "auto-research" and surface in the next morning brief. Deduplicates automatically.

## Rules

- Return full search results — don't compress or summarize away document titles, tags, or content snippets.
- For ingest_to_kb, confirm what was saved: title, document_type, and tags used.
- When a tool errors, report the error and tool name explicitly.`;

const TOOLS: Anthropic.Tool[] = [
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
    name: 'search_kb',
    description: 'Search the Pathova knowledge base. Results ordered by most recent first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' },
        document_type: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        created_after: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'ingest_to_kb',
    description: 'Save text to the Pathova knowledge base. WRITE TOOL — only call when task explicitly instructs saving.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        document_type: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        account_id: { type: 'string' },
        source_url: { type: 'string' },
      },
      required: ['title', 'content', 'document_type'],
    },
  },
  {
    name: 'process_document',
    description: 'Process and classify an uploaded file before saving. Use only for real file uploads, not pasted text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        document_text: { type: 'string' },
        document_type: { type: 'string' },
        account_id: { type: 'string' },
        intent: { type: 'string' },
      },
      required: ['document_text'],
    },
  },
  {
    name: 'load_skill',
    description: `Load the full procedure brief for a specialist tool. Available skills: ${Object.keys(SKILL_INDEX).join(', ')}.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        skill: { type: 'string', description: 'Skill name: prospect-researcher | icp-scorer | risk-assessor | outreach-drafter' },
      },
      required: ['skill'],
    },
  },
  {
    name: 'log_agent_run',
    description: 'Log an agent action for the audit trail.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string' },
        action_type: { type: 'string' },
        decision_mode: { type: 'string' },
        context_score: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
  {
    name: 'queue_research',
    description: 'Queue companies for overnight background research. Results surface in the next morning brief. Deduplicates automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        companies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Company names to queue (max 20)',
        },
        triggered_by: { type: 'string', description: '"manual", "icp_trigger", or "industry_news"' },
      },
      required: ['companies'],
    },
  },
];

export const KB_MANAGER: ManagerConfig = {
  systemPrompt: SYSTEM_PROMPT,
  tools: TOOLS,
  maxRounds: 6,
};
