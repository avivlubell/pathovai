import { executeGmailTool } from './gmail-tools';
import { executeDriveTool } from './drive-tools';
import { executeCalendarTool } from './calendar-tools';
import { loadSkill } from '../../../lib/skills';

const SUPABASE_FUNCTIONS_BASE = 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export const TOOL_ENDPOINT_MAP: Record<string, string> = {
  invoke_signal_brief: 'signal-brief',
  invoke_icp_scorer: 'icp-scorer',
  invoke_prospect_researcher: 'prospect-researcher',
  invoke_outreach_drafter: 'outreach-drafter',
  invoke_risk_assessor: 'risk-assessor',
  get_communications: 'get-communications',
  query_deals: 'query-deals',
  query_icp_triggers: 'query-icp-triggers',
  query_industry_intelligence: 'query-industry-intelligence',
  query_podcast_signals: 'query-podcast-signals',
  query_hiring_signals: 'query-hiring-signals',
  query_touches: 'query-touches',
  fetch_gap_content: 'fetch-gap-content',
  queue_research: 'queue-research',
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
  search_kb: 'search-kb',
  store_learning: 'store-learning',
};

export async function callEdgeFunction(
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

async function executeFdaDevices(input: Record<string, unknown>): Promise<string> {
  const type = String(input.type || '510k').toLowerCase();
  const limit = Math.min(Number(input.limit) || 5, 20);
  const endpoint = type === 'pma'
    ? 'https://api.fda.gov/device/pma.json'
    : type === 'recall'
    ? 'https://api.fda.gov/device/recall.json'
    : 'https://api.fda.gov/device/510k.json';

  const clauses: string[] = [];
  if (input.company_name) clauses.push(`applicant:"${String(input.company_name).replace(/"/g, '')}"`);
  if (input.device_name) clauses.push(`device_name:"${String(input.device_name).replace(/"/g, '')}"`);
  if (input.product_code) clauses.push(`product_code:"${String(input.product_code).replace(/"/g, '')}"`);

  if (clauses.length === 0) return JSON.stringify({ error: 'At least one of company_name, device_name, or product_code is required' });

  const params = new URLSearchParams({ search: clauses.join('+AND+'), limit: String(limit) });
  try {
    const res = await fetch(`${endpoint}?${params}`);
    if (res.status === 404) return JSON.stringify({ total: 0, results: [] });
    if (!res.ok) return JSON.stringify({ error: `FDA API error: ${res.status}` });
    const json = await res.json() as any;
    const results = (json.results || []).map((r: any) => ({
      k_number: r.k_number || r.pma_number || r.res_event_number,
      applicant: r.applicant || r.applicant_full_name,
      device_name: r.device_name || r.generic_name,
      decision_date: r.decision_date,
      decision: r.decision_description || r.decision_code,
      product_code: r.product_code,
      specialty: r.advisory_committee_description || r.openfda?.medical_specialty_description,
      clearance_type: r.clearance_type,
      summary: (r.statement_or_summary || r.recall_reason_description || '').slice(0, 300),
    }));
    return JSON.stringify({ type, total: json.meta?.results?.total, returned: results.length, results });
  } catch (err: any) {
    return JSON.stringify({ error: `FDA fetch failed: ${err.message}` });
  }
}

async function executeIcd10Search(input: Record<string, unknown>): Promise<string> {
  const terms = String(input.terms || '').trim();
  if (!terms) return JSON.stringify({ error: 'terms is required' });
  const limit = Math.min(Number(input.limit) || 15, 50);
  const params = new URLSearchParams({ terms, maxList: String(limit), sf: 'code,name', df: 'code,name', cf: 'code' });
  try {
    const res = await fetch(`https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?${params}`);
    if (!res.ok) return JSON.stringify({ error: `ICD-10 API error: ${res.status}` });
    const [total, codes, , displayPairs] = await res.json() as [number, string[], null, string[][]];
    const results = (codes || []).map((code: string, i: number) => ({
      code,
      description: displayPairs?.[i]?.[1] ?? '',
    }));
    return JSON.stringify({ total_matching: total, returned: results.length, results });
  } catch (err: any) {
    return JSON.stringify({ error: `ICD-10 fetch failed: ${err.message}` });
  }
}

async function executeClinicalTrials(input: Record<string, unknown>): Promise<string> {
  const params = new URLSearchParams({
    format: 'json',
    pageSize: String(Math.min(Number(input.limit) || 10, 25)),
    fields: 'NCTId|BriefTitle|OverallStatus|Phase|StartDate|CompletionDate|LeadSponsorName|BriefSummary|EnrollmentCount|Condition|LocationCountry',
  });
  if (input.condition) params.set('query.cond', String(input.condition));
  if (input.intervention) params.set('query.intr', String(input.intervention));
  if (input.sponsor) params.set('query.lead', String(input.sponsor));
  if (input.term) params.set('query.term', String(input.term));
  if (input.status) params.set('filter.overallStatus', String(input.status));
  if (input.phase) params.set('filter.phase', String(input.phase));
  try {
    const res = await fetch(`https://clinicaltrials.gov/api/v2/studies?${params}`);
    if (!res.ok) return JSON.stringify({ error: `ClinicalTrials API error: ${res.status}` });
    const json = await res.json() as any;
    const studies = (json.studies || []).map((s: any) => {
      const p = s.protocolSection || {};
      const id = p.identificationModule || {};
      const st = p.statusModule || {};
      const design = p.designModule || {};
      const sponsor = p.sponsorCollaboratorsModule || {};
      const desc = p.descriptionModule || {};
      const cond = p.conditionsModule || {};
      return {
        nct_id: id.nctId,
        title: id.briefTitle,
        status: st.overallStatus,
        phase: design.phases,
        start_date: st.startDateStruct?.date,
        completion_date: st.completionDateStruct?.date,
        sponsor: sponsor.leadSponsor?.name,
        conditions: cond.conditions,
        enrollment: design.enrollmentInfo?.count,
        summary: (desc.briefSummary || '').slice(0, 400),
      };
    });
    return JSON.stringify({ total_count: json.totalCount, studies });
  } catch (err: any) {
    return JSON.stringify({ error: `ClinicalTrials fetch failed: ${err.message}` });
  }
}

async function executeCmsCoverage(input: Record<string, unknown>): Promise<string> {
  const type = String(input.type || 'ncd').toLowerCase();
  const limit = Math.min(Number(input.limit) || 10, 25);
  const endpoint = type === 'lcd'
    ? 'https://api.coverage.cms.gov/v1/reports/local-coverage-final-lcds/'
    : 'https://api.coverage.cms.gov/v1/reports/national-coverage-ncd/';
  const params = new URLSearchParams({ page_size: String(limit) });
  if (input.query) params.set('search', String(input.query));
  try {
    const res = await fetch(`${endpoint}?${params}`);
    if (!res.ok) return JSON.stringify({ error: `CMS Coverage API error: ${res.status}` });
    const json = await res.json() as any;
    return JSON.stringify({
      type,
      count: (json.data || []).length,
      has_more: !!json.meta?.next_token,
      results: json.data || [],
    });
  } catch (err: any) {
    return JSON.stringify({ error: `CMS Coverage fetch failed: ${err.message}` });
  }
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  gmailAccessToken?: string
): Promise<string> {
  const gmailResult = await executeGmailTool(toolName, toolInput, gmailAccessToken);
  if (gmailResult !== null) return gmailResult;

  const driveResult = await executeDriveTool(toolName, toolInput, gmailAccessToken);
  if (driveResult !== null) return driveResult;

  const calendarResult = await executeCalendarTool(toolName, toolInput, gmailAccessToken);
  if (calendarResult !== null) return calendarResult;

  if (toolName === 'load_skill') {
    return loadSkill(toolInput.skill as string);
  }
  if (toolName === 'search_fda_devices') return executeFdaDevices(toolInput);
  if (toolName === 'search_icd10') return executeIcd10Search(toolInput);
  if (toolName === 'search_clinical_trials') return executeClinicalTrials(toolInput);
  if (toolName === 'search_cms_coverage') return executeCmsCoverage(toolInput);

  const endpoint = TOOL_ENDPOINT_MAP[toolName];
  if (!endpoint) return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  const result = await callEdgeFunction(endpoint, toolInput);
  return typeof result === 'string' ? result : JSON.stringify(result);
}

export function humanizeToolCall(
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
      return pickName() ? `Pulling prior touches for ${pickName()}` : 'Pulling prior outreach history';
    case 'query_deals':
      return 'Querying deals pipeline';
    case 'query_icp_triggers':
      return 'Querying ICP trigger monitor';
    case 'query_industry_intelligence':
      return 'Querying market intelligence briefings';
    case 'query_podcast_signals':
      return 'Querying podcast signal feed';
    case 'query_hiring_signals':
      return 'Querying hiring signals';
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
    case 'list_calendar_events':
      return pickQuery() ? `Checking calendar for "${pickQuery()}"` : 'Checking your calendar';
    case 'create_calendar_event':
      return (input.summary as string | undefined) ? `Scheduling "${input.summary}"` : 'Creating calendar invite';
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
      return pickQuery() ? `Searching references for "${pickQuery()}"` : 'Searching reference library';
    case 'search_accounts_and_contacts':
      return pickQuery() ? `Searching accounts for "${pickQuery()}"` : 'Searching accounts and contacts';
    case 'get_account_detail':
      return pickName() ? `Looking up ${pickName()}` : 'Looking up account details';
    case 'log_agent_run':
      return 'Logging action to audit trail';
    case 'process_document':
      return 'Processing document';
    case 'search_kb':
      return pickQuery() ? `Searching knowledge base for "${pickQuery()}"` : 'Searching knowledge base';
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
    case 'search_clinical_trials':
      return pickQuery() ? `Searching ClinicalTrials for "${pickQuery()}"` : 'Searching ClinicalTrials.gov';
    case 'search_cms_coverage':
      return pickQuery() ? `Searching CMS Coverage for "${pickQuery()}"` : 'Searching CMS Coverage database';
    case 'search_icd10': {
      const terms = input.terms as string | undefined;
      return terms ? `Looking up ICD-10 codes for "${terms}"` : 'Looking up ICD-10 codes';
    }
    case 'fetch_gap_content': {
      const count = Array.isArray(input.gaps) ? input.gaps.length : 0;
      return count > 1 ? `Fetching ${count} research gaps` : 'Fetching research gap';
    }
    case 'queue_research': {
      const cos = input.companies as string[] | undefined;
      const count = Array.isArray(cos) ? cos.length : 0;
      return count > 1 ? `Queuing overnight research for ${count} companies` : 'Queuing overnight research';
    }
    case 'invoke_signal_brief':
      return pickName() ? `Building Signal Brief for ${pickName()}` : 'Building Signal Brief';
    case 'search_fda_devices':
      return pickName() ? `Searching FDA device database for ${pickName()}` : 'Searching FDA device database';
    case 'delegate_research': {
      const task = input.task as string | undefined;
      const co = input.company_name as string | undefined;
      return co ? `Research Manager → ${co}` : task ? `Research Manager → ${task.slice(0, 50)}` : 'Delegating to Research Manager';
    }
    case 'delegate_crm': {
      const task = input.task as string | undefined;
      const co = input.company_name as string | undefined;
      return co ? `CRM Manager → ${co}` : task ? `CRM Manager → ${task.slice(0, 50)}` : 'Delegating to CRM Manager';
    }
    case 'delegate_qualify': {
      const co = input.company_name as string | undefined;
      return co ? `Qualification Manager → ${co}` : 'Delegating to Qualification Manager';
    }
    case 'delegate_outreach': {
      const co = input.company_name as string | undefined;
      return co ? `Outreach Manager → ${co}` : 'Delegating to Outreach Manager';
    }
    case 'delegate_kb': {
      const task = input.task as string | undefined;
      return task ? `KB Manager → ${task.slice(0, 50)}` : 'Delegating to KB Manager';
    }
    default: {
      const pretty = toolName.replace(/^invoke_/, '').replace(/_/g, ' ');
      return `Running ${pretty}`;
    }
  }
}
