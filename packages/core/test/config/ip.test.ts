import { describe, expect, it } from 'vitest';
import { normalizeIpAddress } from '../../src/index.ts';

describe('normalizeIpAddress', () => {
  it.each([
    ['10.42.0.50', '10.42.0.50'],
    ['0.0.0.0', '0.0.0.0'],
    ['255.255.255.255', '255.255.255.255'],
    ['192.168.0.1', '192.168.0.1'],
  ])('accepts the IPv4 address %s', (input, canonical) => {
    expect(normalizeIpAddress(input)).toBe(canonical);
  });

  it.each([
    ['::1', '::1'],
    ['::', '::'],
    ['2001:DB8::1', '2001:db8::1'],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['fe80::0001', 'fe80::1'],
    // A single zero group is not shortened; the longest run of zeros is, the first one on a tie.
    ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
    ['2001:db8::1:0:0:1', '2001:db8::1:0:0:1'],
    ['2001:0:0:1:0:0:0:1', '2001:0:0:1::1'],
    ['1:0:0:2:0:0:3:4', '1::2:0:0:3:4'],
    ['1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0'],
    ['::2:3:4:5:6:7:8', '0:2:3:4:5:6:7:8'],
    ['1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8'],
    // Embedded IPv4 that is not IPv4-mapped stays IPv6.
    ['64:ff9b::192.0.2.33', '64:ff9b::c000:221'],
    ['::192.0.2.33', '::c000:221'],
  ])('accepts the IPv6 address %s as %s', (input, canonical) => {
    expect(normalizeIpAddress(input)).toBe(canonical);
  });

  it.each([
    ['::ffff:10.42.0.50', '10.42.0.50'],
    ['::FFFF:10.42.0.50', '10.42.0.50'],
    ['::ffff:a2a:32', '10.42.0.50'],
    ['0:0:0:0:0:ffff:0a2a:0032', '10.42.0.50'],
    ['0:0:0:0:0:ffff:10.42.0.50', '10.42.0.50'],
  ])('turns the IPv4-mapped IPv6 address %s into %s', (input, canonical) => {
    expect(normalizeIpAddress(input)).toBe(canonical);
  });

  it.each([
    '',
    ' 10.42.0.50',
    '10.42.0.50 ',
    '10.42.0',
    '10.42.0.50.1',
    '10.42.0.256',
    '10.42.0.-1',
    '010.42.0.50', // leading zeros: octal to some parsers
    '10.42.0.5a',
    '10..0.50',
    '1e1.0.0.1',
    '0x0a.0.0.1',
    'localhost',
    'hud.local',
    '10.42.0.50/24',
    '10.42.0.50:5005',
    '[::1]',
    ':::',
    '1:::2',
    ':1::',
    '1::2::3',
    ':1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7:',
    '1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7:8:9',
    '1:2:3:4:5:6:7:8::',
    '::1:2:3:4:5:6:7:8',
    '12345::1',
    'g::1',
    '1.2.3.4::',
    '::1.2.3.4:5',
    '::1.2.3',
    '::ffff:256.0.0.1',
    '1:2:3:4:5:6:7:1.2.3.4',
    'fe80::1%eth0',
    '::1/128',
    '١٠.٤٢.٠.٥٠', // Arabic-Indic digits
    `${'1:'.repeat(20)}1`,
  ])('rejects %j', (input) => {
    expect(normalizeIpAddress(input)).toBeNull();
  });

  it('maps equal addresses written differently to the same text', () => {
    const forms = ['2001:db8::a', '2001:DB8:0:0:0:0:0:A', '2001:0db8::000a', '2001:db8:0::0:a'];
    expect(new Set(forms.map(normalizeIpAddress))).toEqual(new Set(['2001:db8::a']));
  });

  it('is idempotent', () => {
    for (const input of ['::ffff:10.0.0.1', '2001:DB8::1', '10.0.0.1', '::', '1:0:0:2::']) {
      const once = normalizeIpAddress(input);
      expect(once).not.toBeNull();
      expect(normalizeIpAddress(once!)).toBe(once);
    }
  });
});
