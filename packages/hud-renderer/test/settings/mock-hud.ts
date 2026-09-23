import { DEFAULT_CONFIG, mergeConfig, parseConfig } from '@carheadsup/core';
import { lookupDtc } from '@carheadsup/core/dtc';
import type {
  ApiDiagnostics,
  ApiInfo,
  DeepPartial,
  HudConfig,
  MaintenanceItemStatus,
  SimControl,
  SimStatus,
  TripRecord,
} from '@carheadsup/core';

/**
 * An in-memory HUD implementing the REST API contract (`core/src/types/api.ts`) for renderer
 * tests and screenshots. Config writes go through the real `mergeConfig` / `parseConfig`, so
 * validation errors look exactly like the server's.
 */

export const MOCK_NOW = Date.UTC(2026, 4, 14, 15, 42, 0);
const DAY = 86_400_000;

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

export interface MockHudOptions {
  /** Serve `/api/sim` (else 404 like a HUD on a real car). */
  simulated?: boolean;
  /** Require this bearer token on every request. */
  token?: string;
  /** Refuse clearing DTCs (not parked with the engine off). */
  refuseClear?: boolean;
}

export interface MockResponse {
  status: number;
  contentType: string;
  body: string;
}

function trip(
  id: number,
  daysAgo: number,
  km: number,
  minutes: number,
  litres: number | null,
): TripRecord {
  const startedAt = MOCK_NOW - daysAgo * DAY - minutes * 60_000;
  return {
    id: `trip-${id}`,
    startedAt,
    endedAt: startedAt + minutes * 60_000,
    distanceKm: km,
    durationS: minutes * 60,
    movingS: minutes * 50,
    idleS: minutes * 10,
    fuelUsedL: litres,
    avgLPer100km: litres === null ? null : (litres / km) * 100,
    maxSpeedKph: 118,
    avgMovingSpeedKph: (km / (minutes * 50)) * 3600,
    cost: litres === null ? null : Math.round(litres * 1.82 * 100) / 100,
    currency: 'EUR',
    startOdometerKm: 58_000 - daysAgo * 40,
    endOdometerKm: 58_000 - daysAgo * 40 + km,
  };
}

export function mockTrips(): TripRecord[] {
  return [
    trip(5, 0, 42.7, 52, 3.1),
    trip(4, 1, 12.4, 25, 0.9),
    trip(3, 2, 186.2, 118, 12.6),
    trip(2, 4, 8.1, 19, null),
    trip(1, 6, 23.5, 34, 1.9),
  ];
}

export function mockMaintenance(): MaintenanceItemStatus[] {
  return [
    {
      itemId: 'oil',
      label: 'Oil & filter',
      lastDoneAt: MOCK_NOW - 345 * DAY,
      lastDoneKm: 50_210,
      dueAtKm: 58_210,
      dueAtEpochMs: MOCK_NOW + 20 * DAY,
      remainingKm: 420,
      remainingDays: 20,
      status: 'due-soon',
    },
    {
      itemId: 'brake-fluid',
      label: 'Brake fluid',
      lastDoneAt: MOCK_NOW - 742 * DAY,
      lastDoneKm: null,
      dueAtKm: null,
      dueAtEpochMs: MOCK_NOW - 12 * DAY,
      remainingKm: null,
      remainingDays: -12,
      status: 'overdue',
    },
    {
      itemId: 'tyre-rotation',
      label: 'Tyre rotation',
      lastDoneAt: MOCK_NOW - 90 * DAY,
      lastDoneKm: 54_000,
      dueAtKm: 64_000,
      dueAtEpochMs: null,
      remainingKm: 6210,
      remainingDays: null,
      status: 'ok',
    },
    {
      itemId: 'cabin-filter',
      label: 'Cabin filter',
      lastDoneAt: null,
      lastDoneKm: null,
      dueAtKm: null,
      dueAtEpochMs: null,
      remainingKm: null,
      remainingDays: null,
      status: 'unknown',
    },
  ];
}

export function mockDiagnostics(): ApiDiagnostics {
  const at = MOCK_NOW;
  const dtc = (code: string, kind: 'stored' | 'pending' | 'permanent') => {
    const info = lookupDtc(code);
    return {
      code,
      kind,
      description: info.description,
      short: info.short,
      severity: info.severity,
    };
  };
  return {
    link: {
      state: 'connected',
      adapter: 'OBDLink MX+ (STN2255)',
      protocol: 'ISO 15765-4 (CAN 11/500)',
      message: null,
      since: at - 3_600_000,
    },
    milOn: true,
    dtcs: [dtc('P0420', 'stored'), dtc('P0171', 'pending')],
    dtcsCheckedAt: at - 20_000,
    supported: [
      'speed',
      'rpm',
      'coolantTemp',
      'intakeAirTemp',
      'engineLoad',
      'fuelLevel',
      'controlModuleVoltage',
      'maf',
      'odometer',
    ],
    signals: {
      speed: { value: 0, at },
      rpm: { value: 782, at },
      coolantTemp: { value: 91, at },
      intakeAirTemp: { value: 32, at },
      engineLoad: { value: 21.2, at },
      fuelLevel: { value: 58, at: at - 4000 },
      controlModuleVoltage: { value: 14.2, at },
      longFuelTrimB1: { value: 11.7, at },
      maf: { value: 3.4, at },
      oilTemp: { value: 97, at: at - 60_000 },
      odometer: { value: 58_012.4, at: at - 5000 },
    },
    vin: 'WVWZZZAUZKW123456',
  };
}

function initialConfig(): HudConfig {
  const { config } = parseConfig(DEFAULT_CONFIG);
  config.vehicle.name = 'Golf 1.5 TSI';
  config.units.currency = 'EUR';
  config.phone.pairingToken = 'K7fQ2mZr9TxW4bHc8NpV3sLd';
  return config;
}

const SIM_START: SimStatus = {
  mode: 'scenario',
  throttle: 0.2,
  brake: 0,
  engineRunning: true,
  gear: null,
  speedKph: 48,
  rpm: 1850,
  dtcs: [],
  lux: 12_000,
  ambientTempC: 17,
  scenarioStep: 'city: approaching junction',
};

export class MockHud {
  config: HudConfig = initialConfig();
  trips: TripRecord[] = mockTrips();
  maintenance: MaintenanceItemStatus[] = mockMaintenance();
  diagnostics: ApiDiagnostics = mockDiagnostics();
  sim: SimStatus | null;
  requests: RecordedRequest[] = [];
  readonly options: MockHudOptions;
  /** When set, every request fails as a network error (fetch rejects). */
  offline = false;

  constructor(options: MockHudOptions = {}) {
    this.options = options;
    this.sim = options.simulated ? { ...SIM_START } : null;
  }

  info(): ApiInfo {
    return {
      name: 'carheadsup',
      version: '0.1.0',
      simulated: this.sim !== null,
      uptimeS: 7 * 3600 + 23 * 60,
      obd: this.diagnostics.link,
      phoneConnected: true,
    };
  }

  /** Handle one request (URL may be absolute or a path). */
  handle(method: string, url: string, body: unknown, authorization: string | null): MockResponse {
    const { pathname, searchParams } = new URL(url, 'http://hud.local');
    this.requests.push({
      method,
      path: `${pathname}${searchParams.size > 0 ? `?${searchParams}` : ''}`,
      body,
      authorization,
    });
    const json = (status: number, value: unknown): MockResponse => ({
      status,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
    if (this.options.token && authorization !== `Bearer ${this.options.token}`) {
      return json(401, { error: 'Missing or invalid API token' });
    }
    const route = `${method} ${pathname}`;
    switch (route) {
      case 'GET /api/info':
        return json(200, this.info());
      case 'GET /api/config':
        return json(200, this.config);
      case 'PATCH /api/config': {
        const result = mergeConfig(this.config, body as DeepPartial<HudConfig>);
        this.config = result.config;
        return json(200, result);
      }
      case 'PUT /api/config': {
        const result = parseConfig(body, this.config);
        this.config = result.config;
        return json(200, result);
      }
      case 'GET /api/diagnostics':
        return json(200, this.diagnostics);
      case 'POST /api/diagnostics/clear-dtcs':
        if (this.options.refuseClear) {
          return json(409, {
            ok: false,
            message: 'Park and switch the engine off before clearing codes.',
          });
        }
        this.diagnostics = { ...this.diagnostics, dtcs: [], milOn: false };
        return json(200, { ok: true, message: 'Trouble codes cleared.' });
      case 'GET /api/trips': {
        const limit = Number(searchParams.get('limit') ?? 50);
        const before = searchParams.has('before') ? Number(searchParams.get('before')) : Infinity;
        const page = [...this.trips]
          .sort((a, b) => b.startedAt - a.startedAt)
          .filter((t) => t.startedAt < before)
          .slice(0, limit);
        return json(200, page);
      }
      case 'GET /api/trips.csv':
        return {
          status: 200,
          contentType: 'text/csv',
          body: 'id,startedAt\n' + this.trips.map((t) => `${t.id},${t.startedAt}`).join('\n'),
        };
      case 'GET /api/maintenance':
        return json(200, this.maintenance);
      case 'POST /api/odometer':
        return json(200, { ok: true });
      case 'POST /api/input':
        return json(200, { ok: true });
      case 'GET /api/sim':
        return this.sim ? json(200, this.sim) : json(404, { error: 'Not simulating' });
      case 'POST /api/sim': {
        if (!this.sim) return json(404, { error: 'Not simulating' });
        const control = body as SimControl;
        const {
          phone: _phone,
          adas: _adas,
          tirePressuresKpa: _tpms,
          coolantOverrideC: _c,
          voltageOverrideV: _v,
          fuelLevelOverridePct: _f,
          ...rest
        } = control;
        this.sim = { ...this.sim, ...rest };
        return json(200, this.sim);
      }
      default:
        break;
    }
    const tripMatch = /^\/api\/trips\/([^/]+)$/.exec(pathname);
    if (method === 'DELETE' && tripMatch) {
      const id = decodeURIComponent(tripMatch[1] ?? '');
      this.trips = this.trips.filter((t) => t.id !== id);
      return json(200, { ok: true });
    }
    const doneMatch = /^\/api\/maintenance\/([^/]+)\/done$/.exec(pathname);
    if (method === 'POST' && doneMatch) {
      const id = decodeURIComponent(doneMatch[1] ?? '');
      const odometerKm = (body as { odometerKm?: number } | null)?.odometerKm ?? null;
      this.maintenance = this.maintenance.map((m) =>
        m.itemId === id
          ? {
              ...m,
              status: 'ok',
              lastDoneAt: MOCK_NOW,
              lastDoneKm: odometerKm,
              remainingKm: 8000,
              remainingDays: 365,
            }
          : m,
      );
      return json(200, this.maintenance);
    }
    return json(404, { error: `No route for ${route}` });
  }

  /** A `fetch` implementation backed by this mock. */
  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const res = this.handle(init.method ?? 'GET', url, body, headers.get('Authorization'));
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.contentType },
    });
  };

  /** Requests other than the periodic polls, for assertions. */
  writes(): RecordedRequest[] {
    return this.requests.filter((r) => r.method !== 'GET');
  }
}
