import type { LLMClient } from './llm.js';
import type { LLMQADraft, Outreach, PIC, Prospect } from './types.js';

// Mock LLM client for pipeline wiring verification when no API key is
// available. Returns schema-valid JSON synthesized from the input, with
// every generated claim tagged "[MOCK]" so mock output is never confused
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
      return JSON.stringify(buildMockQaDraft());
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
  // Kept short and opener-safe so the deterministic checks exercise
  // their pass paths against mock output.
  const body = `${p.account.name}: mock draft citing ${firstEvidence}. Enable a real API run for grounded content.`;
  return {
    channel: p.channel,
    subject: p.channel === 'email' ? `Mock note for ${p.account.name}` : null,
    body,
    cta: '[MOCK] Specific next step placeholder.',
    references: [{ pic_section: 'problem_diagnosis', evidence_id: firstEvidence }],
    sender: p.sender,
  };
}

// The pipeline owns score/passed/banned_phrases_found/deterministic, so
// the mock only needs to supply the LLM-owned subset.
function buildMockQaDraft(): LLMQADraft {
  return {
    checks: {
      diagnosis_stated: false,
      cta_specific: false,
      persona_appropriate: false,
    },
    suggestions: [
      { check: 'diagnosis_stated', fix: '[MOCK] Open with a PIC-grounded symptom.' },
      { check: 'cta_specific', fix: '[MOCK] Replace placeholder CTA with a scoped next step.' },
      { check: 'persona_appropriate', fix: '[MOCK] Tailor register to the persona.' },
    ],
    banned_phrases_found: [],
  };
}
