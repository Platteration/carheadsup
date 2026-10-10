import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { HudConfig } from '@carheadsup/core';

// These pure helpers need only the token constant. Resolve the workspace alias directly so this
// regression can run on the supported Node version before external dependencies are installed.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === '@carheadsup/core'
        ? new URL('../../../core/src/config/tokens.ts', import.meta.url).href
        : specifier,
      context,
    );
  },
});
const { acceptedApiToken, rebaseConfigResult } = await import(
  '../../src/settings/model/config-response.ts'
);
hooks.deregister();

// Include an unrelated setting to check that secret acknowledgement does not discard other edits.
const config = (apiToken = '[redacted]', pairingToken = '[redacted]') =>
  ({ server: { apiToken }, phone: { pairingToken }, vehicle: { name: 'Initial' } }) as HudConfig;

test('successful masked API and pairing rotations are saved without resending credentials', () => {
  const base = config();
  const draft = config('new-api-secret', 'new-pairing-secret');
  const sent = {
    server: { apiToken: draft.server.apiToken },
    phone: { pairingToken: draft.phone.pairingToken },
  };
  const result = { config: config(), errors: [] };
  assert.deepEqual(rebaseConfigResult(base, result, draft, sent), result.config);
  assert.equal(acceptedApiToken(sent, result), 'new-api-secret');
});

test('a marker round trip retains the device credential instead of installing the marker', () => {
  const base = config('existing-api-secret');
  const result = { config: config('existing-api-secret'), errors: [] };
  assert.equal(acceptedApiToken({ server: { apiToken: '[redacted]' } }, result), undefined);
  assert.deepEqual(
    rebaseConfigResult(base, result, config('[redacted]'), { server: { apiToken: '[redacted]' } }),
    result.config,
  );
});

test('edits made during a masked save remain pending while the accepted token is used', () => {
  const base = config();
  const draft = config('later-api-secret', 'later-pairing-secret');
  draft.vehicle.name = 'Later edit';
  const sent = {
    server: { apiToken: 'sent-api-secret' },
    phone: { pairingToken: 'sent-pairing-secret' },
  };
  const result = { config: config(), errors: [] };
  assert.deepEqual(rebaseConfigResult(base, result, draft, sent), draft);
  assert.equal(acceptedApiToken(sent, result), 'sent-api-secret');
});

test('rejected secrets remain edited and do not replace the device token', () => {
  const base = config();
  const draft = config('invalid-api-secret', 'invalid-pairing-secret');
  const sent = {
    server: { apiToken: draft.server.apiToken },
    phone: { pairingToken: draft.phone.pairingToken },
  };
  const result = {
    config: config(),
    errors: ['server.apiToken: invalid', 'phone.pairingToken: invalid'],
  };
  assert.deepEqual(rebaseConfigResult(base, result, draft, sent), draft);
  assert.equal(acceptedApiToken(sent, result), undefined);
});

test('unrelated validation errors still acknowledge a successful API token rotation', () => {
  const base = config();
  const draft = config('new-api-secret');
  draft.vehicle.name = 'Invalid name';
  const sent = {
    server: { apiToken: draft.server.apiToken },
    vehicle: { name: draft.vehicle.name },
  };
  const result = { config: config(), errors: ['vehicle.name: invalid'] };
  const rebased = rebaseConfigResult(base, result, draft, sent);
  assert.equal(rebased.server.apiToken, '[redacted]');
  assert.equal(rebased.vehicle.name, 'Invalid name');
  assert.equal(acceptedApiToken(sent, result), 'new-api-secret');
});

test('local responses and deliberately empty tokens preserve ordinary editor semantics', () => {
  const base = config('old-api-secret', 'old-pairing-secret');
  const draft = config('', 'new-pairing-secret');
  const sent = { server: { apiToken: '' }, phone: { pairingToken: 'new-pairing-secret' } };
  const result = { config: draft, errors: [] };
  assert.deepEqual(rebaseConfigResult(base, result, draft, sent), draft);
  assert.equal(acceptedApiToken(sent, result), '');
  assert.equal(acceptedApiToken({ server: { apiToken: 'not-accepted' } }, result), undefined);
});

test('an unrelated live response does not acknowledge an unsent credential edit', () => {
  const base = config();
  const draft = config('unsent-api-secret');
  const result = { config: config(), errors: [] };
  assert.deepEqual(rebaseConfigResult(base, result, draft, {}), draft);
  assert.equal(acceptedApiToken({}, result), undefined);
});
