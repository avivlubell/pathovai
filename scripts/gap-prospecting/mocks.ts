import type { LLMClient } from './llm.js';
import type { PIC, Outreach, Prospect, QAResult } from './types.js';

// Mock LLM client for pipeline wiring verification when no API key is
// available. Returns schema-valid JSON synthesized from the input, with
// every generated claim marked "[MOCK]" so mock output is never confused
// with a real run. Real content requires ANTHROPIC_API_KEY.
export function createMockClient(prospect: Prospect): LLMClient {
  let pic: PIC | null = null;
  let outreach: Outreach | null = null;

  return {
    async generate({ stage }) {
      if (stage === 'pic') {
        pic = buildMockPic(prospect);
        return JSON.stringify(pic);
      }
      if (stage === 'outreach') {
        if (!pic) throw new Error('mock: outreach requested before pic');
        outreach = buildMockOutreach(prospect, pic);
        return JSON.stringify(outreach);
      }
      if (!pic || !outreach) throw new Error('mock: qa requested before pic/outreach');
      return JSON.stringify(buildMockQa());
    },
  };
}

function buildMockPic(p: Prospect): PIC {
  const evidence = p.research_signals.map((s, i) => ({
    id: `E${i + 1}`,
    claim: `[MOCK] ${s.claim}`,
    source: s.source,
    date: s.date,
  }));
  return {
    account: p.account,
    persona: p.persona,
    evidence,
    problem_diagnosis: {
      symptoms: [`[MOCK] Symptom derived from ${evidence.length} research signal(s).`],
      likely_root_cause: '[MOCK] Root cause placeholder -- real diagnosis requires LLM.',
      cost_of_inaction: '[MOCK] Cost placeholder.',
      why_now: '[MOCK] Timing placeholder.',
    },
    hypothesis: {
      gap: `[MOCK] Gap between current state and desired outcome for ${p.account.name}.`,
      desired_outcome: '[MOCK] Desired outcome placeholder.',
    },
    qualification: {
      icp_fit_score: 50,
      readiness_signals: ['[MOCK] Readiness placeholder.'],
      disqualifiers: [],
    },
    confidence: 'low',
  };
}

function buildMockOutreach(p: Prospect, pic: PIC): Outreach {
  const firstEvidence = pic.evidence[0]?.id ?? 'E1';
  const body =
    `${p.persona.title} -- this is a mock draft referencing ${firstEvidence}. ` +
    `Real outreach requires an API-backed run; see README for how to enable.`;
  return {
    channel: p.channel,
    subject: p.channel === 'email' ? `[MOCK] Note for ${p.account.name}` : null,
    body,
    cta: '[MOCK] Specific next step placeholder.',
    references: [{ pic_section: 'problem_diagnosis', evidence_id: firstEvidence }],
    sender: p.sender,
  };
}

function buildMockQa(): QAResult {
  // Mock draft trivially fails most checks. That's useful: it proves the
  // QA schema validator handles a realistic fail shape end-to-end.
  return {
    score: 1,
    passed: false,
    checks: {
      diagnosis_stated: false,
      evidence_cited: true,
      no_banned_phrases: true,
      cta_specific: false,
      persona_appropriate: false,
      channel_constraints: false,
    },
    banned_phrases_found: [],
    suggestions: [
      { check: 'diagnosis_stated', fix: '[MOCK] Replace mock opener with a specific symptom from PIC.' },
      { check: 'cta_specific', fix: '[MOCK] Replace placeholder CTA with a scoped next step.' },
      { check: 'persona_appropriate', fix: '[MOCK] Rewrite for the persona; mock is generic.' },
      { check: 'channel_constraints', fix: '[MOCK] Tighten length to channel limits.' },
    ],
  };
}
