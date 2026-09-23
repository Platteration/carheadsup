import type { HudFrame, WidgetFrame } from '@carheadsup/core';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { Widget } from '../../src/hud/widgets/index.tsx';
import { redZoneStart, tachTicks } from '../../src/hud/widgets/Tachometer.tsx';
import { pngDataUrl } from '../../src/hud/widgets/Nav.tsx';
import { tripStats } from '../../src/hud/widgets/TripSummary.tsx';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
import { textOf } from './render.ts';

const render = (w: WidgetFrame) => renderToString(<Widget w={w} />);

describe('speed', () => {
  it('shows the value and unit, and 0 when stopped', () => {
    const html = render({
      id: 'speed',
      zone: 'center',
      value: 0,
      unit: 'mph',
      overLimit: false,
      overBy: null,
    });
    expect(textOf(html)).toBe('0 mph');
  });

  it('never shows a negative badge', () => {
    const html = render({
      id: 'speed',
      zone: 'center',
      value: 50,
      unit: 'km/h',
      overLimit: true,
      overBy: 0,
    });
    expect(html).not.toContain('hud-speed__over');
  });
});

describe('speed limit', () => {
  it('draws a Vienna ring with the numerals and no fill', () => {
    const html = render({
      id: 'speedLimit',
      zone: 'right',
      value: 80,
      unlimited: false,
      unit: 'km/h',
      style: 'vienna',
    });
    expect(html).toContain('hud-sign--vienna');
    expect(html).toContain('fill="none"');
    expect(textOf(html)).toBe('80');
  });

  it('shrinks three-digit numerals to fit the ring', () => {
    const two = render({
      id: 'speedLimit',
      zone: 'right',
      value: 80,
      unlimited: false,
      unit: 'km/h',
      style: 'vienna',
    });
    const three = render({
      id: 'speedLimit',
      zone: 'right',
      value: 130,
      unlimited: false,
      unit: 'km/h',
      style: 'vienna',
    });
    expect(two).toContain('font-size="44"');
    expect(three).toContain('font-size="34"');
  });

  it('draws the MUTCD rectangle with its legend', () => {
    const html = render({
      id: 'speedLimit',
      zone: 'right',
      value: 65,
      unlimited: false,
      unit: 'mph',
      style: 'mutcd',
    });
    expect(html).toContain('hud-sign--mutcd');
    expect(textOf(html)).toBe('SPEED LIMIT 65');
  });

  it('draws the end-of-restrictions sign for unlimited roads in either style', () => {
    for (const style of ['vienna', 'mutcd'] as const) {
      const html = render({
        id: 'speedLimit',
        zone: 'right',
        value: null,
        unlimited: true,
        unit: 'km/h',
        style,
      });
      expect(html).toContain('hud-sign--unlimited');
      expect(textOf(html)).toBe('');
    }
  });

  it('draws nothing when the limit is unknown', () => {
    expect(
      render({
        id: 'speedLimit',
        zone: 'right',
        value: null,
        unlimited: false,
        unit: 'km/h',
        style: 'vienna',
      }),
    ).toBe('');
  });
});

describe('tachometer', () => {
  it('puts the red zone in the last 1 000 rpm within sane bounds', () => {
    expect(redZoneStart(6500)).toBeCloseTo(1 - 1000 / 6500);
    expect(redZoneStart(2000)).toBe(0.7);
    expect(redZoneStart(30000)).toBe(0.95);
    expect(redZoneStart(0)).toBe(0.9);
    expect(redZoneStart(Number.NaN)).toBe(0.9);
  });

  it('ticks every 1 000 rpm below the redline', () => {
    expect(tachTicks(6500).map((t) => Math.round(t * 6500))).toEqual([
      1000, 2000, 3000, 4000, 5000, 6000,
    ]);
    expect(tachTicks(900)).toEqual([]);
    expect(tachTicks(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('turns red inside the zone and clamps the fill', () => {
    const low = render({
      id: 'tachometer',
      zone: 'bottom',
      rpm: 2500,
      fraction: 2500 / 6500,
      redlineRpm: 6500,
    });
    expect(low).not.toContain('hud-tach--red');
    const over = render({
      id: 'tachometer',
      zone: 'bottom',
      rpm: 7200,
      fraction: 1.4,
      redlineRpm: 6500,
    });
    expect(over).toContain('hud-tach--red');
    expect(over).toContain('width:100%');
    expect(textOf(over)).toBe('7200 rpm');
  });
});

describe('gear', () => {
  it('shows reverse in amber and marks inferred gears', () => {
    expect(render({ id: 'gear', zone: 'left', gear: 'r', inferred: false })).toContain(
      'hud-tone--caution',
    );
    const inferred = render({ id: 'gear', zone: 'left', gear: '3', inferred: true });
    expect(inferred).toContain('hud-gear--inferred');
    expect(inferred).toContain('aria-label="Gear 3 (estimated)"');
  });

  it('handles two-character and empty gears', () => {
    expect(render({ id: 'gear', zone: 'left', gear: '10', inferred: false })).toContain(
      'hud-gear--wide',
    );
    expect(textOf(render({ id: 'gear', zone: 'left', gear: ' ', inferred: false }))).toBe('–');
  });
});

describe('nav', () => {
  const base = {
    id: 'nav' as const,
    zone: 'top-left' as const,
    maneuver: { type: 'unknown' as const },
    distance: { value: 1.2, unit: 'km' as const, text: '1.2 km' },
    street: null,
    then: null,
    iconPng: null,
    imminent: false,
    approach: null,
  };

  it('uses the phone app icon only for unknown maneuvers', () => {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    expect(render({ ...base, iconPng: png })).toContain(`src="data:image/png;base64,${png}"`);
    const known = render({ ...base, maneuver: { type: 'left' }, iconPng: png });
    expect(known).not.toContain('<img');
    expect(known).toContain('data-maneuver="left"');
  });

  it('falls back to the drawn icon when the PNG is not plain base64', () => {
    const html = render({ ...base, iconPng: 'javascript:alert(1)' });
    expect(html).not.toContain('<img');
    expect(html).toContain('data-maneuver="unknown"');
  });

  it('splits the distance so the unit is typeset smaller', () => {
    const html = render(base);
    expect(html).toMatch(/<span class="hud-num">1.2<\/span><span class="hud-unit">km<\/span>/);
  });

  it('shows the approach bar and imminent styling only during the approach', () => {
    expect(render(base)).not.toContain('hud-nav__approach');
    const near = render({ ...base, imminent: true, approach: 0.25 });
    expect(near).toContain('hud-nav--imminent');
    expect(near).toContain('width:25%');
  });

  it('shows the street and the follow-up maneuver when present', () => {
    const html = render({ ...base, street: 'Main St', then: { type: 'right' } });
    expect(textOf(html)).toContain('Main St');
    expect(html).toContain('hud-nav__then-icon');
  });

  it('survives a missing distance', () => {
    expect(render({ ...base, distance: null })).not.toContain('hud-nav__distance');
  });
});

describe('pngDataUrl', () => {
  it('accepts base64 (tolerating line breaks) and rejects anything else', () => {
    expect(pngDataUrl('QUJD\nRA==')).toBe('data:image/png;base64,QUJDRA==');
    expect(pngDataUrl(null)).toBeNull();
    expect(pngDataUrl('')).toBeNull();
    expect(pngDataUrl('data:image/png;base64,QUJD')).toBeNull();
    expect(pngDataUrl('"><script>')).toBeNull();
  });
});

describe('lanes', () => {
  it('marks recommended lanes and draws nothing without lanes', () => {
    const html = render({
      id: 'lanes',
      zone: 'top',
      lanes: [
        { directions: ['left'], recommended: false },
        { directions: ['straight'], recommended: true },
        { directions: ['straight', 'right'], recommended: true, activeDirection: 'straight' },
      ],
    });
    expect(html.match(/hud-lane--recommended/g)).toHaveLength(2);
    expect(html).toContain('--lanes:3');
    expect(render({ id: 'lanes', zone: 'top', lanes: [] })).toBe('');
  });
});

describe('eta', () => {
  const eta = {
    id: 'eta' as const,
    zone: 'top-left' as const,
    etaEpochMs: new Date(2026, 4, 14, 14, 5).getTime(),
    clock: '12h' as const,
    remainingMinutes: 75,
    remainingDistance: { value: 88, unit: 'mi' as const, text: '88 mi' },
  };

  it('shows the arrival time in the configured format and what remains', () => {
    expect(textOf(render(eta))).toBe('ETA 2:05 PM 1 h 15 min · 88 mi');
    expect(textOf(render({ ...eta, clock: '24h' }))).toContain('14:05');
  });

  it('degrades gracefully when parts are unknown', () => {
    expect(textOf(render({ ...eta, etaEpochMs: null }))).toBe('1 h 15 min · 88 mi');
    expect(textOf(render({ ...eta, remainingMinutes: null, remainingDistance: null }))).toBe(
      'ETA 2:05 PM',
    );
    expect(
      render({ ...eta, etaEpochMs: null, remainingMinutes: null, remainingDistance: null }),
    ).toBe('');
  });
});

describe('hazard', () => {
  const camera = {
    id: 'hazard' as const,
    zone: 'top-right' as const,
    type: 'speed-camera' as const,
    distance: { value: 300, unit: 'm' as const, text: '300 m' },
    speedLimit: 50,
    limitStyle: 'vienna' as const,
    delayMinutes: null,
    label: 'Speed camera',
  };

  it('shows the enforced limit in the frame’s sign style', () => {
    expect(render(camera)).toContain('hud-sign--vienna');
    expect(render({ ...camera, limitStyle: 'mutcd' })).toContain('hud-sign--mutcd');
    expect(textOf(render({ ...camera, limitStyle: 'mutcd' }))).toContain('50');
  });

  it('falls back to the ring sign for an unknown style from a newer server', () => {
    const odd = { ...camera, limitStyle: 'hexagon' } as unknown as WidgetFrame;
    expect(render(odd)).toContain('hud-sign--vienna');
  });

  it('shows the delay for traffic and nothing extra otherwise', () => {
    const jam = render({
      ...camera,
      type: 'traffic-jam',
      speedLimit: null,
      delayMinutes: 12.4,
      label: 'Traffic jam',
    });
    expect(textOf(jam)).toBe('300 m Traffic jam +12 min');
    const plain = render({ ...camera, type: 'accident', speedLimit: null, label: 'Accident' });
    expect(plain).not.toContain('hud-sign');
    expect(plain).toContain('data-glyph="accident"');
  });

  it('uses its own limit style in the HUD, even without a speed-limit widget', async () => {
    const { renderHud } = await import('./render.ts');
    const base = SAMPLE_FRAMES['imperial-us']!;
    const frame: HudFrame = {
      ...base,
      widgets: [
        ...base.widgets.filter((w) => w.id !== 'speedLimit'),
        { ...camera, limitStyle: 'mutcd' },
      ],
    };
    const html = renderHud(frame);
    const hazard = html.slice(html.indexOf('data-widget="hazard"'));
    expect(hazard).toContain('hud-sign--mutcd');
    // …and it is not taken from the speed-limit widget either.
    const mixed = renderHud({ ...base, widgets: [...base.widgets, camera] });
    expect(mixed.slice(mixed.indexOf('data-widget="hazard"'))).toContain('hud-sign--vienna');
  });
});

describe('fuel', () => {
  const fuel = {
    id: 'fuel' as const,
    zone: 'left' as const,
    instant: 5.25,
    average: 6.9,
    unit: 'L/100km' as const,
    range: 512,
    rangeUnit: 'km' as const,
    levelPct: 71,
    low: false,
  };

  it('shows instant economy with the trip average, range and level', () => {
    const html = render(fuel);
    expect(textOf(html)).toBe('5.3 L/100 km avg 6.9 · 512 km');
    expect(html).toContain('width:71%');
  });

  it('falls back to the average while stationary', () => {
    expect(textOf(render({ ...fuel, instant: null }))).toBe('6.9 L/100 km 512 km');
  });

  it('turns amber when low and labels mpg', () => {
    const html = render({ ...fuel, low: true, unit: 'mpg-uk', levelPct: 8 });
    expect(html).toContain('hud-tone--caution');
    expect(textOf(html)).toContain('mpg');
  });

  it('renders nothing with no data at all', () => {
    expect(render({ ...fuel, instant: null, average: null, range: null, levelPct: null })).toBe('');
  });
});

describe('small readings', () => {
  it('coolant is amber when hot and red when critical', () => {
    expect(
      render({ id: 'coolant', zone: 'bottom-left', value: 112, unit: '°C', status: 'hot' }),
    ).toContain('hud-tone--caution');
    expect(
      render({ id: 'coolant', zone: 'bottom-left', value: 245, unit: '°F', status: 'critical' }),
    ).toContain('hud-tone--critical');
  });

  it('voltage shows one decimal', () => {
    expect(
      textOf(render({ id: 'voltage', zone: 'bottom-left', value: 15.6, status: 'high' })),
    ).toBe('15.6 V');
    expect(textOf(render({ id: 'voltage', zone: 'bottom-left', value: 12, status: 'low' }))).toBe(
      '12.0 V',
    );
  });

  it('outside temperature adds a snowflake on ice risk', () => {
    const cold = render({
      id: 'outsideTemp',
      zone: 'bottom-right',
      value: -1,
      unit: '°C',
      iceRisk: true,
    });
    expect(cold).toContain('data-glyph="snowflake"');
    expect(textOf(cold)).toBe('\u22121 °C');
    expect(
      render({ id: 'outsideTemp', zone: 'bottom-right', value: 20, unit: '°C', iceRisk: false }),
    ).not.toContain('snowflake');
  });

  it('clock follows its format', () => {
    const at = new Date(2026, 0, 2, 7, 3).getTime();
    expect(textOf(render({ id: 'clock', zone: 'bottom-right', epochMs: at, format: '24h' }))).toBe(
      '07:03',
    );
    expect(textOf(render({ id: 'clock', zone: 'bottom-right', epochMs: at, format: '12h' }))).toBe(
      '7:03 AM',
    );
    expect(render({ id: 'clock', zone: 'bottom-right', epochMs: Number.NaN, format: '24h' })).toBe(
      '',
    );
  });

  it('tpms shows missing readings as a dash and flags low tyres', () => {
    const html = render({
      id: 'tpms',
      zone: 'right',
      unit: 'psi',
      fl: { value: 33, low: false },
      fr: { value: null, low: false },
      rl: { value: 24, low: true },
      rr: { value: 32, low: false },
      anyLow: true,
    });
    expect(textOf(html)).toBe('33 – 24 32 psi');
    expect(html.match(/hud-tpms__value--low/g)).toHaveLength(1);
    expect(html.match(/hud-tpms__wheel--low/g)).toHaveLength(1);
  });
});

describe('media', () => {
  it('shows title and artist with a pause mark when paused', () => {
    const html = render({
      id: 'media',
      zone: 'bottom',
      title: 'Song',
      artist: 'Band',
      playing: false,
    });
    expect(textOf(html)).toBe('Song Band');
    expect(html).toContain('data-glyph="pause"');
    expect(
      render({ id: 'media', zone: 'bottom', title: 'Song', artist: null, playing: true }),
    ).toContain('data-glyph="music"');
  });

  it('renders nothing without metadata', () => {
    expect(render({ id: 'media', zone: 'bottom', title: null, artist: null, playing: true })).toBe(
      '',
    );
  });
});

describe('boost', () => {
  it('signs the value and dims vacuum', () => {
    expect(
      textOf(
        render({ id: 'boost', zone: 'bottom-right', value: 0.92, unit: 'bar', fraction: 0.7 }),
      ),
    ).toBe('Boost +0.92 bar');
    const vacuum = render({
      id: 'boost',
      zone: 'bottom-right',
      value: -8.5,
      unit: 'psi',
      fraction: 0.1,
    });
    expect(vacuum).toContain('hud-boost--vacuum');
    expect(textOf(vacuum)).toBe('Boost \u22128.5 psi');
    expect(
      textOf(render({ id: 'boost', zone: 'bottom-right', value: 42, unit: 'kPa', fraction: 0.4 })),
    ).toBe('Boost +42 kPa');
  });
});

describe('trip summary', () => {
  const trip = {
    id: 'tripSummary' as const,
    zone: 'bottom' as const,
    distance: { value: 26.1, unit: 'mi' as const, text: '26.1 mi' },
    durationS: 2400,
    averageEconomy: 31.2,
    economyUnit: 'mpg-us' as const,
    fuelUsed: 0.8,
    fuelUnit: 'gal' as const,
    cost: 3.1,
    currency: 'USD',
  };

  it('lists stats in priority order', () => {
    expect(
      tripStats(trip).map((s) => `${s.label}:${s.value}${s.unit ? ` ${s.unit}` : ''}`),
    ).toEqual(['Trip:26.1 mi', 'Time:40 min', 'Avg:31.2 mpg', 'Cost:$3.10', 'Fuel:0.8 gal']);
  });

  it('skips unknown economy, cost and fuel', () => {
    expect(
      tripStats({ ...trip, averageEconomy: null, cost: null, fuelUsed: null }).map((s) => s.key),
    ).toEqual(['distance', 'duration']);
  });
});

describe('Widget dispatcher', () => {
  it('renders nothing for widget ids from a newer server', () => {
    expect(render({ id: 'hologram', zone: 'center' } as unknown as WidgetFrame)).toBe('');
  });

  it('tags every widget with its id', () => {
    for (const frame of Object.values(SAMPLE_FRAMES)) {
      for (const w of frame.widgets) {
        const html = render(w);
        if (html !== '') expect(html).toContain(`data-widget="${w.id}"`);
      }
    }
  });
});
