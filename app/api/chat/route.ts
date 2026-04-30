export const maxDuration = 300;
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { SYSTEM_PROMPT } from './system-prompt';
import { createClient } from '@supabase/supabase-js';
import { buildConversationContext } from '../../../lib/contextPrompt';
import { authOptions } from '../../../lib/authOptions';
import { gmailTool, executeGmailTool } from './gmail-tools';
import { driveTools, executeDriveTool } from './drive-tools';
import { loadSkill, SKILL_INDEX } from '../../../lib/skills';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUPABASE_FUNCTIONS_BASE = 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY
);

async function fetchLearnings(): Promise<string> {
  try {
    const { data } = await supabase
      .from('agent_learnings')
      .select('feedback, agent_source, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!data || data.length === 0) return '';
    const lines = data.map((l: any) =>
      `[${l.agent_source || '*'}] ${l.feedback}`
    );
    return '\n\n## Active Learnings & Corrections\n' + lines.join('\n');
  } catch {
    return '';
  }
}

function humanizeToolCall(
  toolName: string,
  input: Record<string, unknown>
): string {
  const pickName = (): string | null => {
    const v =
      (input.company_name as string | undefined) ||
      (input.account_name as string | undefined) ||
      (input.name as string | undefined) ||
      null;
    return v && typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const pickQuery = (): string | null => {
    const v = input.query;
    if (typeof v !== 'string' || !v.trim()) return null;
    const s = v.trim();
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  };

  switch (toolName) {
    case 'invoke_prospect_researcher':
    case 'prospect_researcher_batch':
      return pickName() ? `Researching ${pickName()}` : 'Researching the account';
    case 'invoke_icp_scorer':
    case 'score_icp':
      return pickName() ? `Scoring ICP fit for ${pickName()}` : 'Scoring ICP fit';
    case 'invoke_outreach_drafter':
      return pickName() ? `Drafting outreach for ${pickName()}` : 'Drafting outreach';
    case 'invoke_risk_assessor':
      return pickName() ? `Assessing risk for ${pickName()}` : 'Assessing risk';
    case 'get_communications':
      return pickName()
        ? `Pulling prior touches for ${pickName()}`
        : 'Pulling prior outreach history';
    case 'query_deals':
      return 'Querying deals pipeline';
    case 'query_icp_triggers':
      return 'Querying ICP trigger monitor';
    case 'query_touches':
      return pickName() ? `Pulling touches for ${pickName()}` : 'Pulling outreach touches';
    case 'log_outreach_touch':
      return pickName() ? `Logging touch to Notion for ${pickName()}` : 'Logging touch to Notion';
    case 'log_outreach_sequence':
      return pickName() ? `Logging sequence to Notion for ${pickName()}` : 'Logging sequence to Notion';
    case 'mark_touch_sent':
      return 'Marking touch as sent in Notion';
    case 'cancel_queued_touches':
      return pickName() ? `Cancelling queued touches for ${pickName()}` : 'Cancelling queued touches';
    case 'create_account':
      return pickName() ? `Creating account for ${pickName()}` : 'Creating account in Notion';
    case 'create_contact':
      return pickName() ? `Creating contact for ${pickName()}` : 'Creating contact in Notion';
    case 'update_account':
      return pickName() ? `Updating ${pickName()} in Notion` : 'Updating account in Notion';
    case 'sync_account_content':
      return 'Syncing account content from Notion';
    case 'run_prospect_pipeline':
      return pickName() ? `Running pipeline on ${pickName()}` : 'Running prospect pipeline';
    case 'search_references':
      return pickQuery()
        ? `Searching references for "${pickQuery()}"`
        : 'Searching reference library';
    case 'search_accounts_and_contacts':
      return pickQuery()
        ? `Searching accounts for "${pickQuery()}"`
        : 'Searching accounts and contacts';
    case 'get_account_detail':
      return pickName() ? `Looking up ${pickName()}` : 'Looking up account details';
    case 'log_agent_run':
      return 'Logging action to audit trail';
    case 'process_document':
      return 'Processing document';
    case 'ingest_to_kb': {
      const title = typeof input.title === 'string' ? input.title : null;
      return title ? `Saving "${title}" to knowledge base` : 'Saving to knowledge base';
    }
    case 'store_learning':
      return 'Storing learning';
    case 'gmail_send':
    case 'send_email':
      return 'Sending email via Gmail';
    case 'gmail_search':
    case 'search_email':
      return 'Searching Gmail';
    case 'gmail_read':
    case 'read_email':
      return 'Reading email';
    case 'drive_search':
      return pickQuery() ? `Searching Drive for "${pickQuery()}"` : 'Searching Drive';
    case 'drive_read':
      return 'Reading Drive file';
    default: {
      const pretty = toolName.replace(/^invoke_/, '').replace(/_/g, ' ');
      return `Running ${pretty}`;
    }
  }
}

const TOOL_ENDPOINT_MAP: Record<string, string> = {
  invoke_icp_scorer: 'icp-scorer',
  invoke_prospect_researcher: 'prospect-researcher',
  invoke_outreach_drafter: 'outreach-drafter',
  invoke_risk_assessor: 'risk-assessor',
  get_communications: 'get-communications',
  query_deals: 'query-deals',
  query_icp_triggers: 'query-icp-triggers',
  query_touches: 'query-touches',
  log_outreach_touch: 'log-outreach-touch',
  log_outreach_sequence: 'log-outreach-sequence',
  mark_touch_sent: 'mark-touch-sent',
  cancel_queued_touches: 'cancel-queued-touches',
  create_account: 'create-account',
  create_contact: 'create-contact',
  update_account: 'update-account',
  sync_account_content: 'sync-prospect-content',
  sync_touch_content: 'sync-touch-content',
  run_prospect_pipeline: 'run-prospect-pipeline',
  prospect_researcher_batch: 'prospect-researcher',
  search_references: 'search-references',
  search_accounts_and_contacts: 'search-prospects',
  get_account_detail: 'get-prospect-detail',
  score_icp: 'icp-scorer',
  log_agent_run: 'log-agent-run',
  process_document: 'process-document',
  ingest_to_kb: 'ingest-to-kb',
  store_learning: 'store-learning',
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
    name: 'search_accounts_and_contacts',
    description: 'Search accounts (companies) and contacts (people). Use this to find companies by name, industry, or keyword, AND to find people by name, title, email, or region. Returns both account and contact results. An "account" is a company; a "contact" is an individual person at a company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query -- company name, person name, title, industry, region, or keyword' },
      },
    },
  },
  {
    name: 'get_account_detail',
    description: 'Get full details for a specific account (a COMPANY) by name or ID. For an individual person, use search_accounts_and_contacts instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table (NOT a contact/person id)' },
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
        account_id: { type: 'string', description: 'Company UUID from accounts table' },
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
    name: 'query_icp_triggers',
    description: 'Query the ICP Trigger Monitor — a daily-refreshed feed of MedTech companies that hit Pathova ICP signals (FDA clearances, pilot announcements, seed/Series A raises, reimbursement milestones, SBIR awards, ClinicalTrials registrations). Use when the user asks about recent triggers, new ICP-matched companies, FDA clearances, raises, or wants a prioritized list of fresh prospects. This is pre-engagement signal intake — distinct from accounts (active prospects). Rows include tier, trigger types, FDA status, summary, and outreach status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'object',
          description: 'Optional filters',
          properties: {
            tier: { type: 'string', description: 'Substring match on icp_tier (e.g., "Highest Priority", "Strong Fit", "Medium")' },
            trigger_type: { type: 'string', description: 'Exact match on one of: "FDA Clearance / 510(k)", "Pilot Announcement", "Seed / Series A Raise", "Reimbursement Milestone", "SBIR Award", "ClinicalTrials Registration"' },
            outreach_status: { type: 'string', description: 'Substring match on outreach_status (e.g., "Not Contacted", "Sent")' },
            fda_status: { type: 'string', description: 'Substring match on fda_status (e.g., "Cleared", "Pending", "De Novo", "PMA")' },
            company: { type: 'string', description: 'Substring match on company name' },
            since_days: { type: 'number', description: 'Only rows where date_found is within the last N days' },
          },
        },
        limit: { type: 'number', description: 'Max rows to return (default 25, max 100)' },
      },
    },
  },
  {
    name: 'query_touches',
    description:
      'Query the Outreach Touches log — every email, LinkedIn DM, connection request, call, or meeting that has been drafted or sent for an account. Use this for "what have I sent to X?", "what is unsent?", "what is due this week?", or prior outreach history. Distinct from accounts (the company-level record).\n\nResponse shape (READ THIS — common LLM mistakes):\n- `total_matching`: TRUE total of rows matching the filters (use this for counts).\n- `total_returned`: number of rows in the `touches` array (capped by limit).\n- `truncated`: true when total_matching > total_returned. If true, do NOT claim you have shown everything.\n- `touches`: a SAMPLE of detail rows (most recent first). Use these for narrative quotes/examples, NOT for counting or rolling up.\n- `summary.by_account`: AUTHORITATIVE per-account rollup over ALL matching rows (NOT just the sample). Each entry: `{account_id, account_name, count, oldest_touch_date, newest_touch_date, channels}`. When the user asks "how many per account" or you are building a per-account table, use this — never count the `touches` array.\n- `summary.{accounts, sent, unsent, by_channel, by_outcome, oldest_touch_date, newest_touch_date}`: also unbounded.\n\nNever invent rows that aren\'t in the data. If by_account has 12 entries, your table has 12 rows. Do not pad with "Today (just drafted)" or any other synthetic entry — those will be flagged as fabrication.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'object',
          description: 'Optional filters',
          properties: {
            account_id: { type: 'string', description: 'Company UUID from accounts table — exact match on parent account' },
            account_name: { type: 'string', description: 'Company name — fuzzy match; resolved to account_id internally' },
            sent: { type: 'boolean', description: 'Filter to sent (true) or unsent/draft (false) only' },
            channel: { type: 'string', description: 'Substring match on channel: Email, LinkedIn, Phone, Intro, Meeting' },
            outcome: { type: 'string', description: 'Substring match on outcome: Meeting Booked, No Response, Disqualified, Warm Follow-up, Referred, Nurture, Connection Request Pending, Connected on LinkedIn' },
            due_within_days: { type: 'number', description: 'Only unsent touches with touch_date within N days from today' },
            since_days: { type: 'number', description: 'Only touches with touch_date in the last N days' },
            before_date: { type: 'string', description: 'ISO date — only touches on or before this date' },
            after_date: { type: 'string', description: 'ISO date — only touches on or after this date' },
          },
        },
        limit: { type: 'number', description: 'Max rows (default 50, max 200)' },
      },
    },
  },
  {
    name: 'log_outreach_sequence',
    description:
      'Write one OR a sequence of touches to Notion (Outreach Touches DB) and update the parent account in Outreach Intelligence in a single atomic operation. THIS IS A WRITE TOOL: it modifies the user\'s live ops database. Only call after the user has explicitly told you to log/save/queue the sequence ("log this", "queue these drafts", "save to Notion") — never on a draft/preview turn, never as a follow-up to "looks good". This is the canonical way to log touches; prefer it over log_outreach_touch even for a single touch.\n\nBehavior:\n- Each entry in `touches[]` becomes a row in Outreach Touches with the parent account linked via Related Outreach.\n- Idempotent on (account_id, channel, touch_date) for unsent rows: re-running the same call will skip duplicates instead of creating them, so it\'s safe on retry. Already-sent rows are never treated as duplicates.\n- Parent OI Next Step Due is set to the EARLIEST unsent touch_date across the whole account (existing + just-created), and Next Step is mapped from that touch\'s channel.\n- Parent OI Status only advances from "To Do" → "Working" if AT LEAST ONE touch in this call has sent=true. Drafted ≠ sent — queueing 3 future drafts does not flip Status.\n- Last Touch is updated only if at least one touch in the call has sent=true (set to the latest sent date in the batch).\n\nUse cases:\n- Single immediate send: `touches: [{channel, message, sent: true, touch_date: today}]`\n- Future draft for the next step: `touches: [{channel, message, sent: false, touch_date: future}]`\n- Full 3-touch sequence: `touches: [{...today, sent: true OR false}, {...+4d, sent: false}, {...+11d, sent: false}]`\n\nMax 10 touches per call. For larger batches, split into multiple calls (idempotency makes this safe).',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table. Optional if company_name is provided.' },
        company_name: { type: 'string', description: 'Company name — used to resolve account when UUID unknown.' },
        touches: {
          type: 'array',
          description: 'Array of 1-10 touches to log. Order does not matter; idempotency is on (channel, touch_date).',
          items: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Required. One of: Email, LinkedIn, Phone, Intro, Meeting.' },
              message: { type: 'string', description: 'Required. Full message body.' },
              sent: { type: 'boolean', description: 'Default false. true only if this touch went out.' },
              touch_date: { type: 'string', description: 'ISO date YYYY-MM-DD. Defaults to today. For future drafts use a future date.' },
              title: { type: 'string', description: 'Optional. Defaults to "{Company} - {Channel} - {Date}".' },
              outcome: { type: 'string', description: 'Optional. Meeting Booked, No Response, Disqualified, Warm Follow-up, Referred, Nurture, Connection Request Pending, Connected on LinkedIn.' },
              top_challenges: { type: 'array', items: { type: 'string' }, description: 'Optional discussion topics from Top Challenges multi_select.' },
            },
            required: ['channel', 'message'],
          },
        },
        next_step_override: { type: 'string', description: 'Optional override for OI\'s Next Step value when the channel-to-Next-Step heuristic is ambiguous (LinkedIn maps to Linkedin DM by default; pass "LinkedIn Inmail" / "LinkedIn Connection Request" / etc. to override). Must be one of: LinkedIn Inmail, eMail, Linkedin DM, LinkedIn Connection Request, Schedule meeting, LinkedIn Interaction.' },
      },
      required: ['touches'],
    },
  },
  {
    name: 'mark_touch_sent',
    description:
      'Mark a previously-drafted touch as sent. THIS IS A WRITE TOOL: it modifies Notion. Only call after explicit user instruction to mark the touch sent (e.g. "I sent touch #2", "mark the LinkedIn DM sent", "log it as sent with outcome X"). The tool:\n- Re-pulls the touch from Notion to capture any body edits the user made before sending (Notion is source of truth for the body).\n- Sets Sent=true on the touch (and Outcome if provided).\n- Updates the parent OI: Last Touch = the sent date, Status: To Do → Working (if currently To Do), and rolls Next Step Due / Next Step forward to the next remaining unsent touch on the account. If no touches remain unsent, clears those pointers (sequence done).\n- If outcome is "Meeting Booked", does NOT auto-cancel the queued siblings — instead returns them in `queued_to_cancel` so you can ask the user whether to cancel and call cancel_queued_touches on confirmation. Never auto-cancel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        touch_id: { type: 'string', description: 'Notion page ID of the touch to mark sent (with or without dashes). You can get this from query_touches → notion_page_id.' },
        outcome: { type: 'string', description: 'Optional outcome at send-time: Meeting Booked, No Response, Disqualified, Warm Follow-up, Referred, Nurture, Connection Request Pending, Connected on LinkedIn. Sets Outcome on the touch.' },
        sent_date: { type: 'string', description: 'ISO date YYYY-MM-DD when the touch actually went out. Defaults to the touch\'s existing Touch Date if omitted. Updates Touch Date if provided (use when the touch was sent on a different day than originally drafted).' },
      },
      required: ['touch_id'],
    },
  },
  {
    name: 'cancel_queued_touches',
    description:
      'Move queued (unsent) touches to Notion trash and remove them from Supabase. THIS IS A WRITE TOOL. Only call after explicit user confirmation, typically as the second step after mark_touch_sent surfaced queued siblings (e.g. when a meeting was booked and the rest of the sequence is moot). Notion trash is restorable — this is not a hard delete on the Notion side.\n\nTwo modes:\n- `touch_ids: [...]`: cancel ONLY the specified touches (whitelist; safest). Use this whenever you have a known list, especially right after mark_touch_sent.\n- `account_id` or `company_name` (no touch_ids): cancel ALL unsent touches on that account. Use only when the user has explicitly said "cancel everything queued for X" or similar. Capped at 25 per call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        touch_ids: { type: 'array', items: { type: 'string' }, description: 'Notion page IDs to cancel. Preferred mode.' },
        account_id: { type: 'string', description: 'Cancel ALL unsent touches on this account. Use only with explicit user instruction.' },
        company_name: { type: 'string', description: 'Same as account_id but resolved by name.' },
      },
    },
  },
  {
    name: 'create_account',
    description:
      'Create a new account (company) row in Notion\'s Outreach Intelligence database and sync it to Supabase. THIS IS A WRITE TOOL: it modifies the user\'s live ops database. Only call after the user has explicitly told you to add/create the account ("create an account for X", "add Sibel Health to Notion", "promote this trigger to an account", "let\'s start working on X"). Never call as a follow-up to a generic "looks good".\n\nDuplicate detection runs by default (3 tiers: exact name match in accounts, fuzzy substring match in accounts, title substring match in Notion OI database). If duplicates are found, the tool returns `success: false` with `error: "duplicate_detected"` or `"possible_duplicates"` and a list of matches. When this happens, present the matches to the user — do not silently re-call with force_create. Only re-call with `force_create: true` if the user explicitly confirms it\'s a different company (e.g., "yes, those are different — that one is X subsidiary, this is the parent").\n\nIf you\'re promoting an ICP Trigger row to an account, pass `from_icp_trigger_id` (the trigger\'s notion_page_id from query_icp_triggers). The tool will pre-fill HQ Location, Website, and LinkedIn URL from the trigger row. Other constrained fields (regulatory_status, product_category, icp_tier) are not auto-mapped from the trigger\'s vocabulary — pass them explicitly if you want them set.\n\nNew accounts default to Status="To Do", Pipeline Stage="Research". The QB can immediately invoke prospect_researcher / icp_scorer / outreach_drafter / risk_assessor against the returned account_id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string', description: 'REQUIRED. The company name. Becomes the Account title and is the primary duplicate-detection key.' },
        from_icp_trigger_id: { type: 'string', description: 'Optional notion_page_id of an ICP Trigger row (from query_icp_triggers). When provided, HQ Location, Website, and LinkedIn URL are seeded from the trigger.' },
        website: { type: 'string', description: 'Optional company website URL.' },
        linkedin_url: { type: 'string', description: 'Optional company LinkedIn URL.' },
        hq_location: { type: 'string', description: 'Optional HQ city/country as free text.' },
        regulatory_status: { type: 'string', description: 'Optional. Must be one of: Pre-FDA, FDA Cleared, CE Mark Only, FDA + CE Mark, Post-Market.' },
        product_category: { type: 'string', description: 'Optional. Must be one of: Hardware device, Hardware device / Combination, SaMD / Hardware device / DTx / Clinical AI / Combination / Other, Clinical AI / SaMD.' },
        icp_tier: { type: 'string', description: 'Optional. Must be one of: Tier 1: Priority, Tier 2: Qualified, Tier 3: Monitor, Non-ICP.' },
        source: { type: 'string', description: 'Optional. Must be one of: Inbound, Referral, LinkedIn, Conference, Research, Other.' },
        notes: { type: 'string', description: 'Optional free-text notes for the Notes property.' },
        icp_score: { type: 'number', description: 'Optional numeric ICP Score (0-10).' },
        force_create: { type: 'boolean', description: 'Default false. Set to true ONLY after the user has confirmed that surfaced duplicates are a different company.' },
      },
      required: ['company_name'],
    },
  },
  {
    name: 'create_contact',
    description:
      'Create a new contact (person) in Notion\'s Contacts database, link it to a parent account, and sync to Supabase. THIS IS A WRITE TOOL: it modifies the user\'s live ops database. Only call after the user has explicitly told you to add/create the contact ("add Christian Gormsen as a contact for Magnus Medical", "create a contact for the CEO at Sibel", "let\'s add Keith Maison").\n\nThe outreach drafter cannot run on an account that has no contact — it needs a target person. So when the user creates a fresh account (e.g., promoting an ICP Trigger to an OI page), the next natural step is usually to add at least one contact before drafting outreach.\n\nDuplicate detection runs by default (3 tiers, all account-scoped: exact name same account, fuzzy name same account, email match across all accounts). If duplicates surface (`success: false, error: "duplicate_detected" | "possible_duplicates"`), present matches to the user and ask how to proceed. Email matches across accounts may indicate the person changed jobs — surface that to the user.\n\nAfter creation, the new contact_id is returned and you can pass it (or just keep using account_id) to invoke_outreach_drafter; the drafter will pick up the contact via the synced contacts table.',
    input_schema: {
      type: 'object' as const,
      properties: {
        full_name: { type: 'string', description: 'REQUIRED. The person\'s full name. Becomes the Notion Name title and is the primary duplicate-detection key.' },
        account_id: { type: 'string', description: 'Company UUID this contact belongs to. Optional if company_name is provided.' },
        company_name: { type: 'string', description: 'Company name to resolve the parent account when UUID unknown.' },
        title: { type: 'string', description: 'Optional job title (free text).' },
        email: { type: 'string', description: 'Optional email address. Used as a duplicate-detection key across all accounts (catches job changes).' },
        phone: { type: 'string', description: 'Optional phone number.' },
        linkedin_url: { type: 'string', description: 'Optional LinkedIn profile URL.' },
        notes: { type: 'string', description: 'Optional free-text notes.' },
        contact_type: { type: 'string', description: 'Optional. Must be one of: CEO, CFO, CRO, VP Sales, VP Clinical, Physician Champion, Procurement, Other.' },
        relationship_status: { type: 'string', description: 'Optional. Must be one of: Identified, Researched, Outreach, Connected, Engaged, Active Relationship, Unresponsive, Disqualified. Defaults to "Identified" for new contacts.' },
        communication_channels: { type: 'array', items: { type: 'string' }, description: 'Optional multi-select. Values from: Email, LinkedIn, Phone, In-Person, Referral.' },
        is_primary: { type: 'boolean', description: 'Optional. Mark as the primary contact for the account (Supabase-side flag).' },
        force_create: { type: 'boolean', description: 'Default false. Set true ONLY after the user has confirmed surfaced duplicates are different people / different jobs / etc.' },
      },
      required: ['full_name'],
    },
  },
  {
    name: 'update_account',
    description:
      'Update an existing account in Notion\'s Outreach Intelligence database. THIS IS A WRITE TOOL: it modifies the user\'s live ops database. Only call after the user has explicitly told you to update the page ("update Acurable with this intel", "save this to Notion", "log these corrections to the Acurable page"). Never call as a follow-up to a generic "thanks" or "looks good".\n\nTwo update channels, both optional (at least one required):\n\n1. `property_updates` — patch constrained Notion properties: status, pipeline_stage, icp_tier, regulatory_status, product_category, engage_decision, source, timing_status, validation_status, icp_score, hq_location, website, linkedin_url, email, notes (rich_text, replaced wholesale — short scalars only), therapeutic_area / primary_gap (multi_select arrays — replaced wholesale), last_touch / response_date / next_step_due (ISO dates).\n\n2. `body_update` — append rich research/intel to the page body. Mode is `append` only (v1). Optional `heading` is prepended as a heading_2 (use this for dated section headers like "Update — April 28, 2026"). The `markdown` field accepts standard markdown (# headings, - bullets, 1. numbered lists, paragraphs, --- dividers). Inline emphasis (**bold**, *italic*, `code`, [links](url)) is reduced to plain text — Notion\'s annotation model is verbose; if the user wants formatting they can edit in Notion.\n\nThe most common use case: the user gives you a long-form intel update (corrections, new funding history, commercial team changes, recent LinkedIn posts) and asks you to write it to the page. Pass it as a single `body_update.markdown` block with a dated `body_update.heading`.\n\nAfter writing, the parent OI is re-synced to Supabase so the QB sees the new state on the next read.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table. Optional if company_name is provided.' },
        company_name: { type: 'string', description: 'Company name — used to resolve account when UUID unknown.' },
        property_updates: {
          type: 'object',
          description: 'Optional. Patch constrained Notion properties.',
          properties: {
            status: { type: 'string', description: 'To Do | Nurture | Working | Disqualified | Completed' },
            pipeline_stage: { type: 'string', description: 'Research | Qualify | Outreach | Engaged | Pilot | Client | Lost | Disqualified' },
            icp_tier: { type: 'string', description: 'Tier 1: Priority | Tier 2: Qualified | Tier 3: Monitor | Non-ICP' },
            regulatory_status: { type: 'string', description: 'Pre-FDA | FDA Cleared | CE Mark Only | FDA + CE Mark | Post-Market' },
            product_category: { type: 'string', description: 'Hardware device | Hardware device / Combination | SaMD / Hardware device / DTx / Clinical AI / Combination / Other | Clinical AI / SaMD' },
            engage_decision: { type: 'string', description: 'Proceed | Monitor | Defer | Disqualify' },
            source: { type: 'string', description: 'Inbound | Referral | LinkedIn | Conference | Research | Other' },
            timing_status: { type: 'string', description: 'Ready Now | Build Mode | Monitor | Too Mature' },
            validation_status: { type: 'string', description: 'Pain Validated | Pain Assumed | Wrong Timing | Disqualified' },
            icp_score: { type: 'number' },
            hq_location: { type: 'string' },
            website: { type: 'string' },
            linkedin_url: { type: 'string' },
            email: { type: 'string' },
            notes: { type: 'string', description: 'Replaces the Notes property wholesale. Use for short scalars; long-form intel goes in body_update.' },
            therapeutic_area: { type: 'array', items: { type: 'string' }, description: 'Multi-select; replaces existing list.' },
            primary_gap: { type: 'array', items: { type: 'string' }, description: 'Multi-select; replaces existing list.' },
            last_touch: { type: 'string', description: 'ISO date YYYY-MM-DD.' },
            response_date: { type: 'string' },
            next_step_due: { type: 'string' },
          },
        },
        body_update: {
          type: 'object',
          description: 'Optional. Append rich research/intel to the page body.',
          properties: {
            mode: { type: 'string', description: 'Currently only "append" is supported.' },
            heading: { type: 'string', description: 'Optional heading_2 prepended before the markdown content (e.g. "Update — April 28, 2026").' },
            markdown: { type: 'string', description: 'Markdown content. Supported: # ## ### headings, - * bullets, 1. numbered lists, --- dividers, paragraphs. Inline emphasis stripped to plain text.' },
          },
          required: ['markdown'],
        },
      },
    },
  },
  {
    name: 'log_outreach_touch',
    description:
      'DEPRECATED — prefer log_outreach_sequence (which handles single touches as `touches: [{...}]`). Kept for backward compatibility. Same write semantics as the single-touch path of log_outreach_sequence, including the explicit-user-command rule.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table. Optional if company_name is provided.' },
        company_name: { type: 'string', description: 'Company name — used to resolve account when UUID unknown.' },
        channel: { type: 'string', description: 'Touch channel. Must be one of: Email, LinkedIn, Phone, Intro, Meeting.' },
        message: { type: 'string', description: 'Full message body for this touch.' },
        sent: { type: 'boolean', description: 'true if this touch went out, false if it is a draft.' },
        touch_date: { type: 'string', description: 'ISO date (YYYY-MM-DD) of the touch. Defaults to today.' },
        title: { type: 'string', description: 'Notion page title for the touch row. Defaults to "{Company} - {Channel} - {Date}".' },
        outcome: { type: 'string', description: 'Optional outcome.' },
        top_challenges: { type: 'array', items: { type: 'string' }, description: 'Optional discussion topics.' },
        next_touch_in_days: { type: 'number', description: 'If set, updates parent OI Next Step Due to today + N days.' },
        next_touch_channel: { type: 'string', description: 'If set, updates parent OI Next Step.' },
      },
      required: ['channel', 'message', 'sent'],
    },
  },
  {
    name: 'log_agent_run',
    description: 'Log an agent action for audit trail. account_id is the company UUID this action relates to.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table' },
        action_type: { type: 'string' },
        decision_mode: { type: 'string' },
        context_score: { type: 'number' },
        summary: { type: 'string' },
      },
    },
  },
  {
    name: 'invoke_prospect_researcher',
    description: 'Prospect Researcher specialist agent. Uses Perplexity API for live web research on a company. Operates at the COMPANY level, not individual people.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table' },
        company_name: { type: 'string', description: 'Company name to research' },
      },
    },
  },
  {
    name: 'invoke_icp_scorer',
    description: 'ICP Scorer specialist agent. Scores a COMPANY against Pathova ICP framework. Writes to database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table' },
        company_name: { type: 'string', description: 'Company name to score' },
      },
    },
  },
  {
    name: 'invoke_outreach_drafter',
    description: 'Outreach Drafter specialist agent. Takes an ACCOUNT (company) and produces a diagnosis-first PIC (Prospect Intelligence Card) then a 3-touch sequence (LinkedIn + 2 emails) to a single target person AT that company, grounded in evidence and QA-checked. You do NOT need a contact/person id -- the drafter picks the best target from the account data. The drafter auto-pulls prior outreach history from Notion so it avoids repeating angles. ALWAYS pass company_name alongside account_id so the drafter can verify the UUID resolves to the right company; if there is any doubt about the UUID, pass company_name only and let the drafter resolve it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table (NOT a contact/person id). Optional if company_name is provided.' },
        company_name: { type: 'string', description: 'Company name. Used to verify account_id resolves to the right company, or to resolve the account when UUID is unknown. Pass this whenever you have it.' },
      },
    },
  },
  {
    name: 'get_communications',
    description: 'Pull prior outreach touches (email, LinkedIn, phone, meetings) logged in Notion for a company. Use when the user asks what has been sent, what was said, or when you need history to judge whether an account is warm. The outreach drafter already auto-pulls this internally -- do NOT call this before invoke_outreach_drafter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table' },
        company_name: { type: 'string', description: 'Company name to look up if UUID unknown' },
      },
    },
  },
  {
    name: 'invoke_risk_assessor',
    description: 'Risk Assessor specialist agent. Evaluates regulatory, financial, ICP fit, market timing risks for a COMPANY.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table' },
        company_name: { type: 'string', description: 'Company name' },
      },
    },
  },
  {
    name: 'sync_account_content',
    description: 'Sync an account full Notion page content into Supabase.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID to sync' },
      },
    },
  },
  {
    name: 'process_document',
    description: 'Process and classify an actual uploaded file before saving. Use only when the user has provided a real file upload that needs extraction, parsing, or classification. Never use this for text pasted directly into chat.',
    input_schema: {
      type: 'object' as const,
      properties: {
        document_text: { type: 'string', description: 'Extracted raw text from the uploaded document' },
        document_type: { type: 'string', description: 'Optional override for document classification' },
        account_id: { type: 'string', description: 'Optional linked company UUID for context' },
        intent: { type: 'string', description: 'User intent or goal for the uploaded document' },
      },
      required: ['document_text'],
    },
  },
  {
    name: 'ingest_to_kb',
    description: 'Save text directly to the Pathova knowledge base. Use this for text pasted in chat, or for text that has already been extracted from a file. Do not use process_document for pasted chat text. Required fields: title, content, document_type.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Document or note title' },
        content: { type: 'string', description: 'Text content to save into the knowledge base' },
        document_type: { type: 'string', description: 'Classification such as competitive_intel, research_note, battle_card, case_study, white_paper, or general_document' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for categorization' },
        account_id: { type: 'string', description: 'Optional linked company UUID from accounts table' },
        source_url: { type: 'string', description: 'Optional original source URL' },
      },
      required: ['title', 'content', 'document_type'],
    },
  },
  {
    name: 'store_learning',
    description: 'Store a learning, correction, or preference for the system to remember. Use this when the user provides feedback, corrections, or teaches you something new about how they want things done. This makes the system iteratively smarter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        feedback: { type: 'string', description: 'Natural language description of the learning, correction, or preference' },
        agent_source: { type: 'string', description: 'Which agent this applies to: icp-scorer, outreach-drafter, prospect-researcher, risk-assessor, or * for all' },
      },
      required: ['feedback'],
    },
  },
  {
    name: 'load_skill',
    description: `Load the full procedure brief for a specialist tool. Call this before invoking a specialist when you need to understand what it does, interpret its output, enforce prerequisites, or coach the user on results. Available skills: ${Object.keys(SKILL_INDEX).join(', ')}.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        skill: {
          type: 'string',
          description: 'Skill name: prospect-researcher | icp-scorer | risk-assessor | outreach-drafter',
        },
      },
      required: ['skill'],
    },
  },
  gmailTool,
  ...driveTools,
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
  toolInput: Record<string, unknown>,
  gmailAccessToken?: string
): Promise<string> {
  const gmailResult = await executeGmailTool(toolName, toolInput, gmailAccessToken);
  if (gmailResult !== null) return gmailResult;

  const driveResult = await executeDriveTool(toolName, toolInput, gmailAccessToken);
  if (driveResult !== null) return driveResult;

  if (toolName === 'load_skill') {
    return loadSkill(toolInput.skill as string);
  }

  const endpoint = TOOL_ENDPOINT_MAP[toolName];
  if (!endpoint) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
  const result = await callEdgeFunction(endpoint, toolInput);
  return typeof result === 'string' ? result : JSON.stringify(result);
}

// Records every tool call + result in a turn so the claim verifier can
// match the Quarterback's specific claims against real tool output.
interface ToolCallRecord {
  name: string;
  result: string;
}

// Deterministic claim verifier. Runs against the final assistant text
// before it's sent to the UI. Two independent checks per line:
//
// 1. ATTRIBUTION CHECK: any line that attributes a thought, quote,
//    statement, or action to a named person or org ("Kirk said X",
//    "According to Kirk", "Kirk's concern") must include an inline
//    source tag ([transcript], [email:July 8], [DB], [research], etc).
//    Without a tag, the line is stripped. Prevents paraphrased
//    fabrication being passed off as sourced observation.
//
// 2. SPECIFIC-CLAIM CHECK: any line containing a "specific claim" token
//    (quoted string, dollar amount, multi-digit number, K-number,
//    Month+Year, low-integer + count noun, titled role, named
//    third-party org) must have each extracted token appear in the
//    combined tool-result corpus. Lines that fail are stripped.
//
// Operates line-by-line (not sentence-by-sentence) so each bullet,
// list item, and table row is its own verification unit -- a
// fabricated bullet can't hitch a ride on real siblings.
function verifyClaims(text: string, toolCalls: ToolCallRecord[]): string {
  if (!text || toolCalls.length === 0) return text;
  // Normalize smart/curly quotes to straight before lowercasing the corpus
  // and looking up needles. Without this, a phrase the drafter wrote with
  // curly apostrophes (`’`) would not substring-match the same phrase the
  // QB narrated with straight (`'`), producing a false-positive
  // hard-fabrication strip.
  const normalizeQuotes = (s: string): string =>
    s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const corpusRaw = normalizeQuotes(toolCalls.map(tc => tc.result).join('\n'));
  const corpus = corpusRaw.toLowerCase();
  const corpusStripped = corpus.replace(/[,\s]/g, '');

  const inCorpus = (needle: string): boolean => {
    const n = normalizeQuotes(needle).toLowerCase().trim();
    if (!n) return true;
    if (corpus.includes(n)) return true;
    // Tolerate "$10M" vs "$10 million", "10,000" vs "10000", etc.
    const nStripped = n.replace(/[,\s]/g, '');
    return nStripped.length > 1 && corpusStripped.includes(nStripped);
  };

  // Pattern sources stored as strings so we compile a fresh RegExp per use
  // (global RegExp.lastIndex state breaks when shared across .test() and
  // .matchAll()).
  const P = {
    QUOTE_DBL: '["“][^"”]{10,}["”]',
    // Lookaround stops apostrophe-as-contraction false positives:
    // "isn't a timing problem — it's stale" used to match because the
    // regex saw `'t a timing problem — it'` as a quoted token. We now
    // require the opening `'` to NOT be preceded by a letter and the
    // closing `'` to NOT be followed by a letter. Real single-quoted
    // strings ('hello there my friend') still match.
    QUOTE_SGL: "(?<![A-Za-z])['‘][^'’]{10,}['’](?![A-Za-z])",
    DOLLAR: '\\$\\s*\\d[\\d,.]*\\s*(?:M|B|K|million|billion|thousand)?\\b',
    BIG_NUMBER: '\\b\\d{3,}\\b',
    BARE_YEAR: '\\b(?:19|20)\\d{2}\\b',
    MONTH_YEAR: '\\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+(?:19|20)\\d{2}\\b',
    K_NUMBER: '\\b[A-Z]\\d{3,}[A-Z0-9]*\\b',
    LOW_INT_NOUN: '\\b(\\d{1,2})\\s+(clinic|site|customer|rep|employee|pilot|patient|session|partnership|hospital|AMC|deployment|investor|round|hire)s?\\b',
    TITLE: '\\b(?:Director of|VP of|Vice President of|Head of|Chief [A-Z][a-z]+ Officer|Chief [A-Z][a-z]+)\\s+[A-Z][A-Za-z ]+?(?=[,.\\n]|\\s+(?:at|for|of)\\s|$)',
    ORG_SUFFIX: '\\b[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+)?\\s+(?:Surgical|Pharmaceutical|Pharma|Therapeutics|Medical|Health|Healthcare|Hospital|Labs|Laboratories|Bio|Biosciences|Pharmacy|Clinic|Diagnostics|Robotics)\\b',
  };

  const hasSpecificClaim = (s: string): boolean =>
    Object.values(P).some(src => new RegExp(src).test(s));

  // Words that look like proper nouns but aren't attributable people.
  // Pronouns, first-person references, and common sentence-leads.
  const NON_ATTRIBUTABLE = new Set([
    'we', 'he', 'she', 'they', 'the', 'it', 'i', 'our',
    'this', 'that', 'these', 'those', 'there', 'here',
    'research', 'transcript', 'email', 'note', 'notes', 'data',
  ]);

  const ATTRIB_VERBS =
    '(?:said|says|asked|asks|noted|notes|flagged|flags|surfaced|surfaces|' +
    'mentioned|mentions|told|tells|confirmed|confirms|described|describes|' +
    'stated|states|reported|reports|believes|believed|thinks|thought|' +
    'emphasized|emphasizes|acknowledged|acknowledges|observed|observes|' +
    'pointed out|points out|called out|calls out|shared|shares|' +
    'is concerned|was concerned|is worried|was worried|' +
    'self-diagnosed|self-diagnoses)';

  const P2 = {
    // "Kirk said", "Kirk Thelander noted", etc.
    ATTRIB_SUBJ_VERB: `\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\s+${ATTRIB_VERBS}\\b`,
    // "According to Kirk", "per Kirk Thelander"
    ATTRIB_ACCORDING: '\\b(?:according to|per)\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)',
    // "Kirk's concern", "Kirk's quote", "Kirk's take"
    ATTRIB_POSSESSIVE:
      "\\b([A-Z][a-z]+)'s\\s+(?:concern|concerns|worry|worries|question|questions|" +
      'point|points|take|takes|opinion|opinions|view|views|frustration|frustrations|' +
      'stance|stances|observation|observations|quote|quotes|words|own words)',
    // Inline source tag: [transcript], [email:July 8], [DB:research_output], etc.
    SOURCE_TAG:
      '\\[(?:transcript|email|gmail|call|meet|meeting|notion|DB|db|research|' +
      'communications|comms|source|research_output|research_summary)' +
      '(?::[^\\]]*)?\\]',
  };

  const extractAttributedNames = (s: string): string[] => {
    const names = new Set<string>();
    const tryAdd = (raw: string) => {
      const first = raw.trim().split(/\s+/)[0].toLowerCase();
      if (!NON_ATTRIBUTABLE.has(first)) names.add(raw.trim());
    };
    for (const m of s.matchAll(new RegExp(P2.ATTRIB_SUBJ_VERB, 'g'))) tryAdd(m[1]);
    for (const m of s.matchAll(new RegExp(P2.ATTRIB_ACCORDING, 'gi'))) tryAdd(m[1]);
    for (const m of s.matchAll(new RegExp(P2.ATTRIB_POSSESSIVE, 'g'))) tryAdd(m[1]);
    return Array.from(names);
  };

  const hasSourceTag = (s: string): boolean =>
    new RegExp(P2.SOURCE_TAG, 'i').test(s);

  const extractClaimTokens = (s: string): string[] => {
    const tokens: string[] = [];
    for (const m of s.matchAll(new RegExp(P.QUOTE_DBL, 'gu'))) {
      tokens.push(m[0].slice(1, -1).slice(0, 60));
    }
    for (const m of s.matchAll(new RegExp(P.QUOTE_SGL, 'gu'))) {
      tokens.push(m[0].slice(1, -1).slice(0, 60));
    }
    for (const m of s.matchAll(new RegExp(P.DOLLAR, 'gi'))) {
      tokens.push(m[0]);
    }
    // Month+year before bare year -- "Feb 2026" is a stricter token than "2026".
    const phrasedYears = new Set<string>();
    for (const m of s.matchAll(new RegExp(P.MONTH_YEAR, 'gi'))) {
      tokens.push(m[0]);
      const y = m[0].match(/\d{4}/);
      if (y) phrasedYears.add(y[0]);
    }
    for (const m of s.matchAll(new RegExp(P.K_NUMBER, 'g'))) {
      tokens.push(m[0]);
    }
    for (const m of s.matchAll(new RegExp(P.LOW_INT_NOUN, 'gi'))) {
      tokens.push(`${m[1]} ${m[2].toLowerCase()}`);
    }
    for (const m of s.matchAll(new RegExp(P.TITLE, 'g'))) {
      tokens.push(m[0].trim());
    }
    for (const m of s.matchAll(new RegExp(P.ORG_SUFFIX, 'g'))) {
      tokens.push(m[0]);
    }
    for (const m of s.matchAll(new RegExp(P.BIG_NUMBER, 'g'))) {
      tokens.push(m[0]);
    }
    for (const m of s.matchAll(new RegExp(P.BARE_YEAR, 'g'))) {
      if (!phrasedYears.has(m[0])) tokens.push(m[0]);
    }
    return tokens;
  };

  // Split on line breaks so each bullet / list item is verified independently.
  const lines = text.split(/(\r?\n)/);
  const kept: string[] = [];
  let strippedCount = 0;

  // Extract just the quoted-string tokens (verbatim quoted content)
  // from a line. A quoted token whose content is not in the corpus is
  // treated as HARD FABRICATION and the line is stripped. Non-quote
  // token failures are flagged in place instead.
  const extractQuoteTokens = (s: string): string[] => {
    const out: string[] = [];
    for (const m of s.matchAll(new RegExp(P.QUOTE_DBL, 'gu'))) {
      out.push(m[0].slice(1, -1).slice(0, 60));
    }
    for (const m of s.matchAll(new RegExp(P.QUOTE_SGL, 'gu'))) {
      out.push(m[0].slice(1, -1).slice(0, 60));
    }
    return out;
  };

  // Map each data-pulling tool to the Notion database it ultimately mirrors.
  // Used to route auto-generated verify prompts at Notion AI when the corpus
  // is internal CRM data, instead of pointing the user at Perplexity (which
  // has no access to the user's Notion).
  const NOTION_DB_BY_TOOL: Record<string, string> = {
    query_touches: 'Outreach Touches',
    get_communications: 'Outreach Touches',
    get_account_detail: 'Outreach Intelligence',
    search_accounts_and_contacts: 'Outreach Intelligence (and Contacts)',
    query_icp_triggers: 'ICP Trigger Monitor',
    query_deals: 'Motions & Deals',
    sync_account_content: 'Outreach Intelligence',
  };
  const WEB_RESEARCH_TOOLS = new Set(['invoke_prospect_researcher']);

  const usedToolNames = new Set(toolCalls.map(tc => tc.name));
  const notionDbs = new Set<string>();
  for (const t of usedToolNames) {
    if (NOTION_DB_BY_TOOL[t]) notionDbs.add(NOTION_DB_BY_TOOL[t]);
  }
  const usedNotion = notionDbs.size > 0;
  const usedWeb = Array.from(usedToolNames).some(t => WEB_RESEARCH_TOOLS.has(t));

  const cleanClaimText = (raw: string): string => {
    let c = raw
      .replace(/^\s*[-*•]\s+/, '')
      .replace(/^\s*\d+\.\s+/, '')
      .replace(/[*_`]/g, '')
      .trim();
    // Markdown table rows wrapped in quotes look ridiculous —
    // "| Identifeye Health | 1 | Email |". Convert pipes to slashes and
    // drop the outer pipes so the prompt reads as a sentence.
    if (c.startsWith('|') || /\s\|\s/.test(c)) {
      c = c.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').replace(/\s*\|\s*/g, ' / ');
    }
    return c.slice(0, 240);
  };

  // Build a verification prompt routed to the right venue. Notion-resident
  // claims (touches, accounts, triggers, deals) point at Notion AI against
  // the specific database. External/research claims point at Perplexity.
  // Mixed sessions get both prompts so the user can pick.
  const autoVerifyPrompt = (claim: string): string => {
    const c = cleanClaimText(claim);

    const notionPrompt = (): string => {
      const dbList = Array.from(notionDbs).join(' or ');
      return (
        `[Notion AI — open the ${dbList} database${notionDbs.size > 1 ? 's' : ''}]\n` +
        `Verify whether this is accurate against the current data: "${c}". ` +
        `Return: (1) the matching row(s), (2) the exact property values that confirm or refute, ` +
        `(3) the count of matching rows. ` +
        `If no rows match, reply "not found" — do not infer.`
      );
    };

    const webPrompt = (): string =>
      `[Perplexity / Comet — public web]\n` +
      `Verify whether this statement is currently true: "${c}". ` +
      `Source from primary materials only (the company's website, press releases, ` +
      `SEC/FDA filings, LinkedIn). ` +
      `Return: (1) supporting URL, (2) verbatim excerpt from the source that confirms or refutes, ` +
      `(3) publication date. ` +
      `If the statement cannot be confirmed from primary sources, return "not found" — do not infer.`;

    if (usedNotion && usedWeb) return `${notionPrompt()}\n\n${webPrompt()}`;
    if (usedNotion) return notionPrompt();
    return webPrompt();
  };

  // Wrap an unverified line in a prose flag + hidden meta block. Used when
  // the verifier catches something the QB did not self-flag. Preserves the
  // original claim so the user sees what was flagged and why. Plain
  // English here matters — this prose is shown to the user inline.
  const flagInPlace = (line: string, reason: string): string => {
    const claim = line
      .trim()
      .replace(/^\s*[-*•]\s+/, '')
      .replace(/^\s*\d+\.\s+/, '')
      // Strip leading/trailing markdown table pipes so a flagged table
      // cell renders as readable prose, not "| Can we use plain english".
      .replace(/^\s*\|\s*/, '')
      .replace(/\s*\|\s*$/, '')
      .replace(/\s*\|\s*/g, ' / ');
    const prose =
      `\n⚠ I couldn't verify this from the data I pulled — please double-check: ` +
      `${claim} *(Worth checking — see list below.)*\n`;
    const meta =
      `\n<!--verify-meta\n` +
      `criticality: unassessed\n` +
      `why_unverified: ${reason}\n` +
      `go_to_url: N/A\n` +
      `verify_prompt: ${autoVerifyPrompt(claim)}\n` +
      `-->\n`;
    return prose + meta;
  };

  let flaggedCount = 0;
  const strippedClaims: string[] = [];

  let inMetaBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\r?\n$/.test(line) || line === '') {
      kept.push(line);
      continue;
    }

    // Track verify-meta block boundaries — preserve content for the
    // post-pass that builds the bottom checklist, then strips them.
    if (/<!--verify-meta\b/.test(line)) {
      kept.push(line);
      inMetaBlock = true;
      if (/-->/.test(line)) inMetaBlock = false;
      continue;
    }
    if (inMetaBlock) {
      kept.push(line);
      if (/-->/.test(line)) inMetaBlock = false;
      continue;
    }

    // Strip leading bullet/list markers when checking, keep original in output.
    const content = line
      .replace(/^\s*[-*•]\s+/, '')
      .replace(/^\s*\d+\.\s+/, '');

    // Skip prose ⚠ flag lines (already self-flagged or verifier-caught).
    if (/^\s*⚠/.test(content)) {
      kept.push(line);
      continue;
    }

    // HARD FABRICATION CHECK: a quoted string whose content is not in
    // the corpus is suspect — but only when it's *attributed*. If the
    // quote sits in a sentence with an attribution verb (said/wrote/etc.)
    // or "according to" / "per", it claims to be someone's actual words;
    // missing from corpus = real fabrication risk → strip.
    //
    // If the quote is unattributed, it's almost always rhetorical: a
    // tone descriptor (`Email 1 is investigative ("are you seeing this?")`),
    // a label (`they call this "VAC purgatory"`), or a hypothetical
    // characterization. Flagging these creates more noise than signal —
    // the specific-claim check below still catches numbers/names/dates,
    // and the attribution check still catches "<Person> said X" without
    // a source tag. We log to console for audit trail but do NOT
    // user-flag.
    const ATTRIBUTION_CONTEXT_RE = new RegExp(
      `\\b(?:${ATTRIB_VERBS.slice(3, -1)}|wrote|writes|replied|replies|responded|responds|cited|cites|quoted|quotes|according to|per)\\b`,
      'i',
    );
    const findQuoteSentence = (text: string, quoteTok: string): string => {
      const sentences = text.split(/(?<=[.!?])\s+|\s+—\s+/);
      const needle = quoteTok.toLowerCase();
      const match = sentences.find(s => s.toLowerCase().includes(needle));
      return match ?? text;
    };
    const quoteTokens = extractQuoteTokens(content);
    const missingQuote = quoteTokens.find(t => !inCorpus(t));
    if (missingQuote) {
      const sentence = findQuoteSentence(content, missingQuote);
      if (ATTRIBUTION_CONTEXT_RE.test(sentence)) {
        strippedCount++;
        strippedClaims.push(line.trim());
        console.warn(
          `[verifyClaims] HARD FABRICATION stripped (attributed quote). content: ${JSON.stringify(missingQuote)}. line: ${line.slice(0, 160)}`,
        );
        if (i + 1 < lines.length && /^\r?\n$/.test(lines[i + 1])) i++;
        continue;
      }
      // Unattributed — log only, don't flag. Fall through so the
      // line still goes through attribution + specific-claim checks.
      console.warn(
        `[verifyClaims] unattributed quoted phrase not in corpus (not user-flagged): ${JSON.stringify(missingQuote)}. line: ${line.slice(0, 160)}`,
      );
    }

    // ATTRIBUTION CHECK: lines that attribute thought/quote/action to a
    // named person or org must carry an inline source tag, and that name
    // must appear somewhere in the corpus. Flag in place if they don't.
    const attributedNames = extractAttributedNames(content);
    if (attributedNames.length > 0) {
      if (!hasSourceTag(content)) {
        flaggedCount++;
        console.warn(
          `[verifyClaims] flagged unattributed line. names: ${JSON.stringify(attributedNames)}. line: ${line.slice(0, 160)}`
        );
        kept.push(flagInPlace(line, `mentions ${attributedNames.join(', ')} but doesn't say where the quote or claim came from. Add a source tag like [email], [transcript], or [DB] so we can trace it.`));
        continue;
      }
      const missingName = attributedNames.find(n => !inCorpus(n));
      if (missingName) {
        flaggedCount++;
        console.warn(
          `[verifyClaims] flagged line — attributed name "${missingName}" not in corpus. line: ${line.slice(0, 160)}`
        );
        kept.push(flagInPlace(line, `mentions "${missingName}" but I couldn't find them in any of the data I pulled — the source tag may be pointing at the wrong place.`));
        continue;
      }
    }

    // SPECIFIC-CLAIM CHECK: extract non-quote claim tokens and flag in
    // place if any are missing from the corpus.
    if (!hasSpecificClaim(content)) {
      kept.push(line);
      continue;
    }
    const tokens = extractClaimTokens(content);
    const missingTokens = tokens.filter(t => !inCorpus(t));
    if (missingTokens.length === 0) {
      kept.push(line);
    } else {
      flaggedCount++;
      console.warn(
        `[verifyClaims] flagged line — tokens not in corpus: ${JSON.stringify(missingTokens)}. line: ${line.slice(0, 160)}`
      );
      kept.push(flagInPlace(line, `these specific details aren't in any data I pulled: ${missingTokens.map(t => JSON.stringify(t)).join(', ')}. They may need verification.`));
    }
  }

  let verified = kept.join('').trim();

  // Parse <!--verify-meta ... --> blocks. Each block is paired with the
  // nearest preceding ⚠ prose line, which becomes the human-readable
  // claim in the checklist. The meta block itself is then stripped from
  // inline output so the user sees only the prose flag plus the
  // checklist at the bottom.
  type ChecklistItem = {
    claim: string;
    criticality: string;
    why: string;
    url: string;
    prompt: string;
  };
  const items: ChecklistItem[] = [];

  const META_RE = /<!--verify-meta\s*\n([\s\S]*?)\n\s*-->/g;
  const FIELD_RE = /^\s*(criticality|why_unverified|go_to_url|verify_prompt)\s*:\s*(.*)$/i;

  const parseMeta = (raw: string): Omit<ChecklistItem, 'claim'> => {
    const out: Record<string, string> = { criticality: '', why_unverified: '', go_to_url: '', verify_prompt: '' };
    let last: string | null = null;
    for (const ln of raw.split('\n')) {
      const m = ln.match(FIELD_RE);
      if (m) {
        last = m[1].toLowerCase();
        out[last] = m[2].trim();
      } else if (last && ln.trim()) {
        out[last] += ' ' + ln.trim();
      }
    }
    return {
      criticality: out.criticality || 'unassessed',
      why: out.why_unverified || '',
      url: out.go_to_url || '',
      prompt: out.verify_prompt || '',
    };
  };

  const cleanProseToClaim = (prose: string): string =>
    prose
      .replace(/^⚠\s*/, '')
      .replace(/\s*\*?\(\s*(?:HIGH|MEDIUM|LOW|Manual review|unassessed)\b[^)]*\)\*?\s*$/i, '')
      .trim();

  // Walk meta blocks in order; for each, look back into the unmodified
  // text for the most recent ⚠ prose line.
  let m: RegExpExecArray | null;
  const consumed: { start: number; end: number }[] = [];
  while ((m = META_RE.exec(verified)) !== null) {
    const before = verified.slice(0, m.index);
    const warnIdx = before.lastIndexOf('⚠');
    let claim = '';
    if (warnIdx !== -1) {
      const nl = before.indexOf('\n', warnIdx);
      const proseLine = nl === -1 ? before.slice(warnIdx) : before.slice(warnIdx, nl);
      claim = cleanProseToClaim(proseLine);
    }
    const meta = parseMeta(m[1]);
    items.push({ claim: claim || '(claim text unavailable)', ...meta });
    consumed.push({ start: m.index, end: m.index + m[0].length });
  }

  // Strip meta blocks from inline output (back-to-front to preserve indices).
  // Surrounding whitespace is normalized by the \n{3,} collapse below — that
  // keeps the blank line between the prose ⚠ and the next paragraph intact.
  for (let k = consumed.length - 1; k >= 0; k--) {
    const { start, end } = consumed[k];
    verified = verified.slice(0, start) + verified.slice(end);
  }
  verified = verified.replace(/\n{3,}/g, '\n\n').trim();

  if (items.length === 0 && strippedClaims.length === 0) {
    return verified;
  }

  // Build the verification checklist.
  const sevRank = (s: string): number => {
    const u = s.toUpperCase();
    if (u.startsWith('HIGH')) return 0;
    if (u.startsWith('MEDIUM')) return 1;
    if (u.startsWith('LOW')) return 2;
    return 3;
  };
  items.sort((a, b) => sevRank(a.criticality) - sevRank(b.criticality));

  const totalCount = items.length + strippedClaims.length;
  const out: string[] = [
    '',
    '---',
    '',
    `### Things worth double-checking (${totalCount})`,
    '',
    'Each item below is flagged inline above with a `⚠`. ' +
    'Paste the prompt into the suggested venue (Notion AI, Perplexity, Gmail, Drive) ' +
    'to verify — or just open the source link.',
    '',
  ];

  items.forEach((item, idx) => {
    const sevRaw = item.criticality.match(/^(HIGH|MEDIUM|LOW)/i)?.[1];
    const sevLabel = sevRaw ? ` · ${sevRaw.toUpperCase()}` : '';
    out.push(`**${idx + 1}. ${item.claim}**${sevLabel}`);
    if (item.why) out.push(`What's missing: ${item.why}`);
    if (item.url && item.url.toUpperCase() !== 'N/A') {
      out.push(`Source: ${item.url}`);
    }
    if (item.prompt) {
      out.push('');
      out.push('How to verify:');
      out.push('```');
      out.push(item.prompt);
      out.push('```');
    }
    out.push('');
  });

  if (strippedClaims.length > 0) {
    out.push(`**Removed as likely fabrication** (${strippedClaims.length}) — quoted content I couldn't find in any data I pulled, attributed to someone. The original line${strippedClaims.length === 1 ? ' is' : 's are'} listed below for your awareness; treat as suspect:`);
    out.push('');
    for (const claim of strippedClaims) {
      out.push(`- ~~${claim}~~`);
    }
    out.push('');
  }

  return verified + '\n' + out.join('\n').trimEnd();
}

function collectSources(
  rawResult: string,
  acc: Array<{ id: string; title: string; snippet: string }>,
  seen: Set<string>
): void {
  try {
    const parsed = JSON.parse(rawResult);
    const refs = parsed?.references;
    if (!Array.isArray(refs)) return;
    for (const r of refs) {
      const id = typeof r?.id === 'string' ? r.id : null;
      const title = typeof r?.title === 'string' ? r.title : null;
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);
      const content = typeof r?.content === 'string' ? r.content : '';
      const snippet = content
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      acc.push({ id, title, snippet });
    }
  } catch {
    // ignore malformed results
  }
}

function extractReply(finalText: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(finalText);
  } catch {
    return finalText;
  }
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
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const chatMessages = body?.messages;
    const chatId: string | null =
      typeof body?.chat_id === 'string' && body.chat_id ? body.chat_id : null;
    if (!Array.isArray(chatMessages)) {
      return NextResponse.json(
        { error: 'Invalid payload: messages must be an array' },
        { status: 400 }
      );
    }

    const session = await getServerSession(authOptions).catch(() => null);
    const gmailAccessToken =
      typeof (session as any)?.accessToken === 'string'
        ? ((session as any).accessToken as string)
        : undefined;

    const conversationContext = chatId
      ? await buildConversationContext(chatId).catch(() => '')
      : '';

    // Keep only the most recent messages to stay under the 200k token limit.
    // Estimate ~4 chars per token; reserve 50k tokens for system prompt + tool rounds.
    const MAX_HISTORY_CHARS = 150_000 * 4;
    let historyChars = 0;
    const trimmedMessages = [];
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const len = (chatMessages[i].content ?? '').length;
      if (historyChars + len > MAX_HISTORY_CHARS) break;
      historyChars += len;
      trimmedMessages.unshift(chatMessages[i]);
    }
    // Always include at least the last message so the request isn't empty.
    if (trimmedMessages.length === 0 && chatMessages.length > 0) {
      trimmedMessages.push(chatMessages[chatMessages.length - 1]);
    }

    const messages: Anthropic.MessageParam[] = trimmedMessages.map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        const MAX_TOOL_ROUNDS = 25;
        let round = 0;
        const sources: Array<{ id: string; title: string; snippet: string }> = [];
        const seenSourceIds = new Set<string>();
        const turnToolCalls: ToolCallRecord[] = [];
        let stepCounter = 0;

        try {
          while (round < MAX_TOOL_ROUNDS) {
            round++;
            const learningsAndContext =
              (await fetchLearnings()) + conversationContext;
            const response = await anthropic.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 4096,
              system: [
                {
                  type: 'text',
                  text: SYSTEM_PROMPT,
                  cache_control: { type: 'ephemeral' },
                },
                ...(learningsAndContext
                  ? [{ type: 'text' as const, text: learningsAndContext }]
                  : []),
              ],
              tools,
              tool_choice: { type: 'auto' },
              messages,
            });

            console.log('USAGE:', JSON.stringify(response.usage));

            const toolUseBlocks = response.content.filter(
              (b): b is Anthropic.ContentBlock & { type: 'tool_use' } =>
              b.type === 'tool_use'
            );

            if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
              const textBlocks = response.content.filter(
                (b): b is Anthropic.ContentBlock & { type: 'text' } =>
                b.type === 'text'
              );
              const finalText = textBlocks.map((b: any) => b.text).join('\n');
              const reply = extractReply(finalText);
              const verifiedReply = verifyClaims(reply, turnToolCalls);
              send('done', { reply: verifiedReply, sources });
              controller.close();
              return;
            }

            messages.push({
              role: 'assistant',
              content: response.content as any,
            });

            const toolResults: any[] = [];
            for (const toolBlock of toolUseBlocks) {
              const toolInput = (toolBlock as any).input as Record<string, unknown>;
              const stepId = `s${++stepCounter}`;
              const label = humanizeToolCall(toolBlock.name, toolInput);
              const startedAt = Date.now();
              send('trace', {
                id: stepId,
                phase: 'start',
                tool: toolBlock.name,
                label,
              });

              const result = await executeTool(
                toolBlock.name,
                toolInput,
                gmailAccessToken
              );
              if (toolBlock.name === 'search_references') {
                collectSources(result, sources, seenSourceIds);
              }

              send('trace', {
                id: stepId,
                phase: 'end',
                tool: toolBlock.name,
                durationMs: Date.now() - startedAt,
              });

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: result,
              });
              turnToolCalls.push({ name: toolBlock.name, result });
            }

            messages.push({
              role: 'user',
              content: toolResults,
            });
          }

          send('done', {
            reply:
              '[Agent reached maximum tool-use rounds. Please try a simpler query.]',
            sources,
          });
          controller.close();
        } catch (err: any) {
          console.error('Claude error', err);
          send('error', {
            error: 'Server error',
            details: err?.message ?? String(err),
          });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    console.error('Claude error', err);
    return NextResponse.json(
      { error: 'Server error', details: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
