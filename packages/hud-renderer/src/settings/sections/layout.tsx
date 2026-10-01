import { DRIVING_CONTEXTS, LAYOUT_ZONES, resolveLayout } from '@carheadsup/core';
import type {
  DrivingContext,
  HudConfig,
  LayoutPreset,
  WidgetPlacement,
  Zone,
} from '@carheadsup/core';
import { useMemo, useState } from 'preact/hooks';
import { HudView } from '../../hud/HudView.tsx';
import { cx } from '../../hud/util.ts';
import {
  BUILTIN_PRESETS,
  CONTEXT_LABELS,
  PRESET_INFO,
  WIDGET_LABELS,
  ZONE_LABELS,
  buildLayoutPreviewFrame,
  crowdedZones,
  customFromPreset,
  editorRows,
  moveWidget,
  setWidgetContext,
  setWidgetZone,
} from '../model/layout.ts';
import type { BuiltinPreset, EditorRow } from '../model/layout.ts';
import type { Scope } from '../model/scope.ts';
import { SECONDS_FROM_MS } from '../model/units.ts';
import { Button, Card, Notice, Section } from '../ui/common.tsx';
import { FieldGrid, FieldGroup, NumberField, Segmented, Switch } from '../ui/fields.tsx';
import { useForm } from '../ui/form-context.ts';

const CONTEXT_OPTIONS = DRIVING_CONTEXTS.map((c) => ({ value: c, label: CONTEXT_LABELS[c] }));

export function LayoutSection({ root }: { root: Scope<HudConfig> }) {
  const display = root.child('display');
  const layout = display.child('layout');
  const [context, setContext] = useState<DrivingContext>('city');
  const [situational, setSituational] = useState(true);
  const placements = resolveLayout(root.value);
  const frame = useMemo(
    () => buildLayoutPreviewFrame(placements, context, { situational }),
    [placements, context, situational],
  );
  const preset = layout.value.preset;

  const choosePreset = (next: LayoutPreset) => {
    if (next === preset) return;
    if (next === 'custom') {
      // Start the custom layout from what is on screen now.
      layout.replace({
        preset: 'custom',
        widgets: customFromPreset(preset === 'custom' ? 'standard' : preset),
      });
    } else {
      layout.set('preset', next);
    }
  };

  return (
    <Section
      id="layout"
      title="Layout"
      intro="Which widgets show where. The HUD shows fewer of them the faster you go."
    >
      <Card>
        <div
          class="preset-grid"
          role="radiogroup"
          aria-label="Layout preset"
          data-path={layout.keyOf('preset')}
        >
          {(['minimal', 'standard', 'sport', 'custom'] as const).map((p) => (
            <label key={p} class={cx('preset', p === preset && 'preset--on')}>
              <input
                type="radio"
                class="visually-hidden"
                name="layout-preset"
                checked={p === preset}
                onChange={() => choosePreset(p)}
              />
              <span class="preset__name">{PRESET_INFO[p].label}</span>
              <span class="preset__blurb">{PRESET_INFO[p].blurb}</span>
            </label>
          ))}
        </div>
        <div class="layout-preview">
          <Segmented
            name="preview-context"
            ariaLabel="Preview driving context"
            options={CONTEXT_OPTIONS}
            value={context}
            onChange={setContext}
            size="small"
          />
          <div class="hud-box" data-testid="layout-preview">
            <HudView frame={frame} preview />
          </div>
          <label class="inline-toggle">
            <Switch
              checked={situational}
              onChange={setSituational}
              label="Show situational widgets"
            />
            <span>Include guidance, hazards and warnings (shown only when relevant)</span>
          </label>
          {context === 'parked' && (
            <p class="muted small">
              When parked, the HUD shows the diagnostics dashboard instead of this grid.
            </p>
          )}
        </div>
      </Card>
      {preset === 'custom' ? (
        <CustomLayoutEditor scope={layout.child('widgets')} />
      ) : (
        <Card>
          <div class="card__row">
            <span>Want widgets elsewhere?</span>
            <Button size="small" onClick={() => choosePreset('custom')}>
              Customise {PRESET_INFO[preset].label.toLowerCase()}
            </Button>
          </div>
        </Card>
      )}
      <ContextThresholds root={root} />
    </Section>
  );
}

function CustomLayoutEditor({ scope }: { scope: Scope<WidgetPlacement[]> }) {
  const rows = editorRows(scope.value);
  const crowded = crowdedZones(scope.value);
  const update = (next: WidgetPlacement[]) => scope.replace(next);
  const issue = scope.issuesWithin()[0];
  return (
    <Card>
      <FieldGroup
        title="Custom layout"
        description="Choose each widget’s zone and the driving situations it may appear in. Higher in the list wins when a zone is full."
      >
        <div class="restart-row">
          <span class="muted small">Start again from</span>
          {BUILTIN_PRESETS.map((p: BuiltinPreset) => (
            <Button
              key={p}
              size="small"
              variant="ghost"
              onClick={() => update(customFromPreset(p))}
            >
              {PRESET_INFO[p].label}
            </Button>
          ))}
        </div>
        {crowded.length > 0 && (
          <Notice tone="caution" title="Crowded zones">
            {crowded
              .slice(0, 3)
              .map(
                (c) =>
                  `${ZONE_LABELS[c.zone]} (${CONTEXT_LABELS[c.context].toLowerCase()}): ${c.ids.map((id) => WIDGET_LABELS[id]).join(', ')}`,
              )
              .join('; ')}
            . Lower-priority widgets may not fit.
          </Notice>
        )}
        {issue && <p class="field__error">{issue.message}</p>}
        <ol class="widget-list" data-path={scope.key}>
          {rows.map((row, i) => (
            <WidgetRow
              key={row.id}
              row={row}
              first={row.index === 0}
              last={row.index === null || rows[i + 1]?.index === null || i === rows.length - 1}
              onZone={(zone) => update(setWidgetZone(scope.value, row.id, zone))}
              onContext={(context, on) =>
                update(setWidgetContext(scope.value, row.id, context, on))
              }
              onMove={(delta) => update(moveWidget(scope.value, row.id, delta))}
            />
          ))}
        </ol>
      </FieldGroup>
    </Card>
  );
}

function WidgetRow({
  row,
  first,
  last,
  onZone,
  onContext,
  onMove,
}: {
  row: EditorRow;
  first: boolean;
  last: boolean;
  onZone: (zone: Zone) => void;
  onContext: (context: DrivingContext, on: boolean) => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const hidden = row.contexts.length === 0;
  const label = WIDGET_LABELS[row.id];
  return (
    <li class={cx('widget-row', hidden && 'widget-row--hidden')} data-widget={row.id}>
      <div class="widget-row__head">
        <span class="widget-row__name">{label}</span>
        <select
          class="input select select--compact"
          aria-label={`${label} zone`}
          value={row.zone}
          onChange={(event) => onZone(event.currentTarget.value as Zone)}
        >
          {LAYOUT_ZONES.map((z) => (
            <option key={z} value={z}>
              {ZONE_LABELS[z]}
            </option>
          ))}
        </select>
      </div>
      <div class="widget-row__body">
        <div class="chips" role="group" aria-label={`${label} shows when`}>
          {DRIVING_CONTEXTS.map((c) => {
            const on = row.contexts.includes(c);
            return (
              <label key={c} class={cx('chip', on && 'chip--on')}>
                <input
                  type="checkbox"
                  class="visually-hidden"
                  checked={on}
                  onChange={(event) => onContext(c, event.currentTarget.checked)}
                />
                {CONTEXT_LABELS[c]}
              </label>
            );
          })}
        </div>
        {row.index !== null && (
          <span class="widget-row__order">
            <button
              type="button"
              class="icon-btn"
              aria-label={`Move ${label} up`}
              disabled={first}
              onClick={() => onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label={`Move ${label} down`}
              disabled={last}
              onClick={() => onMove(1)}
            >
              ↓
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

function ContextThresholds({ root }: { root: Scope<HudConfig> }) {
  const { driverUnits } = useForm();
  const context = root.child('display').child('context');
  return (
    <details class="disclosure disclosure--card">
      <summary>When is it “highway”, “stopped”, “parked”?</summary>
      <FieldGrid>
        <NumberField
          scope={context}
          k="highwayEnterKph"
          label="Highway above"
          unit={driverUnits.speed}
        />
        <NumberField
          scope={context}
          k="highwayExitKph"
          label="Leave highway below"
          unit={driverUnits.speed}
        />
        <NumberField
          scope={context}
          k="highwayDwellMs"
          label="…for at least"
          unit={SECONDS_FROM_MS}
          integer
        />
        <NumberField
          scope={context}
          k="stationaryKph"
          label="Stopped below"
          unit={{ ...driverUnits.speed, decimals: 1 }}
        />
        <NumberField
          scope={context}
          k="parkedAfterMs"
          label="Parked after idling for"
          unit={SECONDS_FROM_MS}
          integer
          hint="Standing still with the engine running; not while navigating or in gear."
        />
        <NumberField
          scope={context}
          k="engineOffParkedAfterMs"
          label="Parked after engine off for"
          unit={SECONDS_FROM_MS}
          integer
          hint="Delayed so automatic start-stop does not open the parked dashboard at red lights."
        />
      </FieldGrid>
    </details>
  );
}
