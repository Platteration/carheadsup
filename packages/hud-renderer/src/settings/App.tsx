import { DEFAULT_CONFIG } from '@carheadsup/core';
import type { HudConfig } from '@carheadsup/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { describeError } from '../common/api.ts';
import type { HudApi } from '../common/api.ts';
import { cx } from '../hud/util.ts';
import type { Scope } from './model/scope.ts';
import { driverUnits } from './model/units.ts';
import { AlertsSection } from './sections/alerts.tsx';
import { DiagnosticsSection } from './sections/diagnostics.tsx';
import { DisplaySection } from './sections/display.tsx';
import { LayoutSection } from './sections/layout.tsx';
import { MaintenanceSection } from './sections/maintenance.tsx';
import { ObdSection } from './sections/obd.tsx';
import { PhoneSection } from './sections/phone.tsx';
import { ProjectionSection } from './sections/projection.tsx';
import { SensorsSection } from './sections/sensors.tsx';
import { ServerSection } from './sections/server.tsx';
import { ShiftLightSection } from './sections/shift-light.tsx';
import { StatusSection, needsToken } from './sections/status.tsx';
import { TripsSection } from './sections/trips.tsx';
import { UnitsSection } from './sections/units.tsx';
import { VehicleSection } from './sections/vehicle.tsx';
import { useConfigEditor } from './state/useConfigEditor.ts';
import type { ConfigEditor, ConfigEditorOptions } from './state/useConfigEditor.ts';
import { Button, Placeholder, Section } from './ui/common.tsx';
import { FormContext } from './ui/form-context.ts';
import type { FormContextValue } from './ui/form-context.ts';
import { usePageVisible, useResource } from './ui/hooks.ts';
import { SaveBar } from './ui/SaveBar.tsx';
import { SectionNav } from './ui/SectionNav.tsx';
import './settings.css';

interface SectionInfo {
  id: string;
  title: string;
  /** Label in the section bar. */
  short: string;
  /** What the section needs before it can render: live data from the HUD, or its config. */
  needs: 'nothing' | 'data' | 'config';
}

/** Every section in page order: live car data first, then HUD look, then setup. */
export const SECTIONS: readonly SectionInfo[] = [
  { id: 'status', title: 'Status', short: 'Status', needs: 'nothing' },
  { id: 'diagnostics', title: 'Diagnostics', short: 'Diagnostics', needs: 'data' },
  { id: 'trips', title: 'Trips', short: 'Trips', needs: 'data' },
  { id: 'maintenance', title: 'Maintenance', short: 'Service', needs: 'data' },
  { id: 'display', title: 'Display', short: 'Display', needs: 'config' },
  { id: 'projection', title: 'Projection', short: 'Projection', needs: 'config' },
  { id: 'layout', title: 'Layout', short: 'Layout', needs: 'config' },
  { id: 'shift-light', title: 'Shift light', short: 'Shift light', needs: 'config' },
  { id: 'alerts', title: 'Alerts', short: 'Alerts', needs: 'config' },
  { id: 'units', title: 'Units', short: 'Units', needs: 'config' },
  { id: 'vehicle', title: 'Vehicle', short: 'Vehicle', needs: 'config' },
  { id: 'phone', title: 'Phone', short: 'Phone', needs: 'config' },
  { id: 'obd', title: 'OBD connection', short: 'OBD', needs: 'config' },
  { id: 'sensors', title: 'Sensors and buttons', short: 'Sensors', needs: 'config' },
  { id: 'server', title: 'Server', short: 'Server', needs: 'config' },
];

const idsNeeding = (needs: SectionInfo['needs']) =>
  SECTIONS.filter((s) => s.needs === needs).map((s) => s.id);

/** How often the status block refreshes. */
export const INFO_POLL_MS = 4000;

export interface SettingsAppProps {
  api: HudApi;
  /** Test seams for the editor (debounce, clock). */
  editorOptions?: ConfigEditorOptions;
}

type Connection = 'connecting' | 'online' | 'offline' | 'locked';

export function SettingsApp({ api, editorOptions }: SettingsAppProps) {
  const editor = useConfigEditor(api, editorOptions);
  const pageVisible = usePageVisible();
  const info = useResource((signal) => api.getInfo({ signal }), {
    pollMs: INFO_POLL_MS,
    enabled: pageVisible,
  });
  /** Bumped when the token changes, remounting sections so they refetch with it. */
  const [session, setSession] = useState(0);

  const connection: Connection =
    info.data !== null
      ? 'online'
      : info.error === null
        ? 'connecting'
        : needsToken(info.error)
          ? 'locked'
          : 'offline';

  // The HUD came (back) within reach: retry loading the config if that had failed.
  useEffect(() => {
    if (info.loadedAt !== null && editor.status === 'error') void editor.reload();
  }, [info.loadedAt]);

  const units = editor.draft?.units ?? DEFAULT_CONFIG.units;
  const form = useMemo<FormContextValue>(
    () => ({
      setLocalError: editor.setLocalError,
      revision: editor.revision,
      units,
      driverUnits: driverUnits(units),
    }),
    [editor.setLocalError, editor.revision, units],
  );

  const onTokenChange = () => {
    setSession((n) => n + 1);
    info.reload();
    void editor.reload();
  };

  const root = editor.root;
  const online = connection === 'online';

  return (
    <FormContext.Provider value={form}>
      <div class={cx('app', !online && 'app--offline')}>
        <header class="topbar">
          <div class="topbar__title">
            <h1>HUD settings</h1>
            <p class="topbar__subtitle">{editor.draft?.vehicle.name ?? 'carheadsup'}</p>
          </div>
          <ConnectionPill connection={connection} simulated={info.data?.simulated ?? false} />
        </header>
        <SectionNav sections={SECTIONS} />
        <main class="content" id="content">
          <StatusSection api={api} info={info} onTokenChange={onTokenChange} />
          {online ? (
            <>
              <DiagnosticsSection key={`d${session}`} api={api} units={units} />
              <TripsSection key={`t${session}`} api={api} units={units} root={root} />
              <MaintenanceSection
                key={`m${session}`}
                api={api}
                units={units}
                root={root}
                savedSchedule={editor.base?.maintenance ?? null}
              />
            </>
          ) : (
            idsNeeding('data').map((id) => <Waiting key={id} id={id} connection={connection} />)
          )}
          <ConfigSections editor={editor} root={root} connection={connection} />
        </main>
        <SaveBar editor={editor} />
      </div>
    </FormContext.Provider>
  );
}

function ConfigSections({
  editor,
  root,
  connection,
}: {
  editor: ConfigEditor;
  root: Scope<HudConfig> | null;
  connection: Connection;
}) {
  const ids = idsNeeding('config');
  if (root === null) {
    return (
      <>
        {ids.map((id, i) => (
          <Waiting
            key={id}
            id={id}
            connection={connection}
            loadError={i === 0 && connection === 'online' ? editor.loadError : null}
            onRetry={i === 0 ? () => void editor.reload() : undefined}
          />
        ))}
      </>
    );
  }
  return (
    <>
      <DisplaySection root={root} />
      <ProjectionSection root={root} live={editor.live} onRetry={editor.retryLive} />
      <LayoutSection root={root} />
      <ShiftLightSection root={root} />
      <AlertsSection root={root} />
      <UnitsSection root={root} />
      <VehicleSection root={root} />
      <PhoneSection root={root} />
      <ObdSection root={root} />
      <SensorsSection root={root} />
      <ServerSection root={root} />
    </>
  );
}

const WAITING_TEXT: Readonly<Record<Connection, string>> = {
  connecting: 'Loading…',
  online: 'Loading…',
  offline: 'Available once the HUD is reachable.',
  locked: 'Enter the access token under Status to continue.',
};

/** Stand-in for a section whose data cannot be loaded yet (keeps the page and nav intact). */
function Waiting({
  id,
  connection,
  loadError,
  onRetry,
}: {
  id: string;
  connection: Connection;
  loadError?: unknown;
  onRetry?: () => void;
}) {
  const section = SECTIONS.find((s) => s.id === id);
  const failed = loadError !== null && loadError !== undefined;
  return (
    <Section id={id} title={section?.title ?? id}>
      <Placeholder>
        <span>
          {failed
            ? `Settings could not be loaded: ${describeError(loadError)}`
            : WAITING_TEXT[connection]}
        </span>
        {failed && onRetry && (
          <Button size="small" onClick={onRetry}>
            Retry
          </Button>
        )}
      </Placeholder>
    </Section>
  );
}

function ConnectionPill({ connection, simulated }: { connection: Connection; simulated: boolean }) {
  const labels: Record<Connection, ComponentChildren> = {
    connecting: 'Connecting…',
    online: simulated ? 'Simulator' : 'Connected',
    offline: 'Offline',
    locked: 'Locked',
  };
  return (
    <span class={cx('pill', `pill--${connection}`)} role="status">
      <span class="pill__dot" aria-hidden="true" />
      {labels[connection]}
    </span>
  );
}
