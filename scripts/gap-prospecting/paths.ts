import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// scripts/gap-prospecting/paths.ts -> project root is two levels up.
const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..', '..');

export const SCHEMAS = {
  prospect: resolve(ROOT, 'schemas/prospect.schema.json'),
  pic: resolve(ROOT, 'schemas/pic.schema.json'),
  outreach: resolve(ROOT, 'schemas/outreach.schema.json'),
  qa: resolve(ROOT, 'schemas/qa.schema.json'),
} as const;

export const PROMPTS = {
  pic: resolve(ROOT, 'prompts/pic-generation.md'),
  outreach: resolve(ROOT, 'prompts/outreach-generation.md'),
  qa: resolve(ROOT, 'prompts/qa.md'),
} as const;

export const RUBRIC = resolve(ROOT, 'evals/rubric.md');

export const OUTPUTS_DIR = resolve(ROOT, 'outputs');
