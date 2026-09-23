import type {
  ApiClearDtcsResult,
  ApiDiagnostics,
  DtcKind,
  DtcSeverity,
  UnitsConfig,
} from '@carheadsup/core';
import { useRef, useState } from 'preact/hooks';
import { describeError } from '../../common/api.ts';
import type { HudApi } from '../../common/api.ts';
import { cx } from '../../hud/util.ts';
import { signalRows, watchSignals } from '../model/records.ts';
import type { SignalWatch } from '../model/records.ts';
import { Badge, Button, Card, Dialog, Notice, Section, Stat, StatusDot } from '../ui/common.tsx';
import type { Tone } from '../ui/common.tsx';
import { useOnScreen, usePageVisible, useResource } from '../ui/hooks.ts';
import { OBD_STATE_LABELS, OBD_STATE_TONES } from './status.tsx';

/** Live values refresh this often while the section is on screen. */
export const DIAGNOSTICS_POLL_MS = 1000;

const SEVERITY_TONE: Readonly<Record<DtcSeverity, Tone>> = {
  info: 'info',
  caution: 'caution',
  warning: 'warning',
  critical: 'critical',
};

const SEVERITY_LABEL: Readonly<Record<DtcSeverity, string>> = {
  info: 'Info',
  caution: 'Caution',
  warning: 'Warning',
  critical: 'Critical',
};

const KIND_LABEL: Readonly<Record<DtcKind, string>> = {
  stored: 'Stored',
  pending: 'Pending',
  permanent: 'Permanent',
};

export interface DiagnosticsSectionProps {
  api: HudApi;
  units: UnitsConfig;
}

export function DiagnosticsSection({ api, units }: DiagnosticsSectionProps) {
  const ref = useRef<HTMLElement>(null);
  const onScreen = useOnScreen(ref, '200px');
  const pageVisible = usePageVisible();
  const diagnostics = useResource((signal) => api.getDiagnostics({ signal }), {
    pollMs: DIAGNOSTICS_POLL_MS,
    enabled: onScreen && pageVisible,
  });
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<ApiClearDtcsResult | null>(null);
  const [clearError, setClearError] = useState<unknown>(null);

  const d = diagnostics.data;
  const stale = diagnostics.error !== null;

  const clear = async () => {
    setClearing(true);
    setResult(null);
    setClearError(null);
    try {
      setResult(await api.clearDtcs());
      diagnostics.reload();
    } catch (error) {
      setClearError(error);
    } finally {
      setClearing(false);
      setConfirming(false);
    }
  };

  return (
    <Section
      id="diagnostics"
      title="Diagnostics"
      sectionRef={ref}
      aside={
        d !== null && (
          <Badge tone={d.milOn ? 'caution' : 'ok'}>
            {d.milOn ? 'Check engine on' : 'No warning light'}
          </Badge>
        )
      }
    >
      {d === null && diagnostics.error === null && (
        <Card>
          <p class="muted">Reading the car…</p>
        </Card>
      )}
      {diagnostics.error !== null && (
        <Notice
          tone={d === null ? 'critical' : 'caution'}
          title={d === null ? 'Diagnostics unavailable' : 'Live data paused'}
          actions={
            <Button size="small" onClick={diagnostics.reload}>
              Retry
            </Button>
          }
        >
          {describeError(diagnostics.error)}
        </Notice>
      )}
      {d !== null && (
        <>
          <Card class={stale ? 'is-stale' : undefined}>
            <DtcList diagnostics={d} />
            {result && (
              <Notice
                tone={result.ok ? 'ok' : 'caution'}
                title={result.ok ? 'Codes cleared' : 'Codes not cleared'}
              >
                {result.message}
              </Notice>
            )}
            {clearError !== null && (
              <Notice tone="critical" title="Codes not cleared">
                {describeError(clearError)}
              </Notice>
            )}
            <div class="card__actions">
              <Button
                variant="danger"
                onClick={() => setConfirming(true)}
                disabled={d.dtcs.length === 0 && !d.milOn}
              >
                Clear trouble codes…
              </Button>
            </div>
          </Card>
          <Card class={stale ? 'is-stale' : undefined}>
            <dl class="stats stats--compact">
              <Stat label="OBD-II link">
                <span class="stat-line">
                  <StatusDot tone={OBD_STATE_TONES[d.link.state] ?? 'neutral'} />
                  {OBD_STATE_LABELS[d.link.state] ?? d.link.state}
                </span>
              </Stat>
              <Stat label="Adapter">{d.link.adapter ?? '–'}</Stat>
              <Stat label="Protocol">{d.link.protocol ?? '–'}</Stat>
              <Stat label="VIN">
                <span class="mono">{d.vin ?? '–'}</span>
              </Stat>
              <Stat label="Supported signals">
                {d.supported === null ? 'Discovering…' : String(d.supported.length)}
              </Stat>
            </dl>
          </Card>
          <SignalTable diagnostics={d} units={units} paused={stale} />
        </>
      )}
      {confirming && (
        <Dialog
          title="Clear trouble codes?"
          onClose={() => setConfirming(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="danger" busy={clearing} onClick={clear}>
                Clear codes
              </Button>
            </>
          }
        >
          <p>
            This turns off the check-engine light and erases the stored codes and freeze-frame data.
          </p>
          <p>
            It also <strong>resets the emissions readiness monitors</strong>: the car needs a full
            drive cycle (often several days of mixed driving) before it passes an emissions or
            inspection test again. A fault that is not repaired will come back.
          </p>
          <p class="muted">The HUD only does this when the car is parked with the engine off.</p>
        </Dialog>
      )}
    </Section>
  );
}

function DtcList({ diagnostics }: { diagnostics: ApiDiagnostics }) {
  if (diagnostics.dtcs.length === 0) {
    return (
      <div class="empty">
        <p class="empty__title">No trouble codes</p>
        <p class="muted">
          {diagnostics.dtcsCheckedAt === null
            ? 'The car has not been asked for codes yet.'
            : `Last checked ${new Date(diagnostics.dtcsCheckedAt).toLocaleTimeString()}.`}
        </p>
      </div>
    );
  }
  return (
    <ul class="dtc-list">
      {diagnostics.dtcs.map((dtc) => (
        <li key={`${dtc.code}-${dtc.kind}`} class={cx('dtc', `dtc--${dtc.severity}`)}>
          <div class="dtc__head">
            <span class="dtc__code">{dtc.code}</span>
            <Badge tone={SEVERITY_TONE[dtc.severity] ?? 'caution'}>
              {SEVERITY_LABEL[dtc.severity] ?? dtc.severity}
            </Badge>
            <Badge>{KIND_LABEL[dtc.kind] ?? dtc.kind}</Badge>
          </div>
          <p class="dtc__short">{dtc.short}</p>
          {dtc.description !== dtc.short && <p class="dtc__description">{dtc.description}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Each signal's sample time across polls (see `watchSignals`), advanced once per response; a new
 * response arrives every poll, so ageing values are re-judged without a timer.
 */
function useSignalAging(diagnostics: ApiDiagnostics) {
  const state = useRef<{ from: ApiDiagnostics | null; watch: SignalWatch; now: number }>({
    from: null,
    watch: new Map(),
    now: 0,
  });
  if (state.current.from !== diagnostics) {
    const now = performance.now();
    state.current = {
      from: diagnostics,
      watch: watchSignals(state.current.watch, diagnostics, now),
      now,
    };
  }
  return { watch: state.current.watch, now: state.current.now, poll: DIAGNOSTICS_POLL_MS };
}

function SignalTable({
  diagnostics,
  units,
  paused,
}: {
  diagnostics: ApiDiagnostics;
  units: UnitsConfig;
  paused: boolean;
}) {
  const aging = useSignalAging(diagnostics);
  const rows = signalRows(diagnostics, units, aging);
  return (
    <Card>
      <div class="card__head">
        <h3 class="card__title">Live data</h3>
        <span class="muted small">{paused ? 'Paused' : 'Updates every second'}</span>
      </div>
      {rows.length === 0 ? (
        <p class="muted">No live values — the car is not reporting any right now.</p>
      ) : (
        <table class="signals">
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                class={cx(row.stale && 'is-stale', row.abnormal && !row.stale && 'is-abnormal')}
              >
                <th scope="row">{row.label}</th>
                <td class="signals__value">
                  {row.stale ? <span class="muted">stale</span> : row.value}
                </td>
                <td class="signals__unit">{row.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
