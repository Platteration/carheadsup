import { useEffect, useState } from 'preact/hooks';
import { describeError } from '../../common/api.ts';
import { pathWithin } from '../model/diff.ts';
import type { ConfigEditor } from '../state/useConfigEditor.ts';
import { Button } from './common.tsx';

/** How long the "Saved" confirmation stays up. */
export const SAVED_NOTICE_MS = 3000;

/**
 * The element best matching a config path: an exact `data-path`, else the closest ancestor or
 * descendant path (e.g. a list row whose field is not rendered).
 */
export function findFieldElement(root: ParentNode, path: string): HTMLElement | null {
  const all = [...root.querySelectorAll<HTMLElement>('[data-path]')];
  const exact = all.find((el) => el.dataset.path === path);
  if (exact) return exact;
  let best: HTMLElement | null = null;
  let bestLength = -1;
  for (const el of all) {
    const p = el.dataset.path ?? '';
    if (p !== '' && (pathWithin(path, p) || pathWithin(p, path)) && p.length > bestLength) {
      best = el;
      bestLength = p.length;
    }
  }
  return best;
}

/** Bring a field into view: open collapsed groups around it, scroll, focus its input. */
export function revealField(path: string): void {
  const el = findFieldElement(document, path);
  if (!el) return;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement) node.open = true;
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true });
}

/** Sticky bottom bar: unsaved-change count, problems to fix, Save / Discard, save results. */
export function SaveBar({ editor }: { editor: ConfigEditor }) {
  const { pendingPaths, blockingPaths, saving, saveError, lastSave, generalErrors } = editor;
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (lastSave === null) return undefined;
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [lastSave]);

  const pending = pendingPaths.length;
  const problems = blockingPaths.length;
  const rejected = lastSave?.rejected ?? 0;
  const visible =
    pending > 0 ||
    saving ||
    saveError !== null ||
    generalErrors.length > 0 ||
    showSaved ||
    (problems > 0 && pending > 0);
  if (!visible) return null;

  let message: string;
  let tone: 'neutral' | 'ok' | 'caution' | 'critical' = 'neutral';
  if (saveError !== null) {
    message = `Not saved: ${describeError(saveError)}`;
    tone = 'critical';
  } else if (problems > 0 && pending > 0) {
    message = problems === 1 ? '1 field needs fixing' : `${problems} fields need fixing`;
    tone = 'caution';
  } else if (showSaved && rejected > 0) {
    message =
      rejected === 1
        ? 'Saved, but the HUD rejected 1 value — see the marked field'
        : `Saved, but the HUD rejected ${rejected} values — see the marked fields`;
    tone = 'caution';
  } else if (pending > 0) {
    message = pending === 1 ? '1 unsaved change' : `${pending} unsaved changes`;
  } else if (generalErrors.length > 0) {
    message = generalErrors.join(' ');
    tone = 'caution';
  } else {
    message = 'Saved';
    tone = 'ok';
  }

  return (
    <div class={`save-bar save-bar--${tone}`} role="region" aria-label="Unsaved changes">
      <p class="save-bar__message" role="status" aria-live="polite">
        {message}
      </p>
      {pending > 0 && (
        <div class="save-bar__actions">
          <Button size="small" variant="ghost" onClick={editor.discard} disabled={saving}>
            Discard
          </Button>
          {problems > 0 ? (
            <Button size="small" onClick={() => blockingPaths[0] && revealField(blockingPaths[0])}>
              Show
            </Button>
          ) : (
            <Button size="small" variant="primary" onClick={() => void editor.save()} busy={saving}>
              Save
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
