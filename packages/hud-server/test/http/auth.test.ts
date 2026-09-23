import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  isAuthorized,
  isCrossSiteRequest,
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
  ])('rejects %s', (address) => {
    expect(isLoopbackAddress(address)).toBe(false);
  });

  it('rejects a missing address (destroyed socket)', () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress(null)).toBe(false);
  });
});

describe('bearerToken', () => {
  it('extracts the token, case-insensitively and tolerating whitespace', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc  ')).toBe('abc');
    expect(bearerToken('BEARER x.y-z')).toBe('x.y-z');
  });

  it('rejects other schemes and malformed headers', () => {
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken('Bearer a b')).toBeNull();
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
  const remote = '192.168.4.20';

  it('always allows loopback clients, even with a token configured and none sent', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(isAuthorized({ remoteAddress: address, apiToken: 'secret' })).toBe(true);
    }
  });

  it('allows everyone when no token is configured', () => {
    expect(isAuthorized({ remoteAddress: remote, apiToken: '' })).toBe(true);
  });

  it('requires the right bearer token from remote clients', () => {
    expect(isAuthorized({ remoteAddress: remote, apiToken: 'secret' })).toBe(false);
    expect(
      isAuthorized({ remoteAddress: remote, authorization: 'Bearer secret', apiToken: 'secret' }),
    ).toBe(true);
    expect(
      isAuthorized({ remoteAddress: remote, authorization: 'Bearer wrong', apiToken: 'secret' }),
    ).toBe(false);
    expect(
      isAuthorized({ remoteAddress: remote, authorization: 'Basic secret', apiToken: 'secret' }),
    ).toBe(false);
  });

  it('accepts an explicitly passed token (WebSocket ?token=)', () => {
    expect(isAuthorized({ remoteAddress: remote, token: 'secret', apiToken: 'secret' })).toBe(true);
    expect(isAuthorized({ remoteAddress: remote, token: '', apiToken: 'secret' })).toBe(false);
    expect(
      isAuthorized({
        remoteAddress: remote,
        token: 'wrong',
        authorization: 'Bearer secret',
        apiToken: 'secret',
      }),
    ).toBe(true);
  });

  it('refuses clients whose address is unknown when a token is required', () => {
    expect(isAuthorized({ remoteAddress: undefined, apiToken: 'secret' })).toBe(false);
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
