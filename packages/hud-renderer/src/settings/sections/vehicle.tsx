import { SIGNAL_IDS, SIGNAL_META } from '@carheadsup/core';
import type {
  CustomPidConfig,
  FuelType,
  HudConfig,
  SignalId,
  TransmissionType,
} from '@carheadsup/core';
import { formatNumber } from '../../common/format.ts';
import type { Scope } from '../model/scope.ts';
import { LITRES, PERCENT, RPM, SECONDS_FROM_MS, plainUnit } from '../model/units.ts';
import {
  MAX_GEARS,
  TYPICAL_GEAR_RATIOS,
  checkFormula,
  gearRatioUnit,
  missingTyrePids,
  newCustomPid,
  withExtraGear,
} from '../model/vehicle.ts';
import { Button, Card, Notice, Section } from '../ui/common.tsx';
import {
  FieldGrid,
  FieldGroup,
  FieldShell,
  NumberField,
  Segmented,
  SelectField,
  TextField,
  ToggleField,
  issueText,
} from '../ui/fields.tsx';
import type { Option } from '../ui/fields.tsx';
import { useForm } from '../ui/form-context.ts';
import { useArmed, useRowKeys } from '../ui/hooks.ts';

const FUEL_TYPES: ReadonlyArray<Option<FuelType>> = [
  { value: 'gasoline', label: 'Petrol / gasoline' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'e85', label: 'E85' },
  { value: 'lpg', label: 'LPG' },
];

const TRANSMISSIONS: ReadonlyArray<Option<TransmissionType>> = [
  { value: 'manual', label: 'Manual' },
  { value: 'automatic', label: 'Automatic' },
  { value: 'dct', label: 'Dual-clutch' },
  { value: 'cvt', label: 'CVT' },
];

const SIGNAL_OPTIONS: ReadonlyArray<Option<SignalId>> = SIGNAL_IDS.map((id) => ({
  value: id,
  label: `${SIGNAL_META[id].label} (${SIGNAL_META[id].unit})`,
}));

const upperHex = (text: string) => text.toUpperCase().replace(/[^0-9A-F]/g, '');

export function VehicleSection({ root }: { root: Scope<HudConfig> }) {
  const vehicle = root.child('vehicle');
  const v = vehicle.value;
  const currency = root.value.units.currency;
  return (
    <Section id="vehicle" title="Vehicle">
      <Card>
        <FieldGroup title="Car">
          <TextField scope={vehicle} k="name" label="Name" placeholder="My car" />
          <FieldGrid>
            <SelectField scope={vehicle} k="fuelType" label="Fuel" options={FUEL_TYPES} />
            <NumberField
              scope={vehicle}
              k="tankCapacityL"
              label="Usable tank size"
              unit={LITRES}
              hint="For the range estimate."
            />
            <NumberField
              scope={vehicle}
              k="fuelPricePerL"
              label="Fuel price per litre"
              unit={{ ...plainUnit(currency), decimals: 3 }}
              hint="For trip cost."
            />
            <NumberField
              scope={vehicle}
              k="displacementL"
              label="Engine size"
              unit={{ ...LITRES, decimals: 2 }}
            />
            <NumberField
              scope={vehicle}
              k="volumetricEfficiency"
              label="Volumetric efficiency"
              unit={PERCENT}
              hint="Only used to estimate fuel without a MAF sensor."
            />
          </FieldGrid>
        </FieldGroup>
      </Card>
      <Card>
        <FieldGroup title="Engine and gearbox">
          <SelectField scope={vehicle} k="transmission" label="Gearbox" options={TRANSMISSIONS} />
          <FieldGrid>
            <NumberField scope={vehicle} k="redlineRpm" label="Redline" unit={RPM} integer />
            <NumberField scope={vehicle} k="idleRpm" label="Idle" unit={RPM} integer />
          </FieldGrid>
          <GearRatios scope={vehicle} />
        </FieldGroup>
      </Card>
      <Card>
        <FieldGroup title="Tyre pressures">
          <ToggleField
            scope={vehicle}
            k="hasTpms"
            label="Show tyre pressures"
            hint="Needs manufacturer PIDs for the four tyre-pressure signals (below)."
          />
          {v.hasTpms && missingTyrePids(root.value.obd.customPids).length > 0 && (
            <Notice tone="caution" title="Tyre PIDs missing">
              Add custom PIDs for:{' '}
              {missingTyrePids(root.value.obd.customPids)
                .map((s) => SIGNAL_META[s].label)
                .join(', ')}
              .
            </Notice>
          )}
        </FieldGroup>
      </Card>
      <CustomPids scope={root.child('obd').child('customPids')} preferTyres={v.hasTpms} />
    </Section>
  );
}

function GearRatios({ scope }: { scope: Scope<HudConfig['vehicle']> }) {
  const { units } = useForm();
  const ratios = scope.value.gearRatiosRpmPerKph;
  const unit = gearRatioUnit(units.system);
  const listScope = scope.child('gearRatiosRpmPerKph');
  const listIssue = scope.issue('gearRatiosRpmPerKph');
  return (
    <div class="gear-ratios" data-path={scope.keyOf('gearRatiosRpmPerKph')}>
      <FieldShell label="Gear detection" dirty={scope.dirty('gearRatiosRpmPerKph')}>
        <Segmented
          name="gear-ratios-mode"
          ariaLabel="Gear detection"
          options={[
            { value: 'learn', label: 'Auto-learn' },
            { value: 'manual', label: 'Enter ratios' },
          ]}
          value={ratios === null ? 'learn' : 'manual'}
          onChange={(mode) =>
            scope.set('gearRatiosRpmPerKph', mode === 'learn' ? null : [...TYPICAL_GEAR_RATIOS])
          }
        />
      </FieldShell>
      {ratios === null ? (
        <p class="field__hint">
          The HUD works out each gear from engine speed and road speed after a few drives.
        </p>
      ) : (
        <>
          <p class="field__hint">
            Engine speed divided by road speed in each gear ({unit.label}), e.g. 3000 rpm at 50{' '}
            {units.system === 'imperial' ? 'mph' : 'km/h'} → 60. Higher gears have smaller numbers.
          </p>
          {listIssue && <p class="field__error">{issueText(listIssue)}</p>}
          <div class="gear-grid">
            {ratios.map((_, index) => (
              <NumberField
                key={index}
                scope={listScope as Scope<number[]>}
                k={index}
                label={`Gear ${index + 1}`}
                unit={{ ...unit, label: '' }}
              />
            ))}
          </div>
          <div class="row-actions">
            <Button
              size="small"
              onClick={() => scope.set('gearRatiosRpmPerKph', withExtraGear(ratios))}
              disabled={ratios.length >= MAX_GEARS}
            >
              Add gear
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => scope.set('gearRatiosRpmPerKph', ratios.slice(0, -1))}
              disabled={ratios.length <= 1}
            >
              Remove gear {ratios.length}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function CustomPids({
  scope,
  preferTyres,
}: {
  scope: Scope<CustomPidConfig[]>;
  preferTyres: boolean;
}) {
  const pids = scope.value;
  const rows = useRowKeys(pids.length);
  const listIssue = scope.issuesWithin().find((i) => i.message.toLowerCase().includes('duplicate'));
  return (
    <Card>
      <FieldGroup
        title="Custom PIDs"
        description={
          <>
            Manufacturer-specific values (tyre pressures, oil temperature …) read with a request
            such as mode 22 and a Torque-style formula over the reply bytes A, B, C … e.g.{' '}
            <code>((A*256)+B)/10</code>.
          </>
        }
      >
        {listIssue && <p class="field__error">{issueText(listIssue)}</p>}
        {pids.length === 0 && <p class="muted">None configured.</p>}
        <ol class="pid-list" data-path={scope.key}>
          {pids.map((_, index) => (
            <PidRow
              key={rows.keys[index]}
              scope={scope.child(index)}
              index={index}
              onRemove={() => {
                rows.remove(index);
                scope.replace(pids.filter((_, i) => i !== index));
              }}
            />
          ))}
        </ol>
        <Button
          onClick={() => scope.replace([...pids, newCustomPid(pids, preferTyres)])}
          disabled={pids.length >= 64}
        >
          Add PID
        </Button>
      </FieldGroup>
    </Card>
  );
}

function PidRow({
  scope,
  index,
  onRemove,
}: {
  scope: Scope<CustomPidConfig>;
  index: number;
  onRemove: () => void;
}) {
  const [armed, arm, disarm] = useArmed();
  const meta = SIGNAL_META[scope.value.signal];
  return (
    <li class="pid">
      <div class="pid__head">
        <span class="pid__index">#{index + 1}</span>
        {armed ? (
          <span class="row-actions">
            <Button size="small" variant="ghost" onClick={disarm}>
              Keep
            </Button>
            <Button size="small" variant="danger" onClick={onRemove}>
              Remove
            </Button>
          </span>
        ) : (
          <Button size="small" variant="ghost" onClick={arm}>
            Remove…
          </Button>
        )}
      </div>
      <SelectField scope={scope} k="signal" label="Signal" options={SIGNAL_OPTIONS} />
      <div class="pid__request">
        <TextField
          scope={scope}
          k="mode"
          label="Mode"
          transform={(t) => upperHex(t).slice(0, 2)}
          monospace
          placeholder="22"
        />
        <TextField
          scope={scope}
          k="pid"
          label="PID"
          transform={(t) => upperHex(t).slice(0, 6)}
          monospace
          placeholder="2A0B"
        />
        <TextField
          scope={scope}
          k="header"
          label="Header"
          transform={(t) => upperHex(t).slice(0, 8)}
          monospace
          emptyAsNull
          placeholder="Default"
        />
      </div>
      <TextField
        scope={scope}
        k="formula"
        label={`Formula → ${meta?.unit ?? ''}`}
        monospace
        placeholder="((A*256)+B)/10"
        validate={(formula) => {
          const check = checkFormula(formula);
          return check.ok ? null : check.error;
        }}
        status={(formula) => {
          const check = checkFormula(formula);
          return check.ok
            ? `With A=0x12 B=0x34 C=0x56 D=0x78 → ${formatNumber(check.sample, 2)} ${meta?.unit ?? ''}`
            : null;
        }}
      />
      <NumberField
        scope={scope}
        k="intervalMs"
        label="Read every"
        unit={{ ...SECONDS_FROM_MS, decimals: 2 }}
        integer
      />
    </li>
  );
}
