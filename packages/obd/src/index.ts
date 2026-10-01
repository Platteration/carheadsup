/**
 * @carheadsup/obd — ELM327 OBD-II driver, transports, PID poller, connection service, and an
 * ELM327 emulator backed by a deterministic vehicle simulation.
 */
export type {
  Transport,
  SerialPortLike,
  SerialTransportOptions,
  TcpTransportOptions,
} from './transport.ts';
export type { CreateTransportOptions } from './transport.ts';
export { SerialTransport, TcpTransport, TransportEvents, createTransport } from './transport.ts';
export {
  ManualClock,
  describeEvent,
  replayTranscript,
  type ReplayOptions,
  type ReplayResult,
} from './replay.ts';
export {
  RecordingTransport,
  TRANSCRIPT_FORMAT,
  TRANSCRIPT_VERSION,
  TranscriptTransport,
  normalizeCommand,
  parseTranscript,
  type RecordingOptions,
  type ReplayStats,
  type Transcript,
  type TranscriptEntry,
  type TranscriptHeader,
  type TranscriptSink,
  type TranscriptSinkFactory,
  type TranscriptTransportOptions,
} from './transcript.ts';

export {
  Elm327,
  type ClearDtcsResult,
  type DtcReport,
  type Elm327Info,
  type Elm327Options,
  type Mode01Answer,
  type Mode01Result,
  type RawAnswer,
} from './elm327.ts';
export {
  ELM_ERROR_CODES,
  ElmError,
  describeNrc,
  isElmError,
  isLinkFatal,
  isVehicleSilence,
  type ElmErrorCode,
  type ElmErrorDetails,
} from './errors.ts';
export {
  cleanResponse,
  classifyResponse,
  parseVoltage,
  splitLines,
  type CommandKind,
} from './response.ts';
export { parseEcuMessages, type EcuMessage, type FrameParseOptions } from './frames.ts';
export {
  MODE01_DATA_LENGTHS,
  VARIABLE_LENGTH_PIDS,
  collectDtcs,
  collectMode01,
  decodeVin,
  negativeResponseCode,
  positiveResponses,
  splitMode01Payload,
} from './payloads.ts';
export {
  ELM_PROTOCOLS,
  getProtocol,
  inferFamily,
  maxPidsPerRequest,
  normalizeProtocolSetting,
  type ElmProtocol,
  type ProtocolFamily,
} from './protocols.ts';

export {
  DEFAULT_POLLER_TUNING,
  ObdPoller,
  type PollerDiscovery,
  type PollerDriver,
  type PollerOptions,
  type PollerTuning,
} from './poller.ts';
export {
  FULL_SEARCH_EVERY,
  MAX_RECONNECT_DELAY_MS,
  ObdService,
  VEHICLE_RETRY_MS,
  type ClearDtcsOutcome,
  type ObdProtocolCache,
  type ObdServiceDeps,
} from './service.ts';

export {
  VehicleSimulator,
  type ScenarioStepListener,
  type TirePressures,
  type VehicleSimulatorOptions,
  type VehicleSnapshot,
} from './sim/vehicle-sim.ts';
export {
  DEMO_PARKED_S,
  DEMO_SCENARIO,
  SpeedController,
  type ScenarioStep,
} from './sim/scenario.ts';
export { VEHICLE_MODEL, rpmPerKph } from './sim/model.ts';
export { SimulationClock, type SimulationClockOptions } from './sim/clock.ts';
export {
  Elm327Emulator,
  SIM_TPMS_PIDS,
  type Elm327EmulatorOptions,
  type EmulatorFault,
  type EmulatorFaultOptions,
} from './sim/elm327-emulator.ts';
export { SIM_TPMS_DIDS, encodeDtc, supportedBitmap, type EmulatedEcu } from './sim/ecus.ts';

export {
  SILENT_LOGGER,
  SYSTEM_CLOCK,
  SYSTEM_TIMERS,
  type Clock,
  type Logger,
  type Timers,
} from './runtime.ts';
