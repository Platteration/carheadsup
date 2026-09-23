import type { HudConfig } from '@carheadsup/core';
import type { Scope } from '../model/scope.ts';
import { plainUnit } from '../model/units.ts';
import { tokenProblem, trimToken } from '../model/validation.ts';
import { Card, Notice, Section } from '../ui/common.tsx';
import { FieldGrid, NumberField, TextField, ToggleField } from '../ui/fields.tsx';
import { SecretActions } from './phone.tsx';

const PLAIN = plainUnit('');

export function ServerSection({ root }: { root: Scope<HudConfig> }) {
  const server = root.child('server');
  const tokenChanged = server.dirty('apiToken');
  return (
    <Section
      id="server"
      title="Server"
      intro="Advanced: how the HUD serves this app, the display and the phone."
    >
      <Card>
        <FieldGrid>
          <TextField
            scope={server}
            k="host"
            label="Listen on"
            monospace
            hint="0.0.0.0 lets the phone connect over Wi-Fi; 127.0.0.1 keeps the HUD private."
          />
          <NumberField scope={server} k="port" label="Port" unit={PLAIN} integer />
          <NumberField
            scope={server}
            k="frameRate"
            label="Display updates"
            unit={plainUnit('fps')}
            integer
          />
        </FieldGrid>
        <ToggleField
          scope={server}
          k="mdns"
          label="Announce on the network (mDNS)"
          hint="Lets the companion app find the HUD without typing its address."
        />
        <TextField
          scope={server}
          k="apiToken"
          label="API token"
          monospace
          transform={trimToken}
          validate={tokenProblem}
          placeholder="None — any device on the Wi-Fi can change settings"
          hint="Devices other than the HUD itself must present this token to use the settings and API."
          actions={
            <SecretActions
              label="API token"
              value={server.value.apiToken}
              onGenerate={(token) => server.set('apiToken', token)}
            />
          }
        />
        {tokenChanged && (
          <Notice tone="info">
            After saving, this device keeps access automatically. Copy the token now to use it on
            other devices.
          </Notice>
        )}
      </Card>
    </Section>
  );
}
