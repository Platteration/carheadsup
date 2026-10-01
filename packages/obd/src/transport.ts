/**
 * Byte links to an ELM327 adapter. Text is exchanged as latin1 strings: the ELM327 protocol
 * is 7-bit ASCII, and latin1 maps every byte 1:1 so line noise never throws.
 */
import net from 'node:net';
import type { ObdConfig } from '@carheadsup/core';
import { RecordingTransport, type RecordingOptions } from './transcript.ts';

export interface Transport {
  /** Open the link. Rejects when the device/host cannot be reached. */
  open(): Promise<void>;
  /** Write raw text (commands must include their trailing "\r"). */
  write(data: string): Promise<void>;
  /** Subscribe to received text; returns an unsubscribe function. */
  onData(cb: (chunk: string) => void): () => void;
  /**
   * Subscribe to the link closing. Fires once per opened session: with an error when the
   * link dropped unexpectedly, without one after `close()`.
   */
  onClose(cb: (err?: Error) => void): () => void;
  /** Close the link; resolves once closed. Safe to call more than once. */
  close(): Promise<void>;
  /** Human-readable description, e.g. "serial /dev/rfcomm0 @ 38400". */
  readonly description: string;
}

/** Listener bookkeeping shared by every transport implementation. */
export class TransportEvents {
  private readonly dataListeners = new Set<(chunk: string) => void>();
  private readonly closeListeners = new Set<(err?: Error) => void>();

  onData(cb: (chunk: string) => void): () => void {
    this.dataListeners.add(cb);
    return () => {
      this.dataListeners.delete(cb);
    };
  }

  onClose(cb: (err?: Error) => void): () => void {
    this.closeListeners.add(cb);
    return () => {
      this.closeListeners.delete(cb);
    };
  }

  emitData(chunk: string): void {
    if (chunk.length === 0) return;
    for (const cb of [...this.dataListeners]) cb(chunk);
  }

  emitClose(err?: Error): void {
    for (const cb of [...this.closeListeners]) cb(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Serial (Bluetooth SPP via /dev/rfcomm*, USB via /dev/ttyUSB*)
// ---------------------------------------------------------------------------------------------

/** The part of serialport's `SerialPort` the transport uses (lets tests inject SerialPortMock). */
export interface SerialPortLike {
  readonly isOpen: boolean;
  open(callback: (err: Error | null) => void): void;
  write(
    data: string,
    encoding: 'latin1',
    callback: (err: Error | null | undefined) => void,
  ): boolean;
  close(callback: (err: Error | null) => void): void;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'close', listener: (err?: Error | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  removeAllListeners(): unknown;
}

export interface SerialTransportOptions {
  /** Device path, e.g. "/dev/rfcomm0" (bind it first with `rfcomm bind`) or "/dev/ttyUSB0". */
  path: string;
  /** 38400 for most ELM327 clones; Bluetooth SPP ignores it. */
  baudRate: number;
  /** Port factory; defaults to serialport's `SerialPort` (loaded lazily). */
  openPort?: (options: {
    path: string;
    baudRate: number;
  }) => SerialPortLike | Promise<SerialPortLike>;
}

async function defaultOpenPort(options: {
  path: string;
  baudRate: number;
}): Promise<SerialPortLike> {
  // Loaded lazily so hosts without the native binding can still use TCP or the simulator.
  const { SerialPort } = await import('serialport');
  return new SerialPort({ path: options.path, baudRate: options.baudRate, autoOpen: false });
}

export class SerialTransport implements Transport {
  readonly description: string;
  private readonly options: SerialTransportOptions;
  private readonly events = new TransportEvents();
  private port: SerialPortLike | null = null;
  private closing = false;

  constructor(options: SerialTransportOptions) {
    this.options = options;
    this.description = `serial ${options.path} @ ${options.baudRate}`;
  }

  async open(): Promise<void> {
    if (this.port) throw new Error(`${this.description} is already open`);
    const factory = this.options.openPort ?? defaultOpenPort;
    const port = await factory({ path: this.options.path, baudRate: this.options.baudRate });
    await new Promise<void>((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });
    this.port = port;
    this.closing = false;
    let lastError: Error | undefined;
    port.on('data', (chunk: Buffer) => this.events.emitData(chunk.toString('latin1')));
    port.on('error', (err: Error) => {
      lastError = err;
    });
    port.on('close', (err?: Error | null) => {
      if (this.port !== port) return;
      this.port = null;
      port.removeAllListeners();
      const reason = this.closing
        ? undefined
        : (err ?? lastError ?? new Error('Serial port closed'));
      this.events.emitClose(reason);
    });
  }

  write(data: string): Promise<void> {
    const port = this.port;
    if (!port?.isOpen) return Promise.reject(new Error(`${this.description} is not open`));
    return new Promise((resolve, reject) => {
      port.write(data, 'latin1', (err) => (err ? reject(err) : resolve()));
    });
  }

  onData(cb: (chunk: string) => void): () => void {
    return this.events.onData(cb);
  }

  onClose(cb: (err?: Error) => void): () => void {
    return this.events.onClose(cb);
  }

  async close(): Promise<void> {
    const port = this.port;
    if (!port) return;
    this.closing = true;
    if (!port.isOpen) {
      this.port = null;
      port.removeAllListeners();
      this.events.emitClose();
      return;
    }
    await new Promise<void>((resolve) => {
      // The 'close' event handler reports the closure; a close error still leaves us closed.
      port.close(() => resolve());
    });
  }
}

// ---------------------------------------------------------------------------------------------
// TCP (Wi-Fi ELM327 adapters, usually 192.168.0.10:35000)
// ---------------------------------------------------------------------------------------------

export interface TcpTransportOptions {
  host: string;
  port: number;
  /** Give up connecting after this long. Default 5000 ms. */
  connectTimeoutMs?: number;
  /** TCP keepalive initial delay, so a vanished adapter is noticed. Default 5000 ms. */
  keepAliveMs?: number;
  /** Socket factory (tests). */
  createSocket?: () => net.Socket;
}

export class TcpTransport implements Transport {
  readonly description: string;
  private readonly options: TcpTransportOptions;
  private readonly events = new TransportEvents();
  private socket: net.Socket | null = null;
  /** Aborts a connection attempt in progress (close() during open()). */
  private abortConnect: (() => void) | null = null;
  private closing = false;

  constructor(options: TcpTransportOptions) {
    this.options = options;
    this.description = `tcp ${options.host}:${options.port}`;
  }

  async open(): Promise<void> {
    if (this.socket || this.abortConnect) throw new Error(`${this.description} is already open`);
    const socket = this.options.createSocket?.() ?? new net.Socket();
    const timeoutMs = this.options.connectTimeoutMs ?? 5000;
    await new Promise<void>((resolve, reject) => {
      const fail = (err: Error): void => {
        cleanup();
        socket.destroy();
        reject(err);
      };
      this.abortConnect = () => fail(new Error(`Connection to ${this.description} aborted`));
      const timer = setTimeout(
        () => fail(new Error(`Timed out connecting to ${this.options.host}:${this.options.port}`)),
        timeoutMs,
      );
      const onError = (err: Error): void => fail(err);
      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        this.abortConnect = null;
        socket.off('error', onError);
        socket.off('connect', onConnect);
      };
      socket.once('error', onError);
      socket.once('connect', onConnect);
      socket.connect({ host: this.options.host, port: this.options.port });
    });

    socket.setNoDelay(true);
    socket.setKeepAlive(true, this.options.keepAliveMs ?? 5000);
    this.socket = socket;
    this.closing = false;
    let lastError: Error | undefined;
    socket.on('data', (chunk: Buffer) => this.events.emitData(chunk.toString('latin1')));
    socket.on('error', (err: Error) => {
      lastError = err;
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      socket.removeAllListeners();
      this.events.emitClose(
        this.closing ? undefined : (lastError ?? new Error('Connection closed by the adapter')),
      );
    });
  }

  write(data: string): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error(`${this.description} is not open`));
    }
    return new Promise((resolve, reject) => {
      socket.write(data, 'latin1', (err) => (err ? reject(err) : resolve()));
    });
  }

  onData(cb: (chunk: string) => void): () => void {
    return this.events.onData(cb);
  }

  onClose(cb: (err?: Error) => void): () => void {
    return this.events.onClose(cb);
  }

  async close(): Promise<void> {
    this.abortConnect?.();
    const socket = this.socket;
    if (!socket) return;
    this.closing = true;
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.destroy();
    });
  }
}

export interface CreateTransportOptions {
  /**
   * Where to record the session when `config.recordTranscript` is on (see `transcript.ts`);
   * without it nothing is recorded.
   */
  recording?: RecordingOptions;
}

function hardwareTransport(config: ObdConfig): Transport {
  switch (config.transport) {
    case 'serial':
      return new SerialTransport({ path: config.serialPath, baudRate: config.baudRate });
    case 'tcp':
      return new TcpTransport({ host: config.tcpHost, port: config.tcpPort });
    case 'simulator':
      throw new Error("The 'simulator' transport is provided by ObdService (Elm327Emulator)");
  }
}

/**
 * Create the configured hardware transport, recording its traffic when `config.recordTranscript`
 * is on and `options.recording` says where to. The 'simulator' kind has no hardware transport;
 * {@link ObdService} builds an `Elm327Emulator` for it.
 *
 * @throws Error for the 'simulator' kind.
 */
export function createTransport(
  config: ObdConfig,
  options: CreateTransportOptions = {},
): Transport {
  const transport = hardwareTransport(config);
  return config.recordTranscript && options.recording !== undefined
    ? new RecordingTransport(transport, options.recording)
    : transport;
}
