import type { HudConfig, TripRecord, UnitsConfig } from '@carheadsup/core';
import { useEffect, useState } from 'preact/hooks';
import { describeError } from '../../common/api.ts';
import type { HudApi } from '../../common/api.ts';
import { formatCurrency, formatDurationS } from '../../common/format.ts';
import type { Scope } from '../model/scope.ts';
import { MINUTES_FROM_MS } from '../model/units.ts';
import {
  formatDateTime,
  formatEconomy,
  formatFuel,
  formatLongDistance,
  tripTotals,
  tripView,
} from '../model/records.ts';
import { Button, Card, Notice, Section, Stat } from '../ui/common.tsx';
import { FieldGrid, FieldGroup, NumberField } from '../ui/fields.tsx';
import { useForm } from '../ui/form-context.ts';
import { useArmed } from '../ui/hooks.ts';
import { saveTextFile } from '../ui/save-file.ts';
import type { FileSaveOutcome } from '../ui/save-file.ts';

/** Trips fetched per page. */
export const TRIPS_PAGE_SIZE = 20;

export interface TripsSectionProps {
  api: HudApi;
  units: UnitsConfig;
  root: Scope<HudConfig> | null;
}

/** What to tell the person after "Download CSV", when a plain download was not possible. */
const SAVE_NOTES: Partial<Record<FileSaveOutcome, { tone: 'info' | 'critical'; text: string }>> = {
  copied: {
    tone: 'info',
    text: 'This app cannot save files, so the CSV was copied to the clipboard instead. Paste it into a spreadsheet, or open this page in a browser to download it.',
  },
  failed: {
    tone: 'critical',
    text: 'This app cannot save files. Open this page in a browser to download the CSV.',
  },
};

export function TripsSection({ api, units, root }: TripsSectionProps) {
  const [trips, setTrips] = useState<TripRecord[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<unknown>(null);
  const [csvOutcome, setCsvOutcome] = useState<FileSaveOutcome | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getTrips({ limit: TRIPS_PAGE_SIZE }, { signal: controller.signal })
      .then((page) => {
        setTrips(page);
        setHasMore(page.length >= TRIPS_PAGE_SIZE);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, nonce]);

  const loadOlder = async () => {
    const oldest = trips?.[trips.length - 1];
    if (!oldest) return;
    setLoading(true);
    try {
      const page = await api.getTrips({ limit: TRIPS_PAGE_SIZE, before: oldest.startedAt });
      setTrips((current) => {
        const known = new Set((current ?? []).map((t) => t.id));
        return [...(current ?? []), ...page.filter((t) => !known.has(t.id))];
      });
      setHasMore(page.length >= TRIPS_PAGE_SIZE);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = async () => {
    setCsvBusy(true);
    setCsvError(null);
    setCsvOutcome(null);
    try {
      const csv = await api.getTripsCsv();
      const filename = `trips-${new Date().toISOString().slice(0, 10)}.csv`;
      setCsvOutcome(await saveTextFile(csv, filename, 'text/csv'));
    } catch (err) {
      setCsvError(err);
    } finally {
      setCsvBusy(false);
    }
  };

  const sorted = trips === null ? null : [...trips].sort((a, b) => b.startedAt - a.startedAt);

  return (
    <Section
      id="trips"
      title="Trips"
      aside={
        <Button
          size="small"
          onClick={downloadCsv}
          busy={csvBusy}
          disabled={trips === null || trips.length === 0}
        >
          Download CSV
        </Button>
      }
    >
      {csvOutcome !== null && SAVE_NOTES[csvOutcome] && (
        <Notice tone={SAVE_NOTES[csvOutcome].tone} title="Trips CSV">
          {SAVE_NOTES[csvOutcome].text}
        </Notice>
      )}
      {csvError !== null && (
        <Notice tone="critical" title="Download failed">
          {describeError(csvError)}
        </Notice>
      )}
      {error !== null && (
        <Notice
          tone={trips === null ? 'critical' : 'caution'}
          title="Trips could not be loaded"
          actions={
            <Button size="small" onClick={() => setNonce((n) => n + 1)}>
              Retry
            </Button>
          }
        >
          {describeError(error)}
        </Notice>
      )}
      {trips === null && error === null && (
        <Card>
          <p class="muted">Loading trips…</p>
        </Card>
      )}
      {sorted !== null && sorted.length === 0 && (
        <Card>
          <div class="empty">
            <p class="empty__title">No trips yet</p>
            <p class="muted">Trips are logged automatically once you drive.</p>
          </div>
        </Card>
      )}
      {sorted !== null && sorted.length > 0 && (
        <>
          <TotalsCard trips={sorted} units={units} />
          <ul class="trip-list">
            {sorted.map((trip) => (
              <TripItem
                key={trip.id}
                trip={trip}
                units={units}
                onDelete={async () => {
                  await api.deleteTrip(trip.id);
                  setTrips((current) => (current ?? []).filter((t) => t.id !== trip.id));
                }}
              />
            ))}
          </ul>
          {hasMore && (
            <Button class="btn--block" onClick={loadOlder} busy={loading}>
              Show older trips
            </Button>
          )}
        </>
      )}
      {root !== null && <TripSettings root={root} />}
    </Section>
  );
}

function TotalsCard({ trips, units }: { trips: TripRecord[]; units: UnitsConfig }) {
  const totals = tripTotals(trips);
  const economy = formatEconomy(totals.avgLPer100km, units);
  return (
    <Card class="totals">
      <p class="card__title">
        {totals.count === 1 ? '1 trip' : `${totals.count} trips`}
        <span class="muted small"> · shown below</span>
      </p>
      <dl class="stats stats--grid">
        <Stat label="Distance">{formatLongDistance(totals.distanceKm, units)}</Stat>
        <Stat label="Driving time">{formatDurationS(totals.durationS)}</Stat>
        <Stat label="Fuel">{totals.fuelL === null ? '–' : formatFuel(totals.fuelL, units)}</Stat>
        <Stat label="Average">{economy ?? '–'}</Stat>
        <Stat label="Cost">
          {totals.costs.length === 0
            ? '–'
            : totals.costs.map((c) => formatCurrency(c.amount, c.currency)).join(' + ')}
        </Stat>
      </dl>
    </Card>
  );
}

function TripItem({
  trip,
  units,
  onDelete,
}: {
  trip: TripRecord;
  units: UnitsConfig;
  onDelete: () => Promise<void>;
}) {
  const view = tripView(trip, units);
  const [armed, arm, disarm] = useArmed();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err);
      setBusy(false);
      disarm();
    }
  };
  return (
    <li class="trip">
      <div class="trip__head">
        <div>
          <p class="trip__date">{formatDateTime(trip.startedAt, units.clock)}</p>
          <p class="trip__distance">
            {view.distance} <span class="trip__duration">in {view.duration}</span>
          </p>
        </div>
        {armed ? (
          <div class="trip__confirm">
            <Button size="small" variant="ghost" onClick={disarm}>
              Keep
            </Button>
            <Button size="small" variant="danger" onClick={remove} busy={busy}>
              Delete
            </Button>
          </div>
        ) : (
          <Button
            size="small"
            variant="ghost"
            onClick={arm}
            aria-label={`Delete trip of ${view.distance}`}
          >
            Delete…
          </Button>
        )}
      </div>
      <dl class="trip__facts">
        <Stat label="Avg speed">{view.avgSpeed}</Stat>
        <Stat label="Fuel">{view.fuel ?? '–'}</Stat>
        <Stat label="Economy">{view.economy ?? '–'}</Stat>
        <Stat label="Cost">{view.cost ?? '–'}</Stat>
      </dl>
      {error !== null && <p class="field__error">{describeError(error)}</p>}
    </li>
  );
}

function TripSettings({ root }: { root: Scope<HudConfig> }) {
  const { driverUnits } = useForm();
  const trip = root.child('trip');
  return (
    <Card>
      <FieldGroup title="Trip detection">
        <FieldGrid>
          <NumberField
            scope={trip}
            k="endAfterEngineOffMs"
            label="End a trip after the engine is off for"
            unit={MINUTES_FROM_MS}
            integer
          />
          <NumberField
            scope={trip}
            k="minDistanceKm"
            label="Discard trips shorter than"
            unit={{ ...driverUnits.distance, decimals: 2 }}
          />
        </FieldGrid>
      </FieldGroup>
    </Card>
  );
}
