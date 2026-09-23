import type { IncomingMessage } from 'node:http';
import { HttpError } from './respond.ts';
import type { HttpReply } from './respond.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteContext {
  req: IncomingMessage;
  url: URL;
  /** Decoded `:name` path parameters. */
  params: Readonly<Record<string, string>>;
  /** The parsed JSON body (`undefined` when empty); read lazily, at most once. */
  body(): Promise<unknown>;
}

export type RouteHandler = (ctx: RouteContext) => HttpReply | Promise<HttpReply>;

interface Route {
  method: HttpMethod;
  segments: readonly string[];
  handler: RouteHandler;
}

export type RouteMatch =
  | { kind: 'found'; handler: RouteHandler; params: Record<string, string> }
  | { kind: 'method-not-allowed'; allow: string[] }
  | { kind: 'not-found' };

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter((segment, index) => index > 0 || segment !== '');
}

/**
 * A minimal exact-segment router: patterns like `/api/trips/:id`, where `:name` matches one
 * non-empty path segment (percent-decoded). HEAD is answered by GET routes. A path that
 * matches with another method yields `method-not-allowed` with the `Allow` list.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method, segments: splitPath(pattern), handler });
    return this;
  }

  match(method: string, pathname: string): RouteMatch {
    const segments = splitPath(pathname);
    const effective = method === 'HEAD' ? 'GET' : method;
    const allowed = new Set<string>();
    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments);
      if (params === null) continue;
      if (route.method === effective) return { kind: 'found', handler: route.handler, params };
      allowed.add(route.method);
      if (route.method === 'GET') allowed.add('HEAD');
    }
    return allowed.size > 0
      ? { kind: 'method-not-allowed', allow: [...allowed].sort() }
      : { kind: 'not-found' };
  }
}

function matchSegments(
  pattern: readonly string[],
  actual: readonly string[],
): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i] ?? '';
    const segment = actual[i] ?? '';
    if (expected.startsWith(':')) {
      if (segment === '') return null;
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        throw new HttpError(400, 'Malformed percent-encoding in the path');
      }
      params[expected.slice(1)] = decoded;
    } else if (expected !== segment) {
      return null;
    }
  }
  return params;
}
