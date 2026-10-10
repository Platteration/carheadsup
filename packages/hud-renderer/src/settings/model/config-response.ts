import { REDACTED_CONFIG_TOKEN } from '@carheadsup/core';
import type { ApiConfigResult, DeepPartial, HudConfig } from '@carheadsup/core';
import { getAt, jsonEqual, pathKey, rebaseDraft, setAt } from './diff.ts';

const SECRET_PATHS = [
  ['server', 'apiToken'],
  ['phone', 'pairingToken'],
] as const;

/** A remote secret is represented by the marker, and sending a marker retains the current secret.
 * Acknowledge either response only when the user has not edited it again during the request. */
export function rebaseConfigResult(
  base: HudConfig,
  result: ApiConfigResult,
  draft: HudConfig,
  sent: DeepPartial<HudConfig>,
): HudConfig {
  let rebased = rebaseDraft(base, result.config, draft, sent);
  for (const path of SECRET_PATHS) {
    const token = getAt(sent, path);
    const returned = getAt(result.config, path);
    if (
      typeof token === 'string' &&
      (token === REDACTED_CONFIG_TOKEN || returned === REDACTED_CONFIG_TOKEN) &&
      !result.errors.some((error) => error.startsWith(`${pathKey(path)}:`)) &&
      jsonEqual(getAt(draft, path), token)
    ) {
      rebased = setAt(rebased, path, returned);
    }
  }
  return rebased;
}

/** A marker retains the server's existing credential; it must never replace this device's
 * bearer token. Other fields may be rejected while the API token rotation still succeeds. */
export function acceptedApiToken(
  sent: DeepPartial<HudConfig>,
  result: ApiConfigResult,
): string | undefined {
  const token = sent.server?.apiToken;
  if (
    token === undefined ||
    token === REDACTED_CONFIG_TOKEN ||
    result.errors.some((error) => error.startsWith('server.apiToken:'))
  )
    return undefined;
  const returned = result.config.server.apiToken;
  return returned === token || returned === REDACTED_CONFIG_TOKEN ? token : undefined;
}
