import type Anthropic from '@anthropic-ai/sdk';

const TASK_PACKET_SCHEMA = {
  type: 'object' as const,
  properties: {
    task: {
      type: 'string',
      description: 'Specific task to perform, written as a clear instruction.',
    },
    company_name: {
      type: 'string',
      description: 'Target company name (if applicable).',
    },
    user_intent: {
      type: 'string',
      description: 'One sentence: what the user actually wants to accomplish. Compress the relevant session context here.',
    },
    established_facts: {
      type: 'array',
      items: { type: 'string' },
      description: 'Facts already confirmed this session that the manager should know (e.g. "account_id is abc-123", "ICP tier is Tier 1 Priority").',
    },
    focus_areas: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific areas to focus on (e.g. "FDA clearance status", "recent funding", "outreach history").',
    },
  },
  required: ['task', 'user_intent'],
};

export const delegateTools: Anthropic.Tool[] = [
  {
    name: 'delegate_research',
    description:
      'Delegate a research task to the Research Manager. Use for: Perplexity company research, FDA lookups, clinical trials, ICD-10 codes, CMS coverage, ICP trigger feed, market intelligence briefings, hiring signals, podcast insights, and cross-source signal synthesis. The manager handles fetch_gap_content automatically after prospect research.',
    input_schema: TASK_PACKET_SCHEMA,
  },
  {
    name: 'delegate_crm',
    description:
      'Delegate to the CRM Manager to read or write internal account data. Use for: account/contact lookups, deal pipeline queries, outreach touch history, creating/updating accounts or contacts, and Gmail/Drive/Calendar access.',
    input_schema: TASK_PACKET_SCHEMA,
  },
  {
    name: 'delegate_qualify',
    description:
      'Delegate to the Qualification Manager to score ICP fit and/or assess deal risk for a company. Returns tier (Tier 1/2/3/Non-ICP) and 6-category risk signal with full rationale.',
    input_schema: TASK_PACKET_SCHEMA,
  },
  {
    name: 'delegate_outreach',
    description:
      'Delegate to the Outreach Manager to draft a PIC + outreach sequence, or to log/mark/cancel touches in Notion. For drafting only (no logging), make clear in the task. For logging, include "log" or "save to Notion" in the task.',
    input_schema: TASK_PACKET_SCHEMA,
  },
  {
    name: 'delegate_kb',
    description:
      'Delegate to the KB Manager for knowledge base operations: searching KB or reference library, ingesting documents, processing file uploads, loading skill briefs, queuing overnight research, or logging audit entries.',
    input_schema: TASK_PACKET_SCHEMA,
  },
  {
    name: 'store_learning',
    description:
      'Store a learning, correction, or preference for the system to remember. Use when the user provides feedback, corrections, or teaches the system something new.',
    input_schema: {
      type: 'object' as const,
      properties: {
        feedback: {
          type: 'string',
          description: 'Natural language description of the learning, correction, or preference',
        },
        agent_source: {
          type: 'string',
          description:
            'Which agent this applies to: icp-scorer, outreach-drafter, prospect-researcher, risk-assessor, or * for all',
        },
      },
      required: ['feedback'],
    },
  },
];
