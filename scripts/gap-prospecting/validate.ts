import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const cache = new Map<string, ValidateFunction>();

function compile(schemaPath: string): ValidateFunction {
  const cached = cache.get(schemaPath);
  if (cached) return cached;
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const fn = ajv.compile(schema);
  cache.set(schemaPath, fn);
  return fn;
}

export class SchemaValidationError extends Error {
  constructor(
    public readonly schemaPath: string,
    public readonly errors: NonNullable<ValidateFunction['errors']>,
    public readonly data: unknown,
  ) {
    const summary = errors
      .map((e) => `  at ${e.instancePath || '(root)'}: ${e.message} ${JSON.stringify(e.params)}`)
      .join('\n');
    super(`Schema validation failed for ${schemaPath}:\n${summary}`);
    this.name = 'SchemaValidationError';
  }
}

// Fail loudly: throws SchemaValidationError on invalid data. Callers should
// let it propagate -- the CLI wrapper surfaces it with a non-zero exit code.
export function assertValid(schemaPath: string, data: unknown): void {
  const validate = compile(schemaPath);
  if (!validate(data)) {
    throw new SchemaValidationError(schemaPath, validate.errors ?? [], data);
  }
}

export function isValid(schemaPath: string, data: unknown): boolean {
  return compile(schemaPath)(data);
}
