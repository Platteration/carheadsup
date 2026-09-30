import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HudFrame, SimStatus } from '@carheadsup/core';
import { SILENT_LOGGER, SYSTEM_CLOCK, SYSTEM_TIMERS } from '@carheadsup/obd';
import { describe, expect, it } from 'vitest';
import { createHudServer } from '../src/app.ts';
import { createSimulation } from '../src/sim/index.ts';
import {
  MemoryLogger,
  TestSocket,
  helloOn,
  makeTempDir,
  testConfig,
  waitFor,
  writeFakeRenderer,
} from './helpers.ts';

/**
 * End-to-end smoke test with the real modules (simulation, sensors, outputs, mDNS, ObdService on
 * the ELM327 emulator). Those modules are developed separately; while the simulation is still a
 * stub that throws "not implemented", this test skips itself.
 */
function realSimulationAvailable(): boolean {
  try {
    const sim = createSimulation(testConfig(), {
      now: SYSTEM_CLOCK,
      timers: SYSTEM_TIMERS,
      logger: SILENT_LOGGER,
    });
    void sim.stop();
    return true;
  } catch (err) {
    if (err instanceof Error && /not implemented/i.test(err.message)) return false;
    throw err;
  }
}

describe('smoke: the whole server with the real simulator', () => {
  it.skipIf(!realSimulationAvailable())(
    'drives frames from the simulated car and phone, and serves the API',
    async () => {
      const temp = await makeTempDir();
      const renderer = join(temp.dir, 'dist');
      await writeFakeRenderer(renderer);
      await writeFile(
        join(temp.dir, 'config.json'),
        JSON.stringify(testConfig({ server: { mdns: false } })),
      );
      const logger = new MemoryLogger();
      const server = createHudServer({
        dataDir: temp.dir,
        sim: true,
        port: 0,
        tlsPort: 0,
        host: '127.0.0.1',
        rendererDir: renderer,
        backlight: false,
        logger,
      });
      const sockets: TestSocket[] = [];
      try {
        const { port, tlsPort } = await server.start();
        const base = `http://127.0.0.1:${port}`;

        const hud = new TestSocket(`ws://127.0.0.1:${port}/ws/hud`);
        sockets.push(hud);
        expect(await hud.nextOfType('display')).toMatchObject({ simulated: true });
        // The ELM327 emulator comes up and live vehicle data reaches the frames.
        const live = await hud.next(
          (m) => m['t'] === 'frame' && (m['frame'] as HudFrame).status.obd === 'connected',
          15_000,
        );
        expect((live['frame'] as HudFrame).status.simulated).toBe(true);
        await waitFor(
          () => server.engine.state.vehicle.signals.rpm !== undefined,
          10_000,
          'polled engine speed',
        );

        const status = (await (await fetch(`${base}/api/sim`)).json()) as SimStatus;
        expect(status.mode).toBe('scenario');
        const controlled = await fetch(`${base}/api/sim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'manual', throttle: 0.3 }),
        });
        expect(controlled.status).toBe(200);
        expect(((await controlled.json()) as SimStatus).mode).toBe('manual');

        const diagnostics = await fetch(`${base}/api/diagnostics`);
        expect(diagnostics.status).toBe(200);

        const phone = new TestSocket(`wss://127.0.0.1:${tlsPort}/ws/phone`);
        sockets.push(phone);
        await phone.opened;
        expect(phone.peerFingerprint).toBe(server.tls?.fingerprint);
        await helloOn(phone, { device: 'Smoke test', app: 'test', appVersion: '0' });
        expect(await phone.nextOfType('welcome')).toMatchObject({ hudName: 'My car' });
      } finally {
        for (const socket of sockets) socket.close();
        await server.stop();
        await temp.cleanup();
      }
      expect(logger.text('error')).not.toMatch(/crashed|failed to start/);
    },
    30_000,
  );
});
