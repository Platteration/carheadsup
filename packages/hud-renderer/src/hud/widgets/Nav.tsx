import type { NavWidget } from '@carheadsup/core';
import { ManeuverIcon } from '../icons/index.ts';
import { cx, pct, splitDistance } from '../util.ts';
import { Num, Unit, WidgetRoot } from './parts.tsx';

/**
 * Only accept what the phone protocol allows for `iconPng` (plain base64) and build the data URL
 * ourselves, so the string can never smuggle another URL scheme (or a quote that ends the CSS
 * `url()`) into the page.
 */
export function pngDataUrl(base64: string | null): string | null {
  if (!base64) return null;
  const compact = base64.replace(/\s+/g, '');
  if (compact.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return `data:image/png;base64,${compact}`;
}

/**
 * Turn-by-turn: maneuver arrow, distance countdown, next street and an optional "then" arrow.
 * When the maneuver is imminent everything grows and an approach bar fills towards the turn.
 *
 * For a maneuver the HUD cannot draw itself, the phone's copy of the nav app's arrow is shown —
 * as a mask (the companion sends it white where the arrow is), filled with the HUD's accent
 * colour like the HUD's own arrows: the app's colours could be invisible (dark: black is
 * transparent on the windshield) or a bright square (a solid tile), and ignore the night palette.
 */
export function Nav({ w }: { w: NavWidget }) {
  const png = w.maneuver.type === 'unknown' ? pngDataUrl(w.iconPng) : null;
  const distance = w.distance ? splitDistance(w.distance) : null;
  return (
    <WidgetRoot id="nav" class={cx(w.imminent && 'hud-nav--imminent')}>
      <div class="hud-nav">
        <div class="hud-nav__icon">
          {png ? (
            <span class="hud-nav__png" style={{ '--hud-nav-icon': `url("${png}")` }} />
          ) : (
            <ManeuverIcon maneuver={w.maneuver} class="hud-nav__arrow" />
          )}
        </div>
        <div class="hud-nav__main">
          {distance && (
            <div class="hud-nav__distance">
              <Num>{distance.value}</Num>
              {distance.unit && <Unit>{distance.unit}</Unit>}
            </div>
          )}
          {w.approach !== null && Number.isFinite(w.approach) && (
            <div class="hud-nav__approach" data-approach={w.approach.toFixed(2)}>
              <div class="hud-nav__approach-fill" style={{ width: pct(w.approach) }} />
            </div>
          )}
          {w.then && (
            <div class="hud-nav__then">
              <span class="hud-nav__then-label">then</span>
              <ManeuverIcon maneuver={w.then} class="hud-nav__then-icon" />
            </div>
          )}
        </div>
        {w.street && <div class="hud-nav__street">{w.street}</div>}
      </div>
    </WidgetRoot>
  );
}
