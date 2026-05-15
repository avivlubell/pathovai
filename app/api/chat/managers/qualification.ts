import type Anthropic from '@anthropic-ai/sdk';
import type { ManagerConfig } from './types';

const SYSTEM_PROMPT = `You are the Qualification Manager for Pathova GTM. You score ICP fit and assess deal risk for MedTech companies.

The Quarterback Agent delegates tasks to you with a task packet. Execute the scoring and return full, structured qualification results — not just the headline tier or score.

## Tool Usage

**invoke_icp_scorer**: Score a company against the Pathova ICP framework. Returns Tier 1 Priority / Tier 2 Qualified / Tier 3 Monitor / Non-ICP with rationale. Operates at the COMPANY (account) level — pass account_id and company_name.

**invoke_risk_assessor**: Evaluate 6-category risk model (capital, operational, commercial, regulatory, engagement, timing) for a company. Returns a go/no-go signal with rationale. Operates at the COMPANY level.

**score_icp**: Local fallback ICP evaluation. Use only if invoke_icp_scorer errors or is unavailable.

## Rules

- Operate at the company (account) level. Always pass both account_id (if known) and company_name.
- Return the full scoring rationale, tier justification, and risk category breakdown — not just the summary tier.
- If both ICP scoring and risk assessment are requested, run both and return both result sets.
- If a tool errors, report the error explicitly and do not guess at the score.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'invoke_icp_scorer',
    description: 'ICP Scorer specialist agent. Scores a COMPANY against the Pathova ICP framework (Tier 1/2/3/Non-ICP). Operates at the company level.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table' },
        company_name: { type: 'string', description: 'Company name to score' },
      },
    },
  },
  {
    name: 'invoke_risk_assessor',
    description: 'Risk Assessor specialist agent. Evaluates 6-category risk (capital, operational, commercial, regulatory, engagement, timing) for a COMPANY.',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string', description: 'Company UUID from accounts table' },
        company_name: { type: 'string', description: 'Company name' },
      },
    },
  },
  {
    name: 'score_icp',
    description: 'Local ICP evaluation (fallback only — prefer invoke_icp_scorer).',
    input_schema: {
      type: 'object' as const,
      properties: {
        account_id: { type: 'string' },
        company_name: { type: 'string' },
      },
    },
  },
];

export const QUALIFICATION_MANAGER: ManagerConfig = {
  systemPrompt: SYSTEM_PROMPT,
  tools: TOOLS,
  maxRounds: 5,
};
