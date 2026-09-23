import type { HudFrame } from '@carheadsup/core';
import { render } from 'preact';
import { HudView } from '../../../src/hud/HudView.tsx';

/** Entry of harness.html: exposes `window.renderHud(frame)` to the browser layout test. */

declare global {
  interface Window {
    renderHud?: (frame: HudFrame | null) => void;
  }
}

const root = document.getElementById('app');
if (root) {
  window.renderHud = (frame) => render(<HudView frame={frame} preview />, root);
}
