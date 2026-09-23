import type { DeepPartial, HudConfig, LayoutPreset, WidgetPlacement } from '../types/config.ts';
import { notImplemented } from '../todo.ts';

/** Sensible defaults for a typical petrol car with a windshield-reflected display. */
export const DEFAULT_CONFIG: HudConfig = undefined as unknown as HudConfig;

/** Widget placements for each built-in layout preset. */
export const LAYOUT_PRESETS: Readonly<
  Record<Exclude<LayoutPreset, 'custom'>, readonly WidgetPlacement[]>
> = undefined as unknown as Record<Exclude<LayoutPreset, 'custom'>, readonly WidgetPlacement[]>;

/** The effective widget placements for a config (preset or custom). */
export function resolveLayout(config: HudConfig): readonly WidgetPlacement[] {
  return notImplemented(`resolveLayout(${config.display.layout.preset})`);
}

/**
 * Validate an unknown value (e.g. a JSON file) into a full HudConfig. Lenient: missing or
 * invalid fields fall back to `base` (default: DEFAULT_CONFIG) and are reported in `errors`
 * with a dotted path, so a partially broken config file never stops the HUD from starting.
 */
export function parseConfig(
  input: unknown,
  base?: HudConfig,
): { config: HudConfig; errors: string[] } {
  return notImplemented(`parseConfig(${typeof input}, ${String(base?.version)})`);
}

/** Deep-merge a patch into a config (arrays replaced wholesale), then validate like parseConfig. */
export function mergeConfig(
  base: HudConfig,
  patch: DeepPartial<HudConfig>,
): { config: HudConfig; errors: string[] } {
  return notImplemented(`mergeConfig(${base.version}, ${typeof patch})`);
}
