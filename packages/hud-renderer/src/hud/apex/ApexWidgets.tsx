import type { HudFrame, WidgetFrame } from '@carheadsup/core';
import { Guard } from '../Guard.tsx';
import { Widget } from '../widgets/index.tsx';
import { selectApexWidgets } from './model.ts';

function Slot({ name, w }: { name: string; w: WidgetFrame | undefined }) {
  return (
    <div class={`apex-slot apex-slot--${name}`} data-apex-slot={name}>
      {w && (
        <Guard name={`apex ${w.id}`} resetKey={w}>
          <Widget w={w} />
        </Guard>
      )}
    </div>
  );
}

/** Fixed anchors: no reflow of speed when navigation, RPM or limit becomes unavailable. */
export function ApexWidgets({ frame }: { frame: HudFrame }) {
  const { speed, nav, limit, rpm, gear, notices } = selectApexWidgets(frame.widgets);
  return (
    <div class="apex-layout" data-apex-layout="true">
      <Slot name="rpm" w={rpm} />
      <Slot name="nav" w={nav} />
      <Slot name="speed" w={speed} />
      <Slot name="limit" w={limit} />
      <Slot name="gear" w={gear} />
      {notices.length > 0 && (
        <div class="apex-notices" data-apex-notices="true">
          {notices.map((w, i) => (
            <div class="apex-notice" key={`${w.id}-${i}`}>
              <Guard name={`apex notice ${w.id}`} resetKey={w}>
                <Widget w={w} />
              </Guard>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
