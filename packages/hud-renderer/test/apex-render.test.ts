import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { HudFrame } from '@carheadsup/core';
import { HudView } from '../src/hud/HudView.tsx';
import { DirectionalGlows } from '../src/hud/apex/DirectionalGlows.tsx';

function frame(overrides: Partial<HudFrame> = {}): HudFrame {
  return {
    at: 1000, context: 'city', blanked: false,
    theme: { night: false, brightness: 1 },
    widgets: [{ id: 'speed', zone: 'center', value: 68, unit: 'mph', overLimit: false, overBy: null }],
    alerts: [], toast: null, call: null, shiftLight: null,
    blindSpot: { left: false, right: false }, collision: 'none', diagnostics: null,
    status: { obd: 'connected', phone: true, simulated: true }, ...overrides,
  };
}
const draw = (f: HudFrame | null) => renderToString(h(HudView, { frame: f, layout: 'apex', preview: true }));

describe('Apex renderer safety boundaries', () => {
  it('shows the minimal layout using real widget components', () => {
    const html = draw(frame());
    expect(html).toContain('data-apex-layout="true"');
    expect(html).toContain('data-apex-slot="speed"');
    expect(html).not.toContain('data-glow=');
  });
  it('uses one top glow instead of a collision card or full-screen border', () => {
    const html = draw(frame({ collision: 'warning' }));
    expect(html).toContain('data-glow="front"');
    expect(html).not.toContain('hud-collision__chevrons');
    expect(html).not.toContain('hud-collision-border');
    expect(html).not.toContain('BRAKE');
    expect(html).not.toContain('data-glow="rear"');
  });
  it('retains directional warnings in blanked mode', () => {
    const html = draw(frame({ blanked: true, collision: 'warning', blindSpot: { left: true, right: true } }));
    expect(html).toContain('data-mode="blanked"');
    for (const side of ['front', 'left', 'right']) expect(html).toContain(`data-glow="${side}"`);
    expect(html).not.toContain('data-apex-layout');
  });
  it('removes both values and warnings on a null frame', () => {
    const html = draw(null);
    expect(html).toContain('data-mode="no-signal"');
    expect(html).not.toContain('data-glow=');
    expect(html).not.toContain('data-apex-layout');
  });
  it('leaves the configured layout available', () => {
    const html = renderToString(h(HudView, { frame: frame({ collision: 'warning' }), preview: true }));
    expect(html).toContain('hud-collision-border');
    expect(html).not.toContain('data-apex-layout');
  });
  it('can render a rear glow only when explicitly supplied to the presentation component', () => {
    const html = renderToString(h(DirectionalGlows, { left: false, right: false, front: 'none', rear: 'warning' }));
    expect(html).toContain('data-glow="rear"');
    expect(html).toContain('Rear collision warning');
    expect(html).not.toContain('data-glow="front"');
  });
});
