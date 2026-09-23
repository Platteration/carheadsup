import type { HudConfig } from '@carheadsup/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { HudView } from '../../hud/HudView.tsx';
import { buildShiftPreviewFrame } from '../model/layout.ts';
import type { Scope } from '../model/scope.ts';
import { RPM } from '../model/units.ts';
import { Button, Card, Section } from '../ui/common.tsx';
import { FieldGrid, NumberField, ToggleField } from '../ui/fields.tsx';

/** One full sweep of the preview (idle → past the flash point). */
export const SWEEP_MS = 3000;

/** rpm at time `t` (ms) of a looping sweep from `from` to `to`, accelerating like a pull through a gear. */
export function sweepRpm(t: number, from: number, to: number, periodMs = SWEEP_MS): number {
  const phase = (((t % periodMs) + periodMs) % periodMs) / periodMs;
  return from + (to - from) * phase * phase;
}

export function ShiftLightSection({ root }: { root: Scope<HudConfig> }) {
  const shift = root.child('shiftLight');
  const vehicle = root.value.vehicle;
  const config = shift.value;
  const top = Math.max(vehicle.redlineRpm, config.flashRpm) + 300;
  const [rpm, setRpm] = useState(() => Math.round((config.startRpm + config.shiftRpm) / 2));
  const [sweeping, setSweeping] = useState(false);

  useEffect(() => {
    if (!sweeping) return undefined;
    const started = performance.now();
    const timer = setInterval(() => {
      setRpm(Math.round(sweepRpm(performance.now() - started, vehicle.idleRpm, top)));
    }, 40);
    return () => clearInterval(timer);
  }, [sweeping, vehicle.idleRpm, top]);

  const frame = useMemo(
    () => buildShiftPreviewFrame(rpm, config, vehicle.redlineRpm, root.value.units.system),
    [rpm, config, vehicle.redlineRpm, root.value.units.system],
  );

  return (
    <Section
      id="shift-light"
      title="Shift light"
      intro="A bar across the top that fills as the revs rise and flashes at the shift point."
    >
      <Card>
        <ToggleField
          scope={shift}
          k="enabled"
          label="Show the shift light"
          hint="For manual gearboxes or spirited driving."
        />
        <FieldGrid>
          <NumberField scope={shift} k="startRpm" label="Start filling at" unit={RPM} integer />
          <NumberField scope={shift} k="shiftRpm" label="Full (shift now) at" unit={RPM} integer />
          <NumberField scope={shift} k="flashRpm" label="Flash from" unit={RPM} integer />
        </FieldGrid>
      </Card>
      <Card>
        <div class="card__head">
          <h3 class="card__title">Preview</h3>
          <Button
            size="small"
            variant={sweeping ? 'primary' : 'secondary'}
            onClick={() => setSweeping((s) => !s)}
          >
            {sweeping ? 'Stop sweep' : 'Sweep revs'}
          </Button>
        </div>
        <div class={config.enabled ? 'hud-box' : 'hud-box is-dimmed'} data-testid="shift-preview">
          <HudView frame={frame} preview />
        </div>
        <div class="slider">
          <input
            class="slider__input"
            type="range"
            min={0}
            max={top}
            step={50}
            value={rpm}
            aria-label="Preview engine speed"
            onInput={(event) => {
              setSweeping(false);
              setRpm(Number(event.currentTarget.value));
            }}
          />
          <output class="slider__value">{rpm} rpm</output>
        </div>
        {!config.enabled && (
          <p class="muted small">The shift light is off; the preview shows how it would look.</p>
        )}
      </Card>
    </Section>
  );
}
