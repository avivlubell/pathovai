import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDeterministicChecks, BANNED_PHRASES } from './qa-deterministic.js';
import type { Outreach, PIC } from './types.js';

// Minimal PIC skeleton reused across cases. Only .evidence matters for
// most deterministic checks; the rest is required by the TS type.
const PIC_FIXTURE: PIC = {
  account: { name: 'Acme', segment: 'IDN' },
  persona: { title: 'Chief', role_family: 'clinical', seniority: 'c_suite' },
  evidence: [
    { id: 'E1', claim: 'c1', source: 's1', date: '2026-01-01' },
    { id: 'E2', claim: 'c2', source: 's2', date: '2026-01-02' },
  ],
  problem_diagnosis: {
    symptoms: ['s'],
    likely_root_cause: 'r',
    cost_of_inaction: 'c',
    why_now: 'w',
  },
  hypothesis: { gap: 'g', desired_outcome: 'd' },
  qualification: { icp_fit_score: 50, readiness_signals: [], disqualifiers: [] },
  confidence: 'medium',
};

function goodOutreach(over: Partial<Outreach> = {}): Outreach {
  return {
    channel: 'email',
    subject: 'Acme 9% volume gap',
    body: 'Your 2025 report shows a 9% case-volume decline [E1]. Mercy recovered 14% with room-turnover work [E2]. Worth a 20-minute walkthrough against your May schedule?',
    cta: '20-minute walkthrough against May schedule',
    references: [
      { pic_section: 'problem_diagnosis', evidence_id: 'E1' },
      { pic_section: 'hypothesis', evidence_id: 'E2' },
    ],
    ...over,
  };
}

test('clean email passes every deterministic check', () => {
  const r = runDeterministicChecks(goodOutreach(), PIC_FIXTURE);
  assert.equal(r.banned_phrases.passed, true, 'banned_phrases');
  assert.equal(r.generic_opener.passed, true, 'generic_opener');
  assert.equal(r.channel_constraints.passed, true, 'channel_constraints');
  assert.equal(r.evidence_cited.passed, true, 'evidence_cited');
});

test('banned phrases are caught case-insensitively', () => {
  const r = runDeterministicChecks(
    goodOutreach({
      body: 'I wanted to Circle Back and leverage our synergies to move the needle on throughput.',
    }),
    PIC_FIXTURE,
  );
  assert.equal(r.banned_phrases.passed, false);
  assert.ok(r.banned_phrases.found.includes('circle back'));
  assert.ok(r.banned_phrases.found.includes('leverage'));
  assert.ok(r.banned_phrases.found.includes('synergies'));
  assert.ok(r.banned_phrases.found.includes('move the needle'));
});

test('rubric banned-phrase list is the source of truth', () => {
  // Guard against drift: rubric.md and BANNED_PHRASES must stay in sync.
  assert.ok(BANNED_PHRASES.length >= 15, 'banned list unexpectedly short');
  assert.ok(BANNED_PHRASES.includes('hope this finds you well'));
});

test('generic openers are caught', () => {
  const cases: [string, string][] = [
    ['I hope this finds you well. Quick note on throughput.', 'hope this finds you'],
    ['Dr. Smith, hope you are doing well. About your Q3 volume.', "hope you're doing well"],
    ['My name is Sample Rep and I work at PathovAI.', 'my name is'],
    ['I noticed you lead cardiac surgery at Riverbend.', 'i noticed you'],
    ['I came across your AHA panel remarks last week.', 'i came across'],
    ['I wanted to reach out about your FY27 plan.', 'i wanted to reach out'],
    ["I'm reaching out about your cardiac service line.", "i'm reaching out"],
  ];
  for (const [body, expected] of cases) {
    const r = runDeterministicChecks(goodOutreach({ body }), PIC_FIXTURE);
    assert.equal(r.generic_opener.passed, false, `should fail: ${body}`);
    assert.equal(r.generic_opener.matched_pattern, expected, `pattern for: ${body}`);
  }
});

test('email channel limits: subject > 8 words fails', () => {
  const r = runDeterministicChecks(
    goodOutreach({ subject: 'one two three four five six seven eight nine' }),
    PIC_FIXTURE,
  );
  assert.equal(r.channel_constraints.passed, false);
  assert.ok(r.channel_constraints.violations.some((v) => v.includes('subject')));
});

test('email channel limits: body > 120 words fails', () => {
  const longBody = Array(121).fill('word').join(' ');
  const r = runDeterministicChecks(
    goodOutreach({ body: longBody }),
    PIC_FIXTURE,
  );
  assert.equal(r.channel_constraints.passed, false);
  assert.ok(r.channel_constraints.violations.some((v) => v.includes('body')));
});

test('linkedin: subject must be null and body <= 300 chars', () => {
  const r1 = runDeterministicChecks(
    goodOutreach({ channel: 'linkedin', subject: 'should not be set', body: 'short body.' }),
    PIC_FIXTURE,
  );
  assert.equal(r1.channel_constraints.passed, false);

  const r2 = runDeterministicChecks(
    goodOutreach({ channel: 'linkedin', subject: null, body: 'x'.repeat(301) }),
    PIC_FIXTURE,
  );
  assert.equal(r2.channel_constraints.passed, false);

  const r3 = runDeterministicChecks(
    goodOutreach({ channel: 'linkedin', subject: null, body: 'x'.repeat(200) }),
    PIC_FIXTURE,
  );
  assert.equal(r3.channel_constraints.passed, true);
});

test('phone: body > 60 words fails', () => {
  const r = runDeterministicChecks(
    goodOutreach({ channel: 'phone', subject: null, body: Array(61).fill('x').join(' ') }),
    PIC_FIXTURE,
  );
  assert.equal(r.channel_constraints.passed, false);
});

test('evidence_cited: empty refs fails', () => {
  const r = runDeterministicChecks(goodOutreach({ references: [] }), PIC_FIXTURE);
  assert.equal(r.evidence_cited.passed, false);
  assert.deepEqual(r.evidence_cited.dangling_references, []);
});

test('evidence_cited: references pointing at missing IDs fail with names', () => {
  const r = runDeterministicChecks(
    goodOutreach({
      references: [
        { pic_section: 'problem_diagnosis', evidence_id: 'E1' },
        { pic_section: 'hypothesis', evidence_id: 'E99' },
      ],
    }),
    PIC_FIXTURE,
  );
  assert.equal(r.evidence_cited.passed, false);
  assert.deepEqual(r.evidence_cited.dangling_references, ['E99']);
});
