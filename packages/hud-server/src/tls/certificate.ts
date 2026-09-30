import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { ipAddressBytes } from '@carheadsup/core';
import {
  bitString,
  boolean,
  explicit,
  implicitPrimitive,
  integer,
  octetString,
  oid,
  sequence,
  set,
  utf8String,
  x509Time,
} from './der.ts';

/**
 * Self-signed X.509 v3 certificates (RFC 5280) for the HUD's TLS listener, built with
 * node:crypto keys and the DER encoder in `der.ts` — no openssl command needed. Only what a TLS
 * server certificate for ECDSA P-256 requires: basicConstraints CA:FALSE, keyUsage
 * digitalSignature, extKeyUsage serverAuth, subjectAltName and a subjectKeyIdentifier.
 */

/** Object identifiers used in the certificate. */
export const X509_OID = {
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  subjectKeyIdentifier: '2.5.29.14',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
} as const;

/**
 * "No well-defined expiration date" (RFC 5280 4.1.2.5): the phone pins the certificate itself,
 * so an expiry would only ever break a working pairing.
 */
export const NO_EXPIRY = new Date(Date.UTC(9999, 11, 31, 23, 59, 59));

/** RFC 5280 upper bound of a common name. */
const MAX_COMMON_NAME = 64;

export interface CertificateOptions {
  /** The key that signs (self-signed: the subject's own key). ECDSA P-256. */
  privateKey: KeyObject;
  /** Subject and issuer common name (cut to 64 characters). */
  commonName: string;
  /** Subject and issuer organisation, if any. */
  organization?: string;
  /** subjectAltName DNS names (ASCII). */
  dnsNames?: readonly string[];
  /** subjectAltName IP addresses (IPv4 or IPv6 literals). */
  ipAddresses?: readonly string[];
  notBefore: Date;
  notAfter: Date;
  /** Positive serial number, 1–20 bytes; default 16 random bytes. */
  serialNumber?: Uint8Array;
}

/** A certificate and its private key, as the TLS listener and the phone see them. */
export interface CertificateBundle {
  /** PKCS#8 PEM of the private key. */
  keyPem: string;
  /** PEM of the certificate. */
  certPem: string;
  /** The certificate's DER bytes. */
  certDer: Buffer;
  /** SHA-256 of `certDer`, 64 lowercase hex digits (what the phone pins and binds). */
  fingerprint: string;
}

/** SHA-256 of a certificate's DER bytes as 64 lowercase hex digits. */
export function certificateFingerprint(der: Uint8Array): string {
  return createHash('sha256').update(der).digest('hex');
}

/** PEM armour: base64 in lines of 64 characters. */
export function toPem(label: string, der: Uint8Array): string {
  const base64 = Buffer.from(der).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function name(commonName: string, organization: string | undefined): Buffer {
  const rdn = (type: string, value: string) => set(sequence(oid(type), utf8String(value)));
  const cn = Array.from(commonName).slice(0, MAX_COMMON_NAME).join('');
  return sequence(
    ...(organization === undefined ? [] : [rdn(X509_OID.organization, organization)]),
    rdn(X509_OID.commonName, cn),
  );
}

function extension(id: string, critical: boolean, value: Uint8Array): Buffer {
  return sequence(oid(id), ...(critical ? [boolean(true)] : []), octetString(value));
}

/** The uncompressed EC point 0x04 || x || y of a P-256 public key (subjectPublicKey's bits). */
function ecPoint(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.x === undefined || jwk.y === undefined) {
    throw new Error('the certificate key must be an ECDSA P-256 key');
  }
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
}

function subjectAltName(dnsNames: readonly string[], ipAddresses: readonly string[]): Buffer {
  const names: Buffer[] = [];
  for (const dns of dnsNames) {
    if (!/^[\x21-\x7e]{1,253}$/.test(dns)) throw new RangeError(`not a DNS name: "${dns}"`);
    // dNSName [2] IMPLICIT IA5String
    names.push(implicitPrimitive(2, Buffer.from(dns, 'ascii')));
  }
  for (const ip of ipAddresses) {
    const bytes = ipAddressBytes(ip);
    if (bytes === null) throw new RangeError(`not an IP address: "${ip}"`);
    // iPAddress [7] IMPLICIT OCTET STRING
    names.push(implicitPrimitive(7, bytes));
  }
  return sequence(...names);
}

function positiveSerial(serial: Uint8Array | undefined): Buffer {
  const bytes = Buffer.from(serial ?? randomBytes(16));
  if (bytes.length === 0 || bytes.length > 20) {
    throw new RangeError('a serial number has 1–20 bytes');
  }
  // Positive and non-zero (RFC 5280 4.1.2.2): clear the sign bit, set a low bit.
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  if (bytes.every((b) => b === 0)) bytes[bytes.length - 1] = 1;
  return bytes;
}

/** DER of a self-signed X.509 v3 certificate for a TLS server with an ECDSA P-256 key. */
export function buildSelfSignedCertificate(options: CertificateOptions): Buffer {
  const { privateKey } = options;
  if (options.notAfter.getTime() <= options.notBefore.getTime()) {
    throw new RangeError('notAfter must be after notBefore');
  }
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const point = ecPoint(publicKey);
  const signatureAlgorithm = sequence(oid(X509_OID.ecdsaWithSha256));
  const subject = name(options.commonName, options.organization);
  const dnsNames = options.dnsNames ?? [];
  const ipAddresses = options.ipAddresses ?? [];

  const extensions = [
    extension(X509_OID.basicConstraints, true, sequence()),
    // digitalSignature only (bit 0): ECDHE key exchange with an ECDSA certificate.
    extension(X509_OID.keyUsage, true, bitString(Buffer.from([0x80]), 7)),
    extension(X509_OID.extKeyUsage, false, sequence(oid(X509_OID.serverAuth))),
    extension(
      X509_OID.subjectKeyIdentifier,
      false,
      octetString(createHash('sha1').update(point).digest()),
    ),
  ];
  if (dnsNames.length > 0 || ipAddresses.length > 0) {
    extensions.push(
      extension(X509_OID.subjectAltName, false, subjectAltName(dnsNames, ipAddresses)),
    );
  }

  const tbs = sequence(
    explicit(0, integer(2)), // v3
    integer(positiveSerial(options.serialNumber)),
    signatureAlgorithm,
    subject, // issuer: self-signed
    sequence(x509Time(options.notBefore), x509Time(options.notAfter)),
    subject,
    spki,
    explicit(3, sequence(...extensions)),
  );
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  return sequence(tbs, signatureAlgorithm, bitString(signature));
}

export interface HudCertificateOptions {
  /** The machine's host name: DNS names `<host>` and `<host>.local` when it is a valid label. */
  hostName: string;
  /** Now (epoch ms); the certificate is valid from a day before. */
  now: number;
}

/** A DNS label: letters, digits and hyphens, 1–63 characters, not starting or ending with "-". */
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * A fresh ECDSA P-256 key and a self-signed certificate naming the HUD: CN "carheadsup HUD
 * (<host>)", subjectAltName `<host>`, `<host>.local`, `localhost`, 127.0.0.1 and ::1, valid from
 * a day before `now` (a Pi without a real-time clock may be behind) without expiry. The phone
 * does not check names or dates: it pins the certificate.
 */
export function createHudCertificate(options: HudCertificateOptions): CertificateBundle {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const host = options.hostName.trim();
  const hostNames = DNS_LABEL.test(host) ? [host, `${host}.local`] : [];
  const day = 24 * 60 * 60 * 1000;
  const notBefore = new Date(Math.floor((options.now - day) / 1000) * 1000);
  const der = buildSelfSignedCertificate({
    privateKey,
    commonName: host === '' ? 'carheadsup HUD' : `carheadsup HUD (${host})`,
    organization: 'carheadsup',
    dnsNames: [...hostNames, 'localhost'],
    ipAddresses: ['127.0.0.1', '::1'],
    notBefore,
    notAfter: NO_EXPIRY,
  });
  return bundleOf(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), der);
}

function bundleOf(keyPem: string, certDer: Buffer): CertificateBundle {
  return {
    keyPem,
    certPem: toPem('CERTIFICATE', certDer),
    certDer,
    fingerprint: certificateFingerprint(certDer),
  };
}

/**
 * Check a stored key and certificate: both parse, and the certificate is for that key. Returns
 * the bundle (with the fingerprint), or throws with the reason. Any key type is accepted, so a
 * certificate of one's own can replace the generated one.
 */
export function parseCertificateBundle(keyPem: string, certPem: string): CertificateBundle {
  const key = createPrivateKey(keyPem);
  const cert = new X509Certificate(certPem);
  if (!cert.checkPrivateKey(key)) throw new Error('the certificate is not for the stored key');
  return bundleOf(keyPem, cert.raw);
}
