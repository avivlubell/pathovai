import { executeGmailTool } from './gmail-tools';
import { executeDriveTool } from './drive-tools';
import { executeCalendarTool } from './calendar-tools';
import { loadSkill } from '../../../lib/skills';

const SUPABASE_FUNCTIONS_BASE = 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const EXPLORIUM_BASE = 'https://api.explorium.ai';
const EXPLORIUM_API_KEY = process.env.EXPLORIUM_API_KEY || '';

const HUNTER_API_KEY = process.env.HUNTER_API_KEY || '';

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
  invoke_ai_imaging_operator: 'ai-imaging-operator',
};

const SLOW_FUNCTIONS = new Set(['prospect-researcher', 'outreach-drafter', 'icp-scorer', 'signal-brief', 'risk-assessor', 'fetch-gap-content', 'run-prospect-pipeline']);

export async function callEdgeFunction(
  functionName: string,
  body: Record<string, unknown>,
  retries = 2
): Promise<unknown> {
  const url = `${SUPABASE_FUNCTIONS_BASE}/${functionName}`;
  const timeoutMs = SLOW_FUNCTIONS.has(functionName) ? 240_000 : 30_000;
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
        signal: AbortSignal.timeout(timeoutMs),
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
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      if (!isTimeout && attempt < retries) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      const msg = isTimeout
        ? `${functionName} timed out after ${timeoutMs / 1000}s — Perplexity may be slow. Try again.`
        : `Failed to call ${functionName}: ${err.message}`;
      return { error: msg };
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

async function callExplorium(
  method: 'GET' | 'POST',
  path: string,
  queryParams?: Record<string, string>,
  body?: object
): Promise<string> {
  const qs = queryParams ? `?${new URLSearchParams(queryParams)}` : '';
  const url = `${EXPLORIUM_BASE}${path}${qs}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'api_key': EXPLORIUM_API_KEY,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text();
      return JSON.stringify({ error: `Explorium error ${res.status}`, detail: text.slice(0, 300) });
    }
    return res.text();
  } catch (err: any) {
    const msg = err.name === 'TimeoutError' ? 'Explorium request timed out after 30s' : `Explorium fetch failed: ${err.message}`;
    return JSON.stringify({ error: msg });
  }
}

async function executeExploriumAutocomplete(input: Record<string, unknown>): Promise<string> {
  const entity = String(input.entity_type || 'business');
  const field = String(input.field || '');
  const query = String(input.query || '');
  if (!field) return JSON.stringify({ error: 'field is required' });
  const basePath = entity === 'prospect' ? '/v1/prospects/autocomplete' : '/v1/businesses/autocomplete';
  const params: Record<string, string> = { field };
  if (query) params.query = query;
  return callExplorium('GET', basePath, params);
}

async function executeExploriumFetchBusinesses(input: Record<string, unknown>): Promise<string> {
  const pageSize = Math.min(Number(input.page_size) || 25, 100);
  const page = Number(input.page) || 1;
  const filters: Record<string, unknown> = {};
  if (Array.isArray(input.company_size)) filters.company_size = { values: input.company_size };
  if (Array.isArray(input.company_revenue)) filters.company_revenue = { values: input.company_revenue };
  if (Array.isArray(input.company_country_code)) filters.country_code = { values: input.company_country_code };
  if (Array.isArray(input.linkedin_category)) filters.linkedin_category = { values: input.linkedin_category };
  if (Array.isArray(input.business_intent_topics)) {
    filters.business_intent_topics = { topics: input.business_intent_topics };
  }
  if (input.events && typeof input.events === 'object') {
    const ev = input.events as { types?: string[]; days?: number };
    if (Array.isArray(ev.types)) filters.events = { values: ev.types, last_occurrence: ev.days ?? 90 };
  }
  return callExplorium('POST', '/v1/businesses', undefined, { mode: 'full', page, page_size: pageSize, filters });
}

async function executeExploriumFetchProspects(input: Record<string, unknown>): Promise<string> {
  const pageSize = Math.min(Number(input.page_size) || 25, 100);
  const page = Number(input.page) || 1;
  const filters: Record<string, unknown> = {};
  if (Array.isArray(input.business_ids)) filters.business_id = { values: input.business_ids };
  if (Array.isArray(input.job_title)) filters.job_title = { values: input.job_title, include_related_job_titles: true };
  if (Array.isArray(input.job_level)) filters.job_level = { values: input.job_level };
  if (Array.isArray(input.job_department)) filters.job_department = { values: input.job_department };
  if (Array.isArray(input.prospect_country_code)) filters.country_code = { values: input.prospect_country_code };
  if (Array.isArray(input.company_size)) filters.company_size = { values: input.company_size };
  if (Array.isArray(input.company_country_code)) filters.company_country_code = { values: input.company_country_code };
  if (input.has_email === true) filters.has_email = { value: true };
  return callExplorium('POST', '/v1/prospects', undefined, { mode: 'full', page, page_size: pageSize, filters });
}

async function executeExploriumEnrichContacts(input: Record<string, unknown>): Promise<string> {
  const ids = input.prospect_ids;
  if (!Array.isArray(ids) || ids.length === 0) return JSON.stringify({ error: 'prospect_ids array is required' });
  const contact_types = Array.isArray(input.contact_types) ? input.contact_types : ['email'];
  return callExplorium('POST', '/v1/prospects/contacts_information/enrich', undefined, {
    prospect_ids: ids,
    contact_types,
  });
}

async function executeExploriumMatchBusiness(input: Record<string, unknown>): Promise<string> {
  const businesses = input.businesses;
  if (!Array.isArray(businesses) || businesses.length === 0) {
    return JSON.stringify({ error: 'businesses array is required' });
  }
  return callExplorium('POST', '/v1/businesses/match', undefined, { businesses });
}

async function fetchEdgarFormD(companyName: string): Promise<{ found: boolean; filingCount: number; lastFilingDate: string | null }> {
  const query = encodeURIComponent(`"${companyName}"`);
  const url = `https://efts.sec.gov/LATEST/search-index?q=${query}&forms=D&dateRange=custom&startdt=2015-01-01`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PathovAI aviv.lubell@pathovagtm.com' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { found: false, filingCount: 0, lastFilingDate: null };
    const data = await res.json() as any;
    const hits: any[] = data?.hits?.hits || [];
    const filingCount: number = data?.hits?.total?.value ?? hits.length;
    const lastFilingDate: string | null = hits[0]?._source?.file_date ?? null;
    return { found: filingCount > 0, filingCount, lastFilingDate };
  } catch {
    return { found: false, filingCount: 0, lastFilingDate: null };
  }
}

async function fetchWebsiteLanguage(domain: string): Promise<{ clinicalOnly: boolean; economicBuyerLanguage: boolean; evidence: string } | null> {
  try {
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Analyze this medical device company website. Does it use economic buyer language (ROI, cost per case, CFO, procurement, reimbursement, budget, supply chain, value-based) or is it purely clinical (surgeon outcomes, clinical evidence, study results, accuracy, sensitivity)?

Website text: ${text}

Return JSON only, no other text:
{"clinical_only": true/false, "economic_buyer_language": true/false, "evidence": "short direct quote from the text proving your answer"}`,
        }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!claudeRes.ok) return null;
    const claudeData = await claudeRes.json() as any;
    const responseText: string = claudeData.content?.[0]?.text || '{}';
    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      clinicalOnly: parsed.clinical_only ?? true,
      economicBuyerLanguage: parsed.economic_buyer_language ?? false,
      evidence: parsed.evidence || '',
    };
  } catch {
    return null;
  }
}

async function executeInvokeCrackScorer(input: Record<string, unknown>): Promise<string> {
  const companyName = String(input.company_name || '').trim();
  const domain = input.domain ? String(input.domain).trim() : null;
  const fdaClearanceDateProvided = input.fda_clearance_date ? String(input.fda_clearance_date) : null;

  if (!companyName) return JSON.stringify({ error: 'company_name is required' });

  // Step 1: Resolve Explorium business_id
  const matchRaw = await callExplorium('POST', '/v1/businesses/match', undefined, {
    businesses: [{ name: companyName, ...(domain ? { domain } : {}) }],
  });
  let businessId: string | null = null;
  try {
    const matchData = JSON.parse(matchRaw);
    const candidates: any[] = matchData?.data ?? matchData?.matched_businesses ?? [];
    businessId = candidates[0]?.business_id ?? null;
  } catch { /* leave null */ }

  // Step 2: Parallel data collection
  const [maProspectsResult, salesProspectsResult, fdaResult, edgarResult, websiteResult] = await Promise.allSettled([
    businessId
      ? callExplorium('POST', '/v1/prospects', undefined, {
          mode: 'full', page: 1, page_size: 25,
          filters: {
            business_id: { values: [businessId] },
            job_title: { values: ['market access', 'health economics', 'HEOR', 'reimbursement', 'payer relations'], include_related_job_titles: true },
          },
        })
      : Promise.resolve(null),

    businessId
      ? callExplorium('POST', '/v1/prospects', undefined, {
          mode: 'full', page: 1, page_size: 25,
          filters: {
            business_id: { values: [businessId] },
            job_department: { values: ['sales'] },
          },
        })
      : Promise.resolve(null),

    fdaClearanceDateProvided
      ? Promise.resolve(null)
      : executeFdaDevices({ company_name: companyName, type: '510k', limit: 3 }),

    fetchEdgarFormD(companyName),

    domain ? fetchWebsiteLanguage(domain) : Promise.resolve(null),
  ]);

  // Step 3: Parse signal values
  const parseTotal = (result: PromiseSettledResult<string | null>): number | null => {
    if (result.status !== 'fulfilled' || !result.value) return null;
    try {
      const d = JSON.parse(typeof result.value === 'string' ? result.value : JSON.stringify(result.value));
      if (typeof d?.total === 'number') return d.total;
      if (Array.isArray(d?.data)) return d.data.length;
      return null;
    } catch { return null; }
  };

  const maHireCount = parseTotal(maProspectsResult);
  const salesHeadcount = parseTotal(salesProspectsResult);

  let fdaClearanceDate: string | null = fdaClearanceDateProvided;
  if (!fdaClearanceDate && fdaResult.status === 'fulfilled' && fdaResult.value) {
    try {
      const fdaData = JSON.parse(typeof fdaResult.value === 'string' ? fdaResult.value : JSON.stringify(fdaResult.value));
      fdaClearanceDate = fdaData?.results?.[0]?.decision_date ?? null;
    } catch { /* leave null */ }
  }

  const edgar = edgarResult.status === 'fulfilled' ? edgarResult.value as { found: boolean; filingCount: number; lastFilingDate: string | null } : null;
  const website = websiteResult.status === 'fulfilled' ? websiteResult.value as { clinicalOnly: boolean; economicBuyerLanguage: boolean; evidence: string } | null : null;

  // Step 4: Score dimensions (null = insufficient data, not zero)
  const scores: Record<string, number | null> = {};
  const flags: string[] = [];

  // D1: No reimbursement / market access hire
  if (maHireCount === null) {
    scores.reimbursement_hire = null;
  } else if (maHireCount === 0) {
    scores.reimbursement_hire = 1;
    flags.push('no_reimbursement_hire');
  } else {
    scores.reimbursement_hire = 0;
  }

  // D2: No commercial sales presence
  if (salesHeadcount === null) {
    scores.sales_presence = null;
  } else if (salesHeadcount === 0) {
    scores.sales_presence = 1;
    flags.push('no_sales_headcount');
  } else {
    scores.sales_presence = 0;
  }

  // D3: Clinical-only website language
  if (website === null) {
    scores.website_language = null;
  } else if (website.clinicalOnly && !website.economicBuyerLanguage) {
    scores.website_language = 1;
    flags.push('clinical_only_language');
  } else {
    scores.website_language = 0;
  }

  // D4: Capital raised with no commercial build
  if (edgar === null) {
    scores.capital_without_gtm = null;
  } else if (edgar.found && salesHeadcount === 0 && maHireCount === 0) {
    scores.capital_without_gtm = 1;
    flags.push('capital_without_gtm');
  } else {
    scores.capital_without_gtm = 0;
  }

  const scoredValues = Object.values(scores).filter((s): s is number => s !== null);
  const totalScore = scoredValues.reduce((sum, s) => sum + s, 0);
  const coverageGaps = Object.entries(scores).filter(([, v]) => v === null).map(([k]) => k);

  const fragility_tier =
    totalScore >= 3 ? 'HIGH' :
    totalScore >= 2 ? 'MEDIUM' :
    totalScore >= 1 ? 'LOW' : 'MINIMAL';

  const outreach_angle = (fragility_tier === 'HIGH' || fragility_tier === 'MEDIUM') ? 'diagnostic' : 'light_touch';

  return JSON.stringify({
    company: companyName,
    total_crack_score: totalScore,
    max_scored: scoredValues.length,
    fragility_tier,
    flags,
    coverage_gaps: coverageGaps,
    outreach_angle,
    dimension_scores: scores,
    raw_signals: {
      business_found: !!businessId,
      ma_hire_count: maHireCount,
      sales_headcount: salesHeadcount,
      fda_clearance_date: fdaClearanceDate,
      form_d_filings: edgar?.filingCount ?? null,
      form_d_last_date: edgar?.lastFilingDate ?? null,
      website_clinical_only: website?.clinicalOnly ?? null,
      website_economic_language: website?.economicBuyerLanguage ?? null,
      website_evidence: website?.evidence ?? null,
    },
  });
}

async function executeVerifyEmail(input: Record<string, unknown>): Promise<string> {
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) return JSON.stringify({ error: 'email is required' });
  if (!HUNTER_API_KEY) return JSON.stringify({ error: 'HUNTER_API_KEY not configured' });
  try {
    const params = new URLSearchParams({ email, api_key: HUNTER_API_KEY });
    const res = await fetch(`https://api.hunter.io/v2/email-verifier?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text();
      return JSON.stringify({ error: `Hunter.io error ${res.status}`, detail: text.slice(0, 200) });
    }
    const json = await res.json() as any;
    const d = json?.data || {};
    return JSON.stringify({
      email,
      status: d.status,
      result: d.result,
      score: d.score,
      mx_records: d.mx_records,
      smtp_server: d.smtp_server,
      smtp_check: d.smtp_check,
      disposable: d.disposable,
      webmail: d.webmail,
      accept_all: d.accept_all,
    });
  } catch (err: any) {
    const msg = err.name === 'TimeoutError' ? 'Hunter.io request timed out' : `Hunter.io fetch failed: ${err.message}`;
    return JSON.stringify({ error: msg });
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
  if (toolName === 'invoke_crack_scorer') return executeInvokeCrackScorer(toolInput);
  if (toolName === 'explorium_autocomplete') return executeExploriumAutocomplete(toolInput);
  if (toolName === 'explorium_fetch_businesses') return executeExploriumFetchBusinesses(toolInput);
  if (toolName === 'explorium_fetch_prospects') return executeExploriumFetchProspects(toolInput);
  if (toolName === 'explorium_enrich_contacts') return executeExploriumEnrichContacts(toolInput);
  if (toolName === 'explorium_match_business') return executeExploriumMatchBusiness(toolInput);
  if (toolName === 'verify_email') return executeVerifyEmail(toolInput);
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
    case 'invoke_crack_scorer':
      return pickName() ? `Scoring commercial fragility for ${pickName()}` : 'Scoring commercial fragility';
    case 'invoke_ai_imaging_operator':
      return pickName() ? `Running AI imaging diagnosis for ${pickName()}` : 'Running AI imaging operator';
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
    case 'explorium_autocomplete':
      return 'Standardizing Explorium filter values';
    case 'explorium_fetch_businesses':
      return 'Searching Explorium for matching companies';
    case 'explorium_fetch_prospects':
      return 'Finding contacts via Explorium';
    case 'explorium_enrich_contacts':
      return 'Fetching contact emails from Explorium';
    case 'verify_email': {
      const em = input.email as string | undefined;
      return em ? `Verifying ${em}` : 'Verifying email';
    }
    case 'explorium_match_business':
      return pickName() ? `Looking up ${pickName()} in Explorium` : 'Matching company in Explorium';
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
