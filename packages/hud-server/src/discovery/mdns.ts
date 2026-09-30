/**
 * mDNS / DNS-SD advertisement through Avahi's `avahi-publish-service` (package avahi-utils):
 *
 *   avahi-publish-service -s "<vehicle name> HUD" _carheadsup._tcp <port> v=<protocol> \
 *     path=/ws/phone id=<HUD id> tls=<TLS port> fp=<certificate SHA-256>
 *
 * The `id` lets a phone that has pinned this HUD skip other HUDs without connecting to them (it
 * checks the id again in the `challenge`; the static service file cannot know it). `tls` is the
 * port the phone connects to (`wss://`); `fp` the fingerprint of the certificate it will see
 * there, which a phone pairing for the first time requires the TLS handshake to match. Neither
 * is a proof: the certificate pin and the handshake's proofs decide.
 *
 * The tool keeps the record registered for as long as it runs, so it is supervised and restarted
 * with backoff if it exits (e.g. avahi-daemon restarting). Without avahi-utils the HUD logs a
 * hint once and runs without advertising; the static Avahi service file shipped in deploy/ is
 * the dependency-free alternative.
 */
import { PROTOCOL_VERSION, hudDisplayName, type HudConfig } from '@carheadsup/core';
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
const MISSING_HINT =
  `mDNS: ${AVAHI_PUBLISH} not found, so the phone cannot discover the HUD automatically. ` +
  'Install avahi-utils ("sudo apt install avahi-utils"), or copy the static Avahi service file ' +
  'from deploy/ to /etc/avahi/services/.';

/**
 * "<vehicle name> HUD", cleaned of control characters and cut to a valid DNS-SD instance name
 * (one DNS label, 63 bytes of UTF-8) — the same name the pairing QR code carries.
 */
export function mdnsInstanceName(vehicleName: string): string {
  return hudDisplayName(vehicleName);
}

/** What the advertisement says about this HUD besides the config. */
export interface MdnsAdvert {
  /** The HUD's identity (TXT `id`). */
  hudId: string;
  /** The TLS listener and its certificate fingerprint (TXT `tls`, `fp`); null without TLS. */
  tls: { port: number; fingerprint: string } | null;
}

/** Arguments for avahi-publish-service. */
export function avahiPublishArgs(config: HudConfig, advert: MdnsAdvert): string[] {
  return [
    '-s',
    mdnsInstanceName(config.vehicle.name),
    MDNS_SERVICE_TYPE,
    String(config.server.port),
    `v=${PROTOCOL_VERSION}`,
    `path=${MDNS_PHONE_PATH}`,
    `id=${advert.hudId}`,
    ...(advert.tls === null ? [] : [`tls=${advert.tls.port}`, `fp=${advert.tls.fingerprint}`]),
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
 * id=<HUD id>, and with TLS tls=<port>, fp=<certificate fingerprint>) so the companion app can
 * find it. Returns null when advertising is disabled or unavailable.
 */
export function advertiseHud(
  config: HudConfig,
  advert: MdnsAdvert,
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
  const args = avahiPublishArgs(config, advert);
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
    `mDNS: advertising "${args[1]}" as ${MDNS_SERVICE_TYPE} on port ${config.server.port}` +
      (advert.tls === null
        ? ' (no TLS port: the phone cannot connect)'
        : ` (TLS port ${advert.tls.port})`),
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
