import type { CoolantWidget } from '@carheadsup/core';
import { formatNumber } from '../../common/format.ts';
import { Glyph } from '../icons/index.ts';
import { Num, Unit, WidgetRoot } from './parts.tsx';

/** Coolant temperature — only sent when out of range: amber when hot, red when critical. */
export function Coolant({ w }: { w: CoolantWidget }) {
  return (
    <WidgetRoot id="coolant" tone={w.status === 'critical' ? 'critical' : 'caution'}>
      <div class="hud-reading">
        <Glyph name="thermometer" class="hud-reading__icon" />
        <Num>{formatNumber(w.value)}</Num>
        <Unit>{w.unit}</Unit>
      </div>
    </WidgetRoot>
  );
}
