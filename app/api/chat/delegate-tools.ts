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
    name: 'invoke_ai_imaging_operator',
    description:
      'AI Imaging Operator — invoke when the prospect company is in the AI diagnostic imaging space (TA tag = "AI Imaging" or similar). Returns a structured commercial brief: failure mode diagnosis, timing urgency, outreach hook, signal basis, and gaps. Invoke BEFORE generating any signal brief or outreach draft for AI imaging companies. Pass everything the QB already knows about the company in the context object.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: {
          type: 'string',
          description: 'Company name',
        },
        context: {
          type: 'object',
          description: 'All known company data from research, ICP scoring, and CRM lookup this session',
          properties: {
            funding_stage: { type: 'string', description: 'e.g. "Series A", "Seed", "bootstrapped"' },
            headcount: { type: 'number', description: 'Employee count from LinkedIn or research' },
            fda_status: { type: 'string', description: 'e.g. "510(k) cleared Feb 2025", "Pre-submission", "Pending"' },
            public_signals: { type: 'string', description: 'Plain-text summary of public signals from research, ICP triggers, or market intel' },
            pilot_announcements: {
              type: 'array',
              items: { type: 'string' },
              description: 'Each announced pilot with the named stakeholders, e.g. "Pilot at Mass General — only Dr. Smith (radiologist) named in press release"',
            },
            hiring_signals: {
              type: 'array',
              items: { type: 'string' },
              description: 'Commercial hiring signals, e.g. "VP Sales posted on LinkedIn 3 days ago"',
            },
            research_summary: { type: 'string', description: 'The research_summary field from the account record if available' },
            indication: {
              type: 'string',
              description: 'Primary AI imaging indication, e.g. "stroke", "mammography", "chest CT", "PE", "cardiac CT", "lung nodule". Derive from fda_status or research. Used to pull targeted reimbursement and competitive intelligence from the knowledge layer.',
            },
            institution_type: {
              type: 'string',
              enum: ['amc', 'large_idn', 'community_hospital'],
              description: 'Target institution type if known. "amc" = academic medical center, "large_idn" = IDN/health system, "community_hospital". Used to filter procurement intelligence.',
            },
          },
        },
      },
      required: ['company_name'],
    },
  },
  {
    name: 'invoke_crack_scorer',
    description:
      'Commercial Fragility Scorer — detects structural GTM cracks in a MedTech company BEFORE deep research. Runs in parallel: Explorium title + dept search, FDA 510(k) lookup, EDGAR Form D check, website language classification. Returns a crack score (0–4), fragility tier (HIGH/MEDIUM/LOW/MINIMAL), named flags (no_reimbursement_hire, no_sales_headcount, clinical_only_language, capital_without_gtm), and outreach_angle (diagnostic vs light_touch). Use BEFORE invoke_outreach_drafter to determine messaging angle. Use BEFORE invoke_prospect_researcher when you want to triage research depth. Pass fda_clearance_date if already known to skip the FDA lookup.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string', description: 'Target company name' },
        domain: { type: 'string', description: 'Company website domain, e.g. "acmedevice.com". Used for website language analysis.' },
        fda_clearance_date: { type: 'string', description: 'ISO date of 510(k) clearance if already known, e.g. "2023-04-15". Skips FDA API lookup.' },
      },
      required: ['company_name'],
    },
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
