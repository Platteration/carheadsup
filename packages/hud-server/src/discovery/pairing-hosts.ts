/**
 * Where a phone can reach this HUD, for the pairing QR code (`protocol/pairing.ts` in core): the
 * machine's IPv4 addresses and its mDNS name.
 */
import type { NetworkInterfaceInfo } from 'node:os';
import { PAIRING_URI, isPairingHost, normalizeIpAddress } from '@carheadsup/core';

/** While the pairing page is up, the HUD's addresses are looked up again at most this often. */
export const PAIRING_HOSTS_REFRESH_MS = 5000;

const WILDCARD_HOSTS: ReadonlySet<string> = new Set(['', '0.0.0.0', '::', '[::]', '*']);

function isLoopbackOrLinkLocal(ipv4: string): boolean {
  return ipv4.startsWith('127.') || ipv4.startsWith('169.254.');
}

/**
 * The hosts for the pairing QR code, most preferred first:
 *
 * - listening on every address (`server.host` 0.0.0.0 or ::): the machine's IPv4 addresses in
 *   the order of its interfaces — except loopback and link-local ones (169.254.x.x), which no
 *   phone can use — then `<host name>.local` (mDNS), the name the HUD answers to;
 * - listening on one IPv4 address: that address, unless it is a loopback one (then no phone can
 *   connect at all, and the list is empty); listening on a host name: that name.
 *
 * IPv6 addresses are left out: a phone would need the right zone for a link-local one. At most
 * `PAIRING_URI.maxHosts` hosts; duplicates are dropped.
 */
export function pairingHosts(
  bindHost: string,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  machineName: string,
): string[] {
  const bind = bindHost.trim().toLowerCase();
  if (!WILDCARD_HOSTS.has(bind)) {
    const ip = normalizeIpAddress(bind);
    if (ip !== null) return ip.includes(':') || isLoopbackOrLinkLocal(ip) ? [] : [ip];
    return bind !== 'localhost' && isPairingHost(bind) ? [bind] : [];
  }
  const hosts: string[] = [];
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      // Node.js before 18.4 reported the family as a number.
      const family: unknown = address.family;
      if (address.internal || (family !== 'IPv4' && family !== 4)) continue;
      const ip = normalizeIpAddress(address.address);
      if (ip === null || ip.includes(':') || isLoopbackOrLinkLocal(ip) || hosts.includes(ip)) {
        continue;
      }
      hosts.push(ip);
    }
  }
  const label = machineName.trim().toLowerCase().split('.')[0] ?? '';
  const mdnsName = `${label}.local`;
  const named = label !== '' && label !== 'localhost' && isPairingHost(mdnsName);
  const room = PAIRING_URI.maxHosts - (named ? 1 : 0);
  return named ? [...hosts.slice(0, room), mdnsName] : hosts.slice(0, room);
}
