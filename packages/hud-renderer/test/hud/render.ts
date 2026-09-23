import type { HudFrame, ProjectionConfig } from '@carheadsup/core';
import { renderToString } from 'preact-render-to-string';
import { h } from 'preact';
import { HudView } from '../../src/hud/HudView.tsx';

/** Server-render the HUD for assertions on markup. */
export function renderHud(
  frame: HudFrame | null,
  props: {
    projection?: ProjectionConfig | null;
    preview?: boolean;
    hardwareBrightness?: boolean;
    className?: string;
  } = {},
): string {
  return renderToString(h(HudView, { frame, ...props }));
}

/** Markup → visible text (tags stripped, entities decoded, whitespace collapsed). */
export function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
