import type { AdasMessage, PhoneToHud, RendererToServer } from '../types/protocol.ts';
import { notImplemented } from '../todo.ts';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Strictly validate a raw WebSocket text frame from the phone. Unknown fields are stripped,
 * strings are length-capped (names 100 chars, iconPng 44 KiB base64), numbers must be finite.
 * A message with any content-like field ("body", "text", "content") on `message` is rejected.
 */
export function parsePhoneMessage(raw: string): ParseResult<PhoneToHud> {
  return notImplemented(`parsePhoneMessage(${raw.length})`);
}

export function parseRendererMessage(raw: string): ParseResult<RendererToServer> {
  return notImplemented(`parseRendererMessage(${raw.length})`);
}

export function parseAdasMessage(raw: string): ParseResult<AdasMessage> {
  return notImplemented(`parseAdasMessage(${raw.length})`);
}
