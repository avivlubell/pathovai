import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SKILLS_DIR = join(process.cwd(), 'lib', 'skills');

export const SKILL_INDEX: Record<string, string> = {
  'prospect-researcher': '10-section Perplexity research procedure. Load to know what was collected, how to interpret GAP blocks, and when research is complete enough to score.',
  'icp-scorer': '4-question classification framework (industry / stage / gap signals / disqualifiers) that produces Priority/Qualified/Monitor/Non-ICP tiers. Load to explain tier results to the user.',
  'risk-assessor': '6-category risk framework (capital / operational / commercial viability / regulatory / engagement / market timing) producing a go/no-go signal. Load to present risk findings meaningfully.',
  'outreach-drafter': 'Diagnosis-first outreach procedure: PIC, 6 messaging hooks, banned phrases, voice requirements, QA rubric. Load before invoking or presenting output so you can enforce prerequisites and coach on quality.',
};

export function loadSkill(name: string): string {
  const path = join(SKILLS_DIR, `${name}.md`);
  if (!existsSync(path)) {
    const available = Object.keys(SKILL_INDEX).join(', ');
    return JSON.stringify({ error: `Skill "${name}" not found. Available: ${available}` });
  }
  return readFileSync(path, 'utf-8');
}
