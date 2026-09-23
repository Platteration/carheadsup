import type { HudFrame } from '@carheadsup/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { cx } from '../hud/util.ts';
import { appendLog, deriveLogEntries } from './log.ts';
import type { LogEntry } from './log.ts';

/** Accumulate log entries from successive frames (see `deriveLogEntries`). */
export function useFrameLog(
  frame: HudFrame | null,
  now: () => number = Date.now,
): [LogEntry[], () => void] {
  const [log, setLog] = useState<LogEntry[]>([]);
  const prev = useRef<HudFrame | null>(null);
  useEffect(() => {
    const entries = deriveLogEntries(prev.current, frame, now());
    prev.current = frame;
    if (entries.length > 0) setLog((current) => appendLog(current, entries));
  }, [frame]);
  return [log, () => setLog([])];
}

function clock(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function EventLog({
  entries,
  onClear,
}: {
  entries: readonly LogEntry[];
  onClear: () => void;
}) {
  return (
    <section class="event-log" aria-label="Event log">
      <header class="panel-head">
        <h2>Event log</h2>
        <button
          type="button"
          class="dbtn dbtn--small dbtn--ghost"
          onClick={onClear}
          disabled={entries.length === 0}
        >
          Clear
        </button>
      </header>
      {entries.length === 0 ? (
        <p class="event-log__empty">
          Alerts, toasts and context changes appear here as frames arrive.
        </p>
      ) : (
        <ol class="event-log__list">
          {entries.map((e, i) => (
            <li key={`${e.at}-${i}-${e.text}`} class={cx('event', `event--${e.tone}`)}>
              <time class="event__time">{clock(e.at)}</time>
              <span class="event__kind">{e.kind}</span>
              <span class="event__text">{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
