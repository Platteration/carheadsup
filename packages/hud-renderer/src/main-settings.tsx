import { render } from 'preact';
import { createHudApi, localStorageTokenStore } from './common/api.ts';
import type { TokenStore } from './common/api.ts';
import { SettingsApp } from './settings/App.tsx';

/**
 * Settings app (`/settings`), used from a phone on the car's Wi-Fi (browser or the companion
 * app's WebView) and from desktop browsers.
 *
 * The companion app may open `/settings?token=<api token>`: the token is stored on this device
 * and removed from the address bar so it does not linger in history or screenshots.
 */
function adoptTokenFromUrl(tokens: TokenStore): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (token === null) return;
  tokens.set(token);
  url.searchParams.delete('token');
  try {
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Not fatal: the token is stored either way.
  }
}

const root = document.getElementById('app');
if (root) {
  const tokens = localStorageTokenStore();
  adoptTokenFromUrl(tokens);
  render(<SettingsApp api={createHudApi({ tokens })} />, root);
}
