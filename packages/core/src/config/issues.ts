import type { z } from 'zod';

/**
 * Human-readable validation messages shared by config parsing and wire-protocol validation.
 * Messages are short, lower-case and path-free; callers prefix the dotted path, e.g.
 * "display.brightness.minLevel: expected number <= 1".
 */

type PathKey = PropertyKey;

/** Format a path as `a.b[2].c`; the empty path is "(root)". */
export function formatPath(path: readonly PathKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out === '' ? String(key) : `.${String(key)}`;
  }
  return out === '' ? '(root)' : out;
}

/** Short description of a value's type for "expected X, got Y" messages. */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : String(value);
  return typeof value;
}

const MAX_LISTED_OPTIONS = 12;

function formatLiteral(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

function formatOptions(values: readonly unknown[]): string {
  if (values.length === 1) return formatLiteral(values[0]);
  const shown = values.slice(0, MAX_LISTED_OPTIONS).map(formatLiteral).join(', ');
  return values.length > MAX_LISTED_OPTIONS
    ? `one of ${shown}, … (${values.length} options)`
    : `one of ${shown}`;
}

function bound(origin: string, op: string, limit: number | bigint): string {
  switch (origin) {
    case 'string':
      return `expected ${op === '<=' ? 'at most' : 'at least'} ${limit} characters`;
    case 'array':
    case 'set':
      return `expected ${op === '<=' ? 'at most' : 'at least'} ${limit} items`;
    default:
      return `expected number ${op} ${limit}`;
  }
}

/**
 * Per-parse zod error map (pass as `{ error: issueMessage }`). Schema-level custom messages
 * (e.g. on regex checks and refinements) take precedence over this map.
 */
export const issueMessage: z.core.$ZodErrorMap = (issue) => {
  const missing =
    issue.input === undefined &&
    (issue.code === 'invalid_type' ||
      issue.code === 'invalid_value' ||
      issue.code === 'invalid_union');
  if (missing) return 'required';
  switch (issue.code) {
    case 'invalid_type': {
      const expected = issue.expected === 'int' ? 'integer' : issue.expected;
      const got =
        issue.expected === 'int' && typeof issue.input === 'number' && Number.isFinite(issue.input)
          ? String(issue.input)
          : describeValue(issue.input);
      return `expected ${expected}, got ${got}`;
    }
    case 'too_big':
      return issue.origin === 'string' && issue.maximum === 0
        ? 'must be empty'
        : bound(issue.origin, issue.inclusive === false ? '<' : '<=', issue.maximum);
    case 'too_small':
      if (issue.origin === 'string' && issue.minimum === 1) return 'must not be empty';
      if (issue.origin === 'array' && issue.minimum === 1) return 'must not be empty';
      return bound(issue.origin, issue.inclusive === false ? '>' : '>=', issue.minimum);
    case 'invalid_value':
      return `expected ${formatOptions(issue.values)}`;
    case 'invalid_union': {
      const options: unknown = issue.options;
      return Array.isArray(options) && options.length > 0
        ? `expected ${formatOptions(options)}`
        : 'invalid value';
    }
    case 'invalid_format':
      return 'invalid format';
    case 'not_multiple_of':
      return `expected a multiple of ${issue.divisor}`;
    case 'unrecognized_keys':
      return `unexpected keys ${issue.keys.map(formatLiteral).join(', ')}`;
    default:
      return undefined;
  }
};

/** Format zod issues as `path: message` strings, prefixing `basePath`. */
export function formatIssues(
  issues: readonly z.core.$ZodIssue[],
  basePath: readonly PathKey[] = [],
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const line = `${formatPath([...basePath, ...issue.path])}: ${issue.message}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}
