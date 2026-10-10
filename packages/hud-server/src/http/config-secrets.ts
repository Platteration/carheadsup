import { REDACTED_CONFIG_TOKEN } from '@carheadsup/core';
import type { HudConfig } from '@carheadsup/core';

/** The local setup UI may copy credentials; ordinary remote config views only show existence. */
export function configForClient(config: HudConfig, local: boolean): HudConfig {
  if (local) return config;
  const view = structuredClone(config);
  if (view.server.apiToken !== '') view.server.apiToken = REDACTED_CONFIG_TOKEN;
  if (view.phone.pairingToken !== '') view.phone.pairingToken = REDACTED_CONFIG_TOKEN;
  return view;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The reserved marker means keep the current secret, including a full GET → PUT round trip. */
export function keepConfigSecrets(body: unknown, current: HudConfig): unknown {
  if (!isRecord(body)) return body;
  const copy = structuredClone(body);
  if (isRecord(copy.server) && copy.server.apiToken === REDACTED_CONFIG_TOKEN) {
    copy.server.apiToken = current.server.apiToken;
  }
  if (isRecord(copy.phone) && copy.phone.pairingToken === REDACTED_CONFIG_TOKEN) {
    copy.phone.pairingToken = current.phone.pairingToken;
  }
  return copy;
}
