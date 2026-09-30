import type { HudConfig, NightModeSource, SpeedLimitSignStyle } from '@carheadsup/core';
import type { Scope } from '../model/scope.ts';
import { DEGREES, LUX, PERCENT, SECONDS_FROM_MS } from '../model/units.ts';
import { Card, Section } from '../ui/common.tsx';
import {
  FieldGrid,
  FieldGroup,
  NumberField,
  SegmentedField,
  SelectField,
  SliderField,
} from '../ui/fields.tsx';
import type { Option } from '../ui/fields.tsx';
import { useForm } from '../ui/form-context.ts';

const NIGHT_SOURCES: ReadonlyArray<Option<NightModeSource>> = [
  {
    value: 'sensor',
    label: 'Light sensor',
    hint: 'Switches with the ambient light (needs a light sensor).',
  },
  {
    value: 'sun',
    label: 'Sunset / sunrise',
    hint: 'Follows the sun at the phone’s location (or the fallback location).',
  },
  { value: 'always', label: 'Always on', hint: 'Warm, dim palette all the time.' },
  { value: 'never', label: 'Never', hint: 'Day palette all the time.' },
];

const SIGN_STYLES: ReadonlyArray<Option<SpeedLimitSignStyle>> = [
  { value: 'vienna', label: 'Red ring', hint: 'Europe and most of the world.' },
  { value: 'mutcd', label: 'US rectangle', hint: 'United States and Canada.' },
];

const MAX_ALERTS: ReadonlyArray<Option<number>> = [1, 2, 3, 4, 5].map((n) => ({
  value: n,
  label: String(n),
}));

export function DisplaySection({ root }: { root: Scope<HudConfig> }) {
  const display = root.child('display');
  const brightness = display.child('brightness');
  const { driverUnits } = useForm();
  const b = brightness.value;
  return (
    <Section
      id="display"
      title="Display"
      intro="Brightness, night palette and what pops up on the HUD."
    >
      <Card>
        <FieldGroup title="Brightness">
          <SegmentedField
            scope={brightness}
            k="mode"
            label="Mode"
            options={[
              {
                value: 'auto',
                label: 'Automatic',
                hint: 'Follows the ambient light (sensor or time of day).',
              },
              {
                value: 'manual',
                label: 'Fixed',
                hint: 'Always the level below (brightness +/− inputs still trim it).',
              },
            ]}
          />
          {b.mode === 'manual' && (
            <SliderField
              scope={brightness}
              k="manualLevel"
              label="Level"
              min={0}
              max={1}
              step={0.01}
              unit={PERCENT}
            />
          )}
          <SliderField
            scope={brightness}
            k="minLevel"
            label="Never dimmer than"
            min={0}
            max={1}
            step={0.01}
            unit={PERCENT}
          />
          <SliderField
            scope={brightness}
            k="maxLevel"
            label="Never brighter than"
            min={0}
            max={1}
            step={0.01}
            unit={PERCENT}
          />
          <details class="disclosure">
            <summary>Adaptation speed</summary>
            <FieldGrid>
              <NumberField
                scope={brightness}
                k="riseTimeMs"
                label="Brightening"
                unit={SECONDS_FROM_MS}
                integer
                hint="Slow, so passing shadows do not flicker."
              />
              <NumberField
                scope={brightness}
                k="fallTimeMs"
                label="Dimming"
                unit={SECONDS_FROM_MS}
                integer
                hint="Fast, e.g. entering a tunnel."
              />
            </FieldGrid>
          </details>
        </FieldGroup>
      </Card>
      <Card>
        <FieldGroup title="Night mode">
          <SelectField
            scope={brightness}
            k="nightMode"
            label="Switch to night palette"
            options={NIGHT_SOURCES}
          />
          {b.nightMode === 'sensor' && (
            <FieldGrid>
              <NumberField scope={brightness} k="nightEnterLux" label="Night below" unit={LUX} />
              <NumberField scope={brightness} k="nightExitLux" label="Day above" unit={LUX} />
            </FieldGrid>
          )}
          {b.nightMode === 'sun' && (
            <NumberField
              scope={brightness}
              k="nightSunElevationDeg"
              label="Night when the sun is below"
              unit={DEGREES}
              signed
              hint="0° is the horizon; −6° is the end of civil twilight."
            />
          )}
        </FieldGroup>
      </Card>
      <Card>
        <FieldGroup title="Signs and pop-ups">
          <SegmentedField
            scope={display}
            k="speedLimitSign"
            label="Speed-limit sign"
            options={SIGN_STYLES}
          />
          <FieldGrid>
            <NumberField
              scope={display}
              k="mediaToastMs"
              label="Song title shows for"
              unit={SECONDS_FROM_MS}
              integer
            />
            <NumberField
              scope={display}
              k="messageToastMs"
              label="Message sender shows for"
              unit={SECONDS_FROM_MS}
              integer
            />
          </FieldGrid>
          <SegmentedField
            scope={display}
            k="maxAlerts"
            label="Alerts shown at once"
            options={MAX_ALERTS}
            hint="Critical alerts always show; extra lower-priority ones wait their turn. Beyond three, they are summed up as “+N more”."
          />
        </FieldGroup>
        <FieldGroup
          title="Show only when close"
          description="Guidance and hazards appear when they matter, keeping the highway view clean."
        >
          <FieldGrid>
            <NumberField
              scope={display}
              k="highwayNavRevealM"
              label="Turn arrow on the highway"
              unit={driverUnits.shortDistance}
            />
            <NumberField
              scope={display}
              k="laneRevealM"
              label="Lane guidance"
              unit={driverUnits.shortDistance}
            />
            <NumberField
              scope={display}
              k="hazardRevealM"
              label="Hazards and cameras"
              unit={driverUnits.shortDistance}
            />
            <NumberField
              scope={display}
              k="trafficRevealM"
              label="Traffic on the highway"
              unit={driverUnits.shortDistance}
              hint="Jams, slowdowns, accidents and road works appear this far ahead on the highway (never later than other hazards)."
            />
          </FieldGrid>
        </FieldGroup>
      </Card>
    </Section>
  );
}
