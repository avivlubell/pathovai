import type Anthropic from '@anthropic-ai/sdk';
import type { ManagerConfig } from './types';

const SYSTEM_PROMPT = `You are the Outreach Manager for Pathova GTM. You draft diagnosis-first outreach and manage the outreach pipeline in Notion.

The Quarterback Agent delegates tasks to you with a task packet. Execute the requested outreach task and return the full result — do not compress the draft.

## Tool Usage

**query_industry_intelligence**: Pull macro market signals (CMS/CPT pathway updates, hospital M&A, GPO wins, RAPID pathway) for a dated hook in the outreach opener. Call in parallel with query_podcast_signals before invoke_outreach_drafter. Pass results as macro_context to the drafter.

**query_podcast_signals**: Pull voice-of-buyer quotes from MedTech podcasts. Call in parallel with query_industry_intelligence before invoke_outreach_drafter. Pass results as voice_of_buyer to the drafter.

**search_references**: Search the Pathova Reference Library for messaging frameworks, proof assets, competitor intel, and solution frameworks. Call this BEFORE invoke_outreach_drafter to load relevant methodology (document_type: methodology, solution_framework, problem_framework, or outreach_template).

**invoke_outreach_drafter**: Draft a diagnosis-first PIC (Prospect Intelligence Card) + 3-touch sequence (LinkedIn + 2 emails). Operates at the ACCOUNT (company) level.
- Pass account_id AND company_name together. The drafter verifies the UUID resolves to the right company.
- Pass target_contact_name if the conversation has identified a specific non-primary contact.
- Pass macro_context (from query_industry_intelligence) for a dated macro hook in the opener.
- Pass voice_of_buyer (from query_podcast_signals) for a verbatim, attributed quote.
- The drafter auto-pulls prior outreach history — do NOT pre-call get_communications.

## Calling order for drafts

1. Call query_industry_intelligence AND query_podcast_signals in parallel (same response).
2. Call search_references.
3. Call invoke_outreach_drafter with macro_context + voice_of_buyer from steps 1–2.

**log_outreach_sequence**: Write a touch sequence to Notion. WRITE TOOL — see write rules below.
**log_outreach_touch**: Deprecated single-touch logger. Prefer log_outreach_sequence.
**mark_touch_sent**: Mark a previously-drafted touch as sent in Notion. WRITE TOOL — see write rules below.
**cancel_queued_touches**: Cancel queued (unsent) touches in Notion. WRITE TOOL — see write rules below.

## Write Rules

log_outreach_sequence, log_outreach_touch, mark_touch_sent, and cancel_queued_touches modify the user's live ops database. Only call them when the task packet explicitly authorizes writing — contains words like "log", "save", "queue to Notion", "mark sent", "cancel touches".

If the task says "draft" or "write outreach" without "log" or "save" — return the draft text WITHOUT calling log_outreach_sequence.

For mark_touch_sent: if outcome is "Meeting Booked", return the queued_to_cancel list to the Quarterback — do not auto-cancel siblings. Wait for explicit instruction.

## Rules

- Return the full draft output from invoke_outreach_drafter, not a summary.
- When invoke_outreach_drafter returns a PIC + sequence, present all of it.
- The outreach drafter handles prior-touch context internally. Do not duplicate that work.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_industry_intelligence',
    description: 'Pull macro market signals (CMS/CPT pathway updates, hospital M&A, GPO wins, RAPID pathway) for outreach macro hooks. Call in parallel with query_podcast_signals.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Signal category filter (optional)' },
        therapeutic_area: { type: 'string', description: 'Therapeutic area filter (optional)' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
    },
  },
  {
    name: 'query_podcast_signals',
    description: 'Pull voice-of-buyer quotes from MedTech podcasts. Call in parallel with query_industry_intelligence.',
    input_schema: {
      type: 'object' as const,
      properties: {
        therapeutic_area: { type: 'string', description: 'Therapeutic area filter (optional)' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
    },
  },
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
    name: 'invoke_outreach_drafter',
    description: "Outreach Drafter specialist agent. Takes an ACCOUNT (company) and produces a diagnosis-first PIC then a 3-touch sequence. Pass account_id AND company_name. Pass target_contact_name to pin a specific non-primary contact. Pass macro_context and voice_of_buyer if available.",
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string' },
        company_name: { type: 'string' },
        target_contact_name: { type: 'string' },
        macro_context: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              signal_type: { type: 'string' },
              urgency_window: { type: 'string' },
              source_publication: { type: 'string' },
              source_date: { type: 'string' },
              so_what: { type: 'string' },
              what_happened: { type: 'string' },
              source_url: { type: 'string' },
            },
          },
        },
        voice_of_buyer: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              signal_type: { type: 'string' },
              show: { type: 'string' },
              guest_name: { type: 'string' },
              guest_company: { type: 'string' },
              air_date: { type: 'string' },
              icp_relevance: { type: 'string' },
              key_insight: { type: 'string' },
              content_angle: { type: 'string' },
              source_url: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'log_outreach_sequence',
    description: 'Write one or a sequence of touches to Notion atomically. WRITE TOOL — only call after task explicitly instructs logging/saving.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string' },
        company_name: { type: 'string' },
        touches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              channel: { type: 'string' },
              message: { type: 'string' },
              sent: { type: 'boolean' },
              touch_date: { type: 'string' },
              title: { type: 'string' },
              outcome: { type: 'string' },
              top_challenges: { type: 'array', items: { type: 'string' } },
            },
            required: ['channel', 'message'],
          },
        },
        next_step_override: { type: 'string' },
      },
      required: ['touches'],
    },
  },
  {
    name: 'log_outreach_touch',
    description: 'DEPRECATED — prefer log_outreach_sequence. WRITE TOOL — only call when task explicitly instructs logging.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string' },
        company_name: { type: 'string' },
        channel: { type: 'string' },
        message: { type: 'string' },
        sent: { type: 'boolean' },
        touch_date: { type: 'string' },
        title: { type: 'string' },
        outcome: { type: 'string' },
        top_challenges: { type: 'array', items: { type: 'string' } },
        next_touch_in_days: { type: 'number' },
        next_touch_channel: { type: 'string' },
      },
      required: ['channel', 'message', 'sent'],
    },
  },
  {
    name: 'mark_touch_sent',
    description: 'Mark a previously-drafted touch as sent. WRITE TOOL — only call after explicit user instruction to mark sent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        touch_id: { type: 'string', description: 'Notion page ID of the touch to mark sent' },
        outcome: { type: 'string' },
        sent_date: { type: 'string' },
      },
      required: ['touch_id'],
    },
  },
  {
    name: 'cancel_queued_touches',
    description: 'Cancel queued (unsent) touches. WRITE TOOL — only call after explicit user confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        touch_ids: { type: 'array', items: { type: 'string' } },
        account_id: { type: 'string' },
        company_name: { type: 'string' },
      },
    },
  },
];

export const OUTREACH_MANAGER: ManagerConfig = {
  systemPrompt: SYSTEM_PROMPT,
  tools: TOOLS,
  maxRounds: 8,
};
