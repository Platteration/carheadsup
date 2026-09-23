// @vitest-environment happy-dom
import type { ProjectionConfig } from '@carheadsup/core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HudView } from '../../src/hud/HudView.tsx';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';

const PROJECTION: ProjectionConfig = {
  mirrorX: true,
  mirrorY: false,
  rotation: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  corners: { tl: [0.02, 0], tr: [0.98, 0.01], br: [1, 1], bl: [0, 0.99] },
  showGrid: false,
};

let container: HTMLElement;

beforeEach(() => {
  // happy-dom has no layout engine: pretend every element is an 800×480 screen.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.restoreAllMocks();
});

describe('HudView in the DOM', () => {
  it('measures the screen and applies the projection as one matrix3d', () => {
    act(() => {
      render(<HudView frame={SAMPLE_FRAMES['city-nav']!} projection={PROJECTION} />, container);
    });
    const stage = container.querySelector<HTMLElement>('.hud-stage')!;
    expect(stage.dataset.projection).toBe('applied');
    expect(stage.style.transform).toMatch(/^matrix3d\(/);
    expect(stage.style.width).toBe('800px');
    expect(stage.style.height).toBe('480px');
    expect(stage.style.visibility).toBe('');
  });

  it('lays a sideways panel out at the swapped logical size', () => {
    act(() => {
      render(
        <HudView frame={SAMPLE_FRAMES['city-nav']!} projection={{ ...PROJECTION, rotation: 90 }} />,
        container,
      );
    });
    const stage = container.querySelector<HTMLElement>('.hud-stage')!;
    expect(stage.style.width).toBe('480px');
    expect(stage.style.height).toBe('800px');
  });

  it('updates as frames change and blanks when the frame goes away', () => {
    act(() => render(<HudView frame={SAMPLE_FRAMES['city-nav']!} />, container));
    expect(container.textContent).toContain('Rosenheimer');
    act(() => render(<HudView frame={SAMPLE_FRAMES.overspeed!} />, container));
    expect(container.querySelector('.hud-speed--over')).not.toBeNull();
    act(() => render(<HudView frame={null} />, container));
    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('[data-no-signal]')).not.toBeNull();
  });
});
