import {
  INPUT_ACTIONS,
  diagnosticDtcs,
  mergeConfig,
  parseConfig,
  toWallTime,
} from '@carheadsup/core';
import type {
  ApiClearDtcsResult,
  ApiConfigResult,
  ApiDiagnostics,
  ApiInfo,
  DeepPartial,
  HudConfig,
  HudEvent,
  HudState,
  InputAction,
  ObdLinkStatus,
  SignalId,
} from '@carheadsup/core';
import type { Clock, ClearDtcsOutcome } from '@carheadsup/obd';
import { clearDtcsRefusal } from '../obd/obd-link.ts';
import type { Simulation } from '../sources/types.ts';
import { TripLogUnavailableError } from '../store/trip-store.ts';
import type { TripStore } from '../store/trip-store.ts';
import { HttpError } from './respond.ts';
import type { HttpReply } from './respond.ts';
import { Router } from './router.ts';
import { parseSimControl } from './sim-control.ts';

/** Default and maximum page size of `GET /api/trips`. */
export const DEFAULT_TRIPS_PAGE = 50;
export const MAX_TRIPS_PAGE = 500;
/** Largest odometer value accepted from the settings app. */
export const MAX_ODOMETER_KM = 9_999_999;

/** A config change: computes the new config from the current stored one. */
export type ConfigChange = (current: HudConfig) => { config: HudConfig; errors: string[] };

/** What the REST API needs from the rest of the server. */
export interface ApiDeps {
  version: string;
  simulated: boolean;
  /** Engine time now (monotonic, see `HudEngine.now`): uptime and event stamps. */
  now: Clock;
  /** Engine time when the server started (for `uptimeS`). */
  startedAt: number;
  engine: {
    readonly state: HudState;
    /** The effective config the reducer runs with. */
    readonly config: HudConfig;
    dispatch(event: HudEvent): void;
  };
  /** The stored config (what `config.json` holds). */
  getConfig(): HudConfig;
  /** Validate, save and apply a config change; resolves with the resulting stored config. */
  updateConfig(change: ConfigChange): Promise<ApiConfigResult>;
  /** Clear trouble codes via the OBD link (the parked/engine-off check is done here first). */
  clearDtcs(): Promise<ClearDtcsOutcome>;
  trips: Pick<TripStore, 'list' | 'csv' | 'delete'>;
  simulation: Pick<Simulation, 'status' | 'control'> | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ok = (json: unknown, status = 200): HttpReply => ({ status, json });

async function requireObject(body: Promise<unknown>): Promise<Record<string, unknown>> {
  const value = await body;
  if (value === undefined) throw new HttpError(400, 'A JSON request body is required');
  if (!isRecord(value)) throw new HttpError(400, 'Expected a JSON object');
  return value;
}

/** Parse a non-negative integer query parameter; null when absent. */
function intParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  if (!/^\d{1,16}$/.test(raw.trim())) {
    throw new HttpError(400, `Query parameter "${name}" must be a non-negative integer`);
  }
  return Number(raw.trim());
}

/** The OBD link status with its `since` on the wall clock. */
function linkStatus(state: HudState): ObdLinkStatus {
  const { link } = state.vehicle;
  return { ...link, since: toWallTime(state, link.since) };
}

/**
 * Diagnostics with every time on the wall clock, `now` included: engine time `now` (read at the
 * request) converted like the sample times, so ages (`now − at`) are exact.
 */
function diagnostics(state: HudState, now: number): ApiDiagnostics {
  const signals: ApiDiagnostics['signals'] = {};
  for (const [id, sample] of Object.entries(state.vehicle.signals)) {
    if (sample !== undefined && Number.isFinite(sample.value)) {
      signals[id as SignalId] = { value: sample.value, at: toWallTime(state, sample.at) };
    }
  }
  const checkedAt = state.vehicle.dtcsCheckedAt;
  return {
    now: toWallTime(state, Math.max(now, state.now)),
    link: linkStatus(state),
    milOn: state.vehicle.milOn,
    dtcs: diagnosticDtcs(state),
    dtcsCheckedAt: checkedAt === null ? null : toWallTime(state, checkedAt),
    supported: state.vehicle.supported === null ? null : [...state.vehicle.supported],
    signals,
    vin: state.vehicle.vin,
  };
}

function configReply(result: ApiConfigResult): HttpReply {
  return ok(result, result.errors.length > 0 ? 422 : 200);
}

/**
 * The REST API of `core/src/types/api.ts`. Handlers return replies; failures are HttpErrors
 * (400 bad input, 404 unknown resource, 409 refused, 413/415 body problems, 422 invalid config).
 */
export function createApiRouter(deps: ApiDeps): Router {
  const router = new Router();

  router.add('GET', '/api/info', () => {
    const state = deps.engine.state;
    const info: ApiInfo = {
      name: 'carheadsup',
      version: deps.version,
      simulated: deps.simulated,
      uptimeS: Math.max(0, Math.floor((deps.now() - deps.startedAt) / 1000)),
      obd: linkStatus(state),
      phoneConnected: state.phone.connected,
    };
    return ok(info);
  });

  router.add('GET', '/api/config', () => ok(deps.getConfig()));

  router.add('PUT', '/api/config', async (ctx) => {
    const body = await ctx.body();
    if (body === undefined) throw new HttpError(400, 'A JSON request body is required');
    return configReply(await deps.updateConfig((current) => parseConfig(body, current)));
  });

  router.add('PATCH', '/api/config', async (ctx) => {
    const body = await ctx.body();
    if (body === undefined) throw new HttpError(400, 'A JSON request body is required');
    return configReply(
      await deps.updateConfig((current) => mergeConfig(current, body as DeepPartial<HudConfig>)),
    );
  });

  router.add('GET', '/api/diagnostics', () => ok(diagnostics(deps.engine.state, deps.now())));

  router.add('POST', '/api/diagnostics/clear-dtcs', async () => {
    const refusal = clearDtcsRefusal(deps.engine.state);
    if (refusal !== null) {
      const result: ApiClearDtcsResult = { ok: false, message: refusal };
      return ok(result, 409);
    }
    let outcome: ClearDtcsOutcome;
    try {
      outcome = await deps.clearDtcs();
    } catch (err) {
      outcome = {
        ok: false,
        message: `Clearing trouble codes failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const result: ApiClearDtcsResult = { ok: outcome.ok, message: outcome.message };
    return ok(result, outcome.ok ? 200 : 409);
  });

  router.add('GET', '/api/trips', (ctx) => {
    const limit = intParam(ctx.url, 'limit') ?? DEFAULT_TRIPS_PAGE;
    if (limit < 1) throw new HttpError(400, 'Query parameter "limit" must be at least 1');
    const before = intParam(ctx.url, 'before');
    return ok(deps.trips.list({ limit: Math.min(limit, MAX_TRIPS_PAGE), before }));
  });

  router.add('GET', '/api/trips.csv', () => ({
    text: deps.trips.csv(),
    contentType: 'text/csv; charset=utf-8',
    headers: { 'Content-Disposition': 'attachment; filename="carheadsup-trips.csv"' },
  }));

  router.add('DELETE', '/api/trips/:id', async (ctx) => {
    const id = ctx.params['id'] ?? '';
    let deleted: boolean;
    try {
      deleted = await deps.trips.delete(id);
    } catch (err) {
      if (err instanceof TripLogUnavailableError) throw new HttpError(503, err.message);
      throw err;
    }
    if (!deleted) throw new HttpError(404, `No trip with id "${id}"`);
    return ok({ ok: true });
  });

  router.add('GET', '/api/maintenance', () => ok(deps.engine.state.maintenance.status));

  router.add('POST', '/api/maintenance/:itemId/done', async (ctx) => {
    const itemId = ctx.params['itemId'] ?? '';
    const body = await ctx.body();
    if (body !== undefined && !isRecord(body)) throw new HttpError(400, 'Expected a JSON object');
    const km = body?.['odometerKm'];
    if (
      km !== undefined &&
      km !== null &&
      !(typeof km === 'number' && Number.isFinite(km) && km >= 0 && km <= MAX_ODOMETER_KM)
    ) {
      throw new HttpError(400, `"odometerKm" must be a number between 0 and ${MAX_ODOMETER_KM}`);
    }
    if (!deps.engine.config.maintenance.items.some((item) => item.id === itemId)) {
      throw new HttpError(404, `No maintenance item "${itemId}"`);
    }
    deps.engine.dispatch({
      type: 'maintenance/done',
      itemId,
      odometerKm: typeof km === 'number' ? km : null,
      at: deps.now(),
    });
    return ok(deps.engine.state.maintenance.status);
  });

  router.add('POST', '/api/odometer', async (ctx) => {
    const body = await requireObject(ctx.body());
    const km = body['odometerKm'];
    if (!(typeof km === 'number' && Number.isFinite(km) && km >= 0 && km <= MAX_ODOMETER_KM)) {
      throw new HttpError(400, `"odometerKm" must be a number between 0 and ${MAX_ODOMETER_KM}`);
    }
    deps.engine.dispatch({ type: 'odometer/set', odometerKm: km, at: deps.now() });
    return ok({ ok: true });
  });

  router.add('POST', '/api/input', async (ctx) => {
    const body = await requireObject(ctx.body());
    const action = body['action'];
    if (typeof action !== 'string' || !(INPUT_ACTIONS as readonly string[]).includes(action)) {
      throw new HttpError(400, `"action" must be one of ${INPUT_ACTIONS.join(', ')}`);
    }
    deps.engine.dispatch({ type: 'input', action: action as InputAction, at: deps.now() });
    return ok({ ok: true });
  });

  const notSimulating = () => new HttpError(404, 'The HUD is not running the simulator');

  router.add('GET', '/api/sim', () => {
    if (deps.simulation === null) throw notSimulating();
    return ok(deps.simulation.status());
  });

  router.add('POST', '/api/sim', async (ctx) => {
    if (deps.simulation === null) throw notSimulating();
    const body = await ctx.body();
    const parsed = parseSimControl(body ?? {});
    if (!parsed.ok) throw new HttpError(400, `Invalid simulator control: ${parsed.error}`);
    return ok(deps.simulation.control(parsed.value));
  });

  return router;
}
