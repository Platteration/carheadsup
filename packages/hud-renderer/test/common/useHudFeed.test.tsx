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

/** A frame the server composed at `at` (server clock). */
const at = (t: number) => ({ ...FRAME, at: FRAME.at + t });

/** Receive a frame on the current socket. */
function receive(frame: typeof FRAME): void {
  act(() => FakeSocket.latest().receiveJson({ t: 'frame', frame }));
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

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
    receive(at(0));
    // The first frame alone proves nothing (it may be the server's cached last frame)…
    expect(feed().frame).toBeNull();
    expect(feed().lastFrameAt).toBe(Date.now());
    advance(66);
    receive(at(66));
    // …one composed after it does.
    expect(feed().frame).toEqual(at(66));
  });

  it('blanks the frame once it is older than one second', () => {
    mount();
    act(() => FakeSocket.latest().open());
    receive(at(0));
    receive(at(66));
    advance(900);
    expect(feed().frame).toEqual(at(66));
    advance(200);
    expect(feed().frame).toBeNull();
    // Still connected — it is the data that is stale, not the link.
    expect(feed().connected).toBe(true);
    receive(at(1200));
    expect(feed().frame).toEqual(at(1200));
  });

  it('honours a custom staleness limit', () => {
    mount({ staleAfterMs: 200 });
    act(() => FakeSocket.latest().open());
    receive(at(0));
    receive(at(66));
    advance(250);
    expect(feed().frame).toBeNull();
  });

  it('never shows the cached frame a stalled server replays on every connect', () => {
    mount();
    // An hour-old frame, sent on connect by a server whose frame loop has stopped.
    const old = at(-3_600_000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      act(() => FakeSocket.latest().open());
      receive(old);
      expect(feed().frame).toBeNull();
      advance(500);
      expect(feed().frame).toBeNull();
      act(() => FakeSocket.latest().drop());
      advance(600);
    }
  });

  it('blanks when frames keep coming but their time stands still', () => {
    mount();
    act(() => FakeSocket.latest().open());
    receive(at(0));
    receive(at(66));
    expect(feed().frame).not.toBeNull();
    // A stuck reducer: frames at 15 fps, all stamped with the same time.
    for (let i = 0; i < 20; i += 1) {
      advance(66);
      receive(at(66));
    }
    expect(feed().frame).toBeNull();
  });

  it('survives the server clock stepping back', () => {
    mount();
    act(() => FakeSocket.latest().open());
    receive(at(0));
    receive(at(66));
    advance(66);
    receive(at(-60_000));
    advance(66);
    receive(at(-59_934));
    expect(feed().frame).toEqual(at(-59_934));
  });

  it('stays up at one frame per second instead of blanking between frames', () => {
    mount();
    act(() => FakeSocket.latest().open());
    let blanks = 0;
    let shown = 0;
    // Engine: publish (4 ms compose), then wait 1000 ms.
    for (let i = 0; i < 15; i += 1) {
      receive(at(i * 1004));
      for (let step = 0; step < 1004; step += 2) {
        advance(2);
        if (i >= 1) {
          if (feed().frame === null) blanks += 1;
          else shown += 1;
        }
      }
    }
    expect(shown).toBeGreaterThan(0);
    expect(blanks).toBe(0);
    // …and still blanks promptly once they stop.
    advance(2600);
    expect(feed().frame).toBeNull();
  });

  it('drops the frame immediately on disconnect and never resurrects it', () => {
    mount();
    act(() => FakeSocket.latest().open());
    receive(at(0));
    receive(at(66));
    expect(feed().frame).not.toBeNull();
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
    expect(feed().hardwareBrightness).toBe(false);
  });

  it('follows hardwareBrightness and forgets it with the connection', () => {
    mount();
    act(() => FakeSocket.latest().open());
    const display = (hardwareBrightness: boolean) =>
      FakeSocket.latest().receiveJson({
        t: 'display',
        projection: PROJECTION,
        simulated: false,
        hardwareBrightness,
      });
    act(() => display(true));
    expect(feed().hardwareBrightness).toBe(true);
    act(() => display(false)); // the backlight went away: dim in CSS again
    expect(feed().hardwareBrightness).toBe(false);
    act(() => display(true));
    act(() => FakeSocket.latest().drop());
    // Until the next server says so, the renderer dims by itself.
    expect(feed().hardwareBrightness).toBe(false);
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
