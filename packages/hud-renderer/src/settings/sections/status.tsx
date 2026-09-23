import type { ApiInfo, ObdLinkState } from '@carheadsup/core';
import { useState } from 'preact/hooks';
import { describeError, isHudApiError } from '../../common/api.ts';
import type { HudApi } from '../../common/api.ts';
import { formatUptime } from '../model/records.ts';
import { Badge, Button, Card, Notice, Section, StatusDot } from '../ui/common.tsx';
import type { Tone } from '../ui/common.tsx';
import type { Resource } from '../ui/hooks.ts';

export const OBD_STATE_LABELS: Readonly<Record<ObdLinkState, string>> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  initializing: 'Initialising adapter…',
  connected: 'Connected',
  error: 'Error',
};

export const OBD_STATE_TONES: Readonly<Record<ObdLinkState, Tone>> = {
  disconnected: 'neutral',
  connecting: 'caution',
  initializing: 'caution',
  connected: 'ok',
  error: 'critical',
};

/** True when the error means "wrong or missing token". */
export function needsToken(error: unknown): boolean {
  return isHudApiError(error) && error.kind === 'unauthorized';
}

export interface StatusSectionProps {
  api: HudApi;
  info: Resource<ApiInfo>;
  /** A new token was stored: reload everything. */
  onTokenChange: () => void;
}

export function StatusSection({ api, info, onTokenChange }: StatusSectionProps) {
  const data = info.data;
  const lost = data !== null && info.error !== null;
  return (
    <Section
      id="status"
      title="Status"
      aside={data?.simulated ? <Badge tone="info">Simulator</Badge> : undefined}
    >
      {data === null && info.error === null && (
        <Card>
          <p class="muted">Connecting to the HUD…</p>
        </Card>
      )}
      {info.error !== null && needsToken(info.error) && (
        <TokenCard api={api} onSaved={onTokenChange} prominent />
      )}
      {info.error !== null && !needsToken(info.error) && (
        <Notice
          tone={data === null ? 'critical' : 'caution'}
          title={data === null ? 'HUD not reachable' : 'Connection lost'}
          actions={
            <Button size="small" onClick={info.reload} busy={info.loading}>
              Retry
            </Button>
          }
        >
          {describeError(info.error)}
          {data !== null
            ? ' The values below are from the last successful update.'
            : ' Retrying automatically.'}
        </Notice>
      )}
      {data !== null && (
        <Card class={lost ? 'is-stale' : undefined}>
          <div class="tiles">
            <div class="tile">
              <p class="tile__label">OBD-II</p>
              <p class="tile__value">
                <StatusDot tone={OBD_STATE_TONES[data.obd.state] ?? 'neutral'} />
                {OBD_STATE_LABELS[data.obd.state] ?? data.obd.state}
              </p>
              {data.obd.adapter && <p class="tile__sub">{data.obd.adapter}</p>}
              {data.obd.protocol && <p class="tile__sub">{data.obd.protocol}</p>}
              {data.obd.message && <p class="tile__sub tile__sub--note">{data.obd.message}</p>}
            </div>
            <div class="tile">
              <p class="tile__label">Phone</p>
              <p class="tile__value">
                <StatusDot tone={data.phoneConnected ? 'ok' : 'neutral'} />
                {data.phoneConnected ? 'Connected' : 'Not connected'}
              </p>
              <p class="tile__sub">
                {data.phoneConnected ? 'Navigation, calls and media' : 'Open the companion app'}
              </p>
            </div>
          </div>
          <p class="status-meta">
            <span>{data.simulated ? 'Vehicle simulator' : 'Live vehicle'}</span>
            <span>v{data.version}</span>
            <span>Up {formatUptime(data.uptimeS)}</span>
          </p>
        </Card>
      )}
      {!needsToken(info.error) && <TokenCard api={api} onSaved={onTokenChange} />}
    </Section>
  );
}

/**
 * Enter the HUD's API token on this device. Prominent when the HUD refused a request; otherwise
 * a collapsed "Access token" row.
 */
export function TokenCard({
  api,
  onSaved,
  prominent = false,
}: {
  api: HudApi;
  onSaved: () => void;
  prominent?: boolean;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(prominent);
  const stored = api.tokens.get() !== '';
  const save = () => {
    api.tokens.set(text);
    setText('');
    onSaved();
  };
  const form = (
    <form
      class="token-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() !== '') save();
      }}
    >
      <label class="field__label" for="api-token">
        Access token
      </label>
      <div class="input-row">
        <input
          id="api-token"
          class="input input--mono"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          placeholder={stored ? '•••••• (saved on this device)' : 'Paste the token'}
          value={text}
          onInput={(event) => setText(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary" disabled={text.trim() === ''}>
          Use
        </Button>
      </div>
      <p class="field__hint">
        Shown under Server → API token on a device that already has access. Stored only on this
        device.
      </p>
      {stored && (
        <Button
          variant="ghost"
          size="small"
          onClick={() => {
            api.tokens.set('');
            onSaved();
          }}
        >
          Forget the saved token
        </Button>
      )}
    </form>
  );
  if (prominent) {
    return (
      <Notice tone="caution" title="This HUD asks for an access token">
        {form}
      </Notice>
    );
  }
  return (
    <details class="disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        Access token <span class="muted">{stored ? '· saved on this device' : '· not set'}</span>
      </summary>
      {form}
    </details>
  );
}
