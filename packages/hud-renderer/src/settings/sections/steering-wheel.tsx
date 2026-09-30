import {
  ADC_CHANNELS,
  ADS1115_ADDRESSES,
  ADS1115_FULL_SCALES,
  INPUT_ACTIONS,
  MAX_CAN_BUTTON_RULES,
  MAX_SWC_WINDOWS,
} from '@carheadsup/core';
import type {
  AdcChannel,
  Ads1115Address,
  Ads1115FullScaleV,
  CanButtonRule,
  CanButtonsConfig,
  InputAction,
  SensorsConfig,
  SwcButtonsConfig,
  SwcWindow,
} from '@carheadsup/core';
import type { Scope } from '../model/scope.ts';
import {
  INPUT_ACTION_LABELS,
  describeCanRule,
  hexDigits,
  newCanRule,
  newSwcWindow,
} from '../model/steering-wheel.ts';
import { MILLISECONDS, VOLTS, plainUnit } from '../model/units.ts';
import { Button, Card, Notice } from '../ui/common.tsx';
import {
  FieldGrid,
  FieldGroup,
  FieldShell,
  NumberField,
  SelectField,
  Switch,
  TextField,
  ToggleField,
  issueText,
} from '../ui/fields.tsx';
import type { Option } from '../ui/fields.tsx';
import { useArmed, useRowKeys } from '../ui/hooks.ts';

const ACTIONS: ReadonlyArray<Option<InputAction>> = INPUT_ACTIONS.map((action) => ({
  value: action,
  label: INPUT_ACTION_LABELS[action],
}));

const LONG_PRESS_ACTIONS: ReadonlyArray<Option<InputAction | null>> = [
  { value: null, label: 'Nothing (act on press)' },
  ...ACTIONS,
];

const ADDRESS_PINS = ['GND', 'VDD', 'SDA', 'SCL'] as const;
const ADDRESSES: ReadonlyArray<Option<Ads1115Address>> = ADS1115_ADDRESSES.map((address, i) => ({
  value: address,
  label: `0x${address.toString(16).toUpperCase()} (ADDR to ${ADDRESS_PINS[i] ?? '?'})`,
}));

const CHANNELS: ReadonlyArray<Option<AdcChannel>> = ADC_CHANNELS.map((channel) => ({
  value: channel,
  label: `A${channel}`,
}));

const GAINS = ['2/3', '1', '2', '4', '8', '16'] as const;
const RANGES: ReadonlyArray<Option<Ads1115FullScaleV>> = ADS1115_FULL_SCALES.map((v, i) => ({
  value: v,
  label: `±${v} V (gain ${GAINS[i] ?? '?'})`,
}));

const VOLTS_2 = { ...VOLTS, decimals: 2 };
const BYTE_INDEX = plainUnit('');

/**
 * `sensors.canButtons` and `sensors.swcButtons`: the car's own steering-wheel buttons as HUD
 * inputs, read from the CAN bus or from the resistor-ladder wire.
 */
export function SteeringWheelButtons({ scope }: { scope: Scope<SensorsConfig> }) {
  return (
    <Card class="steering-wheel">
      <FieldGroup
        title="Steering-wheel buttons"
        description="Use the car’s own buttons to control the HUD."
      >
        <Notice tone="info" title="Easiest: pair the phone with the car">
          Over Bluetooth, the steering wheel’s call and media buttons already reach the phone, and
          the HUD follows the phone’s calls and music — no wiring needed. The options below map
          other buttons (or the same ones, read directly) to HUD actions.
        </Notice>
      </FieldGroup>
      <CanButtons scope={scope.child('canButtons')} />
      <LadderButtons scope={scope.child('swcButtons')} />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// CAN bus

function CanButtons({ scope }: { scope: Scope<CanButtonsConfig> }) {
  const iface = scope.value.interface;
  return (
    <FieldGroup
      title="From the CAN bus"
      description="A CAN interface (e.g. an MCP2515 HAT) on the bus that carries the button frames."
    >
      <FieldShell label="Read buttons from the CAN bus" dirty={scope.dirty('interface')} inline>
        <Switch
          checked={iface !== null}
          label="Read buttons from the CAN bus"
          onChange={(on) => scope.set('interface', on ? 'can0' : null)}
        />
      </FieldShell>
      {iface !== null && (
        <>
          <Notice tone="caution" title="Listen-only mode">
            Bring the interface up with{' '}
            <code>ip link set {iface || 'can0'} up type can bitrate 500000 listen-only on</code>{' '}
            (your car’s bitrate). The HUD never sends anything, and in listen-only mode the CAN chip
            does not acknowledge the car’s frames either. The HUD warns in its log otherwise.
          </Notice>
          <FieldGrid>
            <TextField
              scope={scope}
              k="interface"
              label="Interface"
              monospace
              placeholder="can0"
              transform={(t) => t.trim()}
            />
            <NumberField
              scope={scope}
              k="releaseTimeoutMs"
              label="Release when frames stop for"
              unit={MILLISECONDS}
              integer
              nullable
              placeholder="Never"
              hint="Empty if the car only sends a frame when a button changes."
            />
          </FieldGrid>
          <CanRules scope={scope.child('rules')} />
        </>
      )}
    </FieldGroup>
  );
}

function CanRules({ scope }: { scope: Scope<CanButtonRule[]> }) {
  const rules = scope.value;
  const rows = useRowKeys(rules.length);
  return (
    <div class="button-rules">
      <p class="field__hint">
        One rule per button: the frame’s id as candump shows it (3 hex digits, or 8 for 29-bit ids),
        the data byte (0 = first) and the bits that change when the button is held.
      </p>
      {rules.length === 0 && <p class="muted">No buttons yet.</p>}
      <ol class="pid-list" data-path={scope.key} aria-label="CAN button rules">
        {rules.map((_, index) => (
          <CanRuleRow
            key={rows.keys[index]}
            list={scope}
            index={index}
            onRemove={() => {
              rows.remove(index);
              scope.replace(rules.filter((_, i) => i !== index));
            }}
          />
        ))}
      </ol>
      <Button
        onClick={() => scope.replace([...rules, newCanRule(rules)])}
        disabled={rules.length >= MAX_CAN_BUTTON_RULES}
      >
        Add CAN button
      </Button>
    </div>
  );
}

function CanRuleRow({
  list,
  index,
  onRemove,
}: {
  list: Scope<CanButtonRule[]>;
  index: number;
  onRemove: () => void;
}) {
  const scope = list.child(index);
  const rule = scope.value;
  const rowIssue = list.issue(index);
  const described = describeCanRule(rule);
  return (
    <li class="pid" data-path={scope.key}>
      <RowHead title={`Rule ${index + 1}`} onRemove={onRemove} />
      {rowIssue && <p class="field__error">{issueText(rowIssue)}</p>}
      <div class="can-rule__frame">
        <TextField
          scope={scope}
          k="id"
          label="CAN id"
          transform={(t) => hexDigits(t, 8)}
          monospace
          placeholder="5C1"
        />
        <NumberField scope={scope} k="byte" label="Byte" unit={BYTE_INDEX} integer />
        <TextField
          scope={scope}
          k="mask"
          label="Mask"
          transform={(t) => hexDigits(t, 2)}
          monospace
          placeholder="FF"
        />
        <TextField
          scope={scope}
          k="value"
          label="Value"
          transform={(t) => hexDigits(t, 2)}
          monospace
          placeholder="01"
        />
      </div>
      {described && <p class="field__hint">{described}.</p>}
      <ActionFields scope={scope} />
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Resistor ladder

function LadderButtons({ scope }: { scope: Scope<SwcButtonsConfig> }) {
  const swc = scope.value;
  const idleIssue = scope.issue('idle');
  return (
    <FieldGroup
      title="From a resistor ladder"
      description="An ADS1115 converter measuring the buttons’ KEY1 or KEY2 wire, pulled up to 3.3 V: each button gives its own voltage."
    >
      <ToggleField scope={scope} k="enabled" label="Read a resistor ladder" />
      {swc.enabled && (
        <>
          <FieldGrid>
            <SelectField scope={scope} k="address" label="ADS1115 address" options={ADDRESSES} />
            <SelectField scope={scope} k="channel" label="Input" options={CHANNELS} />
            <SelectField
              scope={scope}
              k="fullScaleV"
              label="Range"
              options={RANGES}
              hint="±4.096 V for a ladder pulled up to 3.3 V."
            />
          </FieldGrid>
          <div data-path={scope.keyOf('idle')}>
            <div class="volt-range">
              <NumberField
                scope={scope.child('idle')}
                k="minV"
                label="No button: from"
                unit={VOLTS_2}
              />
              <NumberField
                scope={scope.child('idle')}
                k="maxV"
                label="No button: to"
                unit={VOLTS_2}
              />
            </div>
            {idleIssue && <p class="field__error">{issueText(idleIssue)}</p>}
          </div>
          <LadderWindows scope={scope} />
          <p class="field__hint">
            To find each button’s voltage, run the HUD with debug logging (
            <code>CARHEADSUP_LOG_LEVEL=debug</code>) and hold each button in turn: the log shows
            “SWC buttons: steady at 1.234 V” whenever the reading moves by more than 50 mV. Give
            each button a window around its voltage, with a gap to its neighbours.
          </p>
        </>
      )}
    </FieldGroup>
  );
}

function LadderWindows({ scope }: { scope: Scope<SwcButtonsConfig> }) {
  const list = scope.child('windows');
  const windows = list.value;
  const rows = useRowKeys(windows.length);
  const listIssue = scope.issue('windows');
  return (
    <div class="button-rules">
      {listIssue && <p class="field__error">{issueText(listIssue)}</p>}
      {windows.length === 0 && <p class="muted">No buttons yet.</p>}
      <ol class="pid-list" data-path={list.key} aria-label="Ladder windows">
        {windows.map((_, index) => (
          <WindowRow
            key={rows.keys[index]}
            list={list}
            index={index}
            onRemove={() => {
              rows.remove(index);
              list.replace(windows.filter((_, i) => i !== index));
            }}
          />
        ))}
      </ol>
      <Button
        onClick={() => list.replace([...windows, newSwcWindow(windows, scope.value.idle)])}
        disabled={windows.length >= MAX_SWC_WINDOWS}
      >
        Add ladder button
      </Button>
    </div>
  );
}

function WindowRow({
  list,
  index,
  onRemove,
}: {
  list: Scope<SwcWindow[]>;
  index: number;
  onRemove: () => void;
}) {
  const scope = list.child(index);
  const rowIssue = list.issue(index);
  return (
    <li class="pid" data-path={scope.key}>
      <RowHead title={`Window ${index + 1}`} onRemove={onRemove} />
      {rowIssue && <p class="field__error">{issueText(rowIssue)}</p>}
      <div class="volt-range">
        <NumberField scope={scope} k="minV" label="From" unit={VOLTS_2} />
        <NumberField scope={scope} k="maxV" label="To" unit={VOLTS_2} />
      </div>
      <ActionFields scope={scope} />
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Shared

function ActionFields<T extends { action: InputAction; longPressAction: InputAction | null }>({
  scope,
}: {
  scope: Scope<T>;
}) {
  const s = scope as unknown as Scope<{ action: InputAction; longPressAction: InputAction | null }>;
  return (
    <FieldGrid>
      <SelectField scope={s} k="action" label="Press" options={ACTIONS} />
      <SelectField
        scope={s}
        k="longPressAction"
        label="Hold (0.8 s)"
        options={LONG_PRESS_ACTIONS}
        hint={s.value.longPressAction === null ? undefined : 'A short press then acts on release.'}
      />
    </FieldGrid>
  );
}

function RowHead({ title, onRemove }: { title: string; onRemove: () => void }) {
  const [armed, arm, disarm] = useArmed();
  return (
    <div class="pid__head">
      <span class="pid__index">{title}</span>
      {armed ? (
        <span class="row-actions">
          <Button size="small" variant="ghost" onClick={disarm}>
            Keep
          </Button>
          <Button size="small" variant="danger" onClick={onRemove}>
            Remove {title.toLowerCase()}
          </Button>
        </span>
      ) : (
        <Button
          size="small"
          variant="ghost"
          onClick={arm}
          aria-label={`Remove ${title.toLowerCase()}…`}
        >
          Remove…
        </Button>
      )}
    </div>
  );
}
