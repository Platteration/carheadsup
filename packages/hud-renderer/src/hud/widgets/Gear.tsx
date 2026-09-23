import type { GearWidget } from '@carheadsup/core';
import { MISSING } from '../../common/format.ts';
import { cx } from '../util.ts';
import { Num, WidgetRoot } from './parts.tsx';

/** Selected gear in a box; reverse in amber. An inferred gear gets a dashed box. */
export function Gear({ w }: { w: GearWidget }) {
  const gear = w.gear.trim() === '' ? MISSING : w.gear.trim().toUpperCase();
  return (
    <WidgetRoot
      id="gear"
      tone={gear === 'R' ? 'caution' : undefined}
      label={`Gear ${gear}${w.inferred ? ' (estimated)' : ''}`}
    >
      <div
        class={cx(
          'hud-gear',
          w.inferred && 'hud-gear--inferred',
          gear.length > 1 && 'hud-gear--wide',
        )}
      >
        <Num class="hud-gear__value">{gear}</Num>
      </div>
    </WidgetRoot>
  );
}
