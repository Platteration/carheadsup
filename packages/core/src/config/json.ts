/** Small helpers for JSON-shaped data (plain objects, arrays, primitives). */

export type JsonObject = Record<string, unknown>;

/** Keys that must never be copied from untrusted JSON onto an object (prototype pollution). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Deep copy of JSON-shaped data; other values are returned as-is. */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => cloneJson(item)) as T;
  if (isPlainObject(value)) {
    const out: JsonObject = {};
    for (const key of Object.keys(value)) {
      if (!UNSAFE_KEYS.has(key)) out[key] = cloneJson(value[key]);
    }
    return out as T;
  }
  return value;
}

/**
 * Deep-merge `patch` into `target` without mutating either. Plain objects merge key by key;
 * arrays, tuples, primitives and null replace the target value wholesale; `undefined` in the
 * patch leaves the target value unchanged.
 */
export function deepMerge(target: unknown, patch: unknown): unknown {
  if (patch === undefined) return cloneJson(target);
  if (!isPlainObject(patch) || !isPlainObject(target)) return cloneJson(patch);
  const out = cloneJson(target);
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = deepMerge(target[key], patch[key]);
  }
  return out;
}

/** Recursively freeze JSON-shaped data (for shared constants such as the default config). */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    Object.freeze(value);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
