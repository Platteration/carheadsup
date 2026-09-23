import type { FieldIssue } from './validation.ts';
import { pathKey } from './diff.ts';
import type { Path, PathKey } from './diff.ts';

/**
 * A typed window onto one object inside the config draft. Sections receive a scope such as
 * `root.child('display').child('brightness')` and read/write its keys with full type checking,
 * while the editor keeps the path needed for patches and error lookup.
 */
export interface Scope<T> {
  readonly value: T;
  readonly path: Path;
  /** Server-format path of the scope itself, e.g. "display.brightness". */
  readonly key: string;
  child<K extends keyof T & PathKey>(key: K): Scope<T[K]>;
  set<K extends keyof T & PathKey>(key: K, value: T[K]): void;
  /** Replace the scope's whole value. */
  replace(value: T): void;
  /** Server-format path of a key in this scope. */
  keyOf(key: keyof T & PathKey): string;
  issue(key: keyof T & PathKey): FieldIssue | undefined;
  /** Every issue at or below this scope (e.g. all rows of a list), in path order. */
  issuesWithin(): FieldIssue[];
  dirty(key: keyof T & PathKey): boolean;
}

/** What a scope needs from the editor that owns the draft. */
export interface ScopeHost {
  setAt(path: Path, value: unknown): void;
  issueAt(key: string): FieldIssue | undefined;
  issuesWithin(key: string): FieldIssue[];
  dirtyAt(path: Path): boolean;
}

export function makeScope<T>(value: T, path: Path, host: ScopeHost): Scope<T> {
  const key = pathKey(path);
  const keyOf = (k: PathKey): string => pathKey([...path, k]);
  return {
    value,
    path,
    key,
    child: (k) => makeScope(value[k], [...path, k], host),
    set: (k, v) => host.setAt([...path, k], v),
    replace: (v) => host.setAt(path, v),
    keyOf,
    issue: (k) => host.issueAt(keyOf(k)),
    issuesWithin: () => host.issuesWithin(key),
    dirty: (k) => host.dirtyAt([...path, k]),
  };
}

/** Keys of `T` whose values are assignable to `V` (e.g. the numeric fields of a config object). */
export type KeysOfType<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T] &
  PathKey;
