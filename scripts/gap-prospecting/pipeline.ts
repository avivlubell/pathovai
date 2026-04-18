import { readFileSync } from 'node:fs';
import type { LLMClient } from './llm.js';
import { PROMPTS, RUBRIC, SCHEMAS } from './paths.js';
import type {
  DeterministicBlock,
  LLMQADraft,
  Outreach,
  PIC,
  Prospect,
  QAChecks,
  QAResult,
} from './types.js';
import { assertValid } from './validate.js';
import { runDeterministicChecks } from './qa-deterministic.js';

export interface PipelineResult {
  prospect: Prospect;
  pic: PIC;
  outreach: Outreach;
  qa: QAResult;
}

export async function runPipeline(
  prospect: Prospect,
  client: LLMClient,
): Promise<PipelineResult> {
  assertValid(SCHEMAS.prospect, prospect);

  const pic = await runStage<PIC>({
    client,
    stage: 'pic',
    system: loadPrompt(PROMPTS.pic),
    user: buildPicUser(prospect),
    schemaPath: SCHEMAS.pic,
  });

  const outreach = await runStage<Outreach>({
    client,
    stage: 'outreach',
    system: loadPrompt(PROMPTS.outreach),
    user: buildOutreachUser(prospect, pic),
    schemaPath: SCHEMAS.outreach,
  });

  const qa = await runQaStage(client, pic, outreach);

  return { prospect, pic, outreach, qa };
}

interface StageArgs {
  client: LLMClient;
  stage: 'pic' | 'outreach' | 'qa';
  system: string;
  user: string;
  schemaPath: string;
}

async function runStage<T>(args: StageArgs): Promise<T> {
  const raw = await args.client.generate({
    stage: args.stage,
    system: args.system,
    user: args.user,
  });
  const parsed = parseJson(raw, args.stage);
  assertValid(args.schemaPath, parsed);
  return parsed as T;
}

// QA stage is special: the LLM emits a loose shape covering only the
// semantic checks it owns. Deterministic findings are computed in code
// and merged in. The merged object is what's validated and persisted.
async function runQaStage(
  client: LLMClient,
  pic: PIC,
  outreach: Outreach,
): Promise<QAResult> {
  const raw = await client.generate({
    stage: 'qa',
    system: loadPrompt(PROMPTS.qa),
    user: buildQaUser(pic, outreach),
  });
  const llmDraft = parseJson(raw, 'qa') as LLMQADraft;
  const deterministic = runDeterministicChecks(outreach, pic);
  const merged = mergeQa(llmDraft, deterministic);
  assertValid(SCHEMAS.qa, merged);
  return merged;
}

function mergeQa(llm: LLMQADraft, det: DeterministicBlock): QAResult {
  // Deterministic wins for overlapping checks. LLM keeps the semantic ones.
  const checks: QAChecks = {
    diagnosis_stated: llm.checks?.diagnosis_stated ?? false,
    no_generic_opener: det.generic_opener.passed,
    evidence_cited: det.evidence_cited.passed,
    no_banned_phrases: det.banned_phrases.passed,
    cta_specific: llm.checks?.cta_specific ?? false,
    persona_appropriate: llm.checks?.persona_appropriate ?? false,
    channel_constraints: det.channel_constraints.passed,
  };
  const score = Object.values(checks).filter(Boolean).length;
  const passed =
    score >= 6 && checks.no_banned_phrases && checks.no_generic_opener;

  const suggestions = [
    ...(llm.suggestions ?? []),
    ...synthesizeSuggestionsFromDeterministic(det),
  ];

  return {
    score,
    passed,
    checks,
    banned_phrases_found: det.banned_phrases.found,
    suggestions,
    deterministic: det,
  };
}

function synthesizeSuggestionsFromDeterministic(
  det: DeterministicBlock,
): { check: string; fix: string }[] {
  const out: { check: string; fix: string }[] = [];
  if (!det.banned_phrases.passed) {
    out.push({
      check: 'no_banned_phrases',
      fix: `Remove banned phrase(s): ${det.banned_phrases.found.join(', ')}.`,
    });
  }
  if (!det.generic_opener.passed) {
    out.push({
      check: 'no_generic_opener',
      fix: `Opener matches template "${det.generic_opener.matched_pattern}". Replace with an evidence-grounded first sentence.`,
    });
  }
  if (!det.channel_constraints.passed) {
    out.push({
      check: 'channel_constraints',
      fix: `Fix channel violations: ${det.channel_constraints.violations.join('; ')}.`,
    });
  }
  if (!det.evidence_cited.passed) {
    const dangling = det.evidence_cited.dangling_references;
    out.push({
      check: 'evidence_cited',
      fix: dangling.length
        ? `Cited evidence IDs not in PIC: ${dangling.join(', ')}. Remove or correct.`
        : 'Populate references[] with at least one PIC evidence_id supporting the body.',
    });
  }
  return out;
}

function parseJson(raw: string, stage: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Stage "${stage}" returned non-JSON output:\n${raw.slice(0, 400)}\n---\n${(err as Error).message}`,
    );
  }
}

function loadPrompt(path: string): string {
  const body = readFileSync(path, 'utf8');
  return `${body}\n\nRespond with a single JSON object only. No prose, no markdown fences.`;
}

function buildPicUser(prospect: Prospect): string {
  const schema = readFileSync(SCHEMAS.pic, 'utf8');
  return [
    '<prospect>',
    JSON.stringify(prospect, null, 2),
    '</prospect>',
    '<schema name="pic">',
    schema,
    '</schema>',
    'Produce the PIC as a JSON object matching the schema.',
  ].join('\n');
}

function buildOutreachUser(prospect: Prospect, pic: PIC): string {
  const schema = readFileSync(SCHEMAS.outreach, 'utf8');
  return [
    '<pic>',
    JSON.stringify(pic, null, 2),
    '</pic>',
    `<channel>${prospect.channel}</channel>`,
    '<sender>',
    JSON.stringify(prospect.sender, null, 2),
    '</sender>',
    '<schema name="outreach">',
    schema,
    '</schema>',
    'Produce the outreach draft as a JSON object matching the schema.',
  ].join('\n');
}

function buildQaUser(pic: PIC, outreach: Outreach): string {
  const rubric = readFileSync(RUBRIC, 'utf8');
  return [
    '<pic>',
    JSON.stringify(pic, null, 2),
    '</pic>',
    '<outreach>',
    JSON.stringify(outreach, null, 2),
    '</outreach>',
    '<rubric>',
    rubric,
    '</rubric>',
    'Grade the outreach for the semantic checks you own (diagnosis_stated, cta_specific, persona_appropriate). Emit a JSON object with { checks, banned_phrases_found, suggestions }.',
  ].join('\n');
}
