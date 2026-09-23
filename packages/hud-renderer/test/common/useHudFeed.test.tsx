// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHudFeed } from '../../src/common/useHudFeed.ts';
import type { HudFeed, HudFeedOptions } from '../../src/common/useHudFeed.ts';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';
import { FakeSocket } from './fake-socket.ts';

const FRAME = SAMPLE_FRAMES['city-nav']!;
const PROJECTION = {
  mirrorX: true,
  mirrorY: false,
  rotation: 0,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  corners: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] },
  showGrid: false,
};

let container: HTMLElement;
let latest: HudFeed | null = null;

function Probe(props: HudFeedOptions) {
  latest = useHudFeed(props);
  return null;
}

function mount(props: HudFeedOptions = {}) {
  act(() => {
    render(
      <Probe
        url="ws://hud/ws/hud"
        createSocket={FakeSocket.factory}
        now={() => Date.now()}
        {...props}
      />,
      container,
    );
  });
}

function feed(): HudFeed {
  if (!latest) throw new Error('hook not rendered');
  return latest;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
  latest = null;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.useRealTimers();
});

describe('useHudFeed', () => {
  it('starts empty and disconnected', () => {
    mount();
    expect(feed()).toMatchObject({
      frame: null,
      projection: null,
      simulated: false,
      connected: false,
      lastFrameAt: null,
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('shows frames while they keep arriving', () => {
    mount();
    act(() => FakeSocket.latest().open());
    expect(feed().connected).toBe(true);
    expect(feed().frame).toBeNull();
    act(() => FakeSocket.latest().receiveJson({ t: 'frame', frame: FRAME }));
    expect(feed().frame).toEqual(FRAME);
    expect(feed().lastFrameAt).toBe(Date.now());
  });

  it('blanks the frame once it is older than one second', () => {
    mount();
    act(() => FakeSocket.latest().open());
    act(() => FakeSocket.latest().receiveJson({ t: 'frame', frame: FRAME }));
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(feed().frame).toEqual(FRAME);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(feed().frame).toBeNull();
    // Still connected — it is the data that is stale, not the link.
    expect(feed().connected).toBe(true);
    act(() => FakeSocket.latest().receiveJson({ t: 'frame', frame: FRAME }));
    expect(feed().frame).toEqual(FRAME);
  });

  it('honours a custom staleness limit', () => {
    mount({ staleAfterMs: 200 });
    act(() => FakeSocket.latest().open());
    act(() => FakeSocket.latest().receiveJson({ t: 'frame', frame: FRAME }));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(feed().frame).toBeNull();
  });

  it('drops the frame immediately on disconnect and never resurrects it', () => {
    mount();
    act(() => FakeSocket.latest().open());
    act(() => FakeSocket.latest().receiveJson({ t: 'frame', frame: FRAME }));
    act(() => FakeSocket.latest().drop());
    expect(feed().frame).toBeNull();
    expect(feed().connected).toBe(false);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => FakeSocket.latest().open());
    expect(feed().connected).toBe(true);
    expect(feed().frame).toBeNull();
  });

  it('keeps the projection and simulator flag from display messages', () => {
    mount();
    act(() => FakeSocket.latest().open());
    act(() =>
      FakeSocket.latest().receiveJson({ t: 'display', projection: PROJECTION, simulated: true }),
    );
    expect(feed().projection).toEqual(PROJECTION);
    expect(feed().simulated).toBe(true);
  });

  it('sends input over the socket', () => {
    mount();
    expect(feed().send({ t: 'input', action: 'primary' })).toBe(false);
    act(() => FakeSocket.latest().open());
    expect(feed().send({ t: 'input', action: 'toggle-blank' })).toBe(true);
    expect(FakeSocket.latest().sent).toEqual(['{"t":"input","action":"toggle-blank"}']);
  });

  it('opens no socket while disabled', () => {
    mount({ enabled: false });
    expect(FakeSocket.instances).toHaveLength(0);
    expect(feed().send({ t: 'input', action: 'primary' })).toBe(false);
  });

  it('closes the socket on unmount', () => {
    mount();
    const socket = FakeSocket.latest();
    act(() => socket.open());
    act(() => render(null, container));
    expect(socket.closeCalls).toBe(1);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
