import type { DeepPartial, HudConfig } from '@carheadsup/core';

/**
 * Config diffing for the settings app: the app edits a local draft and PATCHes only what changed.
 * Semantics match the server's PATCH (`mergeConfig`): plain objects merge key by key, while
 * arrays, tuples and `null` are single values that replace wholesale.
 */

/** A key in a config path: object keys are strings, array indices numbers. */
export type PathKey = string | number;
export type Path = readonly PathKey[];

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Structural equality for JSON-like values (key order does not matter). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
  }
  return false;
}

/** Deep copy of a JSON-like value. */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => cloneJson(item)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = cloneJson(item);
    return out as T;
  }
  return value;
}

/**
 * The minimal patch turning `base` into `next`, or undefined when they are equal. Objects recurse;
 * anything else (including arrays and a change from/to null) is replaced by a copy of `next`.
 */
export function diffValue(base: unknown, next: unknown): unknown {
  if (jsonEqual(base, next)) return undefined;
  if (isPlainObject(base) && isPlainObject(next)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(next)) {
      const child = diffValue(base[key], next[key]);
      if (child !== undefined) out[key] = child;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return cloneJson(next);
}

/** Only the changed subtree of `next` relative to `base` (`{}` when nothing changed). */
export function diffConfig(base: HudConfig, next: HudConfig): DeepPartial<HudConfig> {
  const patch = diffValue(base, next);
  return (isPlainObject(patch) ? patch : {}) as DeepPartial<HudConfig>;
}

/**
 * Apply a patch like the server does: plain objects merge recursively, arrays / tuples / null /
 * primitives replace, `undefined` leaves a field alone. Returns a new value; inputs are untouched.
 */
export function applyPatch<T>(base: T, patch: DeepPartial<T> | undefined): T {
  return mergeValue(base, patch) as T;
}

function mergeValue(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return cloneJson(base);
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = cloneJson(base);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      out[key] = mergeValue(base[key], value);
    }
    return out;
  }
  return cloneJson(patch);
}

/**
 * Carry unsaved edits over to a new server config: the user's changes relative to `oldBase` are
 * re-applied on top of `newBase`. Fields the server rejected therefore stay edited (and dirty);
 * fields it accepted end up equal to the new base.
 *
 * When `newBase` answers a PATCH, pass what was `sent`: a field the user changed again while
 * the request was in flight (even back to its old value) must keep the draft's value, not take
 * the one the server just stored; it then stays dirty and is sent again.
 */
export function rebaseDraft(
  oldBase: HudConfig,
  newBase: HudConfig,
  draft: HudConfig,
  sent?: DeepPartial<HudConfig>,
): HudConfig {
  const rebased = applyPatch<HudConfig>(newBase, diffConfig(oldBase, draft));
  if (sent === undefined) return rebased;
  const afterSend = diffConfig(applyPatch<HudConfig>(oldBase, sent), draft);
  return applyPatch<HudConfig>(rebased, afterSend);
}

/** Dotted path of every leaf in a patch (arrays count as one leaf), in `a.b[2].c` form. */
export function leafPaths(patch: unknown, prefix: Path = []): string[] {
  if (isPlainObject(patch)) {
    return Object.entries(patch).flatMap(([key, value]) =>
      value === undefined ? [] : leafPaths(value, [...prefix, key]),
    );
  }
  return prefix.length === 0 ? [] : [pathKey(prefix)];
}

/** Format a path the way server validation errors do: `display.brightness.minLevel`, `obd.customPids[0].pid`. */
export function pathKey(path: Path): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out === '' ? key : `.${key}`;
  }
  return out;
}

/** True when `path` equals `prefix` or lies inside it (`a.b` contains `a.b.c` and `a.b[0]`). */
export function pathWithin(path: string, prefix: string): boolean {
  if (prefix === '') return true;
  if (path === prefix) return true;
  if (!path.startsWith(prefix)) return false;
  const next = path.charAt(prefix.length);
  return next === '.' || next === '[';
}

/** The value at `path`, or undefined when any step is missing. */
export function getAt(value: unknown, path: Path): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key];
    else if (isPlainObject(current) && typeof key === 'string') current = current[key];
    else return undefined;
  }
  return current;
}

/**
 * A copy of `root` with `value` stored at `path`, sharing every untouched branch (so equality
 * checks on siblings stay cheap). Missing intermediate objects are created.
 */
export function setAt<T>(root: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [key, ...rest] = path as [PathKey, ...PathKey[]];
  if (Array.isArray(root) && typeof key === 'number') {
    const copy = [...(root as unknown[])];
    copy[key] = setAt(copy[key], rest, value);
    return copy as T;
  }
  const obj: Record<string, unknown> = isPlainObject(root) ? { ...root } : {};
  obj[String(key)] = setAt(obj[String(key)], rest, value);
  return obj as T;
}

/** `patch` without the subtree at `path` (pruning objects left empty). */
export function omitPath(patch: unknown, path: Path): unknown {
  if (path.length === 0) return undefined;
  if (!isPlainObject(patch)) return patch;
  const [key, ...rest] = path as [PathKey, ...PathKey[]];
  const name = String(key);
  if (!Object.hasOwn(patch, name)) return patch;
  const out: Record<string, unknown> = { ...patch };
  const child = omitPath(out[name], rest);
  if (child === undefined || (isPlainObject(child) && Object.keys(child).length === 0)) {
    delete out[name];
  } else {
    out[name] = child;
  }
  return out;
}

/** Just the subtree of `patch` at `path`, wrapped back into its parents; undefined when absent. */
export function pickPath(patch: unknown, path: Path): unknown {
  const inner = getAt(patch, path);
  return inner === undefined ? undefined : setAt({}, path, cloneJson(inner));
}
