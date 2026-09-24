/**
 * mDNS / DNS-SD advertisement through Avahi's `avahi-publish-service` (package avahi-utils):
 *
 *   avahi-publish-service -s "<vehicle name> HUD" _carheadsup._tcp <port> v=<protocol> \
 *     path=/ws/phone id=<HUD id>
 *
 * The `id` lets a phone that has pinned this HUD skip other HUDs without connecting to them (it
 * checks the id again in the `challenge`; the static service file cannot know it).
 *
 * The tool keeps the record registered for as long as it runs, so it is supervised and restarted
 * with backoff if it exits (e.g. avahi-daemon restarting). Without avahi-utils the HUD logs a
 * hint once and runs without advertising; the static Avahi service file shipped in deploy/ is
 * the dependency-free alternative.
 */
import { PROTOCOL_VERSION, type HudConfig } from '@carheadsup/core';
import {
  ProcessSupervisor,
  defaultSpawn,
  findExecutable,
  type SpawnFn,
} from '../sensors/process.ts';
import type { RuntimeDeps, Service } from '../sources/types.ts';

export const MDNS_SERVICE_TYPE = '_carheadsup._tcp';
export const MDNS_PHONE_PATH = '/ws/phone';
export const AVAHI_PUBLISH = 'avahi-publish-service';
/** DNS-SD instance names are one DNS label: at most 63 bytes of UTF-8. */
const MAX_INSTANCE_BYTES = 63;

const MISSING_HINT =
  `mDNS: ${AVAHI_PUBLISH} not found, so the phone cannot discover the HUD automatically. ` +
  'Install avahi-utils ("sudo apt install avahi-utils"), or copy the static Avahi service file ' +
  'from deploy/ to /etc/avahi/services/.';

/** "<vehicle name> HUD", cleaned of control characters and cut to a valid DNS-SD instance name. */
export function mdnsInstanceName(vehicleName: string): string {
  const base = vehicleName
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let name = `${base.length > 0 ? base : 'carheadsup'} HUD`;
  const encoder = new TextEncoder();
  while (encoder.encode(name).length > MAX_INSTANCE_BYTES) {
    // Trim the vehicle name (by whole code points) and keep the " HUD" suffix.
    const chars = Array.from(name.slice(0, -4));
    chars.pop();
    name = `${chars.join('').trimEnd()} HUD`;
  }
  return name;
}

/** Arguments for avahi-publish-service. */
export function avahiPublishArgs(config: HudConfig, hudId: string): string[] {
  return [
    '-s',
    mdnsInstanceName(config.vehicle.name),
    MDNS_SERVICE_TYPE,
    String(config.server.port),
    `v=${PROTOCOL_VERSION}`,
    `path=${MDNS_PHONE_PATH}`,
    `id=${hudId}`,
  ];
}

export interface MdnsIo {
  spawn?: SpawnFn;
  /** Locates an executable on PATH; null when missing. */
  which?: (command: string) => string | null;
}

/** Hint logged once per process when avahi-utils is missing. */
let missingLogged = false;

/**
 * Advertise the HUD as `_carheadsup._tcp` (TXT: v=<protocol version>, path=/ws/phone,
 * id=<HUD id>) so the companion app can find it. Returns null when advertising is disabled or
 * unavailable.
 */
export function advertiseHud(
  config: HudConfig,
  hudId: string,
  deps: RuntimeDeps,
  io: MdnsIo = {},
): Service | null {
  if (!config.server.mdns) return null;
  const { logger } = deps;
  const logMissing = (): void => {
    if (missingLogged) return;
    missingLogged = true;
    logger.warn(MISSING_HINT);
  };
  const which = io.which ?? ((command: string) => findExecutable(command));
  if (which(AVAHI_PUBLISH) === null) {
    logMissing();
    return null;
  }
  const args = avahiPublishArgs(config, hudId);
  const supervisor = new ProcessSupervisor({
    label: 'mDNS',
    command: AVAHI_PUBLISH,
    args: () => args,
    spawn: io.spawn ?? defaultSpawn,
    timers: deps.timers,
    now: deps.now,
    logger,
    onStdoutLine: (line) => {
      // "Established under name 'My car HUD'" (or a renamed instance after a name conflict).
      if (/established/i.test(line)) logger.info(`mDNS: ${line.trim()}`);
    },
    onMissing: logMissing,
  });
  logger.info(
    `mDNS: advertising "${args[1]}" as ${MDNS_SERVICE_TYPE} on port ${config.server.port}`,
  );
  supervisor.start();
  return {
    name: 'mdns',
    stop: () => supervisor.stop(),
  };
}

/** Test hook: forget that the missing-tool hint was logged. */
export function resetMdnsHintForTests(): void {
  missingLogged = false;
}
