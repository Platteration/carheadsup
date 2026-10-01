/**
 * Daylight readability of the cues that matter most, checked on the real styles in headless
 * Chromium (skipped without one, see `chromium.ts`): by day the over-limit speed keeps a
 * primary-coloured outline around its red digits (the red alone has about a quarter of the
 * white's luminance on the glass), and blinking cues dip only to half opacity. At night the red
 * is plain and blinks dip deeper.
 */
import type { AlertFrame, HudFrame, SpeedWidget } from '@carheadsup/core';
import type { Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_FRAMES } from '../../../src/hud/fixtures.ts';
import { executablePath, startHarness, type Harness } from './chromium.ts';

const OVER_LIMIT: SpeedWidget = {
  id: 'speed',
  zone: 'center',
  value: 138,
  unit: 'km/h',
  overLimit: true,
  overBy: 18,
};

const OVERHEAT: AlertFrame = {
  key: 'coolant',
  kind: 'coolant',
  severity: 'critical',
  title: 'Engine overheating',
  detail: 'Coolant 125 °C',
  code: null,
  dismissible: false,
};

function scene(night: boolean): HudFrame {
  const base = SAMPLE_FRAMES['highway-cruise']!;
  return {
    ...base,
    theme: { night, brightness: 1 },
    widgets: base.widgets.map((w) => (w.id === 'speed' ? OVER_LIMIT : w)),
    alerts: [OVERHEAT],
  };
}

let harness: Harness | null = null;

beforeAll(async () => {
  if (executablePath === null) return;
  harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

interface Styles {
  strokeWidth: number;
  strokeColor: string;
  primary: string;
  paintOrder: string;
  fill: string;
  /** Opacity of the critical banner frozen in the dim half of its blink. */
  blinkFloor: number;
}

async function measure(page: Page, frame: HudFrame): Promise<Styles> {
  await page.evaluate((f) => window.renderHud!(f), frame);
  await page.waitForSelector('.hud-speed--over .hud-speed__value');
  await page.waitForSelector('.hud-alert.hud-flash');
  return page.evaluate(() => {
    const digits = document.querySelector<HTMLElement>('.hud-speed--over .hud-speed__value')!;
    const banner = document.querySelector<HTMLElement>('.hud-alert.hud-flash')!;
    const style = getComputedStyle(digits);
    // A probe element resolves the palette's primary colour to the same rgb() notation.
    const probe = document.createElement('span');
    probe.style.color = 'var(--c-primary)';
    digits.parentElement!.appendChild(probe);
    const primary = getComputedStyle(probe).color;
    probe.remove();
    const blink = banner.getAnimations()[0];
    if (blink === undefined) throw new Error('the critical banner does not blink');
    blink.pause();
    // 1 s step-end cycle: the dim half runs from 500 to 1000 ms.
    blink.currentTime = 750 - (Number(blink.effect?.getTiming().delay) || 0);
    const blinkFloor = Number(getComputedStyle(banner).opacity);
    return {
      strokeWidth: Number.parseFloat(style.webkitTextStrokeWidth),
      strokeColor: style.webkitTextStrokeColor,
      primary,
      paintOrder: style.paintOrder,
      fill: style.color,
      blinkFloor,
    };
  });
}

describe.skipIf(executablePath === null)('HUD readability in Chromium', () => {
  it('outlines over-limit digits by day and keeps blinks at half opacity', async () => {
    const page = await harness!.browser.newPage({ viewport: { width: 1280, height: 480 } });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await page.goto(harness!.url);
      await page.waitForFunction(() => typeof window.renderHud === 'function');

      const day = await measure(page, scene(false));
      // Red fill, primary outline painted underneath: about 2–4 px of outline on 480–720 px panels.
      expect(day.fill).toBe('rgb(255, 59, 48)');
      expect(day.strokeColor).toBe(day.primary);
      expect(day.strokeWidth).toBeGreaterThanOrEqual(4);
      // `stroke fill` (then markers), as Chromium serialises it: the stroke under the fill.
      expect(day.paintOrder).toBe('stroke');
      expect(day.blinkFloor).toBeCloseTo(0.5, 5);

      const night = await measure(page, scene(true));
      expect(night.strokeWidth).toBe(0);
      expect(night.blinkFloor).toBeCloseTo(0.22, 5);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30_000);
});
