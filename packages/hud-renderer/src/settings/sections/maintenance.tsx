import type {
  ApiOdometer,
  HudConfig,
  MaintenanceItemConfig,
  MaintenanceItemStatus,
  MaintenanceStatusKind,
  UnitsConfig,
} from '@carheadsup/core';
import { roundTo } from '@carheadsup/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { describeError } from '../../common/api.ts';
import type { HudApi } from '../../common/api.ts';
import { formatNumber } from '../../common/format.ts';
import { jsonEqual } from '../model/diff.ts';
import type { Scope } from '../model/scope.ts';
import {
  MAINTENANCE_STATUS_LABELS,
  maintenanceIdFor,
  maintenanceLastDone,
  maintenanceRemaining,
  odometerPrefill,
  sortMaintenance,
} from '../model/records.ts';
import { DAYS, parseNumberText, toCanonical } from '../model/units.ts';
import type { UnitSpec } from '../model/units.ts';
import { Badge, Button, Card, Dialog, Notice, Section } from '../ui/common.tsx';
import type { Tone } from '../ui/common.tsx';
import { FieldGrid, NumberField, TextField } from '../ui/fields.tsx';
import { useForm } from '../ui/form-context.ts';
import { useArmed, useResource } from '../ui/hooks.ts';

/** After this many estimated km the settings app asks for the dash reading again. */
export const CONFIRM_ODOMETER_AFTER_KM = 2000;

const STATUS_TONE: Readonly<Record<MaintenanceStatusKind, Tone>> = {
  ok: 'ok',
  'due-soon': 'caution',
  overdue: 'critical',
  unknown: 'neutral',
};

export interface MaintenanceSectionProps {
  api: HudApi;
  units: UnitsConfig;
  root: Scope<HudConfig> | null;
  /** The saved service schedule; the status list reloads when it changes. */
  savedSchedule?: HudConfig['maintenance'] | null;
}

export function MaintenanceSection({ api, units, root, savedSchedule }: MaintenanceSectionProps) {
  const status = useResource((signal) => api.getMaintenance({ signal }));
  const lastSchedule = useRef(savedSchedule);
  useEffect(() => {
    // Every save returns a fresh config object, so compare contents, not identity.
    if (jsonEqual(savedSchedule, lastSchedule.current)) return;
    lastSchedule.current = savedSchedule;
    status.reload();
  }, [savedSchedule]);
  const [marking, setMarking] = useState<MaintenanceItemStatus | null>(null);
  // Bumped when a service was recorded: its reading may have set the HUD's odometer.
  const [servicesRecorded, setServicesRecorded] = useState(0);
  const items = status.data === null ? null : sortMaintenance(status.data);
  const attention =
    items?.filter((i) => i.status === 'overdue' || i.status === 'due-soon').length ?? 0;

  return (
    <Section
      id="maintenance"
      title="Maintenance"
      aside={attention > 0 ? <Badge tone="caution">{attention} need attention</Badge> : undefined}
    >
      {status.error !== null && (
        <Notice
          tone="critical"
          title="Service status unavailable"
          actions={
            <Button size="small" onClick={status.reload}>
              Retry
            </Button>
          }
        >
          {describeError(status.error)}
        </Notice>
      )}
      {items === null && status.error === null && (
        <Card>
          <p class="muted">Loading service status…</p>
        </Card>
      )}
      {items !== null && items.length === 0 && (
        <Card>
          <p class="muted">No service items configured. Add some under “Service schedule”.</p>
        </Card>
      )}
      {items !== null && items.length > 0 && (
        <ul class="service-list">
          {items.map((item) => (
            <li key={item.itemId} class={`service service--${item.status}`}>
              <div class="service__main">
                <p class="service__label">
                  {item.label}{' '}
                  <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>
                    {MAINTENANCE_STATUS_LABELS[item.status] ?? item.status}
                  </Badge>
                </p>
                <p class="service__remaining">{maintenanceRemaining(item, units)}</p>
                {maintenanceLastDone(item, units) && (
                  <p class="muted small">{maintenanceLastDone(item, units)}</p>
                )}
              </div>
              <Button size="small" onClick={() => setMarking(item)}>
                Mark done
              </Button>
            </li>
          ))}
        </ul>
      )}
      <OdometerCard
        api={api}
        units={units}
        onSaved={status.reload}
        servicesRecorded={servicesRecorded}
      />
      {root !== null && <ScheduleEditor scope={root.child('maintenance')} />}
      {marking !== null && (
        <MarkDoneDialog
          api={api}
          item={marking}
          all={status.data ?? []}
          onClose={() => setMarking(null)}
          onDone={(next) => {
            status.setData(next);
            setMarking(null);
            setServicesRecorded((n) => n + 1);
          }}
        />
      )}
    </Section>
  );
}

/** Odometer input in the driver's distance unit → canonical km; null while empty or invalid. */
function useOdometerInput(unit: UnitSpec, initial: string) {
  const [text, setText] = useState(initial);
  const parsed = parseNumberText(text, { allowEmpty: true });
  const km = parsed.ok && parsed.value !== null ? toCanonical(parsed.value, unit) : null;
  const error = !parsed.ok
    ? parsed.error
    : km !== null && (km < 0 || km > 2_000_000)
      ? 'That odometer reading looks wrong'
      : null;
  return { text, setText, km: error === null ? km : null, error };
}

function MarkDoneDialog({
  api,
  item,
  all,
  onClose,
  onDone,
}: {
  api: HudApi;
  item: MaintenanceItemStatus;
  all: readonly MaintenanceItemStatus[];
  onClose: () => void;
  onDone: (next: MaintenanceItemStatus[]) => void;
}) {
  const { driverUnits } = useForm();
  const unit = driverUnits.distance;
  const input = useOdometerInput(unit, '');
  const [prefilled, setPrefilled] = useState(false);
  /** The text pre-filled from the HUD's own estimate (not a reading), if that is what it is. */
  const [estimateText, setEstimateText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Best-effort prefill from the HUD / the car / last trip / last service (whichever is known).
  const prefill = useResource(async (signal) => {
    const [diag, trips] = await Promise.all([
      api.getDiagnostics({ signal }).catch(() => null),
      api.getTrips({ limit: 1 }, { signal }).catch(() => []),
    ]);
    return odometerPrefill(diag, trips, all);
  });
  useEffect(() => {
    const km = prefill.data?.km ?? null;
    if (prefilled || km === null) return;
    setPrefilled(true);
    if (input.text !== '') return;
    const text = String(Math.round(unit.toDisplay(km)));
    input.setText(text);
    if (prefill.data?.estimate === true) setEstimateText(text);
  }, [prefill.data]);
  const showsEstimate = estimateText !== null && input.text.trim() === estimateText;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // The reading entered is today's dash reading, which also confirms (or sets) the odometer
      // of a car that does not report it: the HUD's own estimate, saved unchanged, is not one.
      const km = showsEstimate ? undefined : (input.km ?? undefined);
      onDone(await api.markMaintenanceDone(item.itemId, km));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`${item.label} done`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={input.error !== null}>
            Save
          </Button>
        </>
      }
    >
      <p>Records the service as done today and restarts its reminder.</p>
      <label class="field__label" for="done-odometer">
        Odometer
      </label>
      <div class="input-unit">
        <input
          id="done-odometer"
          class="input input--number"
          inputMode="numeric"
          value={input.text}
          placeholder={
            prefill.loading
              ? 'Reading…'
              : prefill.data?.unknown === true
                ? 'The reading on the dash'
                : 'Leave empty to use the HUD’s reading'
          }
          onInput={(event) => input.setText(event.currentTarget.value)}
        />
        <span class="input-unit__label">{unit.label}</span>
      </div>
      {input.error !== null && input.text.trim() !== '' ? (
        <p class="field__error">{input.error}</p>
      ) : prefill.data?.unknown === true ? (
        <p class="field__hint">
          The HUD does not know the odometer yet: enter the reading on the dash. It also sets the
          HUD’s odometer, which turns distance reminders on.
        </p>
      ) : showsEstimate ? (
        <p class="field__hint">
          This is the HUD’s estimate. If the dash shows something else, enter that: it also corrects
          the HUD’s odometer.
        </p>
      ) : (
        <p class="field__hint">Pre-filled with the best-known reading; correct it if needed.</p>
      )}
      {error !== null && (
        <Notice tone="critical" title="Not saved">
          {describeError(error)}
        </Notice>
      )}
    </Dialog>
  );
}

function OdometerCard({
  api,
  units,
  onSaved,
  servicesRecorded,
}: {
  api: HudApi;
  units: UnitsConfig;
  onSaved: () => void;
  /** Changes when a service was recorded (its reading may have set the odometer). */
  servicesRecorded: number;
}) {
  const { driverUnits } = useForm();
  const unit = driverUnits.distance;
  const input = useOdometerInput(unit, '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const diagnostics = useResource((signal) => api.getDiagnostics({ signal }));
  useEffect(() => {
    if (servicesRecorded > 0) diagnostics.reload();
  }, [servicesRecorded]);
  // Absent from a HUD that predates it.
  const odometer = diagnostics.data?.odometer ?? null;
  const submit = async () => {
    if (input.km === null) return;
    setBusy(true);
    setResult(null);
    const km = roundTo(input.km, 1);
    try {
      await api.setOdometer(km);
      // Echo what was stored, not what was typed, so a misread entry cannot hide.
      const shown = formatNumber(unit.toDisplay(km), unit.decimals);
      setResult({ ok: true, message: `Odometer set to ${shown} ${unit.label}.` });
      input.setText('');
      onSaved();
      diagnostics.reload();
    } catch (err) {
      setResult({ ok: false, message: describeError(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      {odometer !== null && <OdometerStatus odometer={odometer} unit={unit} />}
      <form
        class="odometer-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label class="field__label" for="set-odometer">
          Correct the odometer
        </label>
        <div class="input-row">
          <div class="input-unit">
            <input
              id="set-odometer"
              class="input input--number"
              inputMode="numeric"
              value={input.text}
              placeholder={units.system === 'imperial' ? 'Miles on the dash' : 'Km on the dash'}
              onInput={(event) => input.setText(event.currentTarget.value)}
            />
            <span class="input-unit__label">{unit.label}</span>
          </div>
          <Button type="submit" variant="primary" busy={busy} disabled={input.km === null}>
            Set
          </Button>
        </div>
        {input.error !== null && input.text.trim() !== '' ? (
          <p class="field__error">{input.error}</p>
        ) : (
          <p class="field__hint">
            Service reminders count from this reading when the car does not report its odometer.
          </p>
        )}
      </form>
      {result && <Notice tone={result.ok ? 'ok' : 'critical'}>{result.message}</Notice>}
    </Card>
  );
}

/**
 * What the HUD's odometer is: unknown (distance reminders off), the car's reading, or an
 * estimate — and, after `CONFIRM_ODOMETER_AFTER_KM` estimated km, a request for the dash reading.
 */
function OdometerStatus({ odometer, unit }: { odometer: ApiOdometer; unit: UnitSpec }) {
  const distance = (km: number) => `${formatNumber(unit.toDisplay(km), 0)} ${unit.label}`;
  if (odometer.km === null) {
    return (
      <Notice tone="caution" title="Odometer unknown – distance reminders are off">
        The car does not report its odometer. Enter the reading on the dash below (or with a
        service) and the HUD keeps counting from it.
      </Notice>
    );
  }
  const since = odometer.kmSinceConfirmed;
  return (
    <>
      <p class="odometer-status" data-source={odometer.source ?? 'unknown'}>
        HUD odometer:{' '}
        <strong>
          {odometer.source === 'estimated' ? '≈ ' : ''}
          {distance(odometer.km)}
        </strong>
        {odometer.source === 'pid'
          ? ', read from the car.'
          : since !== null
            ? `, estimated from the speed since you entered the dash reading ${distance(since)} ago.`
            : ', estimated from the speed.'}
      </p>
      {since !== null && since >= CONFIRM_ODOMETER_AFTER_KM && (
        <Notice tone="caution" title="Check the odometer">
          The HUD has estimated {distance(since)} since the dash reading was last entered. Enter it
          again to keep service reminders accurate.
        </Notice>
      )}
    </>
  );
}

/** Edit `maintenance.items`: intervals per item, add and remove items. */
function ScheduleEditor({ scope }: { scope: Scope<HudConfig['maintenance']> }) {
  const { driverUnits } = useForm();
  const items = scope.child('items');
  const add = () => {
    const taken = items.value.map((i) => i.id);
    const item: MaintenanceItemConfig = {
      id: maintenanceIdFor('New item', taken),
      label: 'New item',
      intervalKm: 10_000,
      intervalDays: 365,
      warnBeforeKm: 500,
      warnBeforeDays: 14,
    };
    items.replace([...items.value, item]);
  };
  return (
    <details class="disclosure disclosure--card">
      <summary>Service schedule</summary>
      <p class="muted small">Leave a distance or time empty to track only the other one.</p>
      <ul class="schedule">
        {items.value.map((item, index) => (
          <ScheduleItem
            key={item.id}
            scope={items.child(index)}
            distance={driverUnits.distance}
            onRemove={() => items.replace(items.value.filter((_, i) => i !== index))}
          />
        ))}
      </ul>
      <Button onClick={add} disabled={items.value.length >= 50}>
        Add service item
      </Button>
    </details>
  );
}

function ScheduleItem({
  scope,
  distance,
  onRemove,
}: {
  scope: Scope<MaintenanceItemConfig>;
  distance: UnitSpec;
  onRemove: () => void;
}) {
  const [armed, arm, disarm] = useArmed();
  return (
    <li class="schedule__item">
      <TextField scope={scope} k="label" label="Name" />
      <FieldGrid>
        <NumberField scope={scope} k="intervalKm" label="Every" unit={distance} nullable />
        <NumberField scope={scope} k="intervalDays" label="Or every" unit={DAYS} integer nullable />
        <NumberField scope={scope} k="warnBeforeKm" label="Remind before" unit={distance} />
        <NumberField scope={scope} k="warnBeforeDays" label="Or before" unit={DAYS} integer />
      </FieldGrid>
      <div class="schedule__actions">
        {armed ? (
          <>
            <Button size="small" variant="ghost" onClick={disarm}>
              Keep
            </Button>
            <Button size="small" variant="danger" onClick={onRemove}>
              Remove {scope.value.label}
            </Button>
          </>
        ) : (
          <Button size="small" variant="ghost" onClick={arm}>
            Remove…
          </Button>
        )}
      </div>
    </li>
  );
}
