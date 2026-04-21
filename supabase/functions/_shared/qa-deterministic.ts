// Deterministic QA checks for outreach drafts.
// Port of scripts/gap-prospecting/qa-deterministic.ts adapted for Deno.
// Keep this file in sync with the Node-side copy -- both must read from the
// same banned-phrase list and opener rules or the skill and the production
// edge function will disagree on what "good" means.

export type Channel = 'email' | 'linkedin' | 'phone';

export interface OutreachReference {
  pic_section: string;
  evidence_id: string;
}

export interface Outreach {
  channel: Channel;
  subject: string | null;
  body: string;
  cta: string;
  references: OutreachReference[];
}

export interface PICEvidence {
  id: string;
}

export interface PICLite {
  evidence: PICEvidence[];
}

export const BANNED_PHRASES: readonly string[] = [
  'just checking in',
  'circle back',
  'circling back',
  'touching base',
  'touch base',
  'synergy',
  'synergies',
  'quick question',
  'quick chat',
  'quick sync',
  'hope this finds you well',
  "hope you're doing well",
  'hope you are doing well',
  'leverage',
  'game-changer',
  'game changer',
  'reach out',
  'ping you',
  'thought leader',
  'best-in-class',
  'move the needle',
  // Additions from the existing outreach-drafter voice rules:
  'worth a brief conversation',
  'worth connecting',
  'would it make sense to connect',
  'happy to chat',
  "i'd love to learn more",
  'would love to explore',
  "i'd welcome the chance",
  "let me know if you'd be open to",
  'we can help you',
  'our solution',
  'proven track record',
  'low-hanging fruit',
];

type OpenerRule =
  | { name: string; kind: 'substring'; needle: string }
  | { name: string; kind: 'substrings'; needles: readonly string[] }
  | { name: string; kind: 'regex'; re: RegExp };

const GENERIC_OPENER_RULES: readonly OpenerRule[] = [
  { name: 'hope this finds you', kind: 'substring', needle: 'hope this finds you' },
  {
    name: "hope you're doing well",
    kind: 'regex',
    re: /hope\s+you(?:'re|\s+are)\s+doing\s+well/,
  },
  { name: 'my name is', kind: 'substring', needle: 'my name is' },
  { name: 'i noticed you', kind: 'substring', needle: 'i noticed you' },
  { name: 'i came across', kind: 'substring', needle: 'i came across' },
  {
    name: 'i wanted to reach out',
    kind: 'substrings',
    needles: ['wanted to reach out', 'want to reach out'],
  },
  { name: "i'm reaching out", kind: 'regex', re: /i['’]?m\s+reaching\s+out/ },
  {
    name: "i'm [role] at [company]",
    kind: 'regex',
    re: /^\s*(?:[^.!?,]+,\s*)?i['’]?m\s+(?:an?\s+|the\s+)?[a-z][^.!?]{0,80}\s+at\s+[a-z]/,
  },
];

export interface DeterministicResult {
  banned_phrases: { passed: boolean; found: string[] };
  generic_opener: { passed: boolean; matched_pattern: string | null };
  channel_constraints: { passed: boolean; violations: string[] };
  evidence_cited: { passed: boolean; dangling_references: string[] };
}

export function runDeterministicChecks(
  outreach: Outreach,
  pic: PICLite,
): DeterministicResult {
  return {
    banned_phrases: scanBannedPhrases(outreach),
    generic_opener: scanGenericOpener(outreach),
    channel_constraints: checkChannelConstraints(outreach),
    evidence_cited: checkEvidenceCited(outreach, pic),
  };
}

function scanBannedPhrases(outreach: Outreach): DeterministicResult['banned_phrases'] {
  const haystack = `${outreach.subject ?? ''} ${outreach.body}`.toLowerCase();
  const found = BANNED_PHRASES.filter((p) => haystack.includes(p));
  return { passed: found.length === 0, found };
}

function scanGenericOpener(outreach: Outreach): DeterministicResult['generic_opener'] {
  const opener = firstTwoSentences(outreach.body).toLowerCase();
  for (const rule of GENERIC_OPENER_RULES) {
    if (matchesRule(opener, rule)) {
      return { passed: false, matched_pattern: rule.name };
    }
  }
  return { passed: true, matched_pattern: null };
}

function matchesRule(opener: string, rule: OpenerRule): boolean {
  if (rule.kind === 'substring') return opener.includes(rule.needle);
  if (rule.kind === 'substrings') return rule.needles.some((n) => opener.includes(n));
  return rule.re.test(opener);
}

function firstTwoSentences(body: string): string {
  const parts = body.split(/(?<=[.!?])\s+/);
  return parts.slice(0, 2).join(' ');
}

function checkChannelConstraints(
  outreach: Outreach,
): DeterministicResult['channel_constraints'] {
  const violations: string[] = [];
  const words = countWords(outreach.body);
  const chars = outreach.body.length;
  const { channel } = outreach;
  const limits = CHANNEL_LIMITS[channel];

  if (channel === 'email') {
    if (!outreach.subject) {
      violations.push('email: subject is required');
    } else {
      const subjWords = countWords(outreach.subject);
      if (subjWords > limits.subjectMaxWords!) {
        violations.push(`email: subject ${subjWords} words exceeds ${limits.subjectMaxWords}`);
      }
    }
    if (words > limits.bodyMaxWords!) {
      violations.push(`email: body ${words} words exceeds ${limits.bodyMaxWords}`);
    }
  } else {
    if (outreach.subject !== null) {
      violations.push(`${channel}: subject must be null`);
    }
    if (channel === 'linkedin' && chars > limits.bodyMaxChars!) {
      violations.push(`linkedin: body ${chars} chars exceeds ${limits.bodyMaxChars}`);
    }
    if (channel === 'phone' && words > limits.bodyMaxWords!) {
      violations.push(`phone: body ${words} words exceeds ${limits.bodyMaxWords}`);
    }
  }

  return { passed: violations.length === 0, violations };
}

interface ChannelLimits {
  subjectMaxWords?: number;
  bodyMaxWords?: number;
  bodyMaxChars?: number;
}

const CHANNEL_LIMITS: Record<Channel, ChannelLimits> = {
  email: { subjectMaxWords: 8, bodyMaxWords: 120 },
  linkedin: { bodyMaxChars: 300 },
  phone: { bodyMaxWords: 60 },
};

function checkEvidenceCited(
  outreach: Outreach,
  pic: PICLite,
): DeterministicResult['evidence_cited'] {
  if (outreach.references.length === 0) {
    return { passed: false, dangling_references: [] };
  }
  const valid = new Set(pic.evidence.map((e) => e.id));
  const dangling = outreach.references
    .map((r) => r.evidence_id)
    .filter((id) => !valid.has(id));
  return { passed: dangling.length === 0, dangling_references: dangling };
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
