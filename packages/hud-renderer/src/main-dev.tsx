import { render } from 'preact';
import { createHudApi } from './common/api.ts';
import { DevApp } from './dev/App.tsx';

/**
 * Developer console (`/dev`): live HUD preview over the renderer WebSocket, simulator controls
 * (`/api/sim`), driver inputs, an event log derived from frames, and a fixture gallery that
 * works without a server.
 */
const root = document.getElementById('app');
if (root) render(<DevApp api={createHudApi()} />, root);
