import { DEFAULT_CONFIG, type HudConfig } from '@carheadsup/core';
import { describe, expect, it, vi } from 'vitest';
import type { UdpSocketLike } from '../../src/sensors/adas-udp.ts';
import { CanButtonSource, GpioButtonSource, createSensorSources } from '../../src/sensors/index.ts';
import type { I2cOpener } from '../../src/sensors/i2c.ts';
import { FakeClock, FakeI2cBus, fakeSpawn, recordingContext, respond } from './fakes.ts';

function config(sensors: Partial<HudConfig['sensors']> = {}): HudConfig {
  const c = structuredClone(DEFAULT_CONFIG) as HudConfig;
  c.sensors = { ...c.sensors, ...sensors };
  return c;
}

function fakeUdpFactory() {
  const sockets: Array<UdpSocketLike & { boundTo: number | null; closed: boolean }> = [];
  const factory = () => {
    const socket = {
      boundTo: null as number | null,
      closed: false,
      on: () => socket,
      bind: (port: number, _address: string, callback: () => void) => {
        socket.boundTo = port;
        setImmediate(callback);
        return socket;
      },
      address: () => ({ port: socket.boundTo ?? 0 }),
      close: (callback?: () => void) => {
        socket.closed = true;
        if (callback) setImmediate(callback);
        return socket;
      },
    };
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets };
}

describe('createSensorSources', () => {
  it('returns one source per sensor kind, all idle with the default config', async () => {
    const clock = new FakeClock();
    const openI2c = vi.fn<I2cOpener>();
    const spawn = fakeSpawn();
    const udp = fakeUdpFactory();
    const timeZone = { name: () => 'Europe/Berlin', utcOffsetMin: () => 120 };
    const sources = createSensorSources(config(), {
      openI2c,
      spawn,
      createUdpSocket: udp.factory,
      timeZone,
    });
    expect(sources.map((s) => s.name)).toEqual([
      'light-sensor',
      'gesture-sensor',
      'gpio-buttons',
      'can-buttons',
      'swc-buttons',
      'adas-udp',
      'time-zone',
    ]);
    const { ctx, events } = recordingContext(clock);
    for (const source of sources) await source.start(ctx);
    await (sources[2] as GpioButtonSource).whenReady();
    await (sources[3] as CanButtonSource).whenReady();
    await clock.advance(10_000);
    expect(openI2c).not.toHaveBeenCalled();
    expect(spawn.children).toEqual([]);
    expect(udp.sockets).toEqual([]);
    // Only the time zone, which is always known.
    expect(events.map((e) => e.type)).toEqual(['clock/zone']);
    for (const source of sources) await source.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('enables sensors at runtime through updateConfig, restarting only what changed', async () => {
    const clock = new FakeClock();
    const opened: number[] = [];
    const openI2c: I2cOpener = async (bus) => {
      opened.push(bus);
      return new FakeI2cBus(); // nothing answers: the sources log and retry quietly
    };
    const spawn = fakeSpawn((child) => {
      if (child.args.includes('--version')) return respond(child, 'gpiomon (libgpiod) v2.1.3\n');
      if (child.args.includes('--help'))
        return respond(child, 'Usage: gpiomon [OPTIONS] <line>...\n  --chip  --bias  --format\n');
      if (child.command === 'gpiodetect')
        return respond(child, 'gpiochip0 [pinctrl-bcm2711] (58 lines)\n');
      if (child.command === 'ip') return respond(child, '', 1, 'Device "can0" does not exist.\n');
    });
    const ready = () =>
      Promise.all([
        (sources[2] as GpioButtonSource).whenReady(),
        (sources[3] as CanButtonSource).whenReady(),
      ]);
    const udp = fakeUdpFactory();
    const sources = createSensorSources(config(), { openI2c, spawn, createUdpSocket: udp.factory });
    const { ctx } = recordingContext(clock);
    for (const source of sources) await source.start(ctx);

    const enabled = config({
      lightSensor: 'veml7700',
      gestureSensor: 'apds9960',
      buttons: { primary: 17, secondary: null, next: null },
      canButtons: {
        interface: 'can0',
        releaseTimeoutMs: 500,
        rules: [
          {
            id: '5C1',
            byte: 0,
            mask: 'FF',
            value: '01',
            action: 'next-page',
            longPressAction: null,
          },
        ],
      },
      swcButtons: { ...DEFAULT_CONFIG.sensors.swcButtons, enabled: true },
      adasUdpPort: 5005,
    });
    for (const source of sources) await source.updateConfig?.(enabled);
    await ready();
    await clock.advance(100);
    expect(opened).toEqual([1, 1, 1]);
    expect(
      spawn.children.filter(
        (c) =>
          c.command === 'gpiomon' && !c.args.includes('--version') && !c.args.includes('--help'),
      ),
    ).toHaveLength(1);
    expect(spawn.children.filter((c) => c.command === 'candump').map((c) => c.args)).toEqual([
      ['-L', 'can0,5C1:C00007FF'],
    ]);
    expect(udp.sockets.map((s) => s.boundTo)).toEqual([5005]);

    // Only the ADAS port changes: nothing else restarts.
    const spawned = spawn.children.length;
    for (const source of sources)
      await source.updateConfig?.({
        ...enabled,
        sensors: { ...enabled.sensors, adasUdpPort: 5006 },
      });
    await ready();
    await clock.advance(100);
    expect(opened).toEqual([1, 1, 1]);
    expect(spawn.children.length).toBe(spawned);
    expect(udp.sockets.map((s) => [s.boundTo, s.closed])).toEqual([
      [5005, true],
      [5006, false],
    ]);

    for (const source of sources) await source.stop();
    expect(udp.sockets.every((s) => s.closed)).toBe(true);
    expect(clock.pendingTimers).toBe(0);
  });
});
