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
    case 'query_industry_intelligence':
      return 'Querying market intelligence briefings';
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
  query_industry_intelligence: 'query-industry-intelligence',
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
    name: 'query_industry_intelligence',
    description: 'Query the 📡 Market Intelligence Briefings — Notion-sourced weekly scan of MedTech commercial signals (RAPID/CMS/CPT pathway updates, GPO contract wins, hospital M&A, FDA clearances in adjacent categories, funding climate, technology tailwinds/headwinds). This is news about the WORLD a prospect operates in, not facts about the prospect itself. Use as a precondition before invoke_outreach_drafter to find timely macro hooks (RAPID pathway, M&A in their category, new CPT codes), and on direct user questions like "what\'s new this week?" / "any RAPID news?" / "what\'s happening in cardiovascular?". Filter by category, signal_type, therapeutic_area, topic_tags, icp_stage, urgency_window, and recency_days. Returns rows of {title, category, signal_type, source_publication, source_url, source_date, what_happened, so_what, urgency_window}.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Single-select. One of: "Procurement & VAC", "Reimbursement & Payer", "Regulatory & FDA", "Funding & Investor", "Tech Trend".' },
        signal_type: { type: 'string', description: 'Single-select. One of: "Tailwind", "Headwind", "Event", "Mixed".' },
        therapeutic_area: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these therapeutic areas (array overlap). Allowed values: cardiovascular, neurology, orthopedics, imaging, RPM, AI diagnostics, surgical robotics, digital health, ambient AI, transseptal, oncology, point-of-care.' },
        topic_tags: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these topic tags (array overlap). Allowed values: RAPID, GPO, M&A, CPT-2026, breakthrough-designation, prior-auth, ambient, EHR-integration, 510k, robotics, ASC, IDN-consolidation, Vizient, Premier, HealthTrust, FHIR.' },
        icp_stage: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these ICP stages (array overlap). Allowed values: pre-clearance, post-clearance, pilot, scaling, bridge.' },
        buyer_persona: { type: 'array', items: { type: 'string' }, description: 'Match ANY of these buyer personas (array overlap). Allowed values: CMO, VAC, Supply Chain, CFO, CIO, Procurement.' },
        urgency_window: { type: 'string', description: 'Single-select. One of: "This week", "30-60 days", "Quarter", "Standing".' },
        recency_days: { type: 'number', description: 'Only rows where source_date is within the last N days. Default 60. Pass 0 for no recency filter.' },
        query: { type: 'string', description: 'Free-text fuzzy match against title / what_happened / so_what.' },
        limit: { type: 'number', description: 'Max rows to return (default 5, max 25).' },
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

// LLM-based claim verifier. Sends the assistant's draft + the raw tool
// outputs to a fast Haiku model and asks it to flag specific claims that
// can't be grounded in the data. Replaces an earlier regex/substring
// approach that produced false positives on date format mismatches
// ("Dec 2025" vs "2025-12-15"), spelling/casing variants, and rhetorical
// commentary ("the elephant in the room…").
//
// Output format is unchanged from the regex version: each flagged claim
// becomes an inline ⚠ line in the body plus a numbered entry in a
// "Things worth double-checking" checklist appended at the bottom, with
// a paste-ready verification prompt routed to Notion AI (for
// CRM-resident claims) or Perplexity (for web claims).
//
// Fail-open: if the verifier API call errors, the original text is
// returned unmodified rather than mass-flagged.
const VERIFIER_TOOL = {
  name: 'report_verification',
  description:
    'Report claims in the assistant draft that cannot be grounded in the tool outputs.',
  input_schema: {
    type: 'object' as const,
    properties: {
      flag: {
        type: 'array',
        description:
          'Specific claims that cannot be confirmed from the tool data and should be surfaced to the user for verification.',
        items: {
          type: 'object',
          properties: {
            line: {
              type: 'string',
              description:
                'The verbatim line from the draft, including any leading bullet markers, list numbers, or table pipe characters. Must match the draft text exactly so the line can be located and replaced.',
            },
            claim: {
              type: 'string',
              description: 'A short, readable description of the unverified claim.',
            },
            reason: {
              type: 'string',
              description:
                'One sentence stating the specific entity/number/date/quote you searched for in the corpus and confirming it was absent. Format: "Searched corpus for X — not present." Do not use generic phrases like "needs a source tag" or "doesn\'t say where this came from"; those are not valid grounding-failure reasons.',
            },
            criticality: {
              type: 'string',
              enum: ['HIGH', 'MEDIUM', 'LOW'],
              description:
                'HIGH = factual error likely to mislead. MEDIUM = should verify before acting. LOW = probably fine but worth a check.',
            },
          },
          required: ['line', 'claim', 'reason', 'criticality'],
        },
      },
      strip: {
        type: 'array',
        description:
          'Direct quotes attributed to a named person or org that do not appear in the tool data. These lines will be removed from the response.',
        items: {
          type: 'object',
          properties: {
            line: {
              type: 'string',
              description: 'The verbatim line from the draft to remove. Must match exactly.',
            },
            reason: {
              type: 'string',
              description: 'One sentence explaining why this is treated as fabrication.',
            },
          },
          required: ['line', 'reason'],
        },
      },
    },
    required: ['flag', 'strip'],
  },
};

const VERIFIER_SYSTEM_PROMPT = `You are a fact-checker for a sales prospecting assistant. You receive a draft response the assistant wrote and the raw tool outputs the assistant pulled. Identify specific claims in the draft that cannot be grounded in the tool outputs.

YOUR ONE JOB is grounding: did the entity / number / date / quote in the draft appear in the corpus? Nothing else.

You are NOT a style reviewer, citation reviewer, or QA assistant. Specifically, do not:
- Flag lines for missing inline source tags, citations, or attribution. The assistant has its own rules about citations; that is not your concern.
- Invent your own QA criteria. The "Do NOT flag" list below is exhaustive — if a line doesn't fall into a flag category from THIS prompt, leave it alone.
- Use generic reasons like "doesn't say where this came from" or "needs a source tag". The only valid reason to flag is that you searched the corpus and the specific entity/number/date/quote is genuinely absent.

Before flagging anything, you MUST search the corpus for the supporting evidence. The reason field MUST quote a verbatim excerpt of what you searched for and confirm the corpus did not contain it. If you cannot articulate what specifically you searched for and didn't find, do not flag.

Be tolerant of harmless format differences:
- Date formats: "Dec 2025", "December 2025", "12/2025", "2025-12-15" all refer to the same date.
- Name variants: "IdentifEye" matches "Identifeye" matches "identifeye health". Case and spacing don't matter.
- Numeric formats: "$10M" matches "$10,000,000" matches "10 million".
- Aggregations: if the draft says "78 LinkedIn touches" and the data has 78 LinkedIn rows, that's correct — do not flag derived counts/sums.

Two output categories:

flag — a claim cannot be grounded and should be surfaced to the user:
- A name of a person, org, or product not in the data.
- A number, date, or amount not in the data (after format normalization).
- A claim that contradicts the data.
- A claim attributed to "the data" or "the records" that you cannot find in the data.

strip — a direct quote attributed to a specific named person or org that is not in the data. Use sparingly; only for explicit attributed quotes (e.g. \`Kirk said: "we love this product"\`), not for paraphrases or characterizations.

Do NOT flag:
- Editorial commentary, rhetorical questions, framing language, or transitions ("the elephant in the room", "before we start firing these off", "what's the play?").
- Counts, sums, or aggregations clearly derived from rows in the data.
- Generic tactical recommendations or qualitative observations.
- Common knowledge or domain language unrelated to the user's specific data.
- Claims that match the data with only minor format/spelling differences.
- Section headers, labels, or table column headers.
- Editorial summaries, paraphrases, or meta-statements about how a knowledge-base / reference document labels, frames, indexes, or organizes content — these are the assistant's interpretation of the source, not factual claims about prospects, dates, or entities. Examples to leave alone: "the term used in the KB is X", "the KB frames this as Y", "it's not indexed under Z as a label", "the solution framing — not 'remove the founder', but…". Quoted key phrases inside such summaries are the assistant naming a concept, not asserting a verbatim citation, and should not be flagged just because the exact phrase isn't in the corpus.
- Conceptual / methodology questions answered from \`search_references\` (the Pathova Reference Library). The corpus is internal methodology docs; the assistant is allowed to summarize, paraphrase, and re-label content. Only flag if the assistant invents a specific entity, number, date, person, or quote that isn't supported anywhere in the corpus.
- Self-reports about tool execution and session state — statements describing what a tool call did or did not return ("the query returned zero results", "no rows came back from search_accounts_and_contacts", "I couldn't find X in the data I pulled", "the touches log has 63 unique accounts"). These describe the assistant's own session, not claims about prospects, and are unverifiable from a corpus that contains only tool outputs by construction.
- Statements about the assistant's own capabilities, tool availability, or process limitations ("there's no single query that returns Y", "I'd need to pull each account individually", "this would be labor intensive", "I don't have a tool that does Z"). These describe the toolset, not the data.
- Procedural recommendations and suggested user actions ("you could run a Notion filter where X is empty", "the fastest path is to check Y", "try opening Z and filtering by W"). Advice about what the user *could do* is not a factual assertion about prospects, dates, or entities — even if it names a Notion property or describes a feature. Only flag if the recommendation embeds a specific made-up entity, number, or quote.
- Hedged inferences and hypotheses explicitly framed as such ("this looks like a sync gap between Notion and Supabase", "appears to be incomplete", "I'd guess that…"). Only flag if the hedge wraps a specific invented entity/number/date/quote.
- Faithful row summaries from tool query results. If \`query_deals\` returned a row for "Healables" with stage "Won" and a non-empty notes field, then the draft line "Healables / Won / Detailed notes present" is a correct summary of that row. Words like "Detailed notes present", "No notes", "notes available", "stage: Won", "in qualifying" are the assistant's characterizations of row content — do not require these phrases to appear verbatim in the corpus. Only flag if the company isn't in the deals output, the stage is wrong, or the notes-presence summary contradicts what's actually in the row.
- Copy-pasteable research prompts the assistant authored for the user to run in an external tool (Perplexity, Comet, Crunchbase, FDA 510(k), Notion AI, LinkedIn). These are imperatives, not claims — they tell the user what to fetch, not what is true. Recognize them by the imperative voice ("Search for…", "Return all funding rounds…", "List every person with…", "Copy verbatim…", "Find any page mentioning…"), and by adjacent venue pointers like "→ Crunchbase" or "→ FDA 510(k) database". The assistant naming a target company inside such a prompt (e.g. "Search for 'Aevice Health'") is not a claim about Aevice — it's a query string. Leave the entire block alone.
- Section headers and venue pointers: lines like "PRIORITY 4 — Funding verification", "PRIORITY 7 — Red flags check", "→ Crunchbase", "→ LinkedIn people page" are scaffolding for the prompt blocks above. They are not claims and have no source to cite. Never flag them with reasons like "doesn't say where this came from" or "needs a source tag" — that reason is categorically banned.

Worked example. Suppose the corpus contains a \`query_deals\` block with rows including:
  { company: "Healables", stage: "Won", notes: "Long detailed text here..." }
  { company: "PathKeeper Surgical", stage: "Won", notes: null }
The draft says:
  - Healables / Won / Detailed notes present
  - PathKeeper Surgical / Won / No notes
Correct verifier output: empty flag array. Both lines are faithful summaries of rows that exist in the corpus, even though the strings "Detailed notes present" and "No notes" do not appear verbatim in the data.

Be conservative. False positives are worse than missed edge cases — the user has explicitly asked for fewer false flags. Return empty arrays if nothing is wrong. When in doubt, don't flag.

Rule of thumb before flagging: ask "is this a claim about a prospect, person, company, date, number, or quote?" If it's a claim about *the assistant's tools*, *the act of querying*, *what the user could do next*, *the assistant's own uncertainty*, or *a faithful summary of a row that exists in the corpus*, do not flag it — even if the exact wording isn't in the corpus, since the corpus is tool output, not session metadata.

For each flagged item, the \`line\` field MUST be a verbatim copy of the draft line (including leading bullet/number/pipe characters) so it can be located by exact substring match and replaced.`;

async function verifyClaims(text: string, toolCalls: ToolCallRecord[]): Promise<string> {
  if (!text || toolCalls.length === 0) return text;

  const corpus = toolCalls
    .map(tc => `=== ${tc.name} ===\n${tc.result}`)
    .join('\n\n');

  // Fenced code blocks in the draft are copy-pasteable research prompts
  // (per prompt.txt's GAP rendering convention). Their contents are
  // imperatives the user will run in Perplexity / Crunchbase / FDA, not
  // factual claims about prospects — redact them so the verifier doesn't
  // try to ground "Search for 'Aevice'" or "Return all funding rounds".
  const draftForVerifier = text.replace(
    /```[\s\S]*?```/g,
    '```[copy-pasteable research prompt — not a factual claim, ignore]```',
  );

  type Flag = { line: string; claim: string; reason: string; criticality: string };
  type Strip = { line: string; reason: string };
  let flags: Flag[] = [];
  let strips: Strip[] = [];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: VERIFIER_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [VERIFIER_TOOL as any],
      tool_choice: { type: 'tool', name: 'report_verification' },
      messages: [
        {
          role: 'user',
          content:
            `<draft>\n${draftForVerifier}\n</draft>\n\n` +
            `<tool_data>\n${corpus}\n</tool_data>`,
        },
      ],
    });
    console.log('VERIFIER USAGE:', JSON.stringify(response.usage));
    const toolUse = response.content.find(
      (b): b is Anthropic.ContentBlock & { type: 'tool_use' } => b.type === 'tool_use',
    );
    if (toolUse) {
      const input = toolUse.input as { flag?: Flag[]; strip?: Strip[] };
      flags = Array.isArray(input.flag) ? input.flag : [];
      strips = Array.isArray(input.strip) ? input.strip : [];
    }
  } catch (e) {
    console.error('[verifyClaims] LLM verifier failed; returning text unmodified', e);
    return text;
  }

  // Drop flags whose reason is a banned meta-pattern. The verifier prompt
  // forbids reasons like "doesn't say where this came from" / "needs a source
  // tag" — they are not grounding failures, they're style/citation gripes.
  // Haiku occasionally violates the rule anyway, so we enforce it here too.
  const BANNED_REASON = /\b(needs?|missing|add|lacks?|requires?|without|no)\s+(an?\s+)?(source|citation|reference|attribution)\s*(tag|link|url)?|doesn'?t\s+say\s+where|where\s+(the\s+)?(quote|claim|info(rmation)?)\s+came\s+from|missing\s+(a\s+)?source\s+tag\b/i;
  const beforeFlagFilter = flags.length;
  flags = flags.filter(f => {
    if (!f.reason) return true;
    if (BANNED_REASON.test(f.reason)) {
      console.warn(
        `[verifyClaims] dropped flag with banned meta-reason: ${JSON.stringify(f.reason.slice(0, 160))}`,
      );
      return false;
    }
    return true;
  });
  if (flags.length !== beforeFlagFilter) {
    console.warn(
      `[verifyClaims] filtered ${beforeFlagFilter - flags.length} flag(s) with banned reasons`,
    );
  }

  if (flags.length === 0 && strips.length === 0) return text;

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
    query_industry_intelligence: 'Industry Intelligence (Market Intelligence Briefings)',
    query_deals: 'Motions & Deals',
    sync_account_content: 'Outreach Intelligence',
    search_references: 'Pathova Reference Library',
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
    if (c.startsWith('|') || /\s\|\s/.test(c)) {
      c = c.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').replace(/\s*\|\s*/g, ' / ');
    }
    return c.slice(0, 240);
  };

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

  // Apply mutations to the draft. Strips remove the matched line entirely;
  // flags replace it with an inline ⚠ prose flag. Both rely on exact
  // substring lookup against the verbatim line returned by the verifier —
  // if the line can't be located, we log and skip rather than mangling
  // surrounding output.
  let working = text;
  const stripped: string[] = [];

  for (const s of strips) {
    if (!s.line) continue;
    const idx = working.indexOf(s.line);
    if (idx === -1) {
      console.warn(
        `[verifyClaims] strip line not found in draft: ${JSON.stringify(s.line.slice(0, 120))}`,
      );
      continue;
    }
    const lineStart = working.lastIndexOf('\n', idx - 1) + 1;
    const lineEnd = working.indexOf('\n', idx + s.line.length);
    const end = lineEnd === -1 ? working.length : lineEnd + 1;
    const fullLine = working.slice(lineStart, lineEnd === -1 ? working.length : lineEnd).trim();
    stripped.push(fullLine);
    working = working.slice(0, lineStart) + working.slice(end);
    console.warn(
      `[verifyClaims] stripped line. reason: ${s.reason}. line: ${s.line.slice(0, 160)}`,
    );
  }

  type ChecklistItem = {
    claim: string;
    criticality: string;
    reason: string;
    prompt: string;
  };
  const items: ChecklistItem[] = [];

  for (const f of flags) {
    if (!f.line) continue;
    const idx = working.indexOf(f.line);
    if (idx === -1) {
      console.warn(
        `[verifyClaims] flag line not found in draft: ${JSON.stringify(f.line.slice(0, 120))}`,
      );
      continue;
    }
    const cleaned = cleanClaimText(f.claim || f.line);
    const prose =
      `⚠ I couldn't verify this from the data I pulled — please double-check: ` +
      `${cleaned} *(Worth checking — see list below.)*`;
    working = working.slice(0, idx) + prose + working.slice(idx + f.line.length);
    items.push({
      claim: cleaned,
      criticality: f.criticality || 'unassessed',
      reason: f.reason || '',
      prompt: autoVerifyPrompt(cleaned),
    });
    console.warn(
      `[verifyClaims] flagged line. reason: ${f.reason}. line: ${f.line.slice(0, 160)}`,
    );
  }

  let verified = working.replace(/\n{3,}/g, '\n\n').trim();

  if (items.length === 0 && stripped.length === 0) return verified;

  const sevRank = (s: string): number => {
    const u = s.toUpperCase();
    if (u.startsWith('HIGH')) return 0;
    if (u.startsWith('MEDIUM')) return 1;
    if (u.startsWith('LOW')) return 2;
    return 3;
  };
  items.sort((a, b) => sevRank(a.criticality) - sevRank(b.criticality));

  const totalCount = items.length + stripped.length;
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
    if (item.reason) out.push(`What's missing: ${item.reason}`);
    if (item.prompt) {
      out.push('');
      out.push('How to verify:');
      out.push('```');
      out.push(item.prompt);
      out.push('```');
    }
    out.push('');
  });

  if (stripped.length > 0) {
    out.push(
      `**Removed as likely fabrication** (${stripped.length}) — quoted content I couldn't find in any data I pulled, attributed to someone. The original line${stripped.length === 1 ? ' is' : 's are'} listed below for your awareness; treat as suspect:`,
    );
    out.push('');
    for (const claim of stripped) {
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
              const verifiedReply = await verifyClaims(reply, turnToolCalls);
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
