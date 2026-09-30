import type { HudFrame, InputAction, SimControl } from '@carheadsup/core';
import { Fragment } from 'preact';
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { HudPreview } from '../dev/HudPreview.tsx';
import { ownsKey } from '../dev/sim-model.ts';
import { actionForKey } from '../hud/keyboard.ts';
import { useWakeLock } from '../hud/kiosk.ts';
import { cx } from '../hud/util.ts';
import type { DemoEngine, DemoStatus } from './engine.ts';
import {
  AMBIENT_MAX_C,
  AMBIENT_MIN_C,
  CLEAR_FAULTS,
  DEMO_PANELS,
  DRIVER_BUTTONS,
  FAULTS,
  LAYOUTS,
  LIGHTS,
  PREFS_KEY,
  activeFaults,
  faultControl,
  formatTemperature,
  lightFromLux,
  panelById,
  prefsConfig,
  readout,
} from './model.ts';
import type { DemoPrefs, LayoutChoice, LightChoice, PanelId, UnitChoice } from './model.ts';
import './demo.css';

/** How often the controls and the readout re-read the simulator. */
const STATUS_MS = 250;
/**
 * Two columns (HUD beside the controls) on large screens and phones held sideways; otherwise the
 * HUD stays pinned on top. Keep in step with the media query in demo.css.
 */
const WIDE_QUERY =
  '(min-width: 1000px) and (min-height: 560px), (min-width: 700px) and (orientation: landscape)';
/** On narrow screens the pinned HUD takes at most this share of the window height. */
const PINNED_HUD_SHARE = 0.42;

function useFrame(engine: DemoEngine): HudFrame {
  const [frame, setFrame] = useState<HudFrame>(() => engine.frame);
  useEffect(() => engine.onFrame(setFrame), [engine]);
  return frame;
}

function useStatus(engine: DemoEngine): [DemoStatus, (next?: DemoStatus) => void] {
  const [status, setStatus] = useState<DemoStatus>(() => engine.status());
  useEffect(() => {
    const timer = setInterval(() => setStatus(engine.status()), STATUS_MS);
    return () => clearInterval(timer);
  }, [engine]);
  return [status, (next) => setStatus(next ?? engine.status())];
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function useWindowHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const update = () => setHeight(window.innerHeight);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return height;
}

function saveBrowserPrefs(prefs: DemoPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Remembering is a convenience; without storage the page simply starts from the defaults.
  }
}

export interface DemoAppProps {
  engine: DemoEngine;
  initialPrefs: DemoPrefs;
  /** Where preferences go (default: this browser's local storage, if it allows). */
  savePrefs?: (prefs: DemoPrefs) => void;
}

/**
 * The drive simulator page: the live HUD (the real HudView, unmirrored) fed by an in-page
 * {@link DemoEngine}, a one-line readout under it and a console of controls for the simulated
 * car, phone, conditions and driver-assistance module, plus the HUD's own driver buttons.
 */
export function DemoApp({ engine, initialPrefs, savePrefs = saveBrowserPrefs }: DemoAppProps) {
  const [status, refresh] = useStatus(engine);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [flash, setFlash] = useState<InputAction | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useWakeLock();

  const updatePrefs = (patch: Partial<DemoPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
    if ('units' in patch || 'layout' in patch || 'shiftLight' in patch) {
      engine.configure(prefsConfig(next));
    }
  };
  const control = (value: SimControl) => refresh(engine.control(value));
  const press = (action: InputAction) => {
    engine.input(action);
    setFlash(action);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 180);
  };
  const wide = useMedia(WIDE_QUERY);
  const stage = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(stage);
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (ownsKey(event.target, event.key)) return;
      const action = actionForKey(event);
      if (action === null) return;
      event.preventDefault();
      pressRef.current(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const note = (
    <p class="note">
      <strong>What you're seeing.</strong> This is the HUD software itself, running in this page
      with the same engine, rules and display as in the car, fed by a simulated car and phone. In
      the car the image is mirrored and reflected off the windshield. Here it is shown unmirrored.
    </p>
  );
  return (
    <div class="demo">
      <header class="masthead">
        <div class="masthead__name">
          <p class="masthead__brand">carheadsup</p>
          <h1 class="masthead__title">Drive Simulator</h1>
        </div>
        {fullscreen.available && (
          <button
            type="button"
            id="hud-fullscreen"
            class="key key--small"
            onClick={fullscreen.toggle}
            title="Show only the HUD, full screen (Esc to leave)"
          >
            Full screen
          </button>
        )}
      </header>
      <main class="layout">
        <Windshield
          engine={engine}
          status={status}
          prefs={prefs}
          wide={wide}
          stage={stage}
          fullscreen={fullscreen.active}
          below={wide ? note : null}
        />
        {!wide && note}
        <div class="console">
          <DriveGroup engine={engine} status={status} control={control} refresh={refresh} />
          <ButtonsGroup press={press} flash={flash} />
          <PhoneGroup control={control} />
          <FaultsGroup status={status} control={control} />
          <OutsideGroup
            status={status}
            units={prefs.units}
            iceRiskC={engine.config.alerts.iceRiskC}
            control={control}
          />
          <AssistGroup status={status} control={control} />
          <DisplayGroup prefs={prefs} update={updatePrefs} />
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The HUD

/** Gap between the HUD and the readout under it (matches `.windshield` in demo.css). */
const WINDSHIELD_GAP_PX = 10;

/** Full screen for `target` where the browser allows it (not in every embedded page or phone). */
function useFullscreen(target: RefObject<HTMLElement>): {
  available: boolean;
  active: boolean;
  toggle: () => void;
} {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const update = () => setActive(document.fullscreenElement === target.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [target]);
  const toggle = () => {
    const el = target.current;
    if (!el) return;
    const request = document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen();
    // Refused (no permission in this frame): the page works the same without it.
    request.catch(() => undefined);
  };
  return { available: document.fullscreenEnabled === true, active, toggle };
}

/**
 * The HUD at the chosen panel size with the readout under it, redrawn with every frame (only this
 * part of the page follows the frame rate). It is scaled to fit: on wide screens into the column's
 * height (above the readout and the note), on narrow ones into a share of the window height so
 * the pinned HUD leaves room for the controls, and in full screen into the whole screen.
 */
function Windshield({
  engine,
  status,
  prefs,
  wide,
  stage,
  fullscreen,
  below,
}: {
  engine: DemoEngine;
  status: DemoStatus;
  prefs: DemoPrefs;
  wide: boolean;
  /** The element that goes full screen. */
  stage: RefObject<HTMLDivElement>;
  fullscreen: boolean;
  below: ComponentChildren;
}) {
  const frame = useFrame(engine);
  const light: LightChoice = lightFromLux(status.lux);
  const area = useRef<HTMLElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ column: 0, stage: 0 });
  const windowHeight = useWindowHeight();

  useLayoutEffect(() => {
    const measure = () => {
      const column = (area.current?.clientHeight ?? 0) - (foot.current?.offsetHeight ?? 0);
      const next = { column: column - WINDSHIELD_GAP_PX, stage: stage.current?.clientHeight ?? 0 };
      setRoom((prev) => (prev.column === next.column && prev.stage === next.stage ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    for (const el of [area.current, stage.current, foot.current]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [wide, stage]);

  const maxHeight = fullscreen
    ? room.stage
    : wide && room.column > 0
      ? room.column
      : Math.max(150, Math.round(windowHeight * PINNED_HUD_SHARE));
  return (
    <section class="windshield" aria-label="Heads-up display" ref={area}>
      <div class={cx('stage', fullscreen && 'stage--fullscreen')} ref={stage}>
        <HudPreview
          frame={frame}
          panel={panelById(prefs.panel)}
          backdrop={prefs.backdrop ? light : 'none'}
          maxHeight={Math.max(60, maxHeight)}
          maxScale={fullscreen ? 4 : 1.5}
          class="stage__hud"
        />
      </div>
      <div class="windshield__foot" ref={foot}>
        <Readout frame={frame} status={status} units={prefs.units} />
        {below}
      </div>
    </section>
  );
}

function Readout({
  frame,
  status,
  units,
}: {
  frame: HudFrame;
  status: DemoStatus;
  units: UnitChoice;
}) {
  return (
    <p class="readout">
      {readout(frame.context, status, units).map((part, i) => (
        <Fragment key={i}>
          {/* Separates the parts for screen readers and copying; the flex layout ignores it. */}
          {i > 0 && ' '}
          <span class="readout__part">
            {part.label !== null && (
              <span class={cx('readout__label', part.optional && 'readout__label--optional')}>
                {part.label}{' '}
              </span>
            )}
            {part.value}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// Controls

function Group({
  id,
  title,
  aside,
  tone,
  children,
}: {
  id: string;
  title: string;
  aside?: ComponentChildren;
  /** Colour of the lit indicators in this group. */
  tone?: 'caution' | 'alarm';
  children: ComponentChildren;
}) {
  return (
    <section class={cx('group', tone && `group--${tone}`)} aria-labelledby={`${id}-title`}>
      <header class="group__head">
        <h2 class="group__title" id={`${id}-title`}>
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/**
 * After a mouse or touch press, give the focus back to the page so that Enter and Space reach the
 * HUD shortcuts instead of pressing the same button again. Keyboard presses keep the focus.
 */
function releaseAfterPointer(event: MouseEvent): void {
  if (event.detail > 0 && event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
}

/** A pushbutton; with `on` it latches, and its indicator lights while on. */
function Key({
  id,
  on,
  onClick,
  title,
  class: extra,
  children,
}: {
  id: string;
  on?: boolean;
  onClick: () => void;
  title?: string;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      id={id}
      class={cx('key', on !== undefined && 'key--latch', extra)}
      aria-pressed={on}
      title={title}
      onClick={(event) => {
        onClick();
        releaseAfterPointer(event);
      }}
    >
      {children}
    </button>
  );
}

function Segmented<V extends string | number>({
  id,
  label,
  hideLabel = false,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  /** Name the choice for assistive technology only (the options say it all). */
  hideLabel?: boolean;
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <div class="field">
      <span class={cx('field__label', hideLabel && 'visually-hidden')} id={`${id}-label`}>
        {label}
      </span>
      <div class="seg" role="group" aria-labelledby={`${id}-label`}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            id={`${id}-${option.value}`}
            class="seg__item"
            aria-pressed={option.value === value}
            onClick={(event) => {
              onChange(option.value);
              releaseAfterPointer(event);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  onInput,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onInput: (value: number) => void;
}) {
  return (
    <div class="field field--slider">
      <label class="field__label" for={id}>
        {label}
      </label>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(event) => onInput(Number(event.currentTarget.value))}
      />
      <output class="field__value" id={`${id}-value`} for={id}>
        {display}
      </output>
    </div>
  );
}

type Control = (value: SimControl) => void;

function DriveGroup({
  engine,
  status,
  control,
  refresh,
}: {
  engine: DemoEngine;
  status: DemoStatus;
  control: Control;
  refresh: (next?: DemoStatus) => void;
}) {
  const scripted = status.mode === 'scenario';
  return (
    <Group
      id="drive"
      title="Drive"
      aside={
        <Key
          id="drive-restart"
          class="key--small"
          onClick={() => refresh(engine.restartDrive())}
          title="Start the scripted drive again from the beginning"
        >
          Restart
        </Key>
      }
    >
      <div class="row">
        <Segmented
          id="drive-mode"
          label="Who drives"
          hideLabel
          options={[
            { value: 'scenario', label: 'Scripted' },
            { value: 'manual', label: 'Manual' },
          ]}
          value={status.mode}
          onChange={(mode) => control({ mode })}
        />
        <Key
          id="drive-engine"
          on={status.engineRunning}
          onClick={() => control({ mode: 'manual', engineRunning: !status.engineRunning })}
          title="Start or stop the engine (takes over from the script)"
        >
          Engine
        </Key>
      </div>
      <Slider
        id="drive-throttle"
        label="Throttle"
        value={status.throttle}
        min={0}
        max={1}
        step={0.01}
        display={`${Math.round(status.throttle * 100)} %`}
        onInput={(throttle) => control({ mode: 'manual', throttle })}
      />
      <Slider
        id="drive-brake"
        label="Brake"
        value={status.brake}
        min={0}
        max={1}
        step={0.01}
        display={`${Math.round(status.brake * 100)} %`}
        onInput={(brake) => control({ mode: 'manual', brake })}
      />
      <p class="hint">
        {scripted
          ? 'The script drives a 5-minute loop. Moving a pedal takes over.'
          : 'You are driving. Scripted restarts the loop from the start.'}
      </p>
    </Group>
  );
}

function ButtonsGroup({
  press,
  flash,
}: {
  press: (action: InputAction) => void;
  flash: InputAction | null;
}) {
  return (
    <Group id="buttons" title="Driver buttons">
      <div class="keys keys--3 keys--stacked">
        {DRIVER_BUTTONS.map((button) => (
          <Key
            key={button.action}
            id={`input-${button.action}`}
            class={cx(flash === button.action && 'key--flash')}
            title={button.title}
            onClick={() => press(button.action)}
          >
            {button.label}
            <kbd class="key__kbd">{button.keys}</kbd>
          </Key>
        ))}
      </div>
    </Group>
  );
}

const PHONE_EVENTS: ReadonlyArray<{ id: string; label: string; event: SimControl['phone'] }> = [
  {
    id: 'phone-call',
    label: 'Incoming call',
    event: { kind: 'incoming-call', name: 'Maria Lopez' },
  },
  { id: 'phone-message', label: 'Message', event: { kind: 'message', sender: 'Alex Chen' } },
  { id: 'phone-track', label: 'Next track', event: { kind: 'next-track' } },
  { id: 'phone-camera', label: 'Speed camera', event: { kind: 'speed-camera' } },
  { id: 'phone-nav-start', label: 'Start route', event: { kind: 'nav-start' } },
  { id: 'phone-nav-stop', label: 'End route', event: { kind: 'nav-stop' } },
];

function PhoneGroup({ control }: { control: Control }) {
  return (
    <Group id="phone" title="Phone">
      <div class="keys keys--3">
        {PHONE_EVENTS.map(({ id, label, event }) => (
          <Key key={id} id={id} onClick={() => control({ phone: event })}>
            {label}
          </Key>
        ))}
      </div>
    </Group>
  );
}

function FaultsGroup({ status, control }: { status: DemoStatus; control: Control }) {
  const active = activeFaults(status);
  return (
    <Group id="faults" title="Faults" tone="caution">
      <div class="keys keys--3 keys--stacked">
        {FAULTS.map((fault) => {
          const on = active.has(fault.id);
          return (
            <Key
              key={fault.id}
              id={`fault-${fault.id}`}
              on={on}
              onClick={() => control(faultControl(fault.id, !on, status.dtcs))}
            >
              <span class="key__code">{fault.label}</span>
              <span class="key__detail">{fault.detail}</span>
            </Key>
          );
        })}
        <Key id="fault-clear" onClick={() => control(CLEAR_FAULTS)} title="Switch every fault off">
          <span>Clear</span>
          <span class="key__detail">all faults</span>
        </Key>
      </div>
      <p class="hint">Minor trouble codes wait until the car stops.</p>
    </Group>
  );
}

function OutsideGroup({
  status,
  units,
  iceRiskC,
  control,
}: {
  status: DemoStatus;
  units: UnitChoice;
  iceRiskC: number;
  control: Control;
}) {
  return (
    <Group id="outside" title="Outside">
      <Segmented
        id="light"
        label="Light"
        options={LIGHTS}
        value={lightFromLux(status.lux)}
        onChange={(value) => {
          const light = LIGHTS.find((l) => l.value === value);
          if (light) control({ lux: light.lux });
        }}
      />
      <Slider
        id="outside-temp"
        label="Temperature"
        value={status.ambientTempC}
        min={AMBIENT_MIN_C}
        max={AMBIENT_MAX_C}
        step={1}
        display={formatTemperature(status.ambientTempC, units)}
        onInput={(ambientTempC) => control({ ambientTempC })}
      />
      <p class="hint">
        At night the HUD dims itself for dark-adapted eyes (Brighter trims it). Ice warning at{' '}
        {formatTemperature(iceRiskC, units)} and below.
      </p>
    </Group>
  );
}

function AssistGroup({ status, control }: { status: DemoStatus; control: Control }) {
  const { adas } = status;
  return (
    <Group id="assist" title="Driver assistance" tone="alarm">
      <div class="keys keys--2">
        <Key
          id="adas-blind-left"
          on={adas.blindSpotLeft}
          onClick={() => control({ adas: { blindSpotLeft: !adas.blindSpotLeft } })}
        >
          Blind spot left
        </Key>
        <Key
          id="adas-blind-right"
          on={adas.blindSpotRight}
          onClick={() => control({ adas: { blindSpotRight: !adas.blindSpotRight } })}
        >
          Blind spot right
        </Key>
      </div>
      <Segmented
        id="adas-collision"
        label="Vehicle ahead"
        options={[
          { value: 'none', label: 'Clear' },
          { value: 'caution', label: 'Caution' },
          { value: 'warning', label: 'Brake' },
        ]}
        value={adas.collision}
        onChange={(collision) => control({ adas: { collision } })}
      />
    </Group>
  );
}

function DisplayGroup({
  prefs,
  update,
}: {
  prefs: DemoPrefs;
  update: (patch: Partial<DemoPrefs>) => void;
}) {
  return (
    <Group id="display" title="Display">
      <div class="row">
        <Segmented<PanelId>
          id="panel"
          label="Screen"
          options={DEMO_PANELS.map((p) => ({
            value: `${p.width}x${p.height}` as PanelId,
            label: p.label.replace(/\s/g, ''),
          }))}
          value={prefs.panel}
          onChange={(panel) => update({ panel })}
        />
        <Key
          id="display-backdrop"
          on={prefs.backdrop}
          onClick={() => update({ backdrop: !prefs.backdrop })}
          title="Show a road behind the glass, lit to match the Light setting"
        >
          Road view
        </Key>
      </div>
      <Segmented<UnitChoice>
        id="units"
        label="Units"
        options={[
          { value: 'metric', label: 'Metric' },
          { value: 'imperial', label: 'Imperial' },
        ]}
        value={prefs.units}
        onChange={(units) => update({ units })}
      />
      <div class="row">
        <Segmented<LayoutChoice>
          id="layout"
          label="Layout"
          options={LAYOUTS}
          value={prefs.layout}
          onChange={(layout) => update({ layout })}
        />
        <Key
          id="display-shift-light"
          on={prefs.shiftLight}
          onClick={() => update({ shiftLight: !prefs.shiftLight })}
          title="Light up as the engine nears the shift point"
        >
          Shift light
        </Key>
      </div>
    </Group>
  );
}
