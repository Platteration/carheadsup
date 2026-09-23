import type { DeepPartial, HudConfig } from '@carheadsup/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isAbortError } from '../../common/api.ts';
import type { HudApi } from '../../common/api.ts';
import {
  diffConfig,
  getAt,
  isPlainObject,
  jsonEqual,
  leafPaths,
  omitPath,
  pathKey,
  pathWithin,
  pickPath,
  rebaseDraft,
  setAt,
} from '../model/diff.ts';
import type { Path } from '../model/diff.ts';
import { makeScope } from '../model/scope.ts';
import type { Scope, ScopeHost } from '../model/scope.ts';
import {
  dropIssuesTouching,
  issuesWithin,
  parseServerErrors,
  validateConfig,
} from '../model/validation.ts';
import type { FieldIssue, IssueMap } from '../model/validation.ts';

/**
 * State of the settings form: the server's config (`base`), the local edits (`draft`), instant
 * validation, and saving. Saving PATCHes only the changed subtree; "live" subtrees (projection)
 * are PATCHed automatically, debounced, so their effect shows on the windshield while editing.
 * All PATCHes go through one queue, and every response is merged back with `rebaseDraft`, so
 * edits made while a request is in flight are never lost.
 */

/** Subtrees saved as they are edited. */
export const LIVE_PATHS: readonly Path[] = [['display', 'projection']];

/** Debounce for live subtrees: fast enough to feel live, slow enough not to flood the HUD. */
export const LIVE_DELAY_MS = 150;

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface LiveStatus {
  /** A live change is waiting for the debounce or the server. */
  pending: boolean;
  /** The last live PATCH failed (network / auth); cleared by a later success or `retryLive`. */
  error: unknown;
}

export interface SaveOutcome {
  /** Number of changed fields that were sent. */
  sent: number;
  /** Fields the server rejected. */
  rejected: number;
  at: number;
}

export interface ConfigEditor {
  status: LoadStatus;
  loadError: unknown;
  base: HudConfig | null;
  draft: HudConfig | null;
  /** Root scope over the draft (null until loaded). */
  root: Scope<HudConfig> | null;
  /** Client validation merged with the server's rejections (client first). */
  issues: IssueMap;
  /** Server messages that are not about a single field. */
  generalErrors: string[];
  /** Inputs whose text could not be parsed, by path. */
  localErrors: ReadonlyMap<string, string>;
  /** Changed fields awaiting Save (live subtrees excluded), as server-format paths. */
  pendingPaths: string[];
  /** Problems that block saving (client issues + unparseable inputs), as paths. */
  blockingPaths: string[];
  saving: boolean;
  saveError: unknown;
  lastSave: SaveOutcome | null;
  live: LiveStatus;
  /** Bumped when edits are discarded or reloaded, so inputs re-sync their text. */
  revision: number;
  setAt(path: Path, value: unknown): void;
  setLocalError(key: string, message: string | null): void;
  save(): Promise<void>;
  discard(): void;
  /**
   * Fetch the config again. The first load (or a retry after it failed) replaces the draft;
   * once loaded, unsaved edits are kept and rebased onto what the HUD now has.
   */
  reload(): Promise<void>;
  retryLive(): void;
}

interface State {
  status: LoadStatus;
  loadError: unknown;
  base: HudConfig | null;
  draft: HudConfig | null;
  serverIssues: Map<string, FieldIssue>;
  generalErrors: string[];
  localErrors: Map<string, string>;
  saving: boolean;
  saveError: unknown;
  lastSave: SaveOutcome | null;
  liveError: unknown;
  revision: number;
}

const INITIAL: State = {
  status: 'loading',
  loadError: null,
  base: null,
  draft: null,
  serverIssues: new Map(),
  generalErrors: [],
  localErrors: new Map(),
  saving: false,
  saveError: null,
  lastSave: null,
  liveError: null,
  revision: 0,
};

/** The patch for everything except live subtrees. */
export function pendingPatch(base: HudConfig, draft: HudConfig): DeepPartial<HudConfig> {
  let patch: unknown = diffConfig(base, draft);
  for (const live of LIVE_PATHS) patch = omitPath(patch, live);
  return (isPlainObject(patch) ? patch : {}) as DeepPartial<HudConfig>;
}

/** The patch for one live subtree, or null when it is unchanged. */
export function livePatch(
  base: HudConfig,
  draft: HudConfig,
  path: Path,
): DeepPartial<HudConfig> | null {
  const picked = pickPath(diffConfig(base, draft), path);
  return isPlainObject(picked) ? (picked as DeepPartial<HudConfig>) : null;
}

export interface ConfigEditorOptions {
  liveDelayMs?: number;
  /** Test seam for timestamps. */
  now?: () => number;
}

export function useConfigEditor(api: HudApi, options: ConfigEditorOptions = {}): ConfigEditor {
  const liveDelayMs = options.liveDelayMs ?? LIVE_DELAY_MS;
  const now = options.now ?? Date.now;
  const [state, setState] = useState<State>(INITIAL);
  // Mirrors of the latest state for async continuations.
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(true);
  /** Serialises every PATCH so responses are applied in order. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** Last value sent (or being sent) per live path, so a rejected value is not re-sent forever. */
  const liveSent = useRef(new Map<string, unknown>());
  const [livePending, setLivePending] = useState(false);
  const liveInFlight = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = useCallback((fn: (s: State) => State) => {
    if (mounted.current) setState(fn);
  }, []);

  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  const reload = useCallback(async () => {
    update((s) => ({ ...s, status: s.base === null ? 'loading' : s.status, loadError: null }));
    try {
      const config = await api.getConfig();
      if (stateRef.current.draft === null) liveSent.current.clear();
      update((s) => {
        if (s.base !== null && s.draft !== null) {
          // Already editing (e.g. a new access token after a refused save): keep every edit.
          return {
            ...s,
            status: 'ready',
            loadError: null,
            base: config,
            draft: rebaseDraft(s.base, config, s.draft),
            saveError: null,
            liveError: null,
          };
        }
        return {
          ...s,
          status: 'ready',
          loadError: null,
          base: config,
          draft: config,
          serverIssues: new Map(),
          generalErrors: [],
          localErrors: new Map(),
          saveError: null,
          liveError: null,
          revision: s.revision + 1,
        };
      });
    } catch (error) {
      if (isAbortError(error)) return;
      update((s) => ({ ...s, status: s.base === null ? 'error' : s.status, loadError: error }));
    }
  }, [api, update]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Apply the response to PATCH `sent`: new base, rebased draft (edits made since sending kept),
   * server issues under `scope` replaced.
   */
  const applyResult = useCallback(
    (
      config: HudConfig,
      errors: readonly string[],
      scopePaths: readonly string[],
      sent: DeepPartial<HudConfig>,
    ) => {
      const parsed = parseServerErrors(errors);
      update((s) => {
        if (s.base === null || s.draft === null) return s;
        const serverIssues = new Map(
          [...s.serverIssues].filter(([key]) => !scopePaths.some((p) => pathWithin(key, p))),
        );
        for (const [key, issue] of parsed.byPath) serverIssues.set(key, issue);
        return {
          ...s,
          base: config,
          draft: rebaseDraft(s.base, config, s.draft, sent),
          serverIssues,
          generalErrors: parsed.general,
        };
      });
      return parsed;
    },
    [update],
  );

  const setAtPath = useCallback(
    (path: Path, value: unknown) => {
      const key = pathKey(path);
      update((s) => {
        if (s.draft === null) return s;
        return {
          ...s,
          draft: setAt(s.draft, path, value),
          serverIssues:
            s.serverIssues.size === 0 ? s.serverIssues : dropIssuesTouching(s.serverIssues, key),
        };
      });
    },
    [update],
  );

  const setLocalError = useCallback(
    (key: string, message: string | null) => {
      update((s) => {
        const current = s.localErrors.get(key) ?? null;
        if (current === message) return s;
        const localErrors = new Map(s.localErrors);
        if (message === null) localErrors.delete(key);
        else localErrors.set(key, message);
        return { ...s, localErrors };
      });
    },
    [update],
  );

  const clientIssues = useMemo(
    () => (state.draft === null ? new Map<string, FieldIssue>() : validateConfig(state.draft)),
    [state.draft],
  );

  const issues = useMemo<IssueMap>(() => {
    if (state.serverIssues.size === 0) return clientIssues;
    const merged = new Map(clientIssues);
    for (const [key, issue] of state.serverIssues) if (!merged.has(key)) merged.set(key, issue);
    return merged;
  }, [clientIssues, state.serverIssues]);

  const pending = useMemo(
    () => (state.base && state.draft ? pendingPatch(state.base, state.draft) : {}),
    [state.base, state.draft],
  );
  const pendingPaths = useMemo(() => leafPaths(pending), [pending]);
  const blockingPaths = useMemo(
    () => [...new Set([...clientIssues.keys(), ...state.localErrors.keys()])],
    [clientIssues, state.localErrors],
  );

  const save = useCallback(async () => {
    const s = stateRef.current;
    if (s.base === null || s.draft === null || s.saving) return;
    const patch = pendingPatch(s.base, s.draft);
    const sentPaths = leafPaths(patch);
    if (sentPaths.length === 0) return;
    update((x) => ({ ...x, saving: true, saveError: null }));
    try {
      const result = await enqueue(() => api.patchConfig(patch));
      const parsed = applyResult(result.config, result.errors, sentPaths, patch);
      // A new API token takes effect for the very next request: keep using it from here.
      const sentToken = patch.server?.apiToken;
      if (sentToken !== undefined && result.config.server.apiToken === sentToken) {
        api.tokens.set(sentToken);
      }
      update((x) => ({
        ...x,
        saving: false,
        lastSave: { sent: sentPaths.length, rejected: parsed.byPath.size, at: now() },
      }));
    } catch (error) {
      update((x) => ({ ...x, saving: false, saveError: error }));
    }
  }, [api, applyResult, enqueue, now, update]);

  const discard = useCallback(() => {
    update((s) => ({
      ...s,
      draft: s.base,
      serverIssues: new Map(),
      generalErrors: [],
      localErrors: new Map(),
      saveError: null,
      revision: s.revision + 1,
    }));
  }, [update]);

  // Live subtrees: debounce, then PATCH just that subtree (never re-sending a value already sent).
  const liveKey = useMemo(() => {
    if (state.base === null || state.draft === null) return null;
    const changes: Array<{ path: Path; key: string; value: unknown }> = [];
    for (const path of LIVE_PATHS) {
      const key = pathKey(path);
      const value = getAt(state.draft, path);
      const changed = livePatch(state.base, state.draft, path) !== null;
      if (changed && !jsonEqual(liveSent.current.get(key), value))
        changes.push({ path, key, value });
    }
    return changes.length === 0 ? null : changes;
  }, [state.base, state.draft, state.revision]);

  useEffect(() => {
    if (liveKey === null) return undefined;
    const timer = setTimeout(() => {
      for (const change of liveKey) {
        liveSent.current.set(change.key, change.value);
        liveInFlight.current += 1;
        setLivePending(true);
        enqueue(async () => {
          // Re-read the latest draft: later edits in the same subtree ride along.
          const s = stateRef.current;
          const patch = s.base && s.draft ? livePatch(s.base, s.draft, change.path) : null;
          if (patch === null) return;
          liveSent.current.set(change.key, getAt(s.draft, change.path));
          const result = await api.patchConfig(patch);
          applyResult(result.config, result.errors, [change.key], patch);
          update((x) => ({ ...x, liveError: null }));
        })
          .catch((error: unknown) => {
            update((x) => ({ ...x, liveError: error }));
          })
          .finally(() => {
            liveInFlight.current -= 1;
            if (mounted.current && liveInFlight.current === 0) setLivePending(false);
          });
      }
    }, liveDelayMs);
    return () => clearTimeout(timer);
  }, [liveKey, liveDelayMs, api, enqueue, applyResult, update]);

  const retryLive = useCallback(() => {
    liveSent.current.clear();
    update((s) => ({ ...s, liveError: null, revision: s.revision + 1 }));
  }, [update]);

  // Warn before leaving with unsaved edits.
  const hasPending = pendingPaths.length > 0;
  useEffect(() => {
    if (!hasPending || typeof window === 'undefined') return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasPending]);

  const host = useMemo<ScopeHost>(
    () => ({
      setAt: setAtPath,
      issueAt: (key) => issues.get(key),
      issuesWithin: (key) => issuesWithin(issues, key).map(([, issue]) => issue),
      dirtyAt: (path) =>
        state.base !== null &&
        state.draft !== null &&
        !jsonEqual(getAt(state.base, path), getAt(state.draft, path)),
    }),
    [setAtPath, issues, state.base, state.draft],
  );

  const root = useMemo(
    () => (state.draft === null ? null : makeScope(state.draft, [], host)),
    [state.draft, host],
  );

  return {
    status: state.status,
    loadError: state.loadError,
    base: state.base,
    draft: state.draft,
    root,
    issues,
    generalErrors: state.generalErrors,
    localErrors: state.localErrors,
    pendingPaths,
    blockingPaths,
    saving: state.saving,
    saveError: state.saveError,
    lastSave: state.lastSave,
    live: { pending: livePending || liveKey !== null, error: state.liveError },
    revision: state.revision,
    setAt: setAtPath,
    setLocalError,
    save,
    discard,
    reload,
    retryLive,
  };
}
