import type {
  GestureSensorKind,
  HudConfig,
  LightSensorKind,
  SensorsConfig,
} from '@carheadsup/core';
import { MAX_ADAS_ALLOWED_SENDERS, normalizeIpAddress, roundTo } from '@carheadsup/core';
import type { JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { Scope } from '../model/scope.ts';
import { DEGREES, plainUnit } from '../model/units.ts';
import { Button, Card, Notice, Section } from '../ui/common.tsx';
import {
  FieldGrid,
  FieldGroup,
  FieldShell,
  NumberField,
  SelectField,
  Switch,
  issueText,
} from '../ui/fields.tsx';
import type { Option } from '../ui/fields.tsx';
import { useForm } from '../ui/form-context.ts';

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
          {s.adasUdpPort !== null && <AllowedSenders scope={sensors} />}
        </FieldGroup>
      </Card>
    </Section>
  );
}

const NOT_AN_ADDRESS = 'Enter an IPv4 or IPv6 address, e.g. 10.42.0.50';

/**
 * `sensors.adasAllowedSenders`: the addresses the ADAS feed listens to. Addresses are checked
 * and stored in canonical form as they are added. A typed address that was not added blocks
 * saving, so it cannot be silently left out; its problem shows once the box is left or Add
 * pressed, not while typing.
 */
function AllowedSenders({ scope }: { scope: Scope<SensorsConfig> }) {
  const list = scope.child('adasAllowedSenders');
  const senders = list.value;
  const key = list.key;
  const form = useForm();
  const id = useId();
  const [typedText, setTypedText] = useState('');
  const [touched, setTouched] = useState(false);

  // Discard / reload: forget a half-typed address.
  const firstRevision = useRef(form.revision);
  useEffect(() => {
    if (form.revision === firstRevision.current) return;
    setTypedText('');
    setTouched(false);
  }, [form.revision]);

  const typed = typedText.trim();
  const address = typed === '' ? null : normalizeIpAddress(typed);
  const listed = new Set(senders.map((sender) => normalizeIpAddress(sender) ?? sender));
  const full = senders.length >= MAX_ADAS_ALLOWED_SENDERS;
  const problem =
    typed === ''
      ? null
      : address === null
        ? NOT_AN_ADDRESS
        : listed.has(address)
          ? `${address} is already in the list`
          : `Press Add to include ${address}, or clear the box`;
  useEffect(() => {
    form.setLocalError(key, problem);
  }, [key, problem]);
  useEffect(() => () => form.setLocalError(key, null), [key]);

  const add = () => {
    setTouched(true);
    if (address === null || listed.has(address) || full) return;
    list.replace([...senders, address]);
    setTypedText('');
    setTouched(false);
  };
  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add();
  };

  const issue = list.issuesWithin()[0];
  const error = (touched ? problem : null) ?? (issue ? issueText(issue) : null);
  return (
    <div class="allowed-senders">
      {senders.length === 0 && (
        <Notice tone="warning" title="Any device on the car’s network can send warnings">
          A passenger’s phone on the Wi-Fi could show a false “BRAKE!” or hide a real warning. Give
          the module a static address and add it below.
        </Notice>
      )}
      <FieldShell
        label="Accept data only from"
        inputId={id}
        hint={
          full
            ? `At most ${MAX_ADAS_ALLOWED_SENDERS} addresses.`
            : 'The module’s IPv4 address (give the module a static one). Data from other devices is ignored; with no address here, any device is heard.'
        }
        error={error}
        dirty={scope.dirty('adasAllowedSenders')}
        path={key}
      >
        <div class="input-row">
          <input
            id={id}
            class="input input--mono"
            type="text"
            value={typedText}
            placeholder="e.g. 10.42.0.50"
            disabled={full}
            autoComplete="off"
            autoCapitalize="off"
            spellcheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onInput={(event) => {
              setTypedText(event.currentTarget.value);
              setTouched(false);
            }}
            onBlur={() => setTouched(true)}
            onKeyDown={onKeyDown}
          />
          <Button onClick={add} disabled={full}>
            Add
          </Button>
        </div>
      </FieldShell>
      {senders.length > 0 && (
        <ul class="address-list" aria-label="Accepted senders">
          {senders.map((sender, index) => (
            <li key={sender} class="address-list__item">
              <code>{sender}</code>
              <Button
                size="small"
                variant="ghost"
                aria-label={`Remove ${sender}`}
                onClick={() => list.replace(senders.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
