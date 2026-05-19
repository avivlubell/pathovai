import type Anthropic from '@anthropic-ai/sdk';
import { gmailTool } from '../gmail-tools';
import { driveTools } from '../drive-tools';
import { calendarTools } from '../calendar-tools';
import type { ManagerConfig } from './types';

const SYSTEM_PROMPT = `You are the CRM Manager for Pathova GTM. You read and write account, contact, deal, and communication data.

The Quarterback Agent delegates tasks to you with a task packet. Execute and return structured results with full detail.

## Terminology

- **account** = a COMPANY in the Outreach Intelligence database, referenced by account_id (UUID).
- **contact** = an individual PERSON at a company, referenced by a contact id, linked via account_id.
- Never confuse an account (company) with a contact (person).

## Tool Usage

**search_accounts_and_contacts**: Find companies or people by name, industry, title, email, or region. Returns both account and contact results.
**get_account_detail**: Get full details for a specific company by name or UUID.
**query_deals**: Query the Deals & Motions pipeline with optional stage/motion_type/company filters.
**query_touches**: Query outreach touch history with rich filtering. Read the response shape carefully — use summary.by_account for per-account counts, not the touches array.
**get_communications**: Pull prior outreach touches from Notion for a company. Do NOT call before invoke_outreach_drafter — the drafter pulls its own history.
**create_account**: Create a new company record. WRITE TOOL — see write rules.
**create_contact**: Create a new contact record. WRITE TOOL — see write rules.
**update_account**: Update account properties or append intel to the page body. WRITE TOOL — see write rules.
**sync_account_content**: Sync a Notion account page content into Supabase.

## Write Rules

create_account, create_contact, and update_account modify the user's live ops database. Only call them when the task packet explicitly contains action words like "create", "add", "update", "save to Notion", "log". If the task says "look up", "find", "get", "check", "search" — that is a read operation. Do not write.

If create_account or create_contact returns duplicate_detected or possible_duplicates, return the match list to the Quarterback — do not re-call with force_create.

## Rules

- Return all relevant data in full detail.
- When a tool errors, report the error and tool name explicitly.
- For name resolution: the tools use fuzzy matching. Trust the resolved match and proceed. If ambiguous, surface the top candidates.
- **Always include the `_freshness` block** from `get_account_detail` verbatim in your response. The Quarterback uses `last_researched`, `last_scored_at`, `icp_tier`, and `research_status` to decide whether to skip research or qualification. If you omit these, the QB will re-run expensive pipelines unnecessarily.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_accounts_and_contacts',
    description: 'Search accounts (companies) and contacts (people). Use to find companies by name, industry, or keyword, AND to find people by name, title, email, or region.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query — company name, person name, title, industry, region, or keyword' },
      },
    },
  },
  {
    name: 'get_account_detail',
    description: 'Get full details for a specific account (COMPANY) by name or ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table' },
        company_name: { type: 'string', description: 'Company name to look up' },
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
    name: 'query_touches',
    description: 'Query the Outreach Touches log. Use summary.by_account for per-account counts (not the touches array). total_matching is the true count.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'object',
          properties: {
            account_id: { type: 'string' },
            account_name: { type: 'string' },
            sent: { type: 'boolean' },
            channel: { type: 'string' },
            outcome: { type: 'string' },
            due_within_days: { type: 'number' },
            sent_within_days: { type: 'number' },
            since_days: { type: 'number' },
            before_date: { type: 'string' },
            after_date: { type: 'string' },
          },
        },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_communications',
    description: 'Pull prior outreach touches from Notion for a company. Do NOT call before invoke_outreach_drafter — the drafter auto-pulls its own history.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string' },
        company_name: { type: 'string' },
      },
    },
  },
  {
    name: 'create_account',
    description: 'Create a new company record in Notion and sync to Supabase. WRITE TOOL — only call when task explicitly instructs creation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string' },
        from_icp_trigger_id: { type: 'string' },
        website: { type: 'string' },
        linkedin_url: { type: 'string' },
        hq_location: { type: 'string' },
        regulatory_status: { type: 'string' },
        product_category: { type: 'string' },
        icp_tier: { type: 'string' },
        source: { type: 'string' },
        notes: { type: 'string' },
        icp_score: { type: 'number' },
        force_create: { type: 'boolean' },
      },
      required: ['company_name'],
    },
  },
  {
    name: 'create_contact',
    description: 'Create a new contact record in Notion and sync to Supabase. WRITE TOOL — only call when task explicitly instructs creation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        full_name: { type: 'string' },
        account_id: { type: 'string' },
        company_name: { type: 'string' },
        title: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        linkedin_url: { type: 'string' },
        notes: { type: 'string' },
        contact_type: { type: 'string' },
        relationship_status: { type: 'string' },
        communication_channels: { type: 'array', items: { type: 'string' } },
        is_primary: { type: 'boolean' },
        force_create: { type: 'boolean' },
      },
      required: ['full_name'],
    },
  },
  {
    name: 'update_account',
    description: 'Update an existing account in Notion. WRITE TOOL — only call when task explicitly instructs update/save.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string' },
        company_name: { type: 'string' },
        property_updates: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            pipeline_stage: { type: 'string' },
            icp_tier: { type: 'string' },
            regulatory_status: { type: 'string' },
            product_category: { type: 'string' },
            engage_decision: { type: 'string' },
            source: { type: 'string' },
            timing_status: { type: 'string' },
            validation_status: { type: 'string' },
            icp_score: { type: 'number' },
            hq_location: { type: 'string' },
            website: { type: 'string' },
            linkedin_url: { type: 'string' },
            email: { type: 'string' },
            notes: { type: 'string' },
            therapeutic_area: { type: 'array', items: { type: 'string' } },
            primary_gap: { type: 'array', items: { type: 'string' } },
            last_touch: { type: 'string' },
            response_date: { type: 'string' },
            next_step_due: { type: 'string' },
            exclude_from_brief: { type: 'boolean' },
          },
        },
        body_update: {
          type: 'object',
          properties: {
            mode: { type: 'string' },
            heading: { type: 'string' },
            markdown: { type: 'string' },
          },
          required: ['markdown'],
        },
      },
    },
  },
  {
    name: 'sync_account_content',
    description: 'Sync an account full Notion page content into Supabase.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string' },
      },
    },
  },
  gmailTool,
  ...driveTools,
  ...calendarTools,
];

export const CRM_MANAGER: ManagerConfig = {
  systemPrompt: SYSTEM_PROMPT,
  tools: TOOLS,
  maxRounds: 10,
};
