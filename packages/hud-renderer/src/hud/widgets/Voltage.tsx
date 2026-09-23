import type { VoltageWidget } from '@carheadsup/core';
import { formatNumber } from '../../common/format.ts';
import { Glyph } from '../icons/index.ts';
import { Num, Unit, WidgetRoot } from './parts.tsx';

/** Battery / charging voltage — only sent when out of range (too low or too high). */
export function Voltage({ w }: { w: VoltageWidget }) {
  return (
    <WidgetRoot id="voltage" tone="caution" label={`Battery ${w.status}`}>
      <div class="hud-reading">
        <Glyph name="battery" class="hud-reading__icon" />
        <Num>{formatNumber(w.value, 1)}</Num>
        <Unit>V</Unit>
      </div>
    </WidgetRoot>
  );
}
