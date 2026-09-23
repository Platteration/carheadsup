import type { AlertFrame, CallFrame } from '@carheadsup/core';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { AlertBanner, alertDetail } from '../../src/hud/overlays/AlertBanner.tsx';
import { CallCard } from '../../src/hud/overlays/CallCard.tsx';
import {
  SHIFT_SEGMENTS,
  litSegments,
  shiftSegmentColor,
} from '../../src/hud/overlays/ShiftLight.tsx';
import { Toast } from '../../src/hud/overlays/Toast.tsx';
import { textOf } from './render.ts';

const ALERT: AlertFrame = {
  key: 'check-engine:P0420',
  kind: 'check-engine',
  severity: 'caution',
  title: 'Check engine',
  detail: 'Catalytic converter efficiency',
  code: 'P0420',
  dismissible: true,
};

describe('alert banner', () => {
  it('prefixes the fault code unless the detail already has it', () => {
    expect(alertDetail(ALERT)).toBe('P0420 · Catalytic converter efficiency');
    expect(alertDetail({ ...ALERT, detail: 'P0420 – Catalytic converter efficiency' })).toBe(
      'P0420 – Catalytic converter efficiency',
    );
    expect(alertDetail({ ...ALERT, detail: 'p0420 lowercase mention' })).toBe(
      'p0420 lowercase mention',
    );
    expect(alertDetail({ ...ALERT, detail: null })).toBe('P0420');
    expect(alertDetail({ ...ALERT, detail: '  ', code: null })).toBeNull();
  });

  it('colours by severity, flashes only when critical and picks the kind icon', () => {
    const caution = renderToString(<AlertBanner alert={ALERT} />);
    expect(caution).toContain('hud-tone--caution');
    expect(caution).not.toContain('hud-flash');
    expect(caution).toContain('data-glyph="engine"');
    expect(caution).toContain('role="status"');
    const critical = renderToString(
      <AlertBanner alert={{ ...ALERT, kind: 'coolant', severity: 'critical' }} />,
    );
    expect(critical).toContain('hud-tone--critical');
    expect(critical).toContain('hud-flash');
    expect(critical).toContain('data-glyph="thermometer"');
    expect(critical).toContain('role="alert"');
  });

  it('draws an unknown severity from a newer server as critical, not as a quiet info line', () => {
    const html = renderToString(
      <AlertBanner alert={{ ...ALERT, severity: 'emergency' as AlertFrame['severity'] }} />,
    );
    expect(html).toContain('hud-tone--critical');
    expect(html).toContain('hud-flash');
    expect(html).toContain('data-severity="critical"');
    expect(html).toContain('role="alert"');
  });

  it('survives an alert kind from a newer server', () => {
    const html = renderToString(
      <AlertBanner alert={{ ...ALERT, kind: 'meteor' as AlertFrame['kind'] }} />,
    );
    expect(html).toContain('data-glyph="warning"');
  });
});

describe('toast', () => {
  it('applies the composer-driven opacity', () => {
    const html = renderToString(
      <Toast toast={{ kind: 'media', title: 'Song', subtitle: 'Band', opacity: 0.456 }} />,
    );
    expect(html).toContain('opacity:0.456');
    expect(textOf(html)).toBe('Song Band');
    expect(html).toContain('data-glyph="music"');
  });

  it('is not rendered once fully faded, and clamps odd values', () => {
    expect(
      renderToString(<Toast toast={{ kind: 'info', title: 'x', subtitle: null, opacity: 0 }} />),
    ).toBe('');
    expect(
      renderToString(
        <Toast toast={{ kind: 'info', title: 'x', subtitle: null, opacity: Number.NaN }} />,
      ),
    ).toBe('');
    expect(
      renderToString(<Toast toast={{ kind: 'info', title: 'x', subtitle: null, opacity: 3 }} />),
    ).toContain('opacity:1');
  });

  it('shows only the sender for messages', () => {
    const html = renderToString(
      <Toast toast={{ kind: 'message', title: 'Alex', subtitle: null, opacity: 1 }} />,
    );
    expect(textOf(html)).toBe('Alex');
    expect(html).toContain('data-glyph="message"');
  });
});

describe('call card', () => {
  const ringing: CallFrame = {
    state: 'ringing',
    name: 'Maria Lopez',
    number: '+1 415 555 0132',
    durationS: null,
    canAccept: true,
    canDecline: true,
  };

  it('offers accept and decline while ringing', () => {
    const html = renderToString(<CallCard call={ringing} />);
    expect(textOf(html)).toBe('Incoming call Maria Lopez +1 415 555 0132 Decline Accept');
    expect(html).toContain('data-glyph="arrow-left"');
    expect(html).toContain('data-glyph="arrow-right"');
  });

  it('shows a running timer and "End" during a call', () => {
    const html = renderToString(
      <CallCard call={{ ...ringing, state: 'active', durationS: 3725, canAccept: false }} />,
    );
    expect(textOf(html)).toBe('On call 1:02:05 Maria Lopez +1 415 555 0132 End');
  });

  it('does not repeat the number when it is the only name', () => {
    const html = renderToString(<CallCard call={{ ...ringing, name: '+1 415 555 0132' }} />);
    expect(textOf(html).match(/555 0132/g)).toHaveLength(1);
  });

  it('shows no actions or timer where none apply', () => {
    const html = renderToString(
      <CallCard
        call={{ ...ringing, state: 'dialing', canAccept: false, canDecline: false, durationS: 3 }}
      />,
    );
    expect(html).not.toContain('hud-call__actions');
    expect(html).not.toContain('hud-call__timer');
    expect(textOf(html)).toContain('Calling');
  });
});

describe('shift light', () => {
  it('bands the segments green, amber, red', () => {
    const colours = Array.from({ length: SHIFT_SEGMENTS }, (_, i) => shiftSegmentColor(i));
    expect(colours).toEqual([
      'green',
      'green',
      'green',
      'green',
      'green',
      'green',
      'amber',
      'amber',
      'amber',
      'amber',
      'red',
      'red',
    ]);
  });

  it('lights segments in proportion to the level, clamped', () => {
    expect(litSegments(0)).toBe(0);
    expect(litSegments(0.5)).toBe(6);
    expect(litSegments(0.99)).toBe(12);
    expect(litSegments(1.7)).toBe(12);
    expect(litSegments(-1)).toBe(0);
    expect(litSegments(Number.NaN)).toBe(0);
  });
});

describe('robustness against enum values from a newer server', () => {
  it('falls back instead of crashing on unknown or prototype-named values', async () => {
    const { renderHud } = await import('./render.ts');
    const { SAMPLE_FRAMES } = await import('../../src/hud/fixtures.ts');
    const base = SAMPLE_FRAMES['city-nav']!;
    const weird = 'constructor';
    const frame = {
      ...base,
      alerts: [{ ...ALERT, kind: weird }],
      toast: { kind: weird, title: 'T', subtitle: null, opacity: 1 },
      call: {
        state: weird,
        name: 'N',
        number: null,
        durationS: null,
        canAccept: false,
        canDecline: true,
      },
      widgets: [
        ...base.widgets,
        {
          id: 'hazard',
          zone: 'top-right',
          type: weird,
          distance: null,
          speedLimit: null,
          delayMinutes: null,
          label: 'x',
        },
        { id: 'lanes', zone: 'top', lanes: [{ directions: [weird], recommended: true }] },
        {
          id: 'nav',
          zone: 'top-left',
          maneuver: { type: weird },
          distance: null,
          street: null,
          then: null,
          iconPng: null,
          imminent: false,
          approach: null,
        },
      ],
    } as unknown as Parameters<typeof renderHud>[0];
    expect(() => renderHud(frame)).not.toThrow();
    const html = renderHud(frame);
    expect(html).toContain('data-glyph="warning"');
    expect(html).toContain('data-glyph="info"');

    const parked = SAMPLE_FRAMES['parked-maintenance']!;
    const odd = {
      ...parked,
      diagnostics: {
        ...parked.diagnostics!,
        maintenance: [{ ...parked.diagnostics!.maintenance[0]!, status: weird }],
      },
    } as unknown as Parameters<typeof renderHud>[0];
    expect(() => renderHud(odd)).not.toThrow();
  });

  it('shows an unknown collision level as the full warning', async () => {
    const { renderHud } = await import('./render.ts');
    const { SAMPLE_FRAMES } = await import('../../src/hud/fixtures.ts');
    const frame = {
      ...SAMPLE_FRAMES['highway-cruise']!,
      collision: 'imminent',
    } as unknown as Parameters<typeof renderHud>[0];
    const html = renderHud(frame);
    expect(html).toContain('data-collision="warning"');
    expect(html).toContain('BRAKE');
    expect(html).toContain('hud-collision-border');
    // …also while the driver has blanked the display.
    const blanked = renderHud({ ...frame!, blanked: true });
    expect(blanked).toContain('BRAKE');
    expect(blanked).toContain('hud-collision-border');
  });
});
