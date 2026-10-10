import type { TokenStore } from './api.ts';

interface SettingsBridge {
  getToken(): string;
  setToken(token: string): void;
  request(id: number, url: string, method: string, body: string, token: string): void;
  cancel(id: number): void;
}

interface NativeReply {
  status: number;
  text: string;
  type: string;
}

type SettingsWindow = typeof globalThis & {
  CarheadsupSettings?: SettingsBridge;
  __carheadsupSettingsReply?: (id: number, raw: string) => void;
};

/** The companion's WebView blocks its own networking. Native requests check the paired leaf
 * certificate for every connection, even when another certificate chains to a system CA. */
export function androidSettingsTransport(host: SettingsWindow = globalThis):
  { fetch: typeof fetch; tokens: TokenStore } | null {
  const bridge = host.CarheadsupSettings;
  if (!bridge) return null;
  let nextId = 0;
  const pending = new Map<number, (reply: NativeReply) => void>();
  host.__carheadsupSettingsReply = (id, raw) => {
    const complete = pending.get(id);
    if (!complete) return;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null) return;
      const reply = value as Partial<NativeReply>;
      if (typeof reply.status !== 'number' || typeof reply.text !== 'string' || typeof reply.type !== 'string') return;
      complete(reply as NativeReply);
    } catch { /* An invalid reply eventually times out through the API's AbortSignal. */ }
  };
  const doFetch: typeof fetch = (input, init = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const signal = init.signal;
    const cleanup = () => {
      pending.delete(id);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      bridge.cancel(id);
      reject(new DOMException('Request cancelled', 'AbortError'));
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(id, (reply) => {
      cleanup();
      const body = [204, 205, 304].includes(reply.status) ? null : reply.text;
      resolve(new Response(body, { status: reply.status, headers: { 'Content-Type': reply.type } }));
    });
    try {
      const authorization = new Headers(init.headers).get('Authorization') ?? '';
      bridge.request(id, String(input), init.method ?? 'GET', typeof init.body === 'string' ? init.body : '',
        authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
  return { fetch: doFetch, tokens: { get: () => bridge.getToken(), set: (token) => bridge.setToken(token.trim()) } };
}
