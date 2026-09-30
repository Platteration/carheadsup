// First: zod's JIT off before core builds its schemas (the no-eval CSP would report its probe).
import './settings/zod-setup.ts';
import { render } from 'preact';
import { DemoApp } from './demo/App.tsx';
import { DemoEngine } from './demo/engine.ts';
import { PREFS_KEY, parsePrefs, prefsConfig } from './demo/model.ts';

/**
 * The drive simulator (`demo.html`, built into one self-contained file by `npm run build:demo`):
 * the whole HUD running in the browser with no server — the server's engine and simulation, the
 * core reducer and composer, and the real HUD view. The drive starts before the first render,
 * so the HUD is live from the first frame.
 */
function readStoredPrefs(): string | null {
  try {
    return localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
}

const root = document.getElementById('app');
if (root) {
  const prefs = parsePrefs(readStoredPrefs());
  const engine = new DemoEngine({ config: prefsConfig(prefs) });
  engine.start();
  render(<DemoApp engine={engine} initialPrefs={prefs} />, root);
}
