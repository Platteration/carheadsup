import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { LOG_LEVELS, isLogLevel } from './logger.ts';
import type { LogLevel } from './logger.ts';

/** Options for one run of the HUD server, after merging flags, environment and defaults. */
export interface CliOptions {
  sim: boolean;
  /** Config file; undefined = `<dataDir>/config.json`. */
  configPath: string | undefined;
  dataDir: string;
  /** Overrides `server.port` when set. */
  port: number | undefined;
  /** Overrides `server.host` when set. */
  host: string | undefined;
  rendererDir: string | undefined;
  /** Backlight device directory; null = auto-detect; false = off. */
  backlight: string | null | false;
  /** Extra host names the HUD may be reached by (DNS-rebinding protection). */
  allowedHosts: string[];
  logLevel: LogLevel;
}

export type CliParseResult =
  | { kind: 'run'; options: CliOptions }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

export type Env = Readonly<Record<string, string | undefined>>;

export const USAGE = `Usage: carheadsup [options]

The carheadsup HUD server: reads the car over OBD-II, talks to the companion app, drives the
projected display and serves the settings app.

Options:
  --sim                  Run against the built-in vehicle and phone simulator
  --config <file>        Config file (default: <data-dir>/config.json)
  --data-dir <dir>       Data directory for config, state and trips
                         (default: $XDG_DATA_HOME/carheadsup or ~/.local/share/carheadsup;
                         with --sim: <that>/sim, so simulated drives never touch real records)
  --port <n>             HTTP/WebSocket port, overriding server.port (0 = any free port)
  --host <addr>          Bind address, overriding server.host
  --renderer-dir <dir>   Built renderer to serve (default: packages/hud-renderer/dist)
  --backlight <dir|off>  Backlight device (e.g. /sys/class/backlight/rpi_backlight),
                         "auto" to detect it (default) or "off"
  --allowed-hosts <names>
                         Extra host names (comma-separated) browsers may use to reach the
                         HUD; IP addresses, localhost, <hostname> and <hostname>.local always
                         work, other names are refused (DNS-rebinding protection)
  --log-level <level>    ${LOG_LEVELS.join(' | ')} (default: info)
  -h, --help             Show this help
  -v, --version          Show the version

Every option can also be set in the environment: CARHEADSUP_SIM=1, CARHEADSUP_CONFIG,
CARHEADSUP_DATA_DIR, CARHEADSUP_PORT, CARHEADSUP_HOST, CARHEADSUP_RENDERER_DIR,
CARHEADSUP_BACKLIGHT, CARHEADSUP_ALLOWED_HOSTS, CARHEADSUP_LOG_LEVEL. Command-line flags take
precedence.
`;

const TRUE_WORDS = new Set(['1', 'true', 'yes', 'on']);
const FALSE_WORDS = new Set(['', '0', 'false', 'no', 'off']);

/** Default data directory (XDG base directory spec), with a separate subdirectory for --sim. */
export function defaultDataDir(env: Env, home: string, sim: boolean): string {
  const xdg = env['XDG_DATA_HOME'];
  const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, '.local', 'share');
  const dir = join(base, 'carheadsup');
  return sim ? join(dir, 'sim') : dir;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

function parsePort(raw: string, source: string): number | string {
  const text = raw.trim();
  if (!/^\d{1,5}$/.test(text) || Number(text) > 65_535) {
    return `${source}: expected a port number 0–65535, got "${raw}"`;
  }
  return Number(text);
}

/** A comma- or space-separated list of host names, or an error message. */
function parseHostList(raw: string, source: string): string[] | string {
  const names = raw
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter((name) => name !== '');
  const bad = names.find((name) => !/^[A-Za-z0-9._-]+$/.test(name));
  return bad === undefined ? names : `${source}: "${bad}" is not a host name`;
}

function parseBacklight(raw: string): string | null | false {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (lower === 'off' || lower === 'none' || lower === 'false' || lower === '0') return false;
  if (lower === 'auto' || value === '') return null;
  return value;
}

/**
 * Parse the command line (without the node/script prefix) and the environment. Flags win over
 * `CARHEADSUP_*` variables, which win over the defaults.
 */
export function parseCli(argv: readonly string[], env: Env, home: string): CliParseResult {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        sim: { type: 'boolean' },
        config: { type: 'string' },
        'data-dir': { type: 'string' },
        port: { type: 'string' },
        host: { type: 'string' },
        'renderer-dir': { type: 'string' },
        backlight: { type: 'string' },
        'allowed-hosts': { type: 'string' },
        'log-level': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  let sim = values.sim ?? false;
  if (values.sim === undefined) {
    const raw = env['CARHEADSUP_SIM'];
    if (raw !== undefined) {
      const word = raw.trim().toLowerCase();
      if (TRUE_WORDS.has(word)) sim = true;
      else if (!FALSE_WORDS.has(word)) {
        return {
          kind: 'error',
          message: `CARHEADSUP_SIM: expected 1/0 or true/false, got "${raw}"`,
        };
      }
    }
  }

  let port: number | undefined;
  const rawPort = values.port ?? nonEmpty(env['CARHEADSUP_PORT']);
  if (rawPort !== undefined) {
    const parsed = parsePort(rawPort, values.port !== undefined ? '--port' : 'CARHEADSUP_PORT');
    if (typeof parsed === 'string') return { kind: 'error', message: parsed };
    port = parsed;
  }

  const rawLevel = values['log-level'] ?? nonEmpty(env['CARHEADSUP_LOG_LEVEL']) ?? 'info';
  const level = rawLevel.trim().toLowerCase();
  if (!isLogLevel(level)) {
    return {
      kind: 'error',
      message: `Unknown log level "${rawLevel}" (expected ${LOG_LEVELS.join(', ')})`,
    };
  }

  const host = values.host ?? nonEmpty(env['CARHEADSUP_HOST']);
  if (host !== undefined && host.trim() === '') {
    return { kind: 'error', message: '--host: expected an address' };
  }
  const dataDir =
    nonEmpty(values['data-dir']) ??
    nonEmpty(env['CARHEADSUP_DATA_DIR']) ??
    defaultDataDir(env, home, sim);
  const rawBacklight = values.backlight ?? env['CARHEADSUP_BACKLIGHT'];
  const rawHosts = values['allowed-hosts'] ?? env['CARHEADSUP_ALLOWED_HOSTS'] ?? '';
  const allowedHosts = parseHostList(
    rawHosts,
    values['allowed-hosts'] !== undefined ? '--allowed-hosts' : 'CARHEADSUP_ALLOWED_HOSTS',
  );
  if (typeof allowedHosts === 'string') return { kind: 'error', message: allowedHosts };

  return {
    kind: 'run',
    options: {
      sim,
      configPath: nonEmpty(values.config) ?? nonEmpty(env['CARHEADSUP_CONFIG']),
      dataDir,
      port,
      host: host?.trim(),
      rendererDir: nonEmpty(values['renderer-dir']) ?? nonEmpty(env['CARHEADSUP_RENDERER_DIR']),
      backlight: rawBacklight === undefined ? null : parseBacklight(rawBacklight),
      allowedHosts,
      logLevel: level,
    },
  };
}

/** Browser URLs for a server bound to `host:port` (all interfaces → localhost plus LAN IPs). */
export function serverUrls(host: string, port: number, lanAddresses: readonly string[]): string[] {
  const format = (address: string) =>
    `http://${address.includes(':') ? `[${address}]` : address}:${port}`;
  if (host === '0.0.0.0' || host === '::' || host === '') {
    return [format('localhost'), ...lanAddresses.map(format)];
  }
  return [format(host)];
}
