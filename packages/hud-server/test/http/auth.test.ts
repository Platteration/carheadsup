import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  hudHostNames,
  isDnsName,
  isAllowedHost,
  isAuthorized,
  isCrossSiteRequest,
  isHudItself,
  isLoopbackAddress,
  secretsEqual,
} from '../../src/http/auth.ts';

describe('isLoopbackAddress', () => {
  it.each([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '127.1.2.3',
    '::FFFF:127.0.0.1',
    '0:0:0:0:0:0:0:1',
  ])('accepts %s', (address) => {
    expect(isLoopbackAddress(address)).toBe(true);
  });

  it.each([
    '192.168.4.20',
    '10.0.0.1',
    '::ffff:192.168.1.2',
    'fe80::1',
    '128.0.0.1',
    '',
    'localhost',
    '127.0.0.1%lo',
    '::1%',
    '0127.0.0.1',
  ])('rejects %s', (address) => {
    expect(isLoopbackAddress(address)).toBe(false);
  });

  it('rejects a missing address (destroyed socket)', () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress(null)).toBe(false);
  });
});

describe('isHudItself', () => {
  it.each([
    // Loopback, wherever it arrived.
    ['127.0.0.1', '127.0.0.1'],
    ['::1', '::1'],
    ['::ffff:127.0.0.1', '::ffff:127.0.0.1'],
    ['127.0.0.1', undefined],
    // From the address it reached the HUD at: the kiosk on a single-address bind.
    ['10.42.0.1', '10.42.0.1'],
    ['192.168.4.1', '192.168.4.1'],
    ['::ffff:10.42.0.1', '10.42.0.1'],
    ['10.42.0.1', '::ffff:10.42.0.1'],
    ['::FFFF:10.42.0.1', '::ffff:a2a:1'],
    ['fd00::10', 'fd00::10'],
    ['FD00:0:0:0:0:0:0:10', 'fd00::10'],
    ['2001:db8::1', '2001:0db8:0000::0001'],
    ['fe80::1%wlan0', 'fe80::1%wlan0'],
    ['fe80::1%wlan0', 'fe80::1'],
    ['fe80::1', 'fe80::1%3'],
  ])('%s → %s is the HUD itself', (remote, local) => {
    expect(isHudItself(remote, local)).toBe(true);
  });

  it.each([
    // Another device, whichever of the HUD's addresses it came to.
    ['10.42.0.23', '10.42.0.1'],
    ['::ffff:10.42.0.23', '::ffff:10.42.0.1'],
    ['192.168.4.20', '127.0.0.1'],
    ['fd00::23', 'fd00::10'],
    ['fe80::2%wlan0', 'fe80::1%wlan0'],
    // The same link-local address on two different links is not the same address.
    ['fe80::1%eth0', 'fe80::1%wlan0'],
    // IPv4 and IPv6 are different addresses, unless one is the other's mapped form.
    ['10.42.0.1', '::a2a:1'],
    ['10.42.0.1', '2001:db8::a2a:1'],
    // Unknown, empty or unusable addresses are never the HUD itself.
    ['10.42.0.1', undefined],
    [undefined, '10.42.0.1'],
    [undefined, undefined],
    ['', ''],
    ['10.42.0.1', ''],
    ['localhost', 'localhost'],
    ['hud.local', 'hud.local'],
    ['010.42.0.1', '010.42.0.1'],
    ['10.42.0.1%eth0', '10.42.0.1%eth0'],
    ['fe80::1%', 'fe80::1%'],
    ['0.0.0.0', '0.0.0.0'],
    ['::', '::'],
  ])('%s → %s is not', (remote, local) => {
    expect(isHudItself(remote, local)).toBe(false);
  });

  it('takes null (a socket already gone) for unknown', () => {
    expect(isHudItself(null, '10.42.0.1')).toBe(false);
    expect(isHudItself('10.42.0.1', null)).toBe(false);
    expect(isHudItself(null, null)).toBe(false);
  });
});

describe('bearerToken', () => {
  it('extracts the token, case-insensitively and tolerating whitespace', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc  ')).toBe('abc');
    expect(bearerToken('BEARER x.y-z')).toBe('x.y-z');
  });

  it('takes everything after the scheme, so tokens may contain spaces', () => {
    expect(bearerToken('Bearer my car key')).toBe('my car key');
    expect(bearerToken('Bearer  a  b  ')).toBe('a  b');
  });

  it('rejects other schemes and malformed headers', () => {
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken('Bearer   ')).toBeNull();
    expect(bearerToken('Bearerabc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken(['Bearer a'])).toBeNull();
  });
});

describe('secretsEqual', () => {
  it('compares exactly, regardless of length differences', () => {
    expect(secretsEqual('s3cret', 's3cret')).toBe(true);
    expect(secretsEqual('s3cret', 's3cre')).toBe(false);
    expect(secretsEqual('s3cret', 's3cret!')).toBe(false);
    expect(secretsEqual('', 'x')).toBe(false);
    expect(secretsEqual('ünïcode', 'ünïcode')).toBe(true);
  });
});

describe('isAuthorized', () => {
  const remote = { remoteAddress: '192.168.4.20', localAddress: '192.168.4.1' };

  it('always allows loopback clients, even with a token configured and none sent', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      for (const localAddress of [address, '10.42.0.1', undefined]) {
        expect(isAuthorized({ remoteAddress: address, localAddress, apiToken: 'secret' })).toBe(
          true,
        );
      }
    }
  });

  it('always allows the HUD itself at a network address (the kiosk on a single-address bind)', () => {
    for (const [remoteAddress, localAddress] of [
      ['10.42.0.1', '10.42.0.1'],
      ['::ffff:10.42.0.1', '::ffff:10.42.0.1'],
      ['fd00::10', 'fd00::10'],
    ]) {
      expect(isAuthorized({ remoteAddress, localAddress, apiToken: 'secret' })).toBe(true);
    }
    // Another device that reached the HUD at that address still needs the token.
    expect(
      isAuthorized({ remoteAddress: '10.42.0.23', localAddress: '10.42.0.1', apiToken: 'secret' }),
    ).toBe(false);
  });

  it('allows everyone when no token is configured', () => {
    expect(isAuthorized({ ...remote, apiToken: '' })).toBe(true);
  });

  it('requires the right bearer token from remote clients', () => {
    expect(isAuthorized({ ...remote, apiToken: 'secret' })).toBe(false);
    expect(isAuthorized({ ...remote, authorization: 'Bearer secret', apiToken: 'secret' })).toBe(
      true,
    );
    expect(isAuthorized({ ...remote, authorization: 'Bearer wrong', apiToken: 'secret' })).toBe(
      false,
    );
    expect(isAuthorized({ ...remote, authorization: 'Basic secret', apiToken: 'secret' })).toBe(
      false,
    );
  });

  it('accepts an explicitly passed token (WebSocket ?token=)', () => {
    expect(isAuthorized({ ...remote, token: 'secret', apiToken: 'secret' })).toBe(true);
    expect(isAuthorized({ ...remote, token: '', apiToken: 'secret' })).toBe(false);
    expect(
      isAuthorized({
        ...remote,
        token: 'wrong',
        authorization: 'Bearer secret',
        apiToken: 'secret',
      }),
    ).toBe(true);
  });

  it('accepts every token the settings app can save and send', () => {
    // Inner spaces are part of the token; surrounding whitespace never survives an HTTP header
    // (and the settings app trims the token it keeps), so it is not part of the comparison.
    expect(
      isAuthorized({
        ...remote,
        authorization: 'Bearer my car key',
        apiToken: 'my car key',
      }),
    ).toBe(true);
    expect(isAuthorized({ ...remote, authorization: 'Bearer key', apiToken: ' key ' })).toBe(true);
    expect(isAuthorized({ ...remote, token: ' key', apiToken: 'key' })).toBe(true);
    expect(
      isAuthorized({
        ...remote,
        authorization: 'Bearer my car',
        apiToken: 'my car key',
      }),
    ).toBe(false);
    // A token of nothing but whitespace can never be presented; it still is not "no token".
    expect(isAuthorized({ ...remote, token: ' ', apiToken: '  ' })).toBe(false);
  });

  it('refuses clients whose address is unknown when a token is required', () => {
    expect(
      isAuthorized({ remoteAddress: undefined, localAddress: undefined, apiToken: 'secret' }),
    ).toBe(false);
    expect(
      isAuthorized({ remoteAddress: undefined, localAddress: '10.42.0.1', apiToken: 'secret' }),
    ).toBe(false);
  });
});

describe('isCrossSiteRequest', () => {
  it('treats requests without browser provenance as same-site (phone app, curl)', () => {
    expect(isCrossSiteRequest({ host: 'hud:8080' })).toBe(false);
  });

  it('accepts a matching Origin, including default ports', () => {
    expect(isCrossSiteRequest({ origin: 'http://hud:8080', host: 'hud:8080' })).toBe(false);
    expect(isCrossSiteRequest({ origin: 'http://HUD.local', host: 'hud.local:80' })).toBe(false);
    expect(isCrossSiteRequest({ origin: 'http://[::1]:8080', host: '[::1]:8080' })).toBe(false);
  });

  it('flags foreign origins, opaque origins and Sec-Fetch-Site: cross-site', () => {
    expect(isCrossSiteRequest({ origin: 'http://evil.example', host: 'hud:8080' })).toBe(true);
    expect(isCrossSiteRequest({ origin: 'http://hud:9999', host: 'hud:8080' })).toBe(true);
    expect(isCrossSiteRequest({ origin: 'null', host: 'hud:8080' })).toBe(true);
    expect(isCrossSiteRequest({ origin: '::garbage', host: 'hud:8080' })).toBe(true);
    expect(isCrossSiteRequest({ origin: 'http://hud:8080' })).toBe(true);
    expect(isCrossSiteRequest({ 'sec-fetch-site': 'cross-site', host: 'hud:8080' })).toBe(true);
  });
});

describe('isDnsName', () => {
  it.each(['hud', 'hud.local', 'my_pi.fritz.box', 'a-b', '10.42.0.1', '0', `${'a'.repeat(63)}.b`])(
    'accepts %s',
    (name) => {
      expect(isDnsName(name)).toBe(true);
    },
  );

  it.each([
    '',
    '.',
    'hud.',
    '.hud',
    'hud..local',
    '-hud',
    'hud-',
    'HUD',
    'a b',
    'a/b',
    'a%2fb',
    'a@b',
    'a:80',
    'é',
    `${'a'.repeat(64)}`,
  ])('refuses %j', (name) => {
    expect(isDnsName(name)).toBe(false);
  });
});

describe('hudHostNames / isAllowedHost', () => {
  const names = hudHostNames('CarHUD.example.lan.', ['Pi.Fritz.Box']);

  it('knows the machine name, its first label, <label>.local and extra names', () => {
    expect([...names].sort()).toEqual([
      'carhud',
      'carhud.example.lan',
      'carhud.local',
      'pi.fritz.box',
    ]);
  });

  it.each([
    'carhud.local:8080',
    'CarHUD.local.',
    'carhud',
    'pi.fritz.box:80',
    '10.42.0.1:8080',
    '192.168.1.5',
    '[::1]:8080',
    '[fd00::10]',
    '[fe80::1%25wlan0]:8080',
    '[fe80::1%wlan0]',
    'localhost:8080',
    'LOCALHOST.',
    'hud.localhost',
    'my_hud.localhost:8080',
    'a-b.c-d.localhost',
    `${'a'.repeat(63)}.localhost`,
  ])('accepts %s', (host) => {
    expect(isAllowedHost(host, names)).toBe(true);
  });

  it.each([
    'evil.example:8080',
    'carhud.evil.example',
    'carhud.local.evil.example',
    'localhost.evil.example',
    '10.42.0.1.nip.io',
    'evil.example:80:80',
    'fe80::1',
    '[::1',
    '[evil.example]:80',
    '[::1]x',
    ':8080',
    // Ending in .localhost, but no host name: a path, query, fragment, userinfo, backslash,
    // percent-encoding, spaces or a non-ASCII dot in it.
    'evil.example/.localhost',
    'evil.example?.localhost',
    'evil.example#.localhost',
    'user@evil.example.localhost',
    'evil.example\\.localhost',
    'evil.example%2f.localhost',
    'a b.localhost',
    'evil.example\u3002localhost',
    'évil.localhost',
    'evil.example:443/.localhost',
    // Not made of DNS labels.
    '.localhost',
    'hud..localhost',
    '-hud.localhost',
    'hud-.localhost',
    `${'a'.repeat(64)}.localhost`,
    `${'a.'.repeat(124)}localhost`,
    'carhud.local..',
    // A configured name only as a DNS name.
    'pi.fritz.box/x',
    // A zone made of something else than a name.
    '[fe80::1%25wlan0/x]:8080',
    '[fe80::1%25a b]',
    '[fe80::1%]',
  ])('refuses %j', (host) => {
    expect(isAllowedHost(host, names)).toBe(false);
  });

  it('accepts a name of 253 characters, not one longer', () => {
    const name = (length: number): string => {
      const labels: string[] = [];
      let left = length - 'localhost'.length;
      while (left > 0) {
        const size = Math.min(63, left - 1);
        labels.push('a'.repeat(size));
        left -= size + 1;
      }
      return [...labels, 'localhost'].join('.');
    };
    expect(name(253)).toHaveLength(253);
    expect(isAllowedHost(name(253), names)).toBe(true);
    expect(isAllowedHost(`${name(253)}.`, names)).toBe(true);
    expect(name(254)).toHaveLength(254);
    expect(isAllowedHost(name(254), names)).toBe(false);
  });

  it('matches configured names only when they are DNS names', () => {
    const odd = hudHostNames('carhud', ['a b', 'evil.example/x']);
    expect(isAllowedHost('a b', odd)).toBe(false);
    expect(isAllowedHost('evil.example/x', odd)).toBe(false);
    expect(isAllowedHost('carhud.local', odd)).toBe(true);
  });

  it('lets requests without a Host header through (not a browser)', () => {
    expect(isAllowedHost(undefined, names)).toBe(true);
    expect(isAllowedHost(['a', 'b'], names)).toBe(false);
  });
});
