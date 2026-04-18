import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createAnthropicClient } from './llm.js';
import { createMockClient } from './mocks.js';
import { OUTPUTS_DIR } from './paths.js';
import { runPipeline } from './pipeline.js';
import type { Prospect } from './types.js';

interface Args {
  prospectPath: string;
  mock: boolean;
  outDir: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let mock = false;
  let outDir = OUTPUTS_DIR;
  for (const a of argv) {
    if (a === '--mock') mock = true;
    else if (a.startsWith('--out=')) outDir = resolve(a.slice('--out='.length));
    else if (a === '-h' || a === '--help') {
      printUsage();
      process.exit(0);
    } else positional.push(a);
  }
  if (positional.length !== 1) {
    printUsage();
    process.exit(2);
  }
  return { prospectPath: resolve(positional[0]), mock, outDir };
}

function printUsage() {
  process.stderr.write(
    [
      'Usage: tsx scripts/gap-prospecting/run.ts <prospect.json> [--mock] [--out=<dir>]',
      '',
      'Runs the 3-stage pipeline (PIC -> outreach -> QA) on a prospect.',
      'Requires ANTHROPIC_API_KEY unless --mock is passed.',
      '',
    ].join('\n'),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prospect: Prospect = JSON.parse(readFileSync(args.prospectPath, 'utf8'));

  const client = args.mock
    ? createMockClient(prospect)
    : createAnthropicClient();

  const t0 = Date.now();
  const result = await runPipeline(prospect, client);
  const ms = Date.now() - t0;

  const slug = basename(args.prospectPath).replace(/\.json$/, '');
  const dir = resolve(args.outDir, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'pic.json'), JSON.stringify(result.pic, null, 2) + '\n');
  writeFileSync(resolve(dir, 'outreach.json'), JSON.stringify(result.outreach, null, 2) + '\n');
  writeFileSync(resolve(dir, 'qa.json'), JSON.stringify(result.qa, null, 2) + '\n');

  process.stdout.write(
    [
      `prospect: ${prospect.account.name} (${prospect.persona.title})`,
      `mode:     ${args.mock ? 'mock' : 'anthropic'}`,
      `time:     ${ms}ms`,
      `outputs:  ${dir}/{pic,outreach,qa}.json`,
      `qa:       score=${result.qa.score}/6 passed=${result.qa.passed}`,
      '',
    ].join('\n'),
  );
}

main().catch((err) => {
  process.stderr.write(`\n${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
