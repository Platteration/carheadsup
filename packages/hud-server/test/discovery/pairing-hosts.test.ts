import type { NetworkInterfaceInfo } from 'node:os';
import { PAIRING_URI } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { pairingHosts } from '../../src/discovery/pairing-hosts.ts';

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  };
}

function v6(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: 'ffff:ffff:ffff:ffff::',
    family: 'IPv6',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/64`,
    scopeid: 2,
  };
}

/** A Pi running its own hotspot on wlan0 and wired into a home network. */
const PI: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  lo: [v4('127.0.0.1', true), v6('::1', true)],
  eth0: [v4('192.168.1.23'), v6('fe80::ba27:ebff:fe12:3456')],
  wlan0: [v4('10.42.0.1'), v6('fe80::ba27:ebff:fe12:3457')],
};

describe('pairingHosts', () => {
  it('lists the IPv4 addresses in interface order, then the mDNS name', () => {
    expect(pairingHosts('0.0.0.0', PI, 'carheadsup')).toEqual([
      '192.168.1.23',
      '10.42.0.1',
      'carheadsup.local',
    ]);
    expect(pairingHosts('::', PI, 'carheadsup')).toEqual([
      '192.168.1.23',
      '10.42.0.1',
      'carheadsup.local',
    ]);
  });

  it('leaves out loopback, link-local and IPv6 addresses, and duplicates', () => {
    const interfaces = {
      lo: [v4('127.0.0.1', true)],
      usb0: [v4('169.254.10.20')],
      wlan0: [v4('10.42.0.1'), v6('2001:db8::1')],
      wlan1: [v4('10.42.0.1')],
      odd: undefined,
    };
    expect(pairingHosts('0.0.0.0', interfaces, 'Pi.lan')).toEqual(['10.42.0.1', 'pi.local']);
  });

  it('takes the first label of the host name, and none that is no name', () => {
    expect(pairingHosts('0.0.0.0', {}, 'CarHUD.fritz.box')).toEqual(['carhud.local']);
    expect(pairingHosts('0.0.0.0', {}, 'localhost')).toEqual([]);
    expect(pairingHosts('0.0.0.0', {}, '')).toEqual([]);
    expect(pairingHosts('0.0.0.0', {}, 'my_pi')).toEqual([]);
  });

  it('keeps within the pairing URI’s limit, the mDNS name last', () => {
    const many = { eth0: Array.from({ length: 12 }, (_, i) => v4(`10.0.0.${i + 1}`)) };
    const hosts = pairingHosts('0.0.0.0', many, 'carheadsup');
    expect(hosts).toHaveLength(PAIRING_URI.maxHosts);
    expect(hosts.at(-1)).toBe('carheadsup.local');
    expect(hosts[0]).toBe('10.0.0.1');
  });

  it('names only the address the HUD listens on', () => {
    expect(pairingHosts('10.42.0.1', PI, 'carheadsup')).toEqual(['10.42.0.1']);
    expect(pairingHosts('hud.example', PI, 'carheadsup')).toEqual(['hud.example']);
    // No phone can reach a HUD that listens on loopback (or on IPv6 only).
    expect(pairingHosts('127.0.0.1', PI, 'carheadsup')).toEqual([]);
    expect(pairingHosts('localhost', PI, 'carheadsup')).toEqual([]);
    expect(pairingHosts('fe80::1', PI, 'carheadsup')).toEqual([]);
  });
});
