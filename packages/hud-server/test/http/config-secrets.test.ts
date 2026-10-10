import { DEFAULT_CONFIG, parseConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { configForClient, keepConfigSecrets } from '../../src/http/config-secrets.ts';

const config = () => parseConfig({
  ...DEFAULT_CONFIG, server: { ...DEFAULT_CONFIG.server, apiToken: 'admin-secret' },
  phone: { ...DEFAULT_CONFIG.phone, pairingToken: 'pairing-secret' },
}).config;

describe('config secret views', () => {
  it('masks every remote response without changing stored credentials or other settings', () => {
    const stored = config();
    const view = configForClient(stored, false);
    expect(JSON.stringify(view)).not.toContain('admin-secret');
    expect(JSON.stringify(view)).not.toContain('pairing-secret');
    expect(view.server.apiToken).toBe('[redacted]');
    expect(view.phone.pairingToken).toBe('[redacted]');
    expect(stored.server.apiToken).toBe('admin-secret');
    expect(configForClient(stored, true)).toEqual(stored);
    expect(view.vehicle).toEqual(stored.vehicle);
  });

  it('preserves secrets through full PUT and partial PATCH while allowing deliberate rotation', () => {
    const stored = config();
    const view = configForClient(stored, false);
    view.vehicle.name = 'Renamed';
    const restored = keepConfigSecrets(view, stored);
    expect(restored).toMatchObject({ vehicle: { name: 'Renamed' },
      server: { apiToken: 'admin-secret' }, phone: { pairingToken: 'pairing-secret' } });
    expect(view.server.apiToken).toBe('[redacted]');
    expect(keepConfigSecrets({ server: { apiToken: '[redacted]' } }, stored))
      .toEqual({ server: { apiToken: 'admin-secret' } });
    expect(keepConfigSecrets({ server: { apiToken: 'new-secret' }, phone: { pairingToken: '' } }, stored))
      .toEqual({ server: { apiToken: 'new-secret' }, phone: { pairingToken: '' } });
  });

  it('keeps empty credentials visibly empty and leaves malformed input to schema validation', () => {
    const stored = config();
    stored.server.apiToken = '';
    stored.phone.pairingToken = '';
    const view = configForClient(stored, false);
    expect(view.server.apiToken).toBe('');
    expect(view.phone.pairingToken).toBe('');
    expect(keepConfigSecrets(null, stored)).toBe(null);
    expect(keepConfigSecrets([1], stored)).toEqual([1]);
  });
});
