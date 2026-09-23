import type { HudFrame } from '@carheadsup/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { HudApi } from '../common/api.ts';
import { useHudFeed } from '../common/useHudFeed.ts';
import type { HudFeedOptions } from '../common/useHudFeed.ts';
import { cx } from '../hud/util.ts';
import { EventLog, useFrameLog } from './EventLog.tsx';
import { Gallery } from './Gallery.tsx';
import { HudPreview } from './HudPreview.tsx';
import { InputPad } from './InputPad.tsx';
import { SimPanel } from './SimPanel.tsx';
import { BACKDROPS, PANEL_SIZES } from './sim-model.ts';
import type { Backdrop } from './sim-model.ts';
import { useSim } from './useSim.ts';
import './dev.css';

export type DevTab = 'live' | 'gallery';

export interface DevPrefs {
  tab: DevTab;
  /** Index into PANEL_SIZES. */
  panel: number;
  backdrop: Backdrop;
}

export const DEFAULT_PREFS: DevPrefs = { tab: 'live', panel: 0, backdrop: 'night' };
const PREFS_KEY = 'carheadsup.dev';

/** Stored preferences, validated field by field (a stale or hand-edited value falls back). */
export function parsePrefs(raw: string | null, hash = ''): DevPrefs {
  let stored: Partial<Record<keyof DevPrefs, unknown>> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) stored = parsed as typeof stored;
  } catch {
    stored = {};
  }
  const fromHash = hash.replace(/^#/, '');
  const tab: DevTab =
    fromHash === 'gallery' || fromHash === 'live'
      ? fromHash
      : stored.tab === 'gallery'
        ? 'gallery'
        : 'live';
  const panel =
    typeof stored.panel === 'number' &&
    Number.isInteger(stored.panel) &&
    stored.panel >= 0 &&
    stored.panel < PANEL_SIZES.length
      ? stored.panel
      : DEFAULT_PREFS.panel;
  const backdrop = BACKDROPS.some((b) => b.value === stored.backdrop)
    ? (stored.backdrop as Backdrop)
    : DEFAULT_PREFS.backdrop;
  return { tab, panel, backdrop };
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
}

/** Frames per second over the last second (0 when frames stop). */
function useFps(frame: HudFrame | null): number {
  const count = useRef(0);
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (frame !== null) count.current += 1;
  }, [frame]);
  useEffect(() => {
    const timer = setInterval(() => {
      setFps(count.current);
      count.current = 0;
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return fps;
}

export interface DevAppProps {
  api: HudApi;
  /** Test seam for the WebSocket feed. */
  feedOptions?: HudFeedOptions;
}

/** Developer console (`/dev`): live HUD preview, simulator controls, event log and gallery. */
export function DevApp({ api, feedOptions }: DevAppProps) {
  const [prefs, setPrefs] = useState<DevPrefs>(() =>
    parsePrefs(readStorage(), typeof location === 'undefined' ? '' : location.hash),
  );
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Preferences are a convenience; private mode simply forgets them.
    }
  }, [prefs]);
  const update = (patch: Partial<DevPrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const selectTab = (tab: DevTab) => {
    update({ tab });
    try {
      history.replaceState(null, '', `#${tab}`);
    } catch {
      // Not important.
    }
  };

  // The API token (when the HUD requires one) also authenticates the live feed, as `?token=`.
  const [token, setToken] = useState(() => api.tokens.get());
  const feed = useHudFeed({ ...feedOptions, token });
  const sim = useSim(api);
  const applyToken = (next: string) => {
    api.tokens.set(next);
    setToken(api.tokens.get());
    sim.refresh();
  };
  const [log, clearLog] = useFrameLog(feed.frame);
  const fps = useFps(feed.frame);
  const panel = PANEL_SIZES[prefs.panel] ?? PANEL_SIZES[0]!;

  const feedState = feed.frame !== null ? 'live' : feed.connected ? 'idle' : 'down';
  const feedLabel =
    feedState === 'live'
      ? `Live · ${fps} fps`
      : feedState === 'idle'
        ? 'Connected · no frames'
        : 'No feed · retrying';

  return (
    <div class="dev">
      <header class="dev-bar">
        <div class="dev-bar__brand">
          <span class="dev-bar__logo" aria-hidden="true" />
          <h1>HUD dev console</h1>
        </div>
        <nav class="dev-tabs" role="tablist" aria-label="View">
          {(['live', 'gallery'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={prefs.tab === tab}
              class={cx('dev-tab', prefs.tab === tab && 'dev-tab--on')}
              onClick={() => selectTab(tab)}
            >
              {tab === 'live' ? 'Live' : 'Gallery'}
            </button>
          ))}
        </nav>
        <div class="dev-bar__controls">
          <label class="dev-select">
            <span>Panel</span>
            <select
              value={String(prefs.panel)}
              onChange={(e) => update({ panel: Number(e.currentTarget.value) })}
            >
              {PANEL_SIZES.map((p, i) => (
                <option key={p.label} value={String(i)}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label class="dev-select">
            <span>Behind the glass</span>
            <select
              value={prefs.backdrop}
              onChange={(e) => update({ backdrop: e.currentTarget.value as Backdrop })}
            >
              {BACKDROPS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <span class={cx('feed-badge', `feed-badge--${feedState}`)} role="status">
            <span class="feed-badge__dot" aria-hidden="true" />
            {feedLabel}
            {feed.simulated && feedState !== 'down' && <span class="feed-badge__sim">SIM</span>}
          </span>
        </div>
      </header>

      {prefs.tab === 'live' ? (
        <main class="live">
          <div class="live__main">
            <section class="panel preview-panel" aria-label="HUD preview">
              <HudPreview
                frame={feed.frame}
                projection={feed.projection}
                panel={panel}
                backdrop={prefs.backdrop}
                maxHeight={460}
              />
              <div class="preview-caption">
                {feed.frame ? (
                  <>
                    <span>
                      Context <strong>{feed.frame.context}</strong>
                    </span>
                    <span>
                      Brightness <strong>{Math.round(feed.frame.theme.brightness * 100)} %</strong>
                      {feed.frame.theme.night ? ' · night palette' : ''}
                    </span>
                    <span>
                      <strong>{feed.frame.widgets.length}</strong> widgets ·{' '}
                      <strong>{feed.frame.alerts.length}</strong> alerts
                    </span>
                  </>
                ) : (
                  <span>
                    No live frames. Start the HUD with <code>npm run sim</code>, or browse the{' '}
                    <button type="button" class="link-btn" onClick={() => selectTab('gallery')}>
                      gallery
                    </button>
                    .
                  </span>
                )}
              </div>
              <InputPad api={api} />
            </section>
            <EventLog entries={log} onClear={clearLog} />
          </div>
          <aside class="panel live__side" aria-label="Simulator">
            <header class="panel-head">
              <h2>Simulator</h2>
              {sim.status && (
                <span class="muted small">
                  {sim.status.mode === 'scenario' ? 'Scripted drive' : 'Manual driving'}
                </span>
              )}
            </header>
            <SimPanel sim={sim} onToken={applyToken} />
          </aside>
        </main>
      ) : (
        <main class="gallery-page">
          <Gallery panel={panel} backdrop={prefs.backdrop} />
        </main>
      )}
    </div>
  );
}
