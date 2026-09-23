import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiError } from '@carheadsup/core';

/** Largest accepted JSON request body. */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

/** An error that maps to an HTTP status and an `ApiError` body. */
export class HttpError extends Error {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
  }
}

/** A handler's answer; the server writes it (JSON unless `text` is given). */
export interface HttpReply {
  status?: number;
  json?: unknown;
  text?: string;
  contentType?: string;
  headers?: Record<string, string>;
}

/** Write a reply. HEAD requests get the headers (including Content-Length) without the body. */
export function sendReply(res: ServerResponse, reply: HttpReply): void {
  const status = reply.status ?? 200;
  const body =
    reply.text !== undefined
      ? reply.text
      : JSON.stringify(reply.json === undefined ? null : reply.json);
  const contentType =
    reply.contentType ??
    (reply.text !== undefined ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
  const buffer = Buffer.from(body, 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(buffer.length));
  if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
  res.end(buffer);
}

export function sendError(
  res: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  const body: ApiError = { error: message };
  sendReply(res, { status, json: body, headers });
}

/** `application/json` or any `application/*+json`, ignoring parameters such as charset. */
export function isJsonContentType(header: string | undefined): boolean {
  if (header === undefined) return false;
  const type = (header.split(';')[0] ?? '').trim().toLowerCase();
  return type === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(type);
}

/**
 * Read a JSON request body. Resolves `undefined` for an empty body. Rejects with an HttpError:
 * 413 over `limit` bytes (checked against Content-Length up front and while streaming),
 * 415 when a non-empty body is not declared as JSON, 400 for invalid UTF-8 or JSON.
 */
export async function readJsonBody(
  req: IncomingMessage,
  limit: number = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const tooLarge = () =>
    new HttpError(413, `Request body too large (limit ${limit} bytes)`, { Connection: 'close' });
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw tooLarge();

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > limit) throw tooLarge();
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  if (!isJsonContentType(req.headers['content-type'])) {
    throw new HttpError(415, 'Request body must be JSON (Content-Type: application/json)');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch {
    throw new HttpError(400, 'Request body is not valid UTF-8');
  }
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new HttpError(
      400,
      `Request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
