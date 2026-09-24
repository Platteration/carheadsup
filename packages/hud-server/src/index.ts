/**
 * @carheadsup/hud-server — the on-car HUD service: engine, persistence, REST API, WebSockets
 * for the renderer and the phone, OBD wiring. `main.ts` is the command-line entry point.
 */
export { CONFIG_FILE, STATE_FILE, TRIPS_FILE, createHudServer } from './app.ts';
export type { HudServer, HudServerOptions, HudServerTuning } from './app.ts';
export {
  CLOCK_SYNC_TOLERANCE_MS,
  HudEngine,
  ODOMETER_PERSIST_INTERVAL_MS,
  PERSIST_DELAY_MS,
  TICK_INTERVAL_MS,
  maintenanceDueMessage,
} from './engine.ts';
export type { EngineOutputs, FrameListener, HudEngineOptions } from './engine.ts';
export { EngineClock, SYSTEM_MONOTONIC } from './clock.ts';
export { effectiveConfig, withSimTpmsPids } from './runtime-config.ts';
export type { RuntimeOverrides } from './runtime-config.ts';
export { phoneMessageToEvents } from './phone/translate.ts';
export { ObdLink, clearDtcsRefusal, createObdService } from './obd/obd-link.ts';
export type { ObdServiceFactory, ObdServiceLike } from './obd/obd-link.ts';
export { ConfigStore, serializeConfig } from './store/config-store.ts';
export { PersistStore, parsePersistedState } from './store/persist-store.ts';
export { DEFAULT_MAX_TRIPS, TripStore, isTripRecord } from './store/trip-store.ts';
export { writeFileAtomic } from './store/atomic.ts';
export { isAuthorized, isCrossSiteRequest, isLoopbackAddress, secretsEqual } from './http/auth.ts';
export { CONTENT_SECURITY_POLICY } from './http/security.ts';
export { PHONE_CLOSE } from './ws/phone-channel.ts';
export { HUD_SOCKET_PATH, PHONE_SOCKET_PATH } from './ws/upgrade.ts';
export { createLogger, isLogLevel, LOG_LEVELS } from './logger.ts';
export type { LogLevel, LoggerOptions } from './logger.ts';
export { HUD_VERSION, DEFAULT_RENDERER_DIR } from './meta.ts';
export type {
  EventSource,
  FrameSink,
  PhoneMessageTranslator,
  RuntimeDeps,
  Service,
  Simulation,
  SourceContext,
} from './sources/types.ts';
