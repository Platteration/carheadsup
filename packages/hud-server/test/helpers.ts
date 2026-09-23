import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, parseConfig } from '@carheadsup/core';
import type {
  DeepPartial,
  HudConfig,
  HudEvent,
  HudToPhone,
  ObdConfig,
  ObdLinkStatus,
  SimControl,
  SimStatus,
} from '@carheadsup/core';
import { mergeConfig } from '@carheadsup/core';
import { VehicleSimulator } from '@carheadsup/obd';
import type { ClearDtcsOutcome, Logger, ObdServiceDeps } from '@carheadsup/obd';
import { WebSocket } from 'ws';
import { createHudServer } from '../src/app.ts';
import type { HudServer, HudServerOptions } from '../src/app.ts';
import type { ObdServiceLike } from '../src/obd/obd-link.ts';
import type { EventSource, RuntimeDeps, Simulation, SourceContext } from '../src/sources/types.ts';

/** A fresh temporary directory, removed by the returned cleanup. */
export async function makeTempDir(prefix = 'carheadsup-test-'): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A logger that records lines per level (and prints nothing). */
export class MemoryLogger implements Logger {
  readonly lines: Array<{ level: 'debug' | 'info' | 'warn' | 'error'; text: string }> = [];
  debug = (...args: unknown[]): void => this.push('debug', args);
  info = (...args: unknown[]): void => this.push('info', args);
  warn = (...args: unknown[]): void => this.push('warn', args);
  error = (...args: unknown[]): void => this.push('error', args);

  private push(level: 'debug' | 'info' | 'warn' | 'error', args: unknown[]): void {
    this.lines.push({ level, text: args.map(String).join(' ') });
  }

  text(level?: 'debug' | 'info' | 'warn' | 'error'): string {
    return this.lines
      .filter((l) => level === undefined || l.level === level)
      .map((l) => l.text)
      .join('\n');
  }
}

/** A config derived from the defaults with `patch` merged in (must validate cleanly). */
export function testConfig(patch: DeepPartial<HudConfig> = {}): HudConfig {
  const { config, errors } = mergeConfig(parseConfig(DEFAULT_CONFIG).config, patch);
  if (errors.length > 0) throw new Error(`invalid test config: ${errors.join('; ')}`);
  return config;
}

/** Stand-in for ObdService: records calls and lets tests emit events. */
export class FakeObdService implements ObdServiceLike {
  readonly config: ObdConfig;
  readonly deps: ObdServiceDeps;
  readonly configs: ObdConfig[] = [];
  started = 0;
  stopped = 0;
  clearCalls = 0;
  dtcReadRequests = 0;
  clearResult: ClearDtcsOutcome = { ok: true, message: 'Trouble codes cleared.' };
  private readonly listeners = new Set<(event: HudEvent) => void>();

  constructor(config: ObdConfig, deps: ObdServiceDeps) {
    this.config = config;
    this.deps = deps;
  }

  get status(): ObdLinkStatus {
    return { state: 'connected', adapter: 'Fake ELM', protocol: 'CAN', message: null, since: 0 };
  }

  start(): void {
    this.started += 1;
  }

  async stop(): Promise<void> {
    this.stopped += 1;
  }

  onEvent(cb: (event: HudEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async clearDtcs(): Promise<ClearDtcsOutcome> {
    this.clearCalls += 1;
    return this.clearResult;
  }

  updateConfig(config: ObdConfig): void {
    this.configs.push(config);
  }

  requestDtcRead(): void {
    this.dtcReadRequests += 1;
  }

  emit(event: HudEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** Stand-in Simulation: a real VehicleSimulator, no sources, recorded controls and messages. */
export class FakeSimulation implements Simulation {
  readonly vehicle = new VehicleSimulator({ mode: 'manual', engineRunning: false });
  readonly sources: EventSource[];
  readonly controls: SimControl[] = [];
  readonly delivered: HudToPhone[] = [];
  /** Every `setRealPhoneConnected` call. */
  readonly realPhone: boolean[] = [];
  started = 0;
  stopped = 0;

  constructor(sources: EventSource[] = []) {
    this.sources = sources;
  }

  control(control: SimControl): SimStatus {
    this.controls.push(control);
    this.vehicle.setControls(control);
    return this.status();
  }

  status(): SimStatus {
    return {
      ...this.vehicle.status(),
      adas: { blindSpotLeft: false, blindSpotRight: false, collision: 'none' },
      phone: { connected: true, steppedAside: this.realPhone.at(-1) === true },
    };
  }

  deliverToPhone(message: HudToPhone): void {
    this.delivered.push(message);
  }

  setRealPhoneConnected(connected: boolean): void {
    this.realPhone.push(connected);
  }

  start(): void {
    this.started += 1;
  }

  async stop(): Promise<void> {
    this.stopped += 1;
  }
}

/** An EventSource that records its lifecycle and lets tests emit through its context. */
export class FakeSource implements EventSource {
  readonly name: string;
  ctx: SourceContext | null = null;
  readonly configs: HudConfig[] = [];
  stopped = 0;

  constructor(name = 'fake-source') {
    this.name = name;
  }

  async start(ctx: SourceContext): Promise<void> {
    this.ctx = ctx;
  }

  async stop(): Promise<void> {
    this.stopped += 1;
  }

  updateConfig(config: HudConfig): void {
    this.configs.push(config);
  }
}

/** A minimal "built renderer" directory. */
export async function writeFakeRenderer(dir: string): Promise<void> {
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>HUD</title>');
  await writeFile(join(dir, 'settings.html'), '<!doctype html><title>Settings</title>');
  await writeFile(join(dir, 'dev.html'), '<!doctype html><title>Dev</title>');
  await writeFile(join(dir, 'assets', 'hud-AbC123.js'), 'console.log("hud");');
  await writeFile(join(dir, 'assets', 'hud-AbC123.css'), 'body{}');
  await writeFile(join(dir, 'assets', 'font-x1.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
  await writeFile(join(dir, '.hidden'), 'secret');
}

export interface TestServer {
  server: HudServer;
  port: number;
  base: string;
  wsBase: string;
  dataDir: string;
  rendererDir: string;
  obd: FakeObdService;
  sim: FakeSimulation | null;
  logger: MemoryLogger;
  stop: () => Promise<void>;
}

export interface TestServerOptions extends Partial<HudServerOptions> {
  /** Written to config.json before start. */
  config?: DeepPartial<HudConfig>;
  /** Files written into the data dir before start. */
  files?: Record<string, string>;
  /** Directories created in the data dir before start (e.g. to make a file unreadable). */
  directories?: string[];
  /** Skip creating a fake renderer build. */
  noRenderer?: boolean;
  simulation?: FakeSimulation;
}

/**
 * Start a real server on 127.0.0.1:0 with a temp data dir, a fake OBD service and fakes for
 * every pluggable module (the concurrently developed sim/sensors/outputs/mDNS modules are never
 * touched).
 */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const temp = await makeTempDir();
  const dataDir = join(temp.dir, 'data');
  const rendererDir = join(temp.dir, 'dist');
  await mkdir(dataDir, { recursive: true });
  if (!options.noRenderer) await writeFakeRenderer(rendererDir);
  if (options.config) {
    await writeFile(join(dataDir, 'config.json'), JSON.stringify(testConfig(options.config)));
  }
  for (const [name, content] of Object.entries(options.files ?? {})) {
    await writeFile(join(dataDir, name), content);
  }
  for (const name of options.directories ?? []) {
    await mkdir(join(dataDir, name), { recursive: true });
  }
  const logger = new MemoryLogger();
  let obd: FakeObdService | null = null;
  const sim = options.simulation ?? (options.sim ? new FakeSimulation() : null);
  const server = createHudServer({
    dataDir,
    rendererDir,
    port: 0,
    host: '127.0.0.1',
    logger,
    createObdService: (config, deps) => {
      obd = new FakeObdService(config, deps);
      return obd;
    },
    createSimulation: (_config: HudConfig, _deps: RuntimeDeps) => {
      if (sim === null) throw new Error('no fake simulation configured');
      return sim;
    },
    createSensorSources: () => [],
    createFrameSinks: () => [],
    advertiseHud: () => null,
    ...options,
  });
  let port: number;
  try {
    ({ port } = await server.start());
  } catch (err) {
    await temp.cleanup();
    throw err;
  }
  if (obd === null) throw new Error('OBD service was not created');
  return {
    server,
    port,
    base: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
    dataDir,
    rendererDir,
    obd,
    sim,
    logger,
    stop: async () => {
      await server.stop();
      await temp.cleanup();
    },
  };
}

/** A WebSocket client that buffers parsed JSON messages for `next()`. */
export class TestSocket {
  readonly ws: WebSocket;
  readonly messages: Array<Record<string, unknown>> = [];
  closeCode: number | null = null;
  closeReason = '';
  private readonly waiters: Array<() => void> = [];
  readonly opened: Promise<void>;
  readonly closed: Promise<number>;

  constructor(url: string, options?: ConstructorParameters<typeof WebSocket>[2]) {
    this.ws = new WebSocket(url, options);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) =>
        reject(new Error(`unexpected response ${res.statusCode ?? '?'}`)),
      );
    });
    this.closed = new Promise((resolve) => {
      this.ws.once('close', (code, reason) => {
        this.closeCode = code;
        this.closeReason = reason.toString();
        this.wake();
        resolve(code);
      });
    });
    this.ws.on('error', () => {});
    this.ws.on('message', (data) => {
      this.messages.push(JSON.parse(String(data)) as Record<string, unknown>);
      this.wake();
    });
  }

  send(message: unknown): void {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** Resolve with the first buffered message matching `predicate` (removing it and all earlier). */
  async next(
    predicate: (m: Record<string, unknown>) => boolean = () => true,
    timeoutMs = 3000,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.messages.findIndex(predicate);
      if (index !== -1) {
        const [found] = this.messages.splice(0, index + 1).slice(-1);
        if (found) return found;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `timed out waiting for a message; got ${JSON.stringify(this.messages.map((m) => m['t']))}`,
        );
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Next message of type `t`. */
  nextOfType(t: string, timeoutMs?: number): Promise<Record<string, unknown>> {
    return this.next((m) => m['t'] === t, timeoutMs);
  }

  close(): void {
    this.ws.terminate();
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}

/** Resolve after `ms` real milliseconds. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `check` until it returns true (or fail after `timeoutMs`). */
export async function waitFor(
  check: () => boolean,
  timeoutMs = 3000,
  what = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}
