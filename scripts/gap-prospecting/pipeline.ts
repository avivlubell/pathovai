import { readFileSync } from 'node:fs';
import type { LLMClient } from './llm.js';
import { PROMPTS, RUBRIC, SCHEMAS } from './paths.js';
import type { Outreach, PIC, Prospect, QAResult } from './types.js';
import { assertValid } from './validate.js';

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

  const qa = await runStage<QAResult>({
    client,
    stage: 'qa',
    system: loadPrompt(PROMPTS.qa),
    user: buildQaUser(pic, outreach),
    schemaPath: SCHEMAS.qa,
  });

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
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Stage "${args.stage}" returned non-JSON output:\n${raw.slice(0, 400)}\n---\n${(err as Error).message}`,
    );
  }
  assertValid(args.schemaPath, parsed);
  return parsed as T;
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
  const schema = readFileSync(SCHEMAS.qa, 'utf8');
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
    '<schema name="qa">',
    schema,
    '</schema>',
    'Grade the outreach. Produce a JSON object matching the schema.',
  ].join('\n');
}
