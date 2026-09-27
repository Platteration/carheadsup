import { directionalGlows } from './model.ts';
import type { DirectionalWarnings } from './model.ts';

/** Inside ProjectionStage: left/right describe the driver's view after optical calibration. */
export function DirectionalGlows(props: DirectionalWarnings) {
  return (
    <div class="apex-glows" data-directional-warnings="true">
      {directionalGlows(props).map(({ direction, severity, label }) => (
        <div
          key={direction}
          class={`apex-glow apex-glow--${direction} apex-glow--${severity}`}
          data-glow={direction}
          data-severity={severity}
          role="img"
          aria-label={label}
        />
      ))}
    </div>
  );
}
