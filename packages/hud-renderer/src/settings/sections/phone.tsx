import { isPairingToken, shortFingerprint } from '@carheadsup/core';
import type { ApiPairingShowResult, ApiTlsInfo, HudConfig } from '@carheadsup/core';
import { useState } from 'preact/hooks';
import { describeError } from '../../common/api.ts';
import type { HudApi } from '../../common/api.ts';
import type { Scope } from '../model/scope.ts';
import { tokenProblem, trimToken } from '../model/validation.ts';
import { Badge, Button, Card, Notice, Section, Stat } from '../ui/common.tsx';
import { FieldGroup, TextField, ToggleField } from '../ui/fields.tsx';
import { copyText, generateToken } from '../ui/hooks.ts';

/** Generate / copy buttons for a secret text field. */
export function SecretActions({
  value,
  onGenerate,
  label,
}: {
  value: string;
  onGenerate: (token: string) => void;
  label: string;
}) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  return (
    <>
      <Button
        size="small"
        onClick={() => onGenerate(generateToken())}
        aria-label={`Generate a new ${label}`}
      >
        Generate
      </Button>
      <Button
        size="small"
        variant="ghost"
        disabled={value === ''}
        aria-label={`Copy the ${label}`}
        onClick={async () => {
          setCopied((await copyText(value)) ? 'ok' : 'failed');
          setTimeout(() => setCopied('idle'), 2000);
        }}
      >
        {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
      </Button>
    </>
  );
}

/**
 * The encrypted phone link as `/api/info` reports it: the certificate fingerprint the companion
 * app pins and shows when it pairs, for the driver to compare. `undefined` until the HUD has
 * answered.
 */
function PhoneLink({ tls }: { tls: ApiTlsInfo | null | undefined }) {
  if (tls === undefined) return <p class="muted">Waiting for the HUD…</p>;
  if (tls === null) {
    return (
      <Notice tone="warning" title="The phone cannot connect">
        The HUD’s encrypted phone link (TLS) is not running. Set a TLS port under Server and restart
        the HUD; if one is set, the HUD’s log says why it did not start.
      </Notice>
    );
  }
  return (
    <>
      <dl class="stats stats--compact">
        <Stat label="Certificate fingerprint">
          <span class="mono" title={`SHA-256 ${tls.fingerprint}`}>
            {shortFingerprint(tls.fingerprint)}
          </span>
        </Stat>
        <Stat label="TLS port">{tls.port}</Stat>
      </dl>
      <p class="field__hint">
        The companion app shows the same fingerprint when it pairs and remembers this certificate
        from then on. If the two differ, another device is posing as the HUD: do not pair.
      </p>
    </>
  );
}

/**
 * "Show pairing code on the HUD": the parked HUD turns its dashboard to a QR code with the
 * pairing code, its certificate and its address, which the companion app scans (Setup → Scan
 * HUD QR code). The HUD refuses unless the car is parked.
 */
export function ShowPairingCode({ api, unsaved }: { api: HudApi; unsaved: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiPairingShowResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const show = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api.showPairing());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="pairing-qr">
      <div class="card__actions">
        <Button variant="primary" busy={busy} onClick={show}>
          Show pairing code on the HUD
        </Button>
      </div>
      <p class="field__hint">
        Parked only. The HUD shows a QR code for the companion app to scan (Setup → Scan HUD QR
        code): the pairing code, the HUD’s certificate and its address, so there is nothing to type
        or compare. It closes by itself after 3 minutes. Anyone who can see the display can scan it.
      </p>
      {unsaved && (
        <p class="field__hint">
          Save your changes first: the HUD shows the pairing code it has saved.
        </p>
      )}
      {result && (
        <Notice
          tone={result.ok && result.status === 'ready' ? 'ok' : 'caution'}
          title={result.ok ? 'On the HUD' : 'Not shown'}
        >
          {result.message}
        </Notice>
      )}
      {error !== null && (
        <Notice tone="critical" title="Not shown">
          {describeError(error)}
        </Notice>
      )}
    </div>
  );
}

export function PhoneSection({
  root,
  tls,
  api,
}: {
  root: Scope<HudConfig>;
  /** The TLS listener from `/api/info`; `undefined` until the HUD has answered. */
  tls?: ApiTlsInfo | null;
  /** The HUD's API, for "Show pairing code on the HUD"; without it the button is left out. */
  api?: HudApi;
}) {
  const phone = root.child('phone');
  const paired = phone.value.pairingToken !== '';
  // A code the HUD kept although it breaks today's rule (spaces, accents…; older versions allowed
  // them, and a hand edit of config.json still can): it still works, but no QR code carries it.
  const legacyCode =
    paired && !phone.dirty('pairingToken') && !isPairingToken(phone.value.pairingToken);
  return (
    <Section
      id="phone"
      title="Phone"
      intro="Navigation, calls, music and messages come from the companion app."
      aside={
        paired ? (
          <Badge tone="ok" title="Phone and HUD prove the pairing code to each other">
            Paired
          </Badge>
        ) : (
          <Badge tone="warning" title="No pairing code: any phone can connect">
            Not paired · open
          </Badge>
        )
      }
    >
      {!paired && (
        <Notice
          tone="warning"
          title="Not paired: the HUD is open"
          actions={
            <Button
              size="small"
              variant="primary"
              onClick={() => phone.set('pairingToken', generateToken())}
            >
              Generate pairing code
            </Button>
          }
        >
          Any phone on the car’s Wi-Fi can connect and feed the HUD, and your phone cannot verify
          that it is talking to this HUD — it asks you to confirm instead. Generate a pairing code,
          save, and pair the companion app by scanning the code on the HUD (or type it in).
        </Notice>
      )}
      {legacyCode && (
        <Notice
          tone="caution"
          title="Old-style pairing code"
          actions={
            <Button
              size="small"
              variant="primary"
              onClick={() => phone.set('pairingToken', generateToken())}
            >
              Generate new pairing code
            </Button>
          }
        >
          It has spaces or characters other than plain letters, digits and symbols, which pairing
          codes no longer use. Phones paired with it still connect, but the HUD cannot show it as a
          QR code. To pair by scanning: generate a new code, save, and pair the phone again.
        </Notice>
      )}
      <Card>
        <FieldGroup title="Encrypted link">
          <PhoneLink tls={tls} />
        </FieldGroup>
        <FieldGroup title="Pairing">
          <TextField
            scope={phone}
            k="pairingToken"
            label="Pairing code"
            monospace
            transform={trimToken}
            validate={tokenProblem}
            placeholder="No code — any phone can connect"
            hint="The companion app gets it by scanning the HUD’s pairing QR code (below), or you type it in: phone and HUD then prove to each other that they know it (the code itself never crosses the Wi-Fi). Use Generate: a long random code cannot be guessed."
            actions={
              <SecretActions
                label="pairing code"
                value={phone.value.pairingToken}
                onGenerate={(token) => phone.set('pairingToken', token)}
              />
            }
          />
          {api && <ShowPairingCode api={api} unsaved={phone.dirty('pairingToken')} />}
        </FieldGroup>
        <FieldGroup title="On the HUD">
          <ToggleField
            scope={phone}
            k="showMessageSender"
            label="Show who sent a message"
            hint="The message itself is never shown while driving."
          />
          <ToggleField
            scope={phone}
            k="readMessagesAloud"
            label="Read messages aloud on the phone"
          />
          <ToggleField scope={phone} k="showMedia" label="Show song and artist on track change" />
        </FieldGroup>
      </Card>
    </Section>
  );
}
