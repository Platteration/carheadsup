import { DEFAULT_CONFIG, PROTOCOL_VERSION, type HudConfig } from '@carheadsup/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AVAHI_PUBLISH,
  MDNS_SERVICE_TYPE,
  advertiseHud,
  avahiPublishArgs,
  mdnsInstanceName,
  resetMdnsHintForTests,
} from '../../src/discovery/mdns.ts';
import { FakeClock, fakeSpawn, memoryLogger, type FakeChild } from '../sensors/fakes.ts';

function config(patch: { name?: string; port?: number; mdns?: boolean } = {}): HudConfig {
  const c = structuredClone(DEFAULT_CONFIG) as HudConfig;
  c.vehicle.name = patch.name ?? 'Golf';
  c.server.port = patch.port ?? 8080;
  c.server.mdns = patch.mdns ?? true;
  return c;
}

function setup(script: (child: FakeChild) => void = () => {}, installed = true) {
  const clock = new FakeClock(0);
  const logger = memoryLogger();
  const spawn = fakeSpawn(script);
  const which = (command: string) =>
    installed && command === AVAHI_PUBLISH ? `/usr/bin/${command}` : null;
  return { clock, logger, spawn, which, deps: { now: clock.now, timers: clock, logger } };
}

beforeEach(() => resetMdnsHintForTests());

describe('mDNS helpers', () => {
  it('names the service after the vehicle', () => {
    expect(mdnsInstanceName('Golf')).toBe('Golf HUD');
    expect(mdnsInstanceName('  My\tcar\n ')).toBe('My car HUD');
    expect(mdnsInstanceName('')).toBe('carheadsup HUD');
    expect(mdnsInstanceName('\u0000')).toBe('carheadsup HUD');
  });

  it('keeps the instance name within one 63-byte DNS label', () => {
    const long = mdnsInstanceName('x'.repeat(100));
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(63);
    expect(long.endsWith(' HUD')).toBe(true);
    const unicode = mdnsInstanceName('Élan électrique '.repeat(6));
    expect(new TextEncoder().encode(unicode).length).toBeLessThanOrEqual(63);
    expect(unicode.endsWith(' HUD')).toBe(true);
    expect(unicode).not.toContain('�');
  });

  it('builds the avahi-publish-service arguments', () => {
    expect(avahiPublishArgs(config({ name: 'Golf', port: 9090 }))).toEqual([
      '-s',
      'Golf HUD',
      MDNS_SERVICE_TYPE,
      '9090',
      `v=${PROTOCOL_VERSION}`,
      'path=/ws/phone',
    ]);
  });
});

describe('advertiseHud', () => {
  it('returns null when disabled', () => {
    const { deps, spawn, which } = setup();
    expect(advertiseHud(config({ mdns: false }), deps, { spawn, which })).toBeNull();
    expect(spawn.children).toEqual([]);
  });

  it('runs avahi-publish-service and stops it', async () => {
    const { clock, deps, spawn, which, logger } = setup((child) =>
      child.print("Established under name 'Golf HUD'"),
    );
    const service = advertiseHud(config({ port: 8123 }), deps, { spawn, which });
    expect(service?.name).toBe('mdns');
    await clock.advance(10);
    expect(spawn.children).toHaveLength(1);
    expect(spawn.children[0]!.command).toBe(AVAHI_PUBLISH);
    expect(spawn.children[0]!.args).toEqual([
      '-s',
      'Golf HUD',
      '_carheadsup._tcp',
      '8123',
      'v=1',
      'path=/ws/phone',
    ]);
    expect(logger.lines('info').join('\n')).toMatch(/Established under name 'Golf HUD'/);
    await service!.stop();
    expect(spawn.children[0]!.signals).toEqual(['SIGTERM']);
    await clock.advance(120_000);
    expect(spawn.children).toHaveLength(1);
    expect(clock.pendingTimers).toBe(0);
  });

  it('logs an install hint once and returns null when avahi-utils is missing', () => {
    const { deps, spawn, which, logger } = setup(() => {}, false);
    expect(advertiseHud(config(), deps, { spawn, which })).toBeNull();
    expect(advertiseHud(config(), deps, { spawn, which })).toBeNull();
    expect(logger.lines('warn')).toHaveLength(1);
    expect(logger.lines('warn')[0]).toMatch(/avahi-utils.*deploy\//);
    expect(spawn.children).toEqual([]);
  });

  it('handles the tool vanishing between the PATH check and the spawn', async () => {
    const { clock, deps, spawn, which, logger } = setup((child) => child.failToStart());
    const service = advertiseHud(config(), deps, { spawn, which });
    expect(service).not.toBeNull();
    await clock.advance(60_000);
    expect(spawn.children).toHaveLength(1);
    expect(logger.lines('warn').filter((l) => /avahi-utils/.test(l))).toHaveLength(1);
    await service!.stop();
  });

  it('restarts with backoff when avahi-publish-service exits unexpectedly', async () => {
    let failing = true;
    const { clock, deps, spawn, which, logger } = setup((child) => {
      if (failing) {
        child.printErr('Failed to create client object: Daemon not running');
        child.exit(1);
      }
    });
    const service = advertiseHud(config(), deps, { spawn, which });
    await clock.advance(10);
    await clock.advance(1000);
    await clock.advance(2000);
    await clock.advance(4000);
    expect(spawn.children).toHaveLength(4);
    expect(logger.lines('warn')).toEqual([
      'mDNS: avahi-publish-service exited (code 1): Failed to create client object: Daemon not running; restarting',
    ]);
    failing = false;
    await clock.advance(8000);
    expect(spawn.children).toHaveLength(5);
    expect(spawn.children[4]!.exited).toBe(false);
    await service!.stop();
    expect(spawn.children[4]!.exited).toBe(true);
    expect(clock.pendingTimers).toBe(0);
  });
});
