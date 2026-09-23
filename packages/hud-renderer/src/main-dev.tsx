import { render } from 'preact';
import { adoptTokenFromUrl, createHudApi, localStorageTokenStore } from './common/api.ts';
import { DevApp } from './dev/App.tsx';

/**
 * Developer console (`/dev`): live HUD preview over the renderer WebSocket, simulator controls
 * (`/api/sim`), driver inputs, an event log derived from frames, and a fixture gallery that
 * works without a server.
 *
 * Once `server.apiToken` is set, other devices need it: `/dev?token=<api token>` stores it on
 * this device (shared with the settings app), or it can be entered when the HUD refuses.
 */
const root = document.getElementById('app');
if (root) {
  const tokens = localStorageTokenStore();
  adoptTokenFromUrl(tokens);
  render(<DevApp api={createHudApi({ tokens })} />, root);
}
