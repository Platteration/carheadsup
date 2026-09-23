/**
 * Real-layout checks in headless Chromium (skipped when no Chromium is installed; set
 * `PW_CHROMIUM` to point at one). happy-dom has no layout engine, and the property that matters
 * here — every alert banner and collision cue actually visible on the panel, never clipped away
 * by the fixed-height top zone — only exists in a browser.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AlertFrame, HudFrame } from '@carheadsup/core';
import { chromium } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_FRAMES } from '../../../src/hud/fixtures.ts';
import { planAlerts, visibleAlerts } from '../../../src/hud/layout.ts';

function findChromium(): string | null {
  let bundled: string | null = null;
  try {
    bundled = chromium.executablePath();
  } catch {
    bundled = null;
  }
  for (const candidate of [process.env['PW_CHROMIUM'], '/opt/pw-browsers/chromium', bundled]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

const executablePath = findChromium();
const rendererRoot = fileURLToPath(new URL('../../../', import.meta.url));

const PANELS = [
  [800, 480],
  [1024, 600],
  [1280, 480],
  [1920, 720],
] as const;

const critical = (key: string, title: string, detail: string): AlertFrame => ({
  key,
  kind: 'coolant',
  severity: 'critical',
  title,
  detail,
  code: null,
  dismissible: false,
});

const OVERHEAT = critical(
  'coolant',
  'Engine overheating',
  'Coolant 125 °C — stop safely and switch off the engine',
);
const OIL = {
  ...critical(
    'check-engine:P0524',
    'Oil pressure low',
    'Engine Oil Pressure Too Low — stop the engine',
  ),
  kind: 'check-engine' as const,
  code: 'P0524',
};
const MISFIRE: AlertFrame = {
  key: 'check-engine:P0300',
  kind: 'check-engine',
  severity: 'warning',
  title: 'Misfire',
  detail: 'Random/Multiple Cylinder Misfire Detected',
  code: 'P0300',
  dismissible: true,
};
const FUEL: AlertFrame = {
  key: 'fuel-low',
  kind: 'fuel-low',
  severity: 'caution',
  title: 'Fuel low',
  detail: 'About 40 km left',
  code: null,
  dismissible: true,
};
const TYRE: AlertFrame = {
  key: 'tpms',
  kind: 'tpms',
  severity: 'warning',
  title: 'Tyre pressure',
  detail: 'Rear left 165 kPa',
  code: null,
  dismissible: true,
};

const BASE = SAMPLE_FRAMES['highway-exit-lanes']!;

const SCENES: Record<string, HudFrame> = {
  'two critical alerts': { ...BASE, alerts: [OVERHEAT, OIL] },
  'collision warning and two critical alerts': {
    ...BASE,
    collision: 'warning',
    alerts: [OVERHEAT, OIL],
  },
  'three alerts (maxAlerts 3) with a collision caution': {
    ...BASE,
    collision: 'caution',
    alerts: [OVERHEAT, OIL, MISFIRE],
  },
  'five alerts (maxAlerts 5) with a collision warning': {
    ...BASE,
    collision: 'warning',
    alerts: [OVERHEAT, OIL, MISFIRE, TYRE, FUEL],
  },
  'blanked with a collision warning and two critical alerts': {
    ...BASE,
    blanked: true,
    widgets: [],
    collision: 'warning',
    alerts: [OVERHEAT, OIL],
  },
};

let server: ViteDevServer | null = null;
let browser: Browser | null = null;
let base = '';

beforeAll(async () => {
  if (executablePath === null) return;
  server = await createServer({
    root: rendererRoot,
    configFile: `${rendererRoot}vite.config.ts`,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  base = server.resolvedUrls?.local[0] ?? '';
  browser = await chromium.launch({ executablePath });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

interface Blocked {
  what: string;
  why: string;
}

/** Every cue, banner and "+N more" line that is not fully on screen and unobstructed. */
function hiddenLeadItems(page: Page): Promise<Blocked[]> {
  return page.evaluate(() => {
    const out: Array<{ what: string; why: string }> = [];
    const items = document.querySelectorAll<HTMLElement>(
      '.hud-collision, .hud-alert, .hud-alert-more',
    );
    for (const el of items) {
      const what = el.dataset.alert ?? el.dataset.collision ?? el.className;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) {
        out.push({ what, why: 'not laid out' });
        continue;
      }
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) {
        out.push({ what, why: `off screen ${JSON.stringify(r)}` });
        continue;
      }
      // Probe just inside the middle of each edge (clear of the rounded corners) and the centre:
      // anything else on top, or a clipping ancestor hiding part of the element, makes
      // elementFromPoint return a different element.
      const inset = 3;
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const points: Array<[number, number]> = [
        [cx, r.top + inset],
        [cx, r.bottom - inset],
        [r.left + inset, cy],
        [r.right - inset, cy],
        [cx, cy],
      ];
      for (const [x, y] of points) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) {
          out.push({
            what,
            why: `covered at ${Math.round(x)},${Math.round(y)} by ${hit?.className}`,
          });
          break;
        }
      }
    }
    return out;
  });
}

describe.skipIf(executablePath === null)('HUD layout in Chromium', () => {
  for (const [width, height] of PANELS) {
    it(`never hides a collision cue or an alert at ${width}×${height}`, async () => {
      const page = await browser!.newPage({ viewport: { width, height } });
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      try {
        await page.goto(`${base}test/hud/browser/harness.html`);
        await page.waitForFunction(() => typeof window.renderHud === 'function');
        await page.evaluate(() => document.fonts.ready);
        for (const [name, frame] of Object.entries(SCENES)) {
          await page.evaluate((f) => window.renderHud!(f), frame);
          await page.waitForSelector('.hud-content[data-mode]');
          const plan = planAlerts(visibleAlerts(frame));
          const expected =
            (frame.collision === 'none' ? 0 : 1) + plan.shown.length + (plan.more > 0 ? 1 : 0);
          const drawn = await page.locator('.hud-collision, .hud-alert, .hud-alert-more').count();
          expect(drawn, name).toBe(expected);
          expect(await hiddenLeadItems(page), name).toEqual([]);
        }
        // With the usual two alerts the speed stays readable below them.
        await page.evaluate((f) => window.renderHud!(f), SCENES['two critical alerts']!);
        const speed = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('.hud-speed__value');
          if (!el) return 'missing';
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
          return hit !== null && el.contains(hit) ? 'visible' : `covered by ${hit?.className}`;
        });
        expect(speed).toBe('visible');
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    }, 30_000);
  }
});
