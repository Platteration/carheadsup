import type {
  DiagnosticDtc,
  DiagnosticGauge,
  DiagnosticsFrame,
  DiagnosticsMaintenanceItem,
  DiagnosticsTrip,
  DtcKind,
  MaintenanceStatusKind,
} from '@carheadsup/core';
import type { ComponentChildren } from 'preact';
import { MISSING, formatCurrency, formatDurationS, formatNumber } from '../../common/format.ts';
import { Glyph } from '../icons/index.ts';
import { clamp01, cx, economyUnitLabel, gaugeTone, lookup, pct, splitDistance } from '../util.ts';
import type { Tone } from '../util.ts';

// ---------------------------------------------------------------------------
// Gauges

/** Grid shape for `count` gauges: few large tiles, never more than 5 columns. */
export function gaugeGridShape(count: number): { columns: number; rows: number } {
  if (count <= 0) return { columns: 1, rows: 1 };
  const columns = count <= 4 ? count : count <= 6 ? 3 : count <= 12 ? 4 : 5;
  return { columns, rows: Math.ceil(count / columns) };
}

/** Position of `value` within the gauge's [min, max] as 0–1 (0 for an empty or inverted range). */
export function gaugeFraction(gauge: DiagnosticGauge): number {
  if (gauge.value === null || !Number.isFinite(gauge.value)) return 0;
  const span = gauge.max - gauge.min;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return clamp01((gauge.value - gauge.min) / span);
}

function Gauge({ gauge }: { gauge: DiagnosticGauge }) {
  const hasValue = gauge.value !== null && Number.isFinite(gauge.value);
  return (
    <div
      class={cx('hud-gauge', `hud-tone--${gaugeTone(gauge.status)}`)}
      data-signal={gauge.signal}
      data-status={gauge.status}
    >
      <div class="hud-gauge__body">
        <div class="hud-gauge__label">{gauge.label}</div>
        <div class="hud-gauge__value">
          <span class="hud-num">
            {hasValue ? formatNumber(gauge.value, gauge.decimals) : MISSING}
          </span>
          {gauge.unit && <span class="hud-unit">{gauge.unit}</span>}
        </div>
        <div class="hud-gauge__bar">
          {hasValue && <div class="hud-gauge__fill" style={{ width: pct(gaugeFraction(gauge)) }} />}
        </div>
      </div>
    </div>
  );
}

function GaugeGrid({ gauges }: { gauges: DiagnosticGauge[] }) {
  const { columns, rows } = gaugeGridShape(gauges.length);
  return (
    <div class="hud-gauges" style={{ '--cols': String(columns), '--rows': String(rows) }}>
      {gauges.map((g) => (
        <Gauge key={g.signal} gauge={g} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trouble codes

const DTC_KIND_LABEL: Record<DtcKind, string> = {
  stored: 'Stored',
  pending: 'Pending',
  permanent: 'Permanent',
};

/** Rows that fit on the dashboard; the rest are summarised as "+N more". */
export const MAX_DTC_ROWS = 5;

function DtcList({ dtcs, milOn }: { dtcs: DiagnosticDtc[]; milOn: boolean }) {
  if (dtcs.length === 0) {
    return (
      <Empty>
        No trouble codes
        <span class="hud-diag__empty-sub">
          {milOn ? 'Check-engine light is on' : 'Check-engine light off'}
        </span>
      </Empty>
    );
  }
  const shown = dtcs.slice(0, MAX_DTC_ROWS);
  const hidden = dtcs.length - shown.length;
  return (
    <div class="hud-dtcs">
      {shown.map((d) => (
        <div
          key={`${d.code}-${d.kind}`}
          class={cx('hud-dtc', `hud-tone--${d.severity}`)}
          data-code={d.code}
        >
          <span class="hud-num hud-dtc__code">{d.code}</span>
          <span class="hud-dtc__kind">{lookup(DTC_KIND_LABEL, d.kind, d.kind)}</span>
          <div class="hud-dtc__text">
            <div class="hud-dtc__short">{d.short}</div>
            {d.description && d.description !== d.short && (
              <div class="hud-dtc__desc">{d.description}</div>
            )}
          </div>
        </div>
      ))}
      {hidden > 0 && <div class="hud-dtcs__more">+{hidden} more</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trip

interface TripTile {
  key: string;
  label: string;
  value: string;
  unit?: string;
}

/** Tiles for the trip page; unknown economy, fuel or cost show as a dash. */
export function tripTiles(trip: DiagnosticsTrip | null): TripTile[] {
  if (!trip) return [];
  const distance = splitDistance(trip.distance);
  const known = (v: number | null): v is number => v !== null && Number.isFinite(v);
  return [
    { key: 'distance', label: 'Distance', value: distance.value, unit: distance.unit },
    { key: 'duration', label: 'Driving time', value: formatDurationS(trip.durationS) },
    { key: 'moving', label: 'Moving', value: formatDurationS(trip.movingS) },
    {
      key: 'economy',
      label: 'Average',
      value: formatNumber(trip.averageEconomy, 1),
      unit: known(trip.averageEconomy) ? economyUnitLabel(trip.economyUnit) : undefined,
    },
    {
      key: 'fuel',
      label: 'Fuel used',
      value: formatNumber(trip.fuelUsed, 1),
      unit: known(trip.fuelUsed) ? trip.fuelUnit : undefined,
    },
    {
      key: 'cost',
      label: 'Cost',
      value: known(trip.cost) ? formatCurrency(trip.cost, trip.currency) : MISSING,
    },
  ];
}

function TripPage({ trip }: { trip: DiagnosticsTrip | null }) {
  if (!trip) return <Empty>No trip in progress</Empty>;
  const completed = trip.completed === true;
  return (
    <>
      <div class="hud-diag-trip__state" data-completed={String(completed)}>
        {completed ? 'Last trip' : 'In progress'}
      </div>
      <div class="hud-diag-trip">
        {tripTiles(trip).map((t) => (
          <div key={t.key} class={`hud-diag-trip__tile hud-diag-trip__tile--${t.key}`}>
            <div class="hud-gauge__body">
              <div class="hud-gauge__label">{t.label}</div>
              <div class="hud-diag-trip__value">
                <span class="hud-num">{t.value}</span>
                {t.unit && <span class="hud-unit">{t.unit}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Maintenance

const MAINTENANCE_LABEL: Record<MaintenanceStatusKind, string> = {
  ok: 'OK',
  'due-soon': 'Due soon',
  overdue: 'Overdue',
  unknown: 'No record',
};

const MAINTENANCE_TONE: Record<MaintenanceStatusKind, Tone> = {
  ok: 'neutral',
  'due-soon': 'caution',
  overdue: 'critical',
  unknown: 'unknown',
};

/**
 * Remaining distance / time until a service, e.g. "in 1 240 km · 45 days", "12 days overdue",
 * or "in 420 km · 3 days overdue" when only one limit has passed. Null when nothing is known.
 * The distance arrives in the driver's units, negative when overdue.
 */
export function maintenanceRemaining(item: DiagnosticsMaintenanceItem): string | null {
  const ahead: string[] = [];
  const overdue: string[] = [];
  const distance = item.remaining;
  if (distance && Number.isFinite(distance.value)) {
    (distance.value < 0 ? overdue : ahead).push(
      `${formatNumber(Math.abs(distance.value))} ${distance.unit}`,
    );
  }
  if (item.remainingDays !== null && Number.isFinite(item.remainingDays)) {
    const days = Math.abs(Math.round(item.remainingDays));
    (item.remainingDays < 0 ? overdue : ahead).push(
      `${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`,
    );
  }
  const parts = [
    ahead.length > 0 ? `in ${ahead.join(' \u00b7 ')}` : null,
    overdue.length > 0 ? `${overdue.join(' \u00b7 ')} overdue` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}

function MaintenanceList({ items }: { items: DiagnosticsMaintenanceItem[] }) {
  if (items.length === 0) return <Empty>No service items</Empty>;
  return (
    <div class="hud-maint">
      {items.map((item) => {
        const remaining = maintenanceRemaining(item);
        return (
          <div
            key={item.itemId}
            class={cx(
              'hud-maint__item',
              `hud-tone--${lookup(MAINTENANCE_TONE, item.status, 'unknown')}`,
            )}
            data-item={item.itemId}
          >
            <span class="hud-maint__label">{item.label}</span>
            <span class="hud-maint__status">
              {lookup(MAINTENANCE_LABEL, item.status, item.status)}
            </span>
            <span class="hud-maint__remaining">{remaining ?? MISSING}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page chrome

function Empty({ children }: { children: ComponentChildren }) {
  return <div class="hud-diag__empty">{children}</div>;
}

function PageDots({ index, count }: { index: number; count: number }) {
  if (count <= 1) return null;
  return (
    <div class="hud-diag__dots" aria-label={`Page ${index + 1} of ${count}`}>
      {Array.from({ length: Math.min(count, 12) }, (_, i) => (
        <span key={i} class={cx('hud-diag__dot', i === index && 'hud-diag__dot--current')} />
      ))}
    </div>
  );
}

/** "VIN … · adapter · protocol", or null when nothing is known. */
export function vehicleLine(vehicle: DiagnosticsFrame['vehicle']): string | null {
  const parts = [
    vehicle.vin ? `VIN ${vehicle.vin}` : null,
    vehicle.adapter,
    vehicle.protocol,
  ].filter((s): s is string => typeof s === 'string' && s.trim() !== '');
  return parts.length > 0 ? parts.join('  ·  ') : null;
}

/** Compact line for the overview page when trouble codes or due maintenance exist. */
function OverviewNotes({ d }: { d: DiagnosticsFrame }) {
  const due = d.maintenance.filter((m) => m.status === 'due-soon' || m.status === 'overdue');
  if (d.dtcs.length === 0 && due.length === 0) return null;
  return (
    <div class="hud-diag__notes">
      {d.dtcs.length > 0 && (
        <span class="hud-diag__note hud-tone--caution">
          <Glyph name="engine" class="hud-diag__note-icon" />
          {d.dtcs.length === 1 && d.dtcs[0]
            ? `${d.dtcs[0].code} ${d.dtcs[0].short}`
            : `${d.dtcs.length} trouble codes`}
        </span>
      )}
      {due.length > 0 && (
        <span
          class={cx(
            'hud-diag__note',
            due.some((m) => m.status === 'overdue') ? 'hud-tone--critical' : 'hud-tone--caution',
          )}
        >
          <Glyph name="wrench" class="hud-diag__note-icon" />
          {due.length === 1 && due[0]
            ? `${due[0].label}: ${lookup(MAINTENANCE_LABEL, due[0].status, due[0].status)}`
            : `${due.length} services due`}
        </span>
      )}
    </div>
  );
}

function PageBody({ d }: { d: DiagnosticsFrame }) {
  switch (d.page) {
    case 'trouble-codes':
      return <DtcList dtcs={d.dtcs} milOn={d.milOn} />;
    case 'trip':
      return <TripPage trip={d.trip} />;
    case 'maintenance':
      return <MaintenanceList items={d.maintenance} />;
    case 'overview':
      return (
        <>
          {d.gauges.length > 0 ? <GaugeGrid gauges={d.gauges} /> : <Empty>No live data</Empty>}
          <OverviewNotes d={d} />
        </>
      );
    default:
      return d.gauges.length > 0 ? <GaugeGrid gauges={d.gauges} /> : <Empty>No live data</Empty>;
  }
}

export interface DiagnosticsViewProps {
  d: DiagnosticsFrame;
  /** Alert banners, call card or toast to show above/below the page. */
  top?: ComponentChildren;
  bottom?: ComponentChildren;
}

/** Full-screen parked dashboard: title and page dots, the page, and the vehicle line. */
export function DiagnosticsView({ d, top, bottom }: DiagnosticsViewProps) {
  const vehicle = vehicleLine(d.vehicle);
  return (
    <div class={cx('hud-diag', `hud-diag--${d.page}`)} data-page={d.page}>
      <header class="hud-diag__header">
        <div class="hud-diag__title">{d.title}</div>
        {d.milOn && (
          <div class="hud-diag__mil hud-tone--caution" title="Check-engine light on">
            <Glyph name="engine" class="hud-diag__mil-icon" />
            <span>MIL</span>
          </div>
        )}
        <PageDots index={d.pageIndex} count={d.pageCount} />
      </header>
      {top && <div class="hud-diag__top">{top}</div>}
      <main class="hud-diag__body">
        <PageBody d={d} />
      </main>
      {bottom && <div class="hud-diag__bottom">{bottom}</div>}
      {vehicle && <footer class="hud-diag__vehicle">{vehicle}</footer>}
    </div>
  );
}
