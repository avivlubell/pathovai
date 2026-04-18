import Anthropic from '@anthropic-ai/sdk';
import type { Stage } from './types.js';

export interface LLMClient {
  generate(args: { system: string; user: string; stage: Stage }): Promise<string>;
}

const DEFAULT_MODEL =
  process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';

export function createAnthropicClient(
  apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
  model: string = DEFAULT_MODEL,
): LLMClient {
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Export it or run with --mock for a wiring-verification pass.',
    );
  }
  const client = new Anthropic({ apiKey });
  return {
    async generate({ system, user }) {
      const resp = await client.messages.create({
        model,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return stripCodeFences(text);
    },
  };
}

// Claude reliably wraps JSON in fenced blocks despite "JSON only" instructions.
// Strip a single leading/trailing fence if present; otherwise return as-is.
function stripCodeFences(s: string): string {
  const m = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : s;
}
