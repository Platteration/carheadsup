import type {
  GestureSensorKind,
  HudConfig,
  LightSensorKind,
  SensorsConfig,
} from '@carheadsup/core';
import { roundTo } from '@carheadsup/core';
import { useState } from 'preact/hooks';
import type { Scope } from '../model/scope.ts';
import { DEGREES, plainUnit } from '../model/units.ts';
import { Button, Card, Section } from '../ui/common.tsx';
import {
  FieldGrid,
  FieldGroup,
  FieldShell,
  NumberField,
  SelectField,
  Switch,
} from '../ui/fields.tsx';
import type { Option } from '../ui/fields.tsx';

const LIGHT_SENSORS: ReadonlyArray<Option<LightSensorKind>> = [
  { value: 'none', label: 'None (use time of day)' },
  { value: 'bh1750', label: 'BH1750' },
  { value: 'veml7700', label: 'VEML7700' },
  { value: 'tsl2591', label: 'TSL2591' },
];

const GESTURE_SENSORS: ReadonlyArray<Option<GestureSensorKind>> = [
  { value: 'none', label: 'None' },
  { value: 'apds9960', label: 'APDS-9960 (swipe to accept / dismiss)' },
];

const GPIO = plainUnit('GPIO');
const PLAIN = plainUnit('');

export function SensorsSection({ root }: { root: Scope<HudConfig> }) {
  const sensors = root.child('sensors');
  const s = sensors.value;
  const buttons = sensors.child('buttons');
  return (
    <Section
      id="sensors"
      title="Sensors and buttons"
      intro="Optional hardware wired to the HUD computer."
    >
      <Card>
        <FieldGroup title="Light sensor">
          <SelectField scope={sensors} k="lightSensor" label="Sensor" options={LIGHT_SENSORS} />
          {s.lightSensor !== 'none' && (
            <NumberField
              scope={sensors}
              k="lightSensorGain"
              label="Gain"
              unit={{ ...PLAIN, decimals: 2 }}
              hint="Above 1 if the sensor sits behind tinted glass or a cover."
            />
          )}
        </FieldGroup>
        <FieldGroup title="Gestures and buttons">
          <SelectField
            scope={sensors}
            k="gestureSensor"
            label="Gesture sensor"
            options={GESTURE_SENSORS}
          />
          <FieldGrid>
            <NumberField scope={sensors} k="i2cBus" label="I²C bus" unit={PLAIN} integer />
          </FieldGrid>
          <p class="field__hint">Buttons use BCM GPIO numbers; leave empty when not fitted.</p>
          <FieldGrid>
            <NumberField
              scope={buttons}
              k="primary"
              label="Accept / OK button"
              unit={GPIO}
              integer
              nullable
            />
            <NumberField
              scope={buttons}
              k="secondary"
              label="Decline / dismiss button"
              unit={GPIO}
              integer
              nullable
            />
            <NumberField
              scope={buttons}
              k="next"
              label="Next page button"
              unit={GPIO}
              integer
              nullable
            />
          </FieldGrid>
        </FieldGroup>
      </Card>
      <Card>
        <FallbackLocation scope={sensors} />
        <FieldGroup title="Driver-assist module">
          <NumberField
            scope={sensors}
            k="adasUdpPort"
            label="Blind-spot / collision feed (UDP port)"
            unit={PLAIN}
            integer
            nullable
            hint="For an add-on camera or radar module. Leave empty when not fitted."
          />
        </FieldGroup>
      </Card>
    </Section>
  );
}

function FallbackLocation({ scope }: { scope: Scope<SensorsConfig> }) {
  const location = scope.value.fallbackLocation;
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const useHere = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('This device cannot share its location.');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        scope.set('fallbackLocation', {
          lat: roundTo(pos.coords.latitude, 3),
          lon: roundTo(pos.coords.longitude, 3),
        });
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied.'
            : 'Could not get a location.',
        );
      },
      { timeout: 15_000, maximumAge: 600_000 },
    );
  };
  return (
    <FieldGroup
      title="Fallback location"
      description="Used for sunset-based night mode when the phone is not sharing its location. Rounded to about 100 m."
    >
      <FieldShell label="Use a fixed location" dirty={scope.dirty('fallbackLocation')} inline>
        <Switch
          checked={location !== null}
          label="Use a fixed location"
          onChange={(on) => scope.set('fallbackLocation', on ? { lat: 0, lon: 0 } : null)}
        />
      </FieldShell>
      {location !== null && (
        <>
          <FieldGrid>
            <NumberField
              scope={scope.child('fallbackLocation') as Scope<{ lat: number; lon: number }>}
              k="lat"
              label="Latitude"
              unit={{ ...DEGREES, decimals: 3 }}
              signed
            />
            <NumberField
              scope={scope.child('fallbackLocation') as Scope<{ lat: number; lon: number }>}
              k="lon"
              label="Longitude"
              unit={{ ...DEGREES, decimals: 3 }}
              signed
            />
          </FieldGrid>
          <Button size="small" onClick={useHere} busy={locating}>
            Use this device’s location
          </Button>
          {error && <p class="field__error">{error}</p>}
        </>
      )}
    </FieldGroup>
  );
}
