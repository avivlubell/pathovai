import Anthropic, { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import type { Stage } from './types.js';

export interface LLMClient {
  generate(args: { system: string; user: string; stage: Stage }): Promise<string>;
}

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = parseIntEnv('ANTHROPIC_MAX_TOKENS', 4096);
const DEFAULT_MAX_RETRIES = parseIntEnv('ANTHROPIC_MAX_RETRIES', 4);
const RETRY_BASE_MS = parseIntEnv('ANTHROPIC_RETRY_BASE_MS', 500);
const RETRY_CAP_MS = parseIntEnv('ANTHROPIC_RETRY_CAP_MS', 30_000);

// Thrown when Claude truncates output at max_tokens. Callers should treat
// this as a hard failure -- a truncated response will fail JSON.parse and
// yield a misleading error otherwise.
export class TruncationError extends Error {
  constructor(
    public readonly stage: Stage,
    public readonly usage: { input_tokens: number; output_tokens: number },
    public readonly maxTokens: number,
  ) {
    super(
      `Stage "${stage}" hit max_tokens (${usage.output_tokens}/${maxTokens}). ` +
        `Increase ANTHROPIC_MAX_TOKENS or reduce prompt size.`,
    );
    this.name = 'TruncationError';
  }
}

export interface AnthropicClientOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  maxRetries?: number;
}

export function createAnthropicClient(opts: AnthropicClientOptions = {}): LLMClient {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Export it or run with --mock for a wiring-verification pass.',
    );
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  // The SDK has its own retry layer; disable it so ours is the only one.
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  return {
    async generate({ system, user, stage }) {
      const started = Date.now();
      const resp = await withRetry(
        () =>
          client.messages.create({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
          }),
        { maxRetries, stage },
      );
      const durationMs = Date.now() - started;

      const usage = {
        input_tokens: resp.usage.input_tokens,
        output_tokens: resp.usage.output_tokens,
      };
      logUsage({ stage, model, usage, durationMs });

      if (resp.stop_reason === 'max_tokens') {
        throw new TruncationError(stage, usage, maxTokens);
      }

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

interface RetryOpts {
  maxRetries: number;
  stage: Stage;
}

async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const retry = retryDelay(err, attempt);
      if (retry === null || attempt > opts.maxRetries) {
        throw err;
      }
      logRetry({ stage: opts.stage, attempt, delayMs: retry, err });
      await sleep(retry);
    }
  }
}

// Returns the delay in ms to wait before retrying, or null if the error
// is not retryable. Respects `retry-after` when present; otherwise
// exponential backoff with full jitter, capped at RETRY_CAP_MS.
function retryDelay(err: unknown, attempt: number): number | null {
  if (err instanceof APIConnectionError) {
    return jitteredBackoff(attempt);
  }
  if (err instanceof APIError) {
    const status = err.status;
    if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
      const raMs = parseRetryAfter(err.headers);
      return raMs ?? jitteredBackoff(attempt);
    }
  }
  return null;
}

function jitteredBackoff(attempt: number): number {
  const exp = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
  return Math.floor(Math.random() * exp);
}

// retry-after is either seconds (integer) or an HTTP-date. We read via
// the fetch Headers.get() shape so this works with the SDK's typed Headers.
function parseRetryAfter(headers: Headers | undefined): number | null {
  const raw = headers?.get?.('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) {
    return Math.min(RETRY_CAP_MS, Math.floor(secs * 1000));
  }
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) {
    return Math.min(RETRY_CAP_MS, Math.max(0, t - Date.now()));
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logUsage(args: {
  stage: Stage;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  durationMs: number;
}) {
  // stderr so stdout stays clean for CLI consumers.
  const { stage, model, usage, durationMs } = args;
  process.stderr.write(
    `[llm] stage=${stage} model=${model} in=${usage.input_tokens} out=${usage.output_tokens} ms=${durationMs}\n`,
  );
}

function logRetry(args: { stage: Stage; attempt: number; delayMs: number; err: unknown }) {
  const { stage, attempt, delayMs, err } = args;
  const status = err instanceof APIError ? err.status : 'connection';
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `[llm] retry stage=${stage} attempt=${attempt} status=${status} delay_ms=${delayMs} msg=${truncate(msg, 140)}\n`,
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '...';
}

function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
