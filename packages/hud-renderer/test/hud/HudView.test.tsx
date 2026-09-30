import type { AlertFrame, HudFrame, ProjectionConfig, WidgetFrame } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
import { renderHud, textOf } from './render.ts';

const CITY = SAMPLE_FRAMES['city-nav']!;
const PARKED = SAMPLE_FRAMES['parked-trouble-codes']!;

function withFrame(base: HudFrame, patch: Partial<HudFrame>): HudFrame {
  return { ...base, ...patch };
}

const CRITICAL: AlertFrame = {
  key: 'coolant',
  kind: 'coolant',
  severity: 'critical',
  title: 'Engine overheating',
  detail: 'Coolant 121 °C',
  code: null,
  dismissible: false,
};

const CAUTION: AlertFrame = {
  key: 'fuel-low',
  kind: 'fuel-low',
  severity: 'caution',
  title: 'Fuel low',
  detail: '38 km range',
  code: null,
  dismissible: true,
};

const MIRROR: ProjectionConfig = {
  mirrorX: true,
  mirrorY: false,
  rotation: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  corners: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] },
  showGrid: false,
};

describe('HudView — no signal', () => {
  it('shows only the tiny no-signal dot without a frame', () => {
    const html = renderHud(null);
    expect(html).toContain('data-no-signal="true"');
    expect(html).toContain('data-mode="no-signal"');
    expect(textOf(html)).toBe('');
    expect(html).not.toContain('hud-w');
    expect(html).not.toContain('hud-status');
  });
});

describe('HudView — speed', () => {
  it('turns the speed red with a +N badge when over the limit', () => {
    const html = renderHud(SAMPLE_FRAMES.overspeed!);
    expect(html).toMatch(/class="[^"]*hud-speed--over/);
    expect(html).toContain('hud-speed__over');
    expect(textOf(html)).toContain('+14');
  });

  it('keeps the normal colour and no badge at or under the limit', () => {
    const html = renderHud(CITY);
    expect(html).not.toContain('hud-speed--over');
    expect(html).not.toContain('hud-speed__over');
  });

  it('shows red without a badge when the excess is unknown', () => {
    const widgets: WidgetFrame[] = [
      { id: 'speed', zone: 'center', value: 70, unit: 'km/h', overLimit: true, overBy: null },
    ];
    const html = renderHud(withFrame(CITY, { widgets }));
    expect(html).toContain('hud-speed--over');
    expect(html).not.toContain('hud-speed__over');
  });
});

describe('HudView — layout', () => {
  it('draws the nine zones and stacks widgets in frame order', () => {
    const html = renderHud(CITY);
    expect(html.match(/data-zone="/g)).toHaveLength(9);
    const topLeft = html.slice(
      html.indexOf('data-zone="top-left"'),
      html.indexOf('data-zone="top"'),
    );
    expect(topLeft.indexOf('data-widget="nav"')).toBeLessThan(topLeft.indexOf('data-widget="eta"'));
  });

  it('puts alerts (after any collision cue) at the top centre and call/toast at the bottom', () => {
    const frame = withFrame(SAMPLE_FRAMES['incoming-call']!, {
      alerts: [CAUTION],
      collision: 'caution',
      toast: { kind: 'info', title: 'Trip saved', subtitle: null, opacity: 1 },
    });
    const html = renderHud(frame);
    const top = html.slice(html.indexOf('data-zone="top"'), html.indexOf('data-zone="top-right"'));
    expect(top.indexOf('data-collision="caution"')).toBeGreaterThan(-1);
    expect(top.indexOf('data-collision')).toBeLessThan(top.indexOf('data-alert="fuel-low"'));
    const bottom = html.slice(
      html.indexOf('data-zone="bottom"'),
      html.indexOf('data-zone="bottom-right"'),
    );
    expect(bottom).toContain('data-call="ringing"');
    expect(bottom).toContain('data-toast="info"');
    expect(bottom.indexOf('data-call')).toBeLessThan(bottom.indexOf('data-toast'));
  });

  it('keeps the cue and every banner in one lead block, compacted when there are several', () => {
    const one = renderHud(withFrame(CITY, { alerts: [CAUTION] }));
    expect(one).toContain('class="hud-lead" data-lead="true"');
    const several = renderHud(
      withFrame(CITY, {
        collision: 'warning',
        alerts: [CRITICAL, { ...CRITICAL, key: 'oil', title: 'Oil pressure low' }],
      }),
    );
    const lead = several.slice(several.indexOf('class="hud-lead hud-lead--compact"'));
    expect(lead.indexOf('data-collision="warning"')).toBeGreaterThan(-1);
    expect(lead.match(/data-alert="/g)).toHaveLength(2);
    expect(renderHud(CITY)).not.toContain('hud-lead');
  });

  it('summarises lower-priority alerts beyond three banners but never drops a critical one', () => {
    const alerts = [
      CRITICAL,
      { ...CRITICAL, key: 'oil' },
      { ...CRITICAL, key: 'brakes' },
      { ...CRITICAL, key: 'charging' },
      CAUTION,
      { ...CAUTION, key: 'washer' },
    ];
    const html = renderHud(withFrame(CITY, { alerts }));
    expect(html.match(/data-severity="critical"/g)).toHaveLength(4);
    expect(html).not.toContain('data-alert="fuel-low"');
    expect(html).toContain('data-alerts-more="2"');
    expect(textOf(html)).toContain('+2 more');
  });

  it('shows the status icons with the simulator badge only when simulated', () => {
    expect(textOf(renderHud(CITY))).not.toContain('SIM');
    const sim = renderHud(
      withFrame(CITY, { status: { obd: 'error', phone: false, simulated: true } }),
    );
    expect(textOf(sim)).toContain('SIM');
    expect(sim).toContain('hud-status__obd--error');
    expect(sim).toContain('data-glyph="phone-off"');
  });

  it('draws the shift light with the lit segment count', () => {
    const html = renderHud(withFrame(CITY, { shiftLight: { level: 0.5, flash: false } }));
    expect(html).toContain('data-lit="6"');
    expect(html).not.toContain('hud-shift--flash');
    const flash = renderHud(withFrame(CITY, { shiftLight: { level: 1, flash: true } }));
    expect(flash).toContain('hud-shift--flash');
    expect(flash.match(/hud-shift__seg--red hud-shift__seg--lit/g)).toHaveLength(12);
  });

  it('draws blind-spot bars on the requested sides', () => {
    const both = renderHud(withFrame(CITY, { blindSpot: { left: true, right: true } }));
    expect(both).toContain('data-blindspot="left"');
    expect(both).toContain('data-blindspot="right"');
    expect(renderHud(CITY)).not.toContain('data-blindspot');
  });
});

describe('HudView — theme', () => {
  it('applies brightness as a CSS filter, never below 5 %', () => {
    expect(renderHud(withFrame(CITY, { theme: { night: false, brightness: 0.4 } }))).toContain(
      'filter:brightness(0.4)',
    );
    expect(renderHud(withFrame(CITY, { theme: { night: false, brightness: 0.001 } }))).toContain(
      'filter:brightness(0.05)',
    );
    expect(renderHud(withFrame(CITY, { theme: { night: false, brightness: -2 } }))).toContain(
      'filter:brightness(0.05)',
    );
  });

  it('leaves dimming to the backlight when the server drives one (no double dimming)', () => {
    const dim = withFrame(CITY, { theme: { night: true, brightness: 0.3 } });
    const html = renderHud(dim, { hardwareBrightness: true });
    expect(html).not.toContain('filter:');
    expect(html).toContain('data-brightness="1"');
    expect(html).toContain('hud--night'); // the palette still follows the frame
    expect(renderHud(dim, { hardwareBrightness: false })).toContain('filter:brightness(0.3)');
  });

  it('omits the filter at full brightness and for invalid values', () => {
    expect(renderHud(withFrame(CITY, { theme: { night: false, brightness: 1 } }))).not.toContain(
      'filter:',
    );
    expect(renderHud(withFrame(CITY, { theme: { night: false, brightness: 7 } }))).not.toContain(
      'filter:',
    );
    expect(
      renderHud(withFrame(CITY, { theme: { night: false, brightness: Number.NaN } })),
    ).not.toContain('filter:');
  });

  it('switches to the night palette', () => {
    expect(renderHud(withFrame(CITY, { theme: { night: true, brightness: 0.3 } }))).toMatch(
      /class="hud hud--night/,
    );
    expect(renderHud(CITY)).not.toContain('hud--night');
  });
});

describe('HudView — blanked', () => {
  const blanked = SAMPLE_FRAMES.blanked!;

  it('hides widgets, calls and toasts behind a tiny indicator', () => {
    const html = renderHud(
      withFrame(blanked, {
        // The composer withholds widgets while blanked; the view must not rely on it.
        widgets: CITY.widgets,
        call: {
          state: 'ringing',
          name: 'Maria',
          number: null,
          durationS: null,
          canAccept: true,
          canDecline: true,
        },
        toast: { kind: 'media', title: 'Song', subtitle: 'Artist', opacity: 1 },
        shiftLight: { level: 1, flash: true },
        alerts: [CAUTION],
      }),
    );
    expect(html).toContain('data-blanked="true"');
    expect(html).not.toContain('data-widget');
    expect(html).not.toContain('data-call');
    expect(html).not.toContain('data-toast');
    expect(html).not.toContain('hud-shift');
    expect(html).not.toContain('data-alert');
    expect(textOf(html)).toBe('');
  });

  it('still shows critical alerts, collision warnings and blind-spot glows', () => {
    const html = renderHud(
      withFrame(blanked, {
        alerts: [CRITICAL, CAUTION],
        collision: 'warning',
        blindSpot: { left: false, right: true },
      }),
    );
    expect(html).toContain('data-alert="coolant"');
    expect(html).not.toContain('data-alert="fuel-low"');
    expect(html).toContain('BRAKE');
    expect(html).toContain('hud-collision-border');
    expect(html).toContain('data-blindspot="right"');
  });
});

describe('HudView — diagnostics', () => {
  it('replaces the widget grid with the dashboard', () => {
    const html = renderHud(withFrame(PARKED, { widgets: CITY.widgets }));
    expect(html).toContain('data-mode="diagnostics"');
    expect(html).not.toContain('data-zone=');
    expect(html).not.toContain('data-widget');
  });

  it('shows page dots with the current page', () => {
    const html = renderHud(PARKED);
    expect(html.match(/class="hud-diag__dot[ "]/g)).toHaveLength(8);
    expect(html.match(/hud-diag__dot--current/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Page 5 of 8"');
  });

  it('keeps alerts, calls and ADAS cues visible over the dashboard', () => {
    const html = renderHud(
      withFrame(PARKED, {
        alerts: [CRITICAL],
        call: {
          state: 'ringing',
          name: 'Maria',
          number: null,
          durationS: null,
          canAccept: true,
          canDecline: true,
        },
        collision: 'caution',
      }),
    );
    expect(html).toContain('data-alert="coolant"');
    expect(html).toContain('data-call="ringing"');
    expect(html).toContain('data-collision="caution"');
  });
});

describe('HudView — projection', () => {
  it('draws untransformed without a projection or with an identity one', () => {
    expect(renderHud(CITY)).not.toContain('data-projection');
    expect(renderHud(CITY, { projection: { ...MIRROR, mirrorX: false } })).not.toContain(
      'data-projection',
    );
  });

  it('keeps a transformed stage hidden until the screen is measured', () => {
    const html = renderHud(CITY, { projection: MIRROR });
    expect(html).toContain('data-projection="pending"');
    expect(html).toContain('visibility:hidden');
  });

  it('ignores mirroring and keystone in preview mode', () => {
    const html = renderHud(CITY, { projection: MIRROR, preview: true });
    expect(html).not.toContain('data-projection');
    expect(html).toContain('hud--preview');
    expect(textOf(html)).toContain('Rosenheimer');
  });

  it('draws the alignment grid instead of the widgets while standing still', () => {
    const grid = { projection: { ...MIRROR, showGrid: true }, preview: true };
    for (const context of ['parked', 'stopped'] as const) {
      const html = renderHud(withFrame(CITY, { context }), grid);
      expect(html, context).toContain('data-alignment-grid="true"');
      expect(html, context).not.toContain('data-widget');
      expect(textOf(html), context).toBe('TL TR BR BL');
    }
    // Also without a frame: calibration does not need live data.
    expect(renderHud(null, { projection: { ...MIRROR, showGrid: true } })).toContain(
      'data-alignment-grid',
    );
  });

  it('never lets the grid hide the HUD of a moving car', () => {
    const highway = withFrame(SAMPLE_FRAMES['highway-cruise']!, {
      collision: 'warning',
      alerts: [CRITICAL, { ...CRITICAL, key: 'voltage', title: 'Charging fault' }, CAUTION],
    });
    for (const frame of [CITY, highway]) {
      const html = renderHud(frame, { projection: { ...MIRROR, showGrid: true } });
      expect(html, frame.context).not.toContain('data-alignment-grid');
      expect(html, frame.context).toContain('data-widget="speed"');
    }
    const html = renderHud(highway, { projection: { ...MIRROR, showGrid: true } });
    expect(html).toContain('data-collision="warning"');
    expect(html).toContain('hud-collision-border');
    expect(html.match(/data-alert="/g)).toHaveLength(3);
  });

  it('keeps safety cues and alerts drawn over the grid', () => {
    const html = renderHud(
      withFrame(CITY, {
        context: 'stopped',
        collision: 'warning',
        blindSpot: { left: true, right: false },
        alerts: [CRITICAL, CAUTION],
      }),
      { projection: { ...MIRROR, showGrid: true }, preview: true },
    );
    expect(html).toContain('data-alignment-grid="true"');
    expect(html).toContain('data-mode="calibration"');
    expect(html).toContain('data-collision="warning"');
    expect(html).toContain('hud-collision-border');
    expect(html).toContain('data-blindspot="left"');
    expect(html).toContain('data-alert="coolant"');
    expect(html).toContain('data-alert="fuel-low"');
    expect(html).not.toContain('data-widget');
  });

  it('passes a class name through', () => {
    expect(renderHud(CITY).startsWith('<div class="hud"')).toBe(true);
    expect(renderHud(CITY, { className: 'gallery-tile' })).toMatch(
      /^<div class="hud gallery-tile"/,
    );
  });
});
