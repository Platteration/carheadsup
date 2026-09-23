import type { HudConfig } from '@carheadsup/core';
import { useState } from 'preact/hooks';
import type { Scope } from '../model/scope.ts';
import { tokenProblem, trimToken } from '../model/validation.ts';
import { Button, Card, Section } from '../ui/common.tsx';
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

export function PhoneSection({ root }: { root: Scope<HudConfig> }) {
  const phone = root.child('phone');
  return (
    <Section
      id="phone"
      title="Phone"
      intro="Navigation, calls, music and messages come from the companion app."
    >
      <Card>
        <FieldGroup title="Pairing">
          <TextField
            scope={phone}
            k="pairingToken"
            label="Pairing code"
            monospace
            transform={trimToken}
            validate={tokenProblem}
            placeholder="No code — any phone can connect"
            hint="Enter the same code in the companion app. Leave empty to allow any phone on the car’s Wi-Fi."
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
