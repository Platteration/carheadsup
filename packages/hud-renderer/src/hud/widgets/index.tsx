import type { WidgetFrame } from '@carheadsup/core';
import { Boost } from './Boost.tsx';
import { Clock } from './Clock.tsx';
import { Coolant } from './Coolant.tsx';
import { Eta } from './Eta.tsx';
import { Fuel } from './Fuel.tsx';
import { Gear } from './Gear.tsx';
import { Hazard } from './Hazard.tsx';
import { Lanes } from './Lanes.tsx';
import { Media } from './Media.tsx';
import { Nav } from './Nav.tsx';
import { OutsideTemp } from './OutsideTemp.tsx';
import { DEFAULT_WIDGET_CONTEXT } from './parts.tsx';
import type { WidgetContext } from './parts.tsx';
import { Speed } from './Speed.tsx';
import { SpeedLimit } from './SpeedLimit.tsx';
import { Tachometer } from './Tachometer.tsx';
import { Tpms } from './Tpms.tsx';
import { TripSummary } from './TripSummary.tsx';
import { Voltage } from './Voltage.tsx';

export type { WidgetContext } from './parts.tsx';
export { DEFAULT_WIDGET_CONTEXT, SpeedSign } from './parts.tsx';

/** Render one widget frame with the component for its id. Unknown ids render nothing. */
export function Widget({
  w,
  ctx = DEFAULT_WIDGET_CONTEXT,
}: {
  w: WidgetFrame;
  ctx?: WidgetContext;
}) {
  switch (w.id) {
    case 'speed':
      return <Speed w={w} />;
    case 'speedLimit':
      return <SpeedLimit w={w} />;
    case 'tachometer':
      return <Tachometer w={w} />;
    case 'gear':
      return <Gear w={w} />;
    case 'nav':
      return <Nav w={w} />;
    case 'lanes':
      return <Lanes w={w} />;
    case 'eta':
      return <Eta w={w} />;
    case 'hazard':
      return <Hazard w={w} ctx={ctx} />;
    case 'fuel':
      return <Fuel w={w} />;
    case 'coolant':
      return <Coolant w={w} />;
    case 'voltage':
      return <Voltage w={w} />;
    case 'tpms':
      return <Tpms w={w} />;
    case 'clock':
      return <Clock w={w} />;
    case 'outsideTemp':
      return <OutsideTemp w={w} />;
    case 'media':
      return <Media w={w} />;
    case 'boost':
      return <Boost w={w} />;
    case 'tripSummary':
      return <TripSummary w={w} />;
    default: {
      // Exhaustiveness check: a new WidgetId must get a component here.
      const unknown: never = w;
      void unknown;
      return null;
    }
  }
}
