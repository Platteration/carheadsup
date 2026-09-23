/**
 * Calibration pattern drawn instead of the HUD while `projection.showGrid` is on: lines every
 * 10 %, a centre cross, and labelled corner markers, so the image can be squared up on the glass.
 * It is drawn inside the projected stage, so mirroring and keystone apply to it too.
 */
export function AlignmentGrid() {
  const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <div class="hud-grid-pattern" data-alignment-grid="true">
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        class="hud-grid-pattern__svg"
        aria-hidden="true"
      >
        <g class="hud-grid-pattern__lines">
          {steps.map((i) => (
            <path key={`v${i}`} d={`M${i * 100} 0V1000`} vector-effect="non-scaling-stroke" />
          ))}
          {steps.map((i) => (
            <path key={`h${i}`} d={`M0 ${i * 100}H1000`} vector-effect="non-scaling-stroke" />
          ))}
        </g>
        <rect
          class="hud-grid-pattern__frame"
          x="0"
          y="0"
          width="1000"
          height="1000"
          fill="none"
          vector-effect="non-scaling-stroke"
        />
        <path
          class="hud-grid-pattern__cross"
          d="M500 380V620M380 500H620"
          vector-effect="non-scaling-stroke"
        />
        <path
          class="hud-grid-pattern__corners"
          d="M0 120V0H120M880 0H1000V120M1000 880V1000H880M120 1000H0V880"
          fill="none"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <span class="hud-grid-pattern__label hud-grid-pattern__label--tl">TL</span>
      <span class="hud-grid-pattern__label hud-grid-pattern__label--tr">TR</span>
      <span class="hud-grid-pattern__label hud-grid-pattern__label--br">BR</span>
      <span class="hud-grid-pattern__label hud-grid-pattern__label--bl">BL</span>
    </div>
  );
}
