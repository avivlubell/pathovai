import { readFileSync } from 'fs';
import { join } from 'path';

export const SYSTEM_PROMPT = readFileSync(
  join(process.cwd(), 'app', 'api', 'chat', 'prompt.txt'),
  'utf-8'
);
