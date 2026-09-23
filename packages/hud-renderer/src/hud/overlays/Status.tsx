import type { HudFrame } from '@carheadsup/core';
import { Glyph } from '../icons/index.ts';
import { cx } from '../util.ts';

/** Tiny, dim link-status icons in the top-right corner: OBD adapter, phone, simulator badge. */
export function StatusIcons({ status }: { status: HudFrame['status'] }) {
  return (
    <div class="hud-status" aria-label="Status">
      {status.simulated && <span class="hud-status__sim">SIM</span>}
      <Glyph
        name="obd"
        class={cx('hud-status__icon', 'hud-status__obd', `hud-status__obd--${status.obd}`)}
        title={`OBD ${status.obd}`}
      />
      <Glyph
        name={status.phone ? 'phone' : 'phone-off'}
        class={cx(
          'hud-status__icon',
          'hud-status__phone',
          !status.phone && 'hud-status__phone--off',
        )}
        title={status.phone ? 'Phone connected' : 'Phone not connected'}
      />
    </div>
  );
}

/** The only thing drawn when there is no live feed: a tiny dim dot, never frozen values. */
export function NoSignal() {
  return <div class="hud-nosignal" role="status" aria-label="No signal" data-no-signal="true" />;
}

/** Tiny marker shown while the driver has blanked the display. */
export function BlankIndicator() {
  return (
    <div
      class="hud-blank-indicator"
      role="status"
      aria-label="Display blanked"
      data-blanked="true"
    />
  );
}
