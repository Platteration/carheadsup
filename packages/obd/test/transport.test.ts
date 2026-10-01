import net from 'node:net';
import { SerialPortMock } from 'serialport';
import { afterEach, describe, expect, it } from 'vitest';
import { SerialTransport, TcpTransport, createTransport } from '../src/transport.ts';
import type { ObdConfig } from '@carheadsup/core';

const until = async (check: () => boolean, ms = 1000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('TcpTransport', () => {
  let server: net.Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  async function listen(onSocket: (socket: net.Socket) => void): Promise<number> {
    server = net.createServer(onSocket);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return address.port;
  }

  it('exchanges text with a Wi-Fi style adapter', async () => {
    const port = await listen((socket) => {
      socket.on('data', (chunk) => {
        if (chunk.toString('latin1') === 'ATI\r') socket.write('ELM327 v1.5\r\r>');
      });
    });
    const transport = new TcpTransport({ host: '127.0.0.1', port });
    expect(transport.description).toBe(`tcp 127.0.0.1:${port}`);
    let received = '';
    transport.onData((chunk) => (received += chunk));
    await transport.open();
    await transport.write('ATI\r');
    await until(() => received.includes('>'));
    expect(received).toBe('ELM327 v1.5\r\r>');
    let closeErr: Error | undefined | null = null;
    transport.onClose((err) => (closeErr = err));
    await transport.close();
    expect(closeErr).toBeUndefined(); // a requested close is not an error
    await expect(transport.write('ATI\r')).rejects.toThrow('not open');
  });

  it('reports the adapter hanging up as an unexpected close', async () => {
    const port = await listen((socket) => setTimeout(() => socket.destroy(), 20));
    const transport = new TcpTransport({ host: '127.0.0.1', port });
    let closeErr: Error | undefined | null = null;
    transport.onClose((err) => (closeErr = err));
    await transport.open();
    await until(() => closeErr !== null);
    expect(closeErr).toBeInstanceOf(Error);
  });

  it('rejects when the connection is refused', async () => {
    const port = await listen(() => {});
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
    await expect(new TcpTransport({ host: '127.0.0.1', port }).open()).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it('gives up connecting after the connect timeout', async () => {
    const socket = new net.Socket();
    socket.connect = (() => socket) as typeof socket.connect; // never connects
    const transport = new TcpTransport({
      host: '192.168.0.10',
      port: 35_000,
      connectTimeoutMs: 30,
      createSocket: () => socket,
    });
    await expect(transport.open()).rejects.toThrow('Timed out connecting to 192.168.0.10:35000');
  });

  it('aborts a connection attempt when closed while connecting', async () => {
    const socket = new net.Socket();
    socket.connect = (() => socket) as typeof socket.connect; // never connects
    const transport = new TcpTransport({
      host: '192.168.0.10',
      port: 35_000,
      createSocket: () => socket,
    });
    const opening = transport.open();
    await transport.close();
    await expect(opening).rejects.toThrow('aborted');
  });
});

describe('SerialTransport', () => {
  const PATH = '/dev/ttyMOCK0';
  afterEach(() => SerialPortMock.binding.reset());

  function transport(): SerialTransport {
    SerialPortMock.binding.createPort(PATH, { echo: false, record: true });
    return new SerialTransport({
      path: PATH,
      baudRate: 38_400,
      openPort: ({ path, baudRate }) => new SerialPortMock({ path, baudRate, autoOpen: false }),
    });
  }

  it('opens, writes and receives through serialport', async () => {
    const serial = transport();
    expect(serial.description).toBe('serial /dev/ttyMOCK0 @ 38400');
    let received = '';
    serial.onData((chunk) => (received += chunk));
    await serial.open();
    await serial.write('ATZ\r');
    const port = (serial as unknown as { port: SerialPortMock }).port;
    await until(() => port.port?.recording.toString('latin1') === 'ATZ\r');
    port.port?.emitData('\r\rELM327 v1.5\r\r>');
    await until(() => received.includes('>'));
    expect(received).toBe('\r\rELM327 v1.5\r\r>');
    let closeErr: Error | undefined | null = null;
    serial.onClose((err) => (closeErr = err));
    await serial.close();
    await until(() => closeErr !== null);
    expect(closeErr).toBeUndefined();
  });

  it('rejects opening a device that does not exist', async () => {
    const serial = new SerialTransport({
      path: '/dev/rfcomm9',
      baudRate: 38_400,
      openPort: ({ path, baudRate }) => new SerialPortMock({ path, baudRate, autoOpen: false }),
    });
    await expect(serial.open()).rejects.toThrow();
  });

  it('refuses writes before opening', async () => {
    await expect(transport().write('ATZ\r')).rejects.toThrow('not open');
  });
});

describe('createTransport', () => {
  const config: ObdConfig = {
    transport: 'serial',
    serialPath: '/dev/rfcomm0',
    baudRate: 38_400,
    tcpHost: '192.168.0.10',
    tcpPort: 35_000,
    protocol: '0',
    timeoutMs: 1000,
    reconnectDelayMs: 3000,
    dtcIntervalMs: 30_000,
    customPids: [],
    recordTranscript: false,
  };

  it('builds the configured hardware transport', () => {
    expect(createTransport(config).description).toBe('serial /dev/rfcomm0 @ 38400');
    expect(createTransport({ ...config, transport: 'tcp' }).description).toBe(
      'tcp 192.168.0.10:35000',
    );
    expect(() => createTransport({ ...config, transport: 'simulator' })).toThrow(/ObdService/);
  });
});
