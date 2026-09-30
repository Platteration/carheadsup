import type {
  ApiClearDtcsResult,
  ApiConfigResult,
  ApiDiagnostics,
  ApiInfo,
  ApiPairingShowResult,
  DeepPartial,
  HudConfig,
  InputAction,
  MaintenanceItemStatus,
  SimControl,
  SimStatus,
  TripRecord,
} from '@carheadsup/core';

/**
 * Typed client for the HUD's REST API (`core/src/types/api.ts`), shared by the settings app and
 * the dev console. Every request carries `Authorization: Bearer <token>` when a token is known
 * (the HUD requires it from non-loopback clients once `server.apiToken` is set), and every
 * failure — including no network at all — surfaces as a {@link HudApiError} with a `kind` the UI
 * can switch on.
 */

/** localStorage key holding the bearer token the user entered on this device. */
export const API_TOKEN_STORAGE_KEY = 'carheadsup.apiToken';

/** Requests that get no response within this time fail with kind `timeout`. */
export const DEFAULT_TIMEOUT_MS = 8000;

export type HudApiErrorKind =
  /** No response at all: offline, host unreachable, connection refused, DNS failure. */
  | 'network'
  /** No response within the client's timeout. */
  | 'timeout'
  /** The caller cancelled the request through its AbortSignal. */
  | 'aborted'
  /** 401 / 403: the bearer token is missing or wrong. */
  | 'unauthorized'
  /** 404: e.g. `/api/sim` on a HUD connected to a real vehicle. */
  | 'not-found'
  /** Any other non-2xx status. */
  | 'http'
  /** A 2xx response whose body is not what the endpoint returns (e.g. an HTML page). */
  | 'invalid-response';

export interface HudApiErrorInit {
  kind: HudApiErrorKind;
  message: string;
  method: string;
  path: string;
  status?: number | null;
  body?: unknown;
  cause?: unknown;
}

/** Every failure of a {@link HudApi} call. */
export class HudApiError extends Error {
  readonly kind: HudApiErrorKind;
  /** HTTP status, or null when no response was received. */
  readonly status: number | null;
  readonly method: string;
  readonly path: string;
  /** Parsed JSON body (or raw text) of an error response, when there was one. */
  readonly body: unknown;

  constructor(init: HudApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'HudApiError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.method = init.method;
    this.path = init.path;
    this.body = init.body;
  }
}

export function isHudApiError(error: unknown): error is HudApiError {
  return error instanceof HudApiError;
}

/** True for errors caused by the caller cancelling the request (safe to ignore). */
export function isAbortError(error: unknown): boolean {
  return isHudApiError(error) && error.kind === 'aborted';
}

/** A short, user-facing sentence for any error thrown by the client (or anything else). */
export function describeError(error: unknown): string {
  if (!isHudApiError(error)) {
    return error instanceof Error && error.message !== '' ? error.message : 'Something went wrong';
  }
  switch (error.kind) {
    case 'network':
      return 'Can’t reach the HUD. Check that this device is on the car’s Wi-Fi.';
    case 'timeout':
      return 'The HUD did not answer in time.';
    case 'aborted':
      return 'Request cancelled.';
    case 'unauthorized':
      return 'The HUD needs a valid access token.';
    case 'not-found':
      return error.message;
    case 'invalid-response':
      return 'The HUD sent an unexpected response. Is this the HUD’s address?';
    case 'http':
      return error.message;
  }
}

// ---------------------------------------------------------------------------------------------
// Token storage

/** Where the bearer token lives between visits. */
export interface TokenStore {
  get(): string;
  /** An empty string forgets the token. */
  set(token: string): void;
}

export function memoryTokenStore(initial = ''): TokenStore {
  let token = initial;
  return {
    get: () => token,
    set: (next) => {
      token = next.trim();
    },
  };
}

/**
 * Token store backed by localStorage. Storage can be unavailable (Android WebViews without DOM
 * storage enabled, private browsing) or throw on access; the token is then kept in memory for
 * the lifetime of the page instead.
 */
export function localStorageTokenStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeLocalStorage(),
  key: string = API_TOKEN_STORAGE_KEY,
): TokenStore {
  const memory = memoryTokenStore();
  try {
    memory.set(storage?.getItem(key) ?? '');
  } catch {
    // Unreadable storage: start without a token.
  }
  return {
    get: memory.get,
    set: (next) => {
      memory.set(next);
      const token = memory.get();
      try {
        if (token === '') storage?.removeItem(key);
        else storage?.setItem(key, token);
      } catch {
        // Quota or security error: the in-memory copy still works for this page.
      }
    },
  };
}

/**
 * Take a token handed over in the page address (`?token=<api token>`, e.g. by the companion
 * app): store it on this device and remove it from the address bar so it does not linger in
 * history or screenshots. Returns whether a token was adopted.
 */
export function adoptTokenFromUrl(
  tokens: TokenStore,
  location: { href: string } = window.location,
  replace: (url: string) => void = (url) => history.replaceState(history.state, '', url),
): boolean {
  let url: URL;
  try {
    url = new URL(location.href);
  } catch {
    return false;
  }
  const token = url.searchParams.get('token');
  if (token === null) return false;
  tokens.set(token);
  url.searchParams.delete('token');
  try {
    replace(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Not fatal: the token is stored either way.
  }
  return true;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Client

export interface HudApiOptions {
  /**
   * Origin (and optional path prefix) of the HUD, e.g. "https://192.168.4.1:8443" (other devices
   * use its TLS port; plain http serves only the HUD itself). Default: same origin.
   */
  baseUrl?: string;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Default: {@link localStorageTokenStore}. */
  tokens?: TokenStore;
  /** Default {@link DEFAULT_TIMEOUT_MS}; 0 disables the timeout. */
  timeoutMs?: number;
}

/** Per-call options. */
export interface CallOptions {
  signal?: AbortSignal;
}

export interface TripsQuery {
  /** Page size; the server's default applies when omitted. */
  limit?: number;
  /** Only trips that started before this epoch ms (for paging back in time). */
  before?: number;
}

export interface HudApi {
  readonly tokens: TokenStore;
  getInfo(options?: CallOptions): Promise<ApiInfo>;
  getConfig(options?: CallOptions): Promise<HudConfig>;
  /** Full replace. Rejected fields keep their previous value and are listed in `errors`. */
  putConfig(config: HudConfig, options?: CallOptions): Promise<ApiConfigResult>;
  /** Deep merge (arrays replace wholesale). Rejected fields are listed in `errors`. */
  patchConfig(patch: DeepPartial<HudConfig>, options?: CallOptions): Promise<ApiConfigResult>;
  getDiagnostics(options?: CallOptions): Promise<ApiDiagnostics>;
  /**
   * Ask the car to clear its trouble codes. A refusal (not parked with the engine off) resolves
   * with `ok: false` and the server's explanation rather than throwing.
   */
  clearDtcs(options?: CallOptions): Promise<ApiClearDtcsResult>;
  /** Completed trips, newest first. */
  getTrips(query?: TripsQuery, options?: CallOptions): Promise<TripRecord[]>;
  /** All trips as CSV text (fetched with the token, so it works behind auth). */
  getTripsCsv(options?: CallOptions): Promise<string>;
  deleteTrip(id: string, options?: CallOptions): Promise<void>;
  getMaintenance(options?: CallOptions): Promise<MaintenanceItemStatus[]>;
  /** Record a service; without `odometerKm` the HUD uses its best-known odometer. */
  markMaintenanceDone(
    itemId: string,
    odometerKm?: number,
    options?: CallOptions,
  ): Promise<MaintenanceItemStatus[]>;
  setOdometer(odometerKm: number, options?: CallOptions): Promise<void>;
  sendInput(action: InputAction, options?: CallOptions): Promise<void>;
  /**
   * Turn the parked HUD's dashboard to its pairing QR code. A refusal (not parked) resolves with
   * `ok: false` and the server's explanation rather than throwing.
   */
  showPairing(options?: CallOptions): Promise<ApiPairingShowResult>;
  /** Simulator status, or null when the HUD is connected to a real vehicle (404). */
  getSim(options?: CallOptions): Promise<SimStatus | null>;
  /** Throws a `not-found` HudApiError when the HUD is not simulating. */
  controlSim(control: SimControl, options?: CallOptions): Promise<SimStatus>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestSpec<T> {
  method: Method;
  path: string;
  body?: unknown;
  /** 'json' parses and checks with `accept`; 'text' returns the raw body. */
  expect: 'json' | 'text';
  accept: (value: unknown) => value is T;
  /** Error responses whose body satisfies this are returned instead of thrown. */
  acceptErrorBody?: (value: unknown) => value is T;
  options?: CallOptions;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isInfo = (v: unknown): v is ApiInfo =>
  isObject(v) && v.name === 'carheadsup' && typeof v.version === 'string' && isObject(v.obd);

const isConfig = (v: unknown): v is HudConfig =>
  isObject(v) && v.version === 1 && isObject(v.units) && isObject(v.display);

const isConfigResult = (v: unknown): v is ApiConfigResult =>
  isObject(v) &&
  isConfig(v.config) &&
  Array.isArray(v.errors) &&
  v.errors.every((e) => typeof e === 'string');

const isDiagnostics = (v: unknown): v is ApiDiagnostics =>
  isObject(v) &&
  isObject(v.link) &&
  typeof v.milOn === 'boolean' &&
  Array.isArray(v.dtcs) &&
  isObject(v.signals);

const isClearResult = (v: unknown): v is ApiClearDtcsResult =>
  isObject(v) && typeof v.ok === 'boolean' && typeof v.message === 'string';

const isPairingShowResult = (v: unknown): v is ApiPairingShowResult =>
  isObject(v) &&
  typeof v.ok === 'boolean' &&
  typeof v.message === 'string' &&
  (v.status === null || typeof v.status === 'string');

const isTrips = (v: unknown): v is TripRecord[] =>
  Array.isArray(v) && v.every((t) => isObject(t) && typeof t.id === 'string');

const isMaintenance = (v: unknown): v is MaintenanceItemStatus[] =>
  Array.isArray(v) && v.every((m) => isObject(m) && typeof m.itemId === 'string');

const isSimStatus = (v: unknown): v is SimStatus =>
  isObject(v) && typeof v.mode === 'string' && typeof v.speedKph === 'number';

/** Any JSON object (for `{ ok: true }` acknowledgements). */
const isAck = (v: unknown): v is Record<string, unknown> => isObject(v);

const isText = (v: unknown): v is string => typeof v === 'string';

/** The server's `{ error }` message, if the body has one. */
function errorMessageOf(body: unknown): string | null {
  if (isObject(body) && typeof body.error === 'string' && body.error.trim() !== '') {
    return body.error.trim();
  }
  if (isObject(body) && typeof body.message === 'string' && body.message.trim() !== '') {
    return body.message.trim();
  }
  return null;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Combine the caller's signal with a timeout; `dispose` must be called when done. */
function linkSignals(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener('abort', onAbort, { once: true });
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    },
  };
}

/** Create a client. With no options it talks to the page's own origin. */
export function createHudApi(options: HudApiOptions = {}): HudApi {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const tokens = options.tokens ?? localStorageTokenStore();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request<T>(spec: RequestSpec<T>): Promise<T> {
    const { method, path } = spec;
    const fail = (init: Omit<HudApiErrorInit, 'method' | 'path'>): HudApiError =>
      new HudApiError({ ...init, method, path });

    if (spec.options?.signal?.aborted) {
      throw fail({ kind: 'aborted', message: `${method} ${path} was cancelled` });
    }
    const headers: Record<string, string> = {
      Accept: spec.expect === 'json' ? 'application/json' : 'text/csv, text/plain, */*',
    };
    const token = tokens.get();
    if (token !== '') headers.Authorization = `Bearer ${token}`;
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';

    const link = linkSignals(spec.options?.signal, timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        signal: link.signal,
        cache: 'no-store',
      });
      text = await response.text();
    } catch (cause) {
      if (link.timedOut()) {
        throw fail({ kind: 'timeout', message: `${method} ${path} timed out`, cause });
      }
      if (spec.options?.signal?.aborted) {
        throw fail({ kind: 'aborted', message: `${method} ${path} was cancelled`, cause });
      }
      throw fail({ kind: 'network', message: `${method} ${path} failed: no response`, cause });
    } finally {
      link.dispose();
    }

    const parsed = parseJson(text);
    const body: unknown = parsed.ok ? parsed.value : text;

    if (!response.ok) {
      if (spec.acceptErrorBody?.(body)) return body;
      const status = response.status;
      const serverMessage = errorMessageOf(body);
      const kind: HudApiErrorKind =
        status === 401 || status === 403 ? 'unauthorized' : status === 404 ? 'not-found' : 'http';
      const message =
        serverMessage ??
        (kind === 'not-found'
          ? `${path} is not available on this HUD`
          : text.trim() === ''
            ? `The HUD answered HTTP ${status} with no details`
            : `The HUD answered HTTP ${status}`);
      throw fail({ kind, status, message, body });
    }

    if (spec.expect === 'text') {
      if (spec.accept(text)) return text;
      throw fail({
        kind: 'invalid-response',
        status: response.status,
        message: 'Unexpected response',
        body: text,
      });
    }
    if (parsed.ok && spec.accept(parsed.value)) return parsed.value;
    throw fail({
      kind: 'invalid-response',
      status: response.status,
      message: parsed.ok
        ? `${method} ${path} returned an unexpected shape`
        : `${method} ${path} did not return JSON`,
      body,
    });
  }

  const get = <T>(path: string, accept: (v: unknown) => v is T, options?: CallOptions) =>
    request({ method: 'GET', path, expect: 'json', accept, options });

  return {
    tokens,
    getInfo: (options) => get('/api/info', isInfo, options),
    getConfig: (options) => get('/api/config', isConfig, options),
    putConfig: (config, options) =>
      request({
        method: 'PUT',
        path: '/api/config',
        body: config,
        expect: 'json',
        accept: isConfigResult,
        acceptErrorBody: isConfigResult,
        options,
      }),
    patchConfig: (patch, options) =>
      request({
        method: 'PATCH',
        path: '/api/config',
        body: patch,
        expect: 'json',
        accept: isConfigResult,
        acceptErrorBody: isConfigResult,
        options,
      }),
    getDiagnostics: (options) => get('/api/diagnostics', isDiagnostics, options),
    clearDtcs: (options) =>
      request({
        method: 'POST',
        path: '/api/diagnostics/clear-dtcs',
        expect: 'json',
        accept: isClearResult,
        acceptErrorBody: isClearResult,
        options,
      }),
    getTrips: (query = {}, options) => {
      const params = new URLSearchParams();
      if (query.limit !== undefined)
        params.set('limit', String(Math.max(1, Math.floor(query.limit))));
      if (query.before !== undefined) params.set('before', String(Math.floor(query.before)));
      const qs = params.toString();
      return get(`/api/trips${qs === '' ? '' : `?${qs}`}`, isTrips, options);
    },
    getTripsCsv: (options) =>
      request({ method: 'GET', path: '/api/trips.csv', expect: 'text', accept: isText, options }),
    deleteTrip: async (id, options) => {
      await request({
        method: 'DELETE',
        path: `/api/trips/${encodeURIComponent(id)}`,
        expect: 'json',
        accept: isAck,
        options,
      });
    },
    getMaintenance: (options) => get('/api/maintenance', isMaintenance, options),
    markMaintenanceDone: (itemId, odometerKm, options) =>
      request({
        method: 'POST',
        path: `/api/maintenance/${encodeURIComponent(itemId)}/done`,
        body: odometerKm === undefined ? {} : { odometerKm },
        expect: 'json',
        accept: isMaintenance,
        options,
      }),
    setOdometer: async (odometerKm, options) => {
      await request({
        method: 'POST',
        path: '/api/odometer',
        body: { odometerKm },
        expect: 'json',
        accept: isAck,
        options,
      });
    },
    showPairing: (options) =>
      request({
        method: 'POST',
        path: '/api/pairing/show',
        expect: 'json',
        accept: isPairingShowResult,
        acceptErrorBody: isPairingShowResult,
        options,
      }),
    sendInput: async (action, options) => {
      await request({
        method: 'POST',
        path: '/api/input',
        body: { action },
        expect: 'json',
        accept: isAck,
        options,
      });
    },
    getSim: async (options) => {
      try {
        return await get('/api/sim', isSimStatus, options);
      } catch (error) {
        if (isHudApiError(error) && error.kind === 'not-found') return null;
        throw error;
      }
    },
    controlSim: (control, options) =>
      request({
        method: 'POST',
        path: '/api/sim',
        body: control,
        expect: 'json',
        accept: isSimStatus,
        options,
      }),
  };
}
