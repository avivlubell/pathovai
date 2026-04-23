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
  sync_account_content: 'sync-prospect-content',
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
    description: 'Outreach Drafter specialist agent. Takes an ACCOUNT (company) and produces a diagnosis-first PIC (Prospect Intelligence Card) then a 3-touch sequence (LinkedIn + 2 emails) to a single target person AT that company, grounded in evidence and QA-checked. You do NOT need a contact/person id -- the drafter picks the best target from the account data. The drafter auto-pulls prior outreach history from Notion so it avoids repeating angles.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Required -- company UUID from accounts table (NOT a contact/person id)' },
      },
      required: ['account_id'],
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
  const corpusRaw = toolCalls.map(tc => tc.result).join('\n');
  const corpus = corpusRaw.toLowerCase();
  const corpusStripped = corpus.replace(/[,\s]/g, '');

  const inCorpus = (needle: string): boolean => {
    const n = needle.toLowerCase().trim();
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
    QUOTE_SGL: "['‘][^'’]{10,}['’]",
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

  // Wrap an unverified line in a flag block. Used when the verifier
  // catches something the QB did not self-flag. Preserves the original
  // claim so the user sees what was flagged and why.
  const flagInPlace = (line: string, reason: string): string => {
    return (
      `\n⚠ UNVERIFIED (verifier-caught): ${line.trim()}\n` +
      `criticality: unassessed — manual review required\n` +
      `why_unverified: ${reason}\n`
    );
  };

  let flaggedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\r?\n$/.test(line) || line === '') {
      kept.push(line);
      continue;
    }
    // Strip leading bullet/list markers when checking, keep original in output.
    const content = line
      .replace(/^\s*[-*•]\s+/, '')
      .replace(/^\s*\d+\.\s+/, '');

    // Skip lines the QB has already self-flagged — don't double-flag.
    if (/^\s*⚠\s*UNVERIFIED/i.test(content) || /^\s*criticality:/i.test(content) ||
        /^\s*why_unverified:/i.test(content) || /^\s*go_to_url:/i.test(content) ||
        /^\s*verify_prompt:/i.test(content)) {
      kept.push(line);
      continue;
    }

    // HARD FABRICATION CHECK: a quoted string whose content is not in
    // the corpus is invention, not inference. Strip outright.
    const quoteTokens = extractQuoteTokens(content);
    const missingQuote = quoteTokens.find(t => !inCorpus(t));
    if (missingQuote) {
      strippedCount++;
      console.warn(
        `[verifyClaims] HARD FABRICATION stripped. quoted content not in corpus: ${JSON.stringify(missingQuote)}. line: ${line.slice(0, 160)}`
      );
      if (i + 1 < lines.length && /^\r?\n$/.test(lines[i + 1])) i++;
      continue;
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
        kept.push(flagInPlace(line, `attributes a statement to ${attributedNames.join(', ')} but has no source tag (e.g. [transcript], [email:...], [DB])`));
        continue;
      }
      const missingName = attributedNames.find(n => !inCorpus(n));
      if (missingName) {
        flaggedCount++;
        console.warn(
          `[verifyClaims] flagged line — attributed name "${missingName}" not in corpus. line: ${line.slice(0, 160)}`
        );
        kept.push(flagInPlace(line, `attributed name "${missingName}" does not appear in tool output — tag may point to wrong source`));
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
      kept.push(flagInPlace(line, `claim contains detail not found in tool output: ${missingTokens.map(t => JSON.stringify(t)).join(', ')}`));
    }
  }

  let verified = kept.join('').trim();
  const notes: string[] = [];
  if (flaggedCount > 0) {
    notes.push(`${flaggedCount} claim${flaggedCount === 1 ? '' : 's'} flagged as unverified`);
  }
  if (strippedCount > 0) {
    notes.push(`${strippedCount} hard-fabricated claim${strippedCount === 1 ? '' : 's'} stripped (quoted content not in tool output)`);
  }
  if (notes.length > 0) {
    verified += `\n\n_${notes.join(' · ')}._`;
  }
  return verified;
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
            const response = await anthropic.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 4096,
              system:
                SYSTEM_PROMPT + (await fetchLearnings()) + conversationContext,
              tools,
              tool_choice: { type: 'auto' },
              messages,
            });

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
