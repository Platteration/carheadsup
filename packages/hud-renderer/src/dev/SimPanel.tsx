import type { SimControl, SimDriveMode, SimStatus } from '@carheadsup/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { describeError } from '../common/api.ts';
import { cx } from '../hud/util.ts';
import { useDtcLookup } from './dtc-lookup.ts';
import {
  DEFAULT_TYRES_KPA,
  GEAR_CHOICES,
  PHONE_ACTIONS,
  QUICK_DTCS,
  checkDtcEntry,
  describeLux,
  luxFromSlider,
  sanitizeTyre,
  sliderFromLux,
  toggleDtc,
} from './sim-model.ts';
import type { SimHandle } from './useSim.ts';
import { useThrottled } from './useSim.ts';

type CollisionChoice = NonNullable<NonNullable<SimControl['adas']>['collision']>;

/** Slider changes are sent at most this often. */
export const SLIDER_SEND_MS = 120;
/** After touching a control, ignore polled values for it this long (so it does not jump back). */
const USER_HOLD_MS = 1500;

function Group({
  title,
  children,
  aside,
}: {
  title: string;
  children: ComponentChildren;
  aside?: ComponentChildren;
}) {
  return (
    <section class="sim-group">
      <header class="sim-group__head">
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** A value from the simulator, overridden by the user's own recent input. */
function useHeld<T>(remote: T | undefined, fallback: T): [T, (v: T) => void] {
  const [local, setLocal] = useState<{ value: T; at: number } | null>(null);
  const held = local !== null && Date.now() - local.at < USER_HOLD_MS;
  const value = held || remote === undefined ? (local?.value ?? fallback) : remote;
  return [value, (v: T) => setLocal({ value: v, at: Date.now() })];
}

export function SimPanel({ sim }: { sim: SimHandle }) {
  const { availability, status, error } = sim;
  if (availability === 'real-vehicle') {
    return (
      <div class="sim-notice" role="status">
        <p class="sim-notice__title">Connected to a real vehicle</p>
        <p>
          The HUD is reading a car over OBD-II, so the simulator controls are hidden. Start the
          server with <code>--sim</code> to use them.
        </p>
      </div>
    );
  }
  const offline = availability !== 'available';
  return (
    <div class={cx('sim', offline && 'sim--offline')}>
      {availability === 'unreachable' && (
        <div class="sim-notice sim-notice--error" role="alert">
          <p class="sim-notice__title">HUD server not reachable</p>
          <p>{describeError(error)} Controls unlock when it answers.</p>
          <button type="button" class="dbtn dbtn--small" onClick={sim.refresh}>
            Retry now
          </button>
        </div>
      )}
      {availability === 'checking' && <p class="muted">Checking for the simulator…</p>}
      <StatusReadout status={status} />
      <fieldset class="sim-fields" disabled={offline}>
        <DriveControls sim={sim} status={status} />
        <FaultControls sim={sim} status={status} />
        <EnvironmentControls sim={sim} status={status} />
        <PhoneControls sim={sim} />
        <AdasControls sim={sim} />
        <TyreControls sim={sim} />
      </fieldset>
      {availability === 'available' && error !== null && (
        <p class="sim-error">Last command failed: {describeError(error)}</p>
      )}
    </div>
  );
}

function StatusReadout({ status }: { status: SimStatus | null }) {
  const cells: Array<[string, ComponentChildren]> = [
    ['Mode', status ? (status.mode === 'scenario' ? 'Scripted drive' : 'Manual') : '–'],
    ['Speed', status ? `${Math.round(status.speedKph)} km/h` : '–'],
    ['Engine', status ? (status.engineRunning ? `${Math.round(status.rpm)} rpm` : 'Off') : '–'],
    [
      'Gear',
      status
        ? status.gear === null
          ? 'Auto'
          : status.gear === 0
            ? 'N'
            : String(status.gear)
        : '–',
    ],
    [
      'Throttle / brake',
      status ? `${Math.round(status.throttle * 100)} % / ${Math.round(status.brake * 100)} %` : '–',
    ],
    ['Light', status ? describeLux(status.lux) : '–'],
    ['Outside', status ? `${Math.round(status.ambientTempC)} °C` : '–'],
    ['Codes', status ? (status.dtcs.length === 0 ? 'None' : status.dtcs.join(', ')) : '–'],
  ];
  return (
    <div class="sim-status" aria-label="Simulator status">
      {status?.scenarioStep && (
        <p class="sim-status__step">
          <span class="muted">Scenario:</span> {status.scenarioStep}
        </p>
      )}
      <dl class="sim-status__grid">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="dswitch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span class="dswitch__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

function Choice<V>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div class="dseg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.label)}
          type="button"
          class={cx('dseg__item', o.value === value && 'dseg__item--on')}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onInput,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onInput: (v: number) => void;
}) {
  return (
    <label class="dslider">
      <span class="dslider__label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onInput(Number(e.currentTarget.value))}
      />
      <output class="dslider__value">{format(value)}</output>
    </label>
  );
}

function DriveControls({ sim, status }: { sim: SimHandle; status: SimStatus | null }) {
  const [throttle, setThrottle] = useHeld(status?.throttle, 0);
  const [brake, setBrake] = useHeld(status?.brake, 0);
  const sendThrottle = useThrottled(
    (v: number) => void sim.send({ mode: 'manual', throttle: v }),
    SLIDER_SEND_MS,
  );
  const sendBrake = useThrottled(
    (v: number) => void sim.send({ mode: 'manual', brake: v }),
    SLIDER_SEND_MS,
  );
  return (
    <Group title="Drive">
      <div class="sim-row">
        <Choice<SimDriveMode>
          label="Drive mode"
          options={[
            { value: 'scenario', label: 'Scripted drive' },
            { value: 'manual', label: 'Manual' },
          ]}
          value={status?.mode ?? 'scenario'}
          onChange={(mode) => void sim.send({ mode })}
        />
        <Toggle
          label="Engine"
          checked={status?.engineRunning ?? false}
          onChange={(on) => void sim.send({ engineRunning: on })}
        />
      </div>
      <Slider
        label="Throttle"
        value={throttle}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)} %`}
        onInput={(v) => {
          setThrottle(v);
          sendThrottle(v);
        }}
      />
      <Slider
        label="Brake"
        value={brake}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)} %`}
        onInput={(v) => {
          setBrake(v);
          sendBrake(v);
        }}
      />
      <p class="sim-hint">Moving a pedal switches to manual driving.</p>
      <div class="sim-row sim-row--label">
        <span class="sim-label">Gear</span>
        <Choice
          label="Gear"
          options={GEAR_CHOICES}
          value={status?.gear ?? null}
          onChange={(gear) => void sim.send({ gear })}
        />
      </div>
    </Group>
  );
}

interface Override {
  on: boolean;
  value: number;
}

function FaultControls({ sim, status }: { sim: SimHandle; status: SimStatus | null }) {
  const dtcs = status?.dtcs ?? [];
  const lookup = useDtcLookup();
  const [entry, setEntry] = useState('');
  const check = checkDtcEntry(entry, lookup);
  const [coolant, setCoolant] = useState<Override>({ on: false, value: 118 });
  const [voltage, setVoltage] = useState<Override>({ on: false, value: 11.6 });
  const [fuel, setFuel] = useState<Override>({ on: false, value: 8 });
  const sendCoolant = useThrottled(
    (v: number | null) => void sim.send({ coolantOverrideC: v }),
    SLIDER_SEND_MS,
  );
  const sendVoltage = useThrottled(
    (v: number | null) => void sim.send({ voltageOverrideV: v }),
    SLIDER_SEND_MS,
  );
  const sendFuel = useThrottled(
    (v: number | null) => void sim.send({ fuelLevelOverridePct: v }),
    SLIDER_SEND_MS,
  );

  const override = (
    label: string,
    state: Override,
    set: (o: Override) => void,
    send: (v: number | null) => void,
    range: { min: number; max: number; step: number; format: (v: number) => string },
  ) => (
    <div class={cx('override', state.on && 'override--on')}>
      <Toggle
        label={label}
        checked={state.on}
        onChange={(on) => {
          set({ ...state, on });
          send(on ? state.value : null);
        }}
      />
      <input
        type="range"
        aria-label={`${label} value`}
        min={range.min}
        max={range.max}
        step={range.step}
        value={state.value}
        disabled={!state.on}
        onInput={(e) => {
          const value = Number(e.currentTarget.value);
          set({ on: true, value });
          send(value);
        }}
      />
      <output class="dslider__value">{range.format(state.value)}</output>
    </div>
  );

  return (
    <Group
      title="Faults"
      aside={
        <button
          type="button"
          class="dbtn dbtn--small dbtn--ghost"
          disabled={dtcs.length === 0}
          onClick={() => void sim.send({ dtcs: [] })}
        >
          Clear codes
        </button>
      }
    >
      <div class="chip-row" role="group" aria-label="Inject trouble codes">
        {QUICK_DTCS.map((code) => {
          const on = dtcs.includes(code);
          return (
            <button
              key={code}
              type="button"
              class={cx('dchip', on && 'dchip--on')}
              aria-pressed={on}
              title={lookup?.(code).description}
              onClick={() => void sim.send({ dtcs: toggleDtc(dtcs, code, !on) })}
            >
              <span class="dchip__code">{code}</span>
              {lookup && <span class="dchip__label">{lookup(code).short}</span>}
            </button>
          );
        })}
      </div>
      <form
        class="sim-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (check.ok) {
            void sim.send({ dtcs: toggleDtc(dtcs, check.code, true) });
            setEntry('');
          }
        }}
      >
        <input
          class="dinput dinput--mono"
          aria-label="Custom trouble code"
          placeholder="Custom code, e.g. P0301"
          value={entry}
          maxLength={5}
          onInput={(e) => setEntry(e.currentTarget.value.toUpperCase())}
        />
        <button type="submit" class="dbtn" disabled={!check.ok}>
          Inject
        </button>
      </form>
      {entry !== '' && (
        <p class={cx('sim-hint', !check.ok && 'sim-hint--error')}>
          {check.ok ? check.label : check.error}
        </p>
      )}
      {dtcs.filter((c) => !QUICK_DTCS.includes(c)).length > 0 && (
        <div class="chip-row">
          {dtcs
            .filter((c) => !QUICK_DTCS.includes(c))
            .map((code) => (
              <button
                key={code}
                type="button"
                class="dchip dchip--on"
                title="Remove"
                onClick={() => void sim.send({ dtcs: toggleDtc(dtcs, code, false) })}
              >
                <span class="dchip__code">{code}</span>
                <span class="dchip__label">×</span>
              </button>
            ))}
        </div>
      )}
      <div class="overrides">
        {override('Coolant', coolant, setCoolant, sendCoolant, {
          min: 40,
          max: 130,
          step: 1,
          format: (v) => `${v} °C`,
        })}
        {override('Battery', voltage, setVoltage, sendVoltage, {
          min: 10,
          max: 16,
          step: 0.1,
          format: (v) => `${v.toFixed(1)} V`,
        })}
        {override('Fuel', fuel, setFuel, sendFuel, {
          min: 0,
          max: 100,
          step: 1,
          format: (v) => `${v} %`,
        })}
      </div>
    </Group>
  );
}

function EnvironmentControls({ sim, status }: { sim: SimHandle; status: SimStatus | null }) {
  const [lux, setLux] = useHeld(status?.lux, 10_000);
  const [temp, setTemp] = useHeld(status?.ambientTempC, 17);
  const sendLux = useThrottled((v: number) => void sim.send({ lux: v }), SLIDER_SEND_MS);
  const sendTemp = useThrottled((v: number) => void sim.send({ ambientTempC: v }), SLIDER_SEND_MS);
  return (
    <Group title="Environment">
      <Slider
        label="Ambient light"
        value={sliderFromLux(lux)}
        min={0}
        max={1}
        step={0.005}
        format={() => describeLux(lux)}
        onInput={(p) => {
          const v = luxFromSlider(p);
          setLux(v);
          sendLux(v);
        }}
      />
      <Slider
        label="Outside"
        value={temp}
        min={-25}
        max={45}
        step={1}
        format={(v) => `${Math.round(v)} °C`}
        onInput={(v) => {
          setTemp(v);
          sendTemp(v);
        }}
      />
    </Group>
  );
}

function PhoneControls({ sim }: { sim: SimHandle }) {
  return (
    <Group title="Phone">
      <div class="button-grid">
        {PHONE_ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            class="dbtn"
            onClick={() => void sim.send({ phone: a.event })}
          >
            {a.label}
          </button>
        ))}
      </div>
    </Group>
  );
}

function AdasControls({ sim }: { sim: SimHandle }) {
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const [collision, setCollision] = useState<CollisionChoice>('none');
  const send = (adas: NonNullable<SimControl['adas']>) => void sim.send({ adas });
  return (
    <Group title="Driver assist">
      <div class="sim-row">
        <Toggle
          label="Blind spot left"
          checked={left}
          onChange={(v) => {
            setLeft(v);
            send({ blindSpotLeft: v });
          }}
        />
        <Toggle
          label="Blind spot right"
          checked={right}
          onChange={(v) => {
            setRight(v);
            send({ blindSpotRight: v });
          }}
        />
      </div>
      <div class="sim-row sim-row--label">
        <span class="sim-label">Collision</span>
        <Choice<CollisionChoice>
          label="Forward collision"
          options={[
            { value: 'none', label: 'None' },
            { value: 'caution', label: 'Caution' },
            { value: 'warning', label: 'Warning' },
          ]}
          value={collision}
          onChange={(v) => {
            setCollision(v);
            send({ collision: v });
          }}
        />
      </div>
    </Group>
  );
}

type Tyres = { fl: number; fr: number; rl: number; rr: number };

function TyreControls({ sim }: { sim: SimHandle }) {
  const [on, setOn] = useState(false);
  const [tyres, setTyres] = useState<Tyres>({ ...DEFAULT_TYRES_KPA });
  const sendTyres = useThrottled(
    (t: Tyres | null) => void sim.send({ tirePressuresKpa: t }),
    SLIDER_SEND_MS,
  );
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    sendTyres(on ? tyres : null);
  }, [on, tyres]);
  const field = (key: keyof Tyres, label: string) => (
    <label class="tyre">
      <span>{label}</span>
      <input
        class="dinput"
        type="number"
        min={0}
        max={600}
        step={5}
        value={tyres[key]}
        disabled={!on}
        onInput={(e) =>
          setTyres({ ...tyres, [key]: sanitizeTyre(Number(e.currentTarget.value), tyres[key]) })
        }
      />
      <span class="muted">kPa</span>
    </label>
  );
  return (
    <Group
      title="Tyre pressures"
      aside={<Toggle label="Report TPMS" checked={on} onChange={setOn} />}
    >
      <div class="tyres">
        {field('fl', 'Front left')}
        {field('fr', 'Front right')}
        {field('rl', 'Rear left')}
        {field('rr', 'Rear right')}
      </div>
      <div class="sim-row">
        <button
          type="button"
          class="dbtn dbtn--small"
          disabled={!on}
          onClick={() => setTyres({ ...tyres, rl: 165 })}
        >
          Slow leak rear left
        </button>
        <button
          type="button"
          class="dbtn dbtn--small dbtn--ghost"
          disabled={!on}
          onClick={() => setTyres({ ...DEFAULT_TYRES_KPA })}
        >
          Reset
        </button>
      </div>
    </Group>
  );
}
