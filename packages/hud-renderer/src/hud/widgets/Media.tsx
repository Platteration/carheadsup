import type { MediaWidget } from '@carheadsup/core';
import { Glyph } from '../icons/index.ts';
import { cx } from '../util.ts';
import { WidgetRoot } from './parts.tsx';

/** Now playing: title and artist, with a pause mark when playback is paused. */
export function Media({ w }: { w: MediaWidget }) {
  if (!w.title && !w.artist) return null;
  return (
    <WidgetRoot id="media" class={cx(!w.playing && 'hud-media--paused')}>
      <div class="hud-media">
        <Glyph name={w.playing ? 'music' : 'pause'} class="hud-media__icon" />
        <div class="hud-media__text">
          {w.title && <div class="hud-media__title">{w.title}</div>}
          {w.artist && <div class="hud-media__artist">{w.artist}</div>}
        </div>
      </div>
    </WidgetRoot>
  );
}
