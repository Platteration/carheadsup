import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash, generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { connect, createServer } from 'node:tls';
import type { ConnectionOptions, PeerCertificate } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NO_EXPIRY,
  buildSelfSignedCertificate,
  certificateFingerprint,
  createHudCertificate,
  parseCertificateBundle,
  toPem,
} from '../../src/tls/certificate.ts';
import type { CertificateBundle } from '../../src/tls/certificate.ts';

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

function openssl(args: string[], input: string): string | null {
  try {
    return execFileSync('openssl', args, { input, encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
}
const hasOpenssl = openssl(['version'], '') !== null;

describe('buildSelfSignedCertificate', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const notBefore = new Date(Date.UTC(2026, 0, 1));

  it('makes a certificate that X.509 parsers accept, signed by its own key', () => {
    const der = buildSelfSignedCertificate({
      privateKey,
      commonName: 'carheadsup HUD (golf)',
      organization: 'carheadsup',
      dnsNames: ['golf', 'golf.local', 'localhost'],
      ipAddresses: ['127.0.0.1', '::1', '10.42.0.1'],
      notBefore,
      notAfter: NO_EXPIRY,
      serialNumber: Buffer.from([0x01, 0x02, 0x03]),
    });
    const cert = new X509Certificate(der);
    expect(cert.subject).toBe('O=carheadsup\nCN=carheadsup HUD (golf)');
    expect(cert.issuer).toBe(cert.subject);
    expect(cert.subjectAltName).toBe(
      'DNS:golf, DNS:golf.local, DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1, IP Address:10.42.0.1',
    );
    expect(cert.serialNumber).toBe('010203');
    expect(new Date(cert.validFrom).getTime()).toBe(notBefore.getTime());
    expect(cert.validTo).toBe('Dec 31 23:59:59 9999 GMT');
    expect(cert.ca).toBe(false);
    expect(cert.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1']); // extended key usage: serverAuth
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.checkPrivateKey(privateKey)).toBe(true);
    expect(cert.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    expect(cert.raw.equals(der)).toBe(true);
  });

  it('makes the serial number positive and non-zero', () => {
    const serial = (bytes: number[]) =>
      new X509Certificate(
        buildSelfSignedCertificate({
          privateKey,
          commonName: 'x',
          notBefore,
          notAfter: NO_EXPIRY,
          serialNumber: Buffer.from(bytes),
        }),
      ).serialNumber;
    expect(serial([0xff, 0x01])).toBe('7F01');
    expect(serial([0, 0])).toBe('01');
    // Random by default, 16 bytes.
    const random = new X509Certificate(
      buildSelfSignedCertificate({ privateKey, commonName: 'x', notBefore, notAfter: NO_EXPIRY }),
    ).serialNumber;
    expect(random.length).toBeGreaterThanOrEqual(30);
  });

  it('cuts the common name to 64 characters and leaves out an empty subjectAltName', () => {
    const cert = new X509Certificate(
      buildSelfSignedCertificate({
        privateKey,
        commonName: 'H'.repeat(80),
        notBefore,
        notAfter: NO_EXPIRY,
      }),
    );
    expect(cert.subject).toBe(`CN=${'H'.repeat(64)}`);
    expect(cert.subjectAltName).toBeUndefined();
  });

  it('refuses what it cannot certify', () => {
    const base = { privateKey, commonName: 'x', notBefore, notAfter: NO_EXPIRY };
    expect(() => buildSelfSignedCertificate({ ...base, notAfter: notBefore })).toThrow(/notAfter/);
    expect(() => buildSelfSignedCertificate({ ...base, ipAddresses: ['hud.local'] })).toThrow(
      /not an IP address/,
    );
    expect(() => buildSelfSignedCertificate({ ...base, dnsNames: ['hüd'] })).toThrow(
      /not a DNS name/,
    );
    expect(() => buildSelfSignedCertificate({ ...base, serialNumber: Buffer.alloc(21) })).toThrow(
      /serial/,
    );
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey;
    expect(() => buildSelfSignedCertificate({ ...base, privateKey: rsa })).toThrow(/P-256/);
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey;
    expect(() => buildSelfSignedCertificate({ ...base, privateKey: p384 })).toThrow(/P-256/);
  });
});

describe('createHudCertificate', () => {
  it('names the HUD and starts a day early, without expiry', () => {
    const bundle = createHudCertificate({ hostName: 'raspberrypi', now: NOW });
    const cert = new X509Certificate(bundle.certPem);
    expect(cert.subject).toBe('O=carheadsup\nCN=carheadsup HUD (raspberrypi)');
    expect(cert.subjectAltName).toBe(
      'DNS:raspberrypi, DNS:raspberrypi.local, DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1',
    );
    expect(new Date(cert.validFrom).getTime()).toBe(NOW - 24 * 3_600_000);
    expect(new Date(cert.validTo).getTime()).toBe(NO_EXPIRY.getTime());
    expect(parseCertificateBundle(bundle.keyPem, bundle.certPem).fingerprint).toBe(
      bundle.fingerprint,
    );
    expect(bundle.keyPem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(bundle.certDer.equals(cert.raw)).toBe(true);
  });

  it('fingerprints the DER bytes with SHA-256, as the phone does', () => {
    const bundle = createHudCertificate({ hostName: 'golf', now: NOW });
    const expected = createHash('sha256').update(bundle.certDer).digest('hex');
    expect(bundle.fingerprint).toBe(expected);
    expect(certificateFingerprint(bundle.certDer)).toBe(expected);
    expect(
      new X509Certificate(bundle.certPem).fingerprint256.replaceAll(':', '').toLowerCase(),
    ).toBe(expected);
  });

  it('is a new key and certificate every time', () => {
    const a = createHudCertificate({ hostName: 'golf', now: NOW });
    const b = createHudCertificate({ hostName: 'golf', now: NOW });
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.keyPem).not.toBe(b.keyPem);
  });

  it('leaves out a host name that is not a DNS label', () => {
    for (const hostName of ['my_pi', '', '-pi', 'a'.repeat(64)]) {
      const cert = new X509Certificate(createHudCertificate({ hostName, now: NOW }).certPem);
      expect(cert.subjectAltName).toBe(
        'DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1',
      );
    }
    expect(
      new X509Certificate(createHudCertificate({ hostName: '', now: NOW }).certPem).subject,
    ).toBe('O=carheadsup\nCN=carheadsup HUD');
  });

  it.skipIf(!hasOpenssl)('passes openssl’s own checks', () => {
    const bundle = createHudCertificate({ hostName: 'golf', now: NOW });
    const text = openssl(['x509', '-noout', '-text'], bundle.certPem) ?? '';
    expect(text).toContain('Version: 3 (0x2)');
    expect(text).toContain('Signature Algorithm: ecdsa-with-SHA256');
    expect(text).toMatch(/X509v3 Basic Constraints: critical\s+CA:FALSE/);
    expect(text).toMatch(/X509v3 Key Usage: critical\s+Digital Signature/);
    expect(text).toMatch(/X509v3 Extended Key Usage:\s+TLS Web Server Authentication/);
    expect(text).toContain('X509v3 Subject Key Identifier');
    expect(text).toContain('DNS:golf.local');
    // Strict DER parsing, and the certificate verifies as its own trust anchor.
    expect(openssl(['asn1parse', '-strictpem'], bundle.certPem)).toContain('prime256v1');
    expect(openssl(['x509', '-noout', '-fingerprint', '-sha256'], bundle.certPem)).toContain(
      bundle.fingerprint.toUpperCase().match(/../g)?.join(':'),
    );
  });
});

describe('parseCertificateBundle', () => {
  it('accepts a matching key and certificate, and refuses a mismatch', () => {
    const a = createHudCertificate({ hostName: 'a', now: NOW });
    const b = createHudCertificate({ hostName: 'b', now: NOW });
    expect(parseCertificateBundle(a.keyPem, a.certPem).fingerprint).toBe(a.fingerprint);
    expect(() => parseCertificateBundle(a.keyPem, b.certPem)).toThrow(/not for the stored key/);
    expect(() => parseCertificateBundle('garbage', a.certPem)).toThrow();
    expect(() =>
      parseCertificateBundle(a.keyPem, toPem('CERTIFICATE', Buffer.from([1, 2]))),
    ).toThrow();
  });
});

describe('a real TLS handshake with the generated certificate', () => {
  const servers: Array<{ close: () => void }> = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function serve(bundle: CertificateBundle): Promise<number> {
    const server = createServer({ key: bundle.keyPem, cert: bundle.certPem }, (socket) => {
      socket.end('hello over TLS');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  function handshake(
    port: number,
    options: ConnectionOptions,
  ): Promise<{ text: string; peer: PeerCertificate; protocol: string | null }> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port, ...options }, () => {
        const peer = socket.getPeerCertificate();
        const protocol = socket.getProtocol();
        let text = '';
        socket.on('data', (chunk: Buffer) => (text += chunk.toString()));
        socket.on('end', () => resolve({ text, peer, protocol }));
      });
      socket.on('error', reject);
    });
  }

  it('is trusted when pinned as the CA, for its IP address and host names', async () => {
    const bundle = createHudCertificate({ hostName: 'golf', now: NOW });
    const port = await serve(bundle);
    for (const servername of [undefined, 'localhost', 'golf.local', 'golf']) {
      const result = await handshake(port, {
        ca: bundle.certPem,
        ...(servername === undefined ? {} : { servername }),
      });
      expect(result.text).toBe('hello over TLS');
      expect(certificateFingerprint(result.peer.raw)).toBe(bundle.fingerprint);
      expect(result.protocol).toMatch(/^TLSv1\.[23]$/);
    }
  });

  it('is refused for a name it does not carry, and by a client that does not pin it', async () => {
    const bundle = createHudCertificate({ hostName: 'golf', now: NOW });
    const port = await serve(bundle);
    await expect(
      handshake(port, { ca: bundle.certPem, servername: 'evil.example' }),
    ).rejects.toThrow(/altnames|Hostname/i);
    await expect(handshake(port, {})).rejects.toThrow(/self[- ]signed/i);
    const other = createHudCertificate({ hostName: 'golf', now: NOW });
    await expect(handshake(port, { ca: other.certPem })).rejects.toThrow();
  });
});
