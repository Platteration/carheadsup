import { shortFingerprint } from '@carheadsup/core';
import type { ApiTlsInfo, HudConfig } from '@carheadsup/core';
import { useState } from 'preact/hooks';
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

export function PhoneSection({
  root,
  tls,
}: {
  root: Scope<HudConfig>;
  /** The TLS listener from `/api/info`; `undefined` until the HUD has answered. */
  tls?: ApiTlsInfo | null;
}) {
  const phone = root.child('phone');
  const paired = phone.value.pairingToken !== '';
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
          save, and enter the same code in the companion app.
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
            hint="Enter the same code in the companion app: phone and HUD then prove to each other that they know it (the code itself never crosses the Wi-Fi). Use Generate: a long random code cannot be guessed from a recorded connection."
            actions={
              <SecretActions
                label="pairing code"
                value={phone.value.pairingToken}
                onGenerate={(token) => phone.set('pairingToken', token)}
              />
            }
          />
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
