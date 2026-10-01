import { describe, expect, it } from 'vitest';
import { USAGE, defaultDataDir, pageUrls, parseCli, serverUrls } from '../src/cli.ts';
import type { CliOptions } from '../src/cli.ts';
import { createLogger, formatLogMessage, isLogLevel } from '../src/logger.ts';

const HOME = '/home/driver';

function run(argv: string[], env: Record<string, string> = {}): CliOptions {
  const result = parseCli(argv, env, HOME);
  if (result.kind !== 'run') throw new Error(`expected run, got ${JSON.stringify(result)}`);
  return result.options;
}

describe('parseCli', () => {
  it('uses sensible defaults', () => {
    expect(run([])).toEqual({
      sim: false,
      configPath: undefined,
      dataDir: '/home/driver/.local/share/carheadsup',
      port: undefined,
      host: undefined,
      rendererDir: undefined,
      backlight: null,
      allowedHosts: [],
      logLevel: 'info',
    });
  });

  it('parses every flag, in both --flag value and --flag=value forms', () => {
    expect(
      run([
        '--sim',
        '--config',
        '/etc/hud.json',
        '--data-dir=/var/lib/hud',
        '--port',
        '9000',
        '--host=127.0.0.1',
        '--renderer-dir',
        './dist',
        '--backlight',
        '/sys/class/backlight/rpi_backlight',
        '--allowed-hosts',
        'hud.fritz.box, car.lan',
        '--log-level',
        'DEBUG',
      ]),
    ).toEqual({
      sim: true,
      configPath: '/etc/hud.json',
      dataDir: '/var/lib/hud',
      port: 9000,
      host: '127.0.0.1',
      rendererDir: './dist',
      backlight: '/sys/class/backlight/rpi_backlight',
      allowedHosts: ['hud.fritz.box', 'car.lan'],
      logLevel: 'debug',
    });
  });

  it('keeps simulated drives in their own data directory by default', () => {
    expect(run(['--sim']).dataDir).toBe('/home/driver/.local/share/carheadsup/sim');
    expect(run(['--sim', '--data-dir', '/x']).dataDir).toBe('/x');
  });

  it('honours XDG_DATA_HOME when absolute', () => {
    expect(defaultDataDir({ XDG_DATA_HOME: '/data' }, HOME, false)).toBe('/data/carheadsup');
    expect(defaultDataDir({ XDG_DATA_HOME: 'relative' }, HOME, false)).toBe(
      '/home/driver/.local/share/carheadsup',
    );
  });

  it('reads CARHEADSUP_* variables, with flags taking precedence', () => {
    const env = {
      CARHEADSUP_SIM: 'true',
      CARHEADSUP_CONFIG: '/env/config.json',
      CARHEADSUP_DATA_DIR: '/env/data',
      CARHEADSUP_PORT: '8181',
      CARHEADSUP_HOST: '0.0.0.0',
      CARHEADSUP_RENDERER_DIR: '/env/dist',
      CARHEADSUP_BACKLIGHT: 'off',
      CARHEADSUP_ALLOWED_HOSTS: 'pi.home',
      CARHEADSUP_LOG_LEVEL: 'warn',
    };
    expect(run([], env)).toEqual({
      sim: true,
      configPath: '/env/config.json',
      dataDir: '/env/data',
      port: 8181,
      host: '0.0.0.0',
      rendererDir: '/env/dist',
      backlight: false,
      allowedHosts: ['pi.home'],
      logLevel: 'warn',
    });
    expect(run(['--port', '1', '--data-dir', '/flag', '--log-level', 'error'], env)).toMatchObject({
      port: 1,
      dataDir: '/flag',
      logLevel: 'error',
    });
    expect(run([], { CARHEADSUP_SIM: '0' }).sim).toBe(false);
    expect(run([], { CARHEADSUP_PORT: '' }).port).toBeUndefined();
  });

  it('rejects host lists with things that are not host names', () => {
    expect(parseCli(['--allowed-hosts', 'http://x/'], {}, HOME)).toEqual({
      kind: 'error',
      message: '--allowed-hosts: "http://x/" is not a host name',
    });
    // Only DNS labels: the Host check would never match anything else.
    for (const bad of ['-hud.lan', 'hud..lan', 'hud-.lan', `${'x'.repeat(64)}.lan`, '.']) {
      expect(parseCli(['--allowed-hosts', `car.lan,${bad}`], {}, HOME)).toEqual({
        kind: 'error',
        message: `--allowed-hosts: "${bad}" is not a host name`,
      });
    }
    expect(
      parseCli([], { CARHEADSUP_ALLOWED_HOSTS: 'Pi.Fritz.Box., my_pi.lan, 10.42.0.1' }, HOME),
    ).toMatchObject({
      kind: 'run',
      options: { allowedHosts: ['Pi.Fritz.Box.', 'my_pi.lan', '10.42.0.1'] },
    });
  });

  it('maps backlight words', () => {
    expect(run(['--backlight', 'off']).backlight).toBe(false);
    expect(run(['--backlight', 'none']).backlight).toBe(false);
    expect(run(['--backlight', 'auto']).backlight).toBeNull();
    expect(run(['--backlight', '/sys/x']).backlight).toBe('/sys/x');
  });

  it('answers --help and --version', () => {
    expect(parseCli(['--help'], {}, HOME)).toEqual({ kind: 'help' });
    expect(parseCli(['-h', '--port', 'bad'], {}, HOME)).toEqual({ kind: 'help' });
    expect(parseCli(['-v'], {}, HOME)).toEqual({ kind: 'version' });
    expect(USAGE).toContain('--sim');
    expect(USAGE).toContain('CARHEADSUP_DATA_DIR');
  });

  it('reports invalid input', () => {
    const errors = [
      parseCli(['--port', '70000'], {}, HOME),
      parseCli(['--port', 'http'], {}, HOME),
      parseCli(['--port', '-1'], {}, HOME),
      parseCli(['--log-level', 'loud'], {}, HOME),
      parseCli(['--unknown'], {}, HOME),
      parseCli(['stray'], {}, HOME),
      parseCli(['--config'], {}, HOME),
      parseCli(['--host', ' '], {}, HOME),
      parseCli([], { CARHEADSUP_SIM: 'maybe' }, HOME),
      parseCli([], { CARHEADSUP_PORT: 'eighty' }, HOME),
    ];
    for (const result of errors) expect(result.kind).toBe('error');
    expect(parseCli([], { CARHEADSUP_PORT: 'eighty' }, HOME)).toEqual({
      kind: 'error',
      message: expect.stringContaining('CARHEADSUP_PORT') as unknown,
    });
  });

  it('accepts port 0 (any free port)', () => {
    expect(run(['--port', '0']).port).toBe(0);
  });

  it('overrides the TLS port of the phone link, or switches it off', () => {
    expect(run([]).tlsPort).toBeUndefined();
    expect(run(['--tls-port', '9443']).tlsPort).toBe(9443);
    expect(run(['--tls-port=0']).tlsPort).toBe(0);
    for (const word of ['off', 'OFF', 'none', 'false', 'no']) {
      expect(run(['--tls-port', word]).tlsPort).toBeNull();
    }
    expect(run([], { CARHEADSUP_TLS_PORT: '8444' }).tlsPort).toBe(8444);
    expect(run([], { CARHEADSUP_TLS_PORT: 'off' }).tlsPort).toBeNull();
    expect(run([], { CARHEADSUP_TLS_PORT: '' }).tlsPort).toBeUndefined();
    expect(run(['--tls-port', '9443'], { CARHEADSUP_TLS_PORT: 'off' }).tlsPort).toBe(9443);
    expect(parseCli(['--tls-port', 'https'], {}, HOME)).toEqual({
      kind: 'error',
      message: '--tls-port: expected a port number 0–65535, got "https" or "off"',
    });
    expect(parseCli([], { CARHEADSUP_TLS_PORT: '70000' }, HOME)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('CARHEADSUP_TLS_PORT') as unknown,
    });
    expect(USAGE).toContain('--tls-port');
    expect(USAGE).toContain('CARHEADSUP_TLS_PORT');
  });
});

describe('serverUrls', () => {
  it('lists localhost and LAN addresses for wildcard binds', () => {
    expect(serverUrls('0.0.0.0', 8080, ['192.168.4.1'])).toEqual([
      'http://localhost:8080',
      'http://192.168.4.1:8080',
    ]);
    expect(serverUrls('::', 80, [])).toEqual(['http://localhost:80']);
  });

  it('uses a specific host as given, bracketing IPv6', () => {
    expect(serverUrls('127.0.0.1', 9000, ['10.0.0.2'])).toEqual(['http://127.0.0.1:9000']);
    expect(serverUrls('fd00::10', 9000, [])).toEqual(['http://[fd00::10]:9000']);
  });

  it('takes another scheme (the phone link over TLS)', () => {
    expect(serverUrls('0.0.0.0', 8443, ['10.42.0.1'], 'wss')).toEqual([
      'wss://localhost:8443',
      'wss://10.42.0.1:8443',
    ]);
  });
});

describe('pageUrls', () => {
  const base = {
    host: '0.0.0.0',
    port: 8080,
    tlsEnabled: true,
    tlsPort: 8443,
    allowPlainRemote: false,
    lanAddresses: ['10.42.0.1', 'fd00::10'],
  };

  it('lists plain http for the HUD itself and https for other devices', () => {
    expect(pageUrls(base)).toEqual([
      'http://localhost:8080',
      'https://10.42.0.1:8443',
      'https://[fd00::10]:8443',
    ]);
    expect(pageUrls({ ...base, host: '127.0.0.1' })).toEqual(['http://127.0.0.1:8080']);
  });

  it('lists the bind address over plain http for the HUD itself when it is a network address', () => {
    // The kiosk reaches a HUD bound to one address there, as the HUD itself.
    expect(pageUrls({ ...base, host: '10.42.0.1' })).toEqual([
      'http://10.42.0.1:8080',
      'https://10.42.0.1:8443',
    ]);
    expect(pageUrls({ ...base, host: 'fd00::10' })).toEqual([
      'http://[fd00::10]:8080',
      'https://[fd00::10]:8443',
    ]);
  });

  it('lists plain http for other devices with TLS off or server.allowPlainRemote', () => {
    const plain = ['http://localhost:8080', 'http://10.42.0.1:8080', 'http://[fd00::10]:8080'];
    expect(pageUrls({ ...base, tlsEnabled: false, tlsPort: null })).toEqual(plain);
    expect(pageUrls({ ...base, allowPlainRemote: true })).toEqual(plain);
    // Once, when the HUD itself and other devices use the same address.
    expect(pageUrls({ ...base, host: '10.42.0.1', allowPlainRemote: true })).toEqual([
      'http://10.42.0.1:8080',
    ]);
  });

  it('lists nothing for other devices while the TLS listener could not start', () => {
    expect(pageUrls({ ...base, tlsPort: null })).toEqual(['http://localhost:8080']);
    expect(pageUrls({ ...base, host: '10.42.0.1', tlsPort: null })).toEqual([
      'http://10.42.0.1:8080',
    ]);
  });
});

describe('logger', () => {
  it('writes one timestamped line per call and filters by level', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      now: () => Date.UTC(2026, 8, 23, 7, 30, 0),
      write: (line) => lines.push(line),
    });
    logger.debug('hidden');
    logger.info('hello', 42, { a: 1 });
    logger.warn('careful');
    logger.error(new Error('bad\nthings'));
    expect(lines[0]).toBe('2026-09-23T07:30:00.000Z INFO  hello 42 { a: 1 }');
    expect(lines[1]).toBe('2026-09-23T07:30:00.000Z WARN  careful');
    expect(lines[2]).toMatch(/^2026-09-23T07:30:00\.000Z ERROR Error: bad \| things/);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).not.toContain('\n');
  });

  it('routes levels to the sink and survives a failing sink', () => {
    const seen: string[] = [];
    const logger = createLogger({ level: 'debug', write: (_line, level) => seen.push(level) });
    logger.debug('a');
    logger.error('b');
    expect(seen).toEqual(['debug', 'error']);
    const broken = createLogger({
      write: () => {
        throw new Error('EPIPE');
      },
    });
    expect(() => broken.info('x')).not.toThrow();
  });

  it('formats like console.log on a single line', () => {
    expect(formatLogMessage(['%s=%d', 'x', 5])).toBe('x=5');
    expect(formatLogMessage(['multi\n  line\r\ntext'])).toBe('multi | line | text');
    expect(isLogLevel('warn')).toBe(true);
    expect(isLogLevel('verbose')).toBe(false);
  });
});
