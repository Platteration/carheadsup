import type { SocketLike } from '../../src/common/connection.ts';

/** In-memory stand-in for a browser WebSocket, driven explicitly by the test. */
export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  readonly sent: string[] = [];
  closeCalls = 0;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static latest(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error('no socket was created');
    return socket;
  }

  static factory = (url: string): SocketLike => new FakeSocket(url);

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('InvalidStateError');
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  // --- test controls -------------------------------------------------------

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  receiveJson(value: unknown): void {
    this.receive(JSON.stringify(value));
  }

  /** The server went away (close event, as browsers deliver it). */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006 } as CloseEvent);
  }

  /** Connection failure: 'error' followed by 'close', like a browser. */
  fail(): void {
    this.onerror?.(new Event('error'));
    this.drop();
  }
}
