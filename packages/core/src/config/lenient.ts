import { z } from 'zod';
import { describeValue, formatIssues, formatPath, issueMessage } from './issues.ts';
import { cloneJson, isPlainObject } from './json.ts';
import type { JsonObject } from './json.ts';
import { rulesOf } from './schema.ts';

/** At most this many problems are reported for a single field (e.g. a long, broken array). */
const MAX_ERRORS_PER_FIELD = 5;

/**
 * Validate `input` against `schema` one field at a time, falling back to `fallback` per field.
 *
 *  - Object schemas are walked key by key, so one bad field only resets that field.
 *  - Anything else (primitives, arrays, tuples, nullable objects) is a single field: it is
 *    either accepted whole or replaced whole by the fallback (arrays are never half-kept).
 *  - Missing (`undefined`) fields take the fallback silently; unknown keys are dropped.
 *  - Cross-field rules attached with `withRules` run after the fields of their object. A
 *    failing rule is repaired minimally: the first of its fields whose fallback value restores
 *    it (without breaking another rule) is reverted and blamed; if no single field does, all
 *    of its fields are reverted and the first is blamed.
 *
 * `fallback` must itself satisfy `schema`; the result then always satisfies it too.
 * Problems are appended to `errors` as "dotted.path: message". The result shares no
 * references with `input` or `fallback`.
 */
export function parseLenient(
  schema: z.ZodType,
  input: unknown,
  fallback: unknown,
  path: readonly PropertyKey[],
  errors: string[],
): unknown {
  if (input === undefined) return cloneJson(fallback);

  if (schema instanceof z.ZodObject && isPlainObject(fallback)) {
    if (!isPlainObject(input)) {
      errors.push(`${formatPath(path)}: expected object, got ${describeValue(input)}`);
      return cloneJson(fallback);
    }
    const out: JsonObject = {};
    for (const [key, child] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      const value = Object.hasOwn(input, key) ? input[key] : undefined;
      out[key] = parseLenient(child, value, fallback[key], [...path, key], errors);
    }
    applyRules(schema, out, fallback, path, errors);
    return out;
  }

  const result = schema.safeParse(input, { error: issueMessage });
  if (result.success) return result.data;
  errors.push(...formatIssues(result.error.issues, path, MAX_ERRORS_PER_FIELD));
  return cloneJson(fallback);
}

function applyRules(
  schema: z.ZodType,
  out: JsonObject,
  fallback: JsonObject,
  path: readonly PropertyKey[],
  errors: string[],
): void {
  const rules = rulesOf(schema);
  if (rules.length === 0) return;
  // Every pass either fixes the failing rule without breaking a holding one (one field reset) or
  // moves all of its fields to the fallback, so this converges quickly; the cap is a safety net.
  const maxPasses = 4 * rules.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    const failing = rules.find((rule) => !rule.holds(out));
    if (failing === undefined) return;
    const message = failing.message(out);
    const holding = rules.filter((rule) => rule !== failing && rule.holds(out));
    // Prefer reverting a single field: the one the user changed is usually the only one whose
    // fallback value makes the rule hold again.
    const single = failing.fields.find((field) => {
      const candidate = { ...out, [field]: fallback[field] };
      return failing.holds(candidate) && holding.every((rule) => rule.holds(candidate));
    });
    const reset = single === undefined ? failing.fields : [single];
    errors.push(`${formatPath([...path, reset[0] ?? failing.fields[0]])}: ${message}`);
    for (const field of reset) out[field] = cloneJson(fallback[field]);
  }
  // Unreachable with a valid fallback; guarantees a consistent object regardless.
  for (const rule of rules) {
    for (const field of rule.fields) out[field] = cloneJson(fallback[field]);
  }
}
