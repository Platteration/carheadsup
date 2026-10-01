/**
 * The systemd service watchdog (`WatchdogSec=` in carheadsup.service): the server tells systemd
 * that it is alive with `systemd-notify WATCHDOG=1` (Node.js cannot send to the notification
 * socket itself, a Unix datagram socket), and systemd restarts it when that stops. The pings come
 * from the frame path, not from a timer of their own: a frame proves that the event loop runs and
 * that the HUD still composes what the display shows, so an event loop stuck in an endless loop,
 * or a composer that fails on every frame, stops them. A ping that gets lost now and then is
 * harmless: systemd allows four ping intervals before it acts.
 */
import type { Clock, Logger, Timers } from '@carheadsup/obd';
import { CommandNotFoundError, defaultSpawn, runCommand } from '../sensors/process.ts';
import type { SpawnFn } from '../sensors/process.ts';
import type { FrameSink } from '../sources/types.ts';

/** The environment systemd gives a service with `WatchdogSec=` (and `NotifyAccess=`). */
export type WatchdogEnv = Readonly<Record<string, string | undefined>>;

/** Shortest and longest ping interval, whatever `WATCHDOG_USEC` says. */
const MIN_PING_INTERVAL_MS = 500;
const MAX_PING_INTERVAL_MS = 15_000;

export interface WatchdogOptions {
  /** `NOTIFY_SOCKET`, `WATCHDOG_USEC`, `WATCHDOG_PID` (default `process.env`). */
  env?: WatchdogEnv;
  /** This process's id, compared with `WATCHDOG_PID` (default `process.pid`). */
  pid?: number;
  spawn?: SpawnFn;
  /** Monotonic ms clock (the server passes engine time). */
  monotonic: Clock;
  timers: Timers;
  logger: Logger;
}

/**
 * How often to ping for the watchdog timeout in `env` (a quarter of it), or null when systemd
 * runs no watchdog for this process: no `NOTIFY_SOCKET`, no positive `WATCHDOG_USEC`, or a
 * `WATCHDOG_PID` naming another process.
 */
export function watchdogPingIntervalMs(env: WatchdogEnv, pid: number): number | null {
  const socket = env['NOTIFY_SOCKET'];
  const usec = Number(env['WATCHDOG_USEC']);
  if (socket === undefined || socket === '' || !Number.isFinite(usec) || usec <= 0) return null;
  const owner = env['WATCHDOG_PID'];
  if (owner !== undefined && owner !== '' && Number(owner) !== pid) return null;
  return Math.min(MAX_PING_INTERVAL_MS, Math.max(MIN_PING_INTERVAL_MS, usec / 1000 / 4));
}

/**
 * A frame sink that pings the systemd watchdog at most every quarter of its timeout, or null when
 * systemd runs none for this process (started by hand, in a test, or without `WatchdogSec=`).
 */
export function createSystemdWatchdog(options: WatchdogOptions): FrameSink | null {
  const env = options.env ?? process.env;
  const intervalMs = watchdogPingIntervalMs(env, options.pid ?? process.pid);
  if (intervalMs === null) return null;
  const { logger, timers, monotonic } = options;
  const spawn = options.spawn ?? defaultSpawn;
  let lastPingAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;
  let failing = false;
  let stopped = false;

  const ping = async (): Promise<void> => {
    try {
      // systemd-notify waits until systemd has taken the message (so that systemd still finds
      // the sender's service when it reads it); give it at most one interval.
      const result = await runCommand(spawn, timers, 'systemd-notify', ['WATCHDOG=1'], intervalMs);
      if (result.code !== 0) throw new Error(result.stderr.trim() || `exit status ${result.code}`);
      if (failing) logger.info('Watchdog: systemd takes the pings again');
      failing = false;
    } catch (err) {
      if (!failing) {
        const reason =
          err instanceof CommandNotFoundError
            ? 'systemd-notify is not installed'
            : err instanceof Error
              ? err.message
              : String(err);
        logger.error(
          `Watchdog: pinging systemd failed (${reason}); systemd restarts the HUD unless that recovers`,
        );
      }
      failing = true;
    } finally {
      inFlight = false;
    }
  };

  logger.info(
    `Watchdog: systemd restarts the HUD unless it composes frames (pinging every ${Math.round(intervalMs / 100) / 10} s)`,
  );
  return {
    name: 'systemd watchdog',
    onFrame() {
      if (stopped || inFlight) return;
      const now = monotonic();
      if (now - lastPingAt < intervalMs && now >= lastPingAt) return;
      lastPingAt = now;
      inFlight = true;
      void ping();
    },
    async stop() {
      stopped = true;
    },
  };
}
