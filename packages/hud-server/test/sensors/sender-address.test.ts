import { isIP } from 'node:net';
import { normalizeIpAddress } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';

/**
 * The ADAS allow-list compares the addresses Node reports for datagrams with the configured ones
 * through core's `normalizeIpAddress`, so it must read addresses exactly as Node does. Checked
 * here against `net.isIP` and the WHATWG URL parser's canonical IPv6 form (RFC 5952).
 */

/** Deterministic pseudo-random numbers (mulberry32), so failures reproduce. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Node's canonical text for an IPv6 address (IPv4-mapped ones print as hex, e.g. ::ffff:a2a:32). */
function urlForm(address: string): string {
  return new URL(`http://[${address}]/`).hostname.slice(1, -1);
}

/** Every way of writing `groups`: full, with leading zeros, each zero run as "::", upper case. */
function spellings(groups: readonly number[], rnd: () => number): string[] {
  const hex = groups.map((g) => g.toString(16));
  const out = [hex.join(':'), groups.map((g) => g.toString(16).padStart(4, '0')).join(':')];
  for (let start = 0; start < 8; start++) {
    for (let end = start + 1; end <= 8; end++) {
      if (groups.slice(start, end).some((g) => g !== 0)) break;
      out.push(`${hex.slice(0, start).join(':')}::${hex.slice(end).join(':')}`);
    }
  }
  return out.map((s) => (rnd() < 0.3 ? s.toUpperCase() : s));
}

describe('normalizeIpAddress agrees with Node', () => {
  it('on IPv6 addresses, however they are written', () => {
    const rnd = random(1);
    for (let n = 0; n < 400; n++) {
      // Plenty of zero groups, so that runs of zeros (and their compression) are common.
      const groups = Array.from({ length: 8 }, () =>
        rnd() < 0.5 ? 0 : Math.floor(rnd() * 0x10000),
      );
      if (n % 10 === 0) groups.splice(0, 6, 0, 0, 0, 0, 0, 0xffff); // IPv4-mapped
      const canonical = urlForm(groups.map((g) => g.toString(16)).join(':'));
      const mapped = canonical.startsWith('::ffff:') && groups[5] === 0xffff;
      const expected = mapped
        ? [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.')
        : canonical;
      for (const spelling of spellings(groups, rnd)) {
        expect(isIP(spelling), spelling).toBe(6);
        expect(normalizeIpAddress(spelling), spelling).toBe(expected);
      }
    }
  });

  it('on IPv4 addresses, plain and IPv4-mapped', () => {
    const rnd = random(2);
    for (let n = 0; n < 400; n++) {
      const address = Array.from({ length: 4 }, () => Math.floor(rnd() * 256)).join('.');
      expect(isIP(address), address).toBe(4);
      expect(normalizeIpAddress(address)).toBe(address);
      expect(normalizeIpAddress(`::ffff:${address}`)).toBe(address);
      expect(normalizeIpAddress(`::FFFF:${address}`)).toBe(address);
    }
  });

  it('on what is and is not an address (random strings)', () => {
    const rnd = random(3);
    const alphabet = '0123456789abcdefABCDEFg:.:.:';
    let valid = 0;
    for (let n = 0; n < 50_000; n++) {
      const length = 1 + Math.floor(rnd() * 20);
      let text = '';
      for (let i = 0; i < length; i++) text += alphabet[Math.floor(rnd() * alphabet.length)];
      const ours = normalizeIpAddress(text) !== null;
      expect(ours, text).toBe(isIP(text) !== 0);
      if (ours) valid += 1;
    }
    expect(valid).toBeGreaterThan(50); // the corpus does exercise both answers
  });

  it('except that zone indices, which Node accepts, are refused (the server strips them)', () => {
    expect(isIP('fe80::1%wlan0')).toBe(6);
    expect(normalizeIpAddress('fe80::1%wlan0')).toBeNull();
  });
});
