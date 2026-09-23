// First: must run before any module that builds a zod schema (see the file).
import './settings/zod-setup.ts';
import { render } from 'preact';
import { adoptTokenFromUrl, createHudApi, localStorageTokenStore } from './common/api.ts';
import { SettingsApp } from './settings/App.tsx';

/**
 * Settings app (`/settings`), used from a phone on the car's Wi-Fi (browser or the companion
 * app's WebView) and from desktop browsers.
 *
 * The companion app may open `/settings?token=<api token>`: the token is stored on this device
 * and removed from the address bar so it does not linger in history or screenshots.
 */
const root = document.getElementById('app');
if (root) {
  const tokens = localStorageTokenStore();
  adoptTokenFromUrl(tokens);
  render(<SettingsApp api={createHudApi({ tokens })} />, root);
}
