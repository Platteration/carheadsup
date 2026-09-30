import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCertFingerprint } from '@carheadsup/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createHudCertificate } from '../../src/tls/certificate.ts';
import type { CertificateBundle, HudCertificateOptions } from '../../src/tls/certificate.ts';
import {
  TLS_FILE,
  loadTlsIdentity,
  parseTlsIdentity,
  serializeTlsIdentity,
} from '../../src/tls/identity.ts';
import { MemoryLogger, makeTempDir } from '../helpers.ts';

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup() {
  const temp = await makeTempDir();
  cleanups.push(temp.cleanup);
  const logger = new MemoryLogger();
  const made: CertificateBundle[] = [];
  const generate = (options: HudCertificateOptions): CertificateBundle => {
    const bundle = createHudCertificate(options);
    made.push(bundle);
    return bundle;
  };
  const path = join(temp.dir, TLS_FILE);
  const load = () => loadTlsIdentity(path, logger, { hostName: 'golf', now: () => NOW, generate });
  return { dir: temp.dir, path, logger, made, load };
}

const isPosix = process.platform !== 'win32';

describe('loadTlsIdentity', () => {
  it('makes a key and certificate on first start and keeps them, private', async () => {
    const { path, logger, made, load } = await setup();
    const first = await load();
    expect(made).toHaveLength(1);
    expect(logger.text('info')).toContain(`TLS: created a certificate in ${path}`);
    const text = await readFile(path, 'utf8');
    expect(text).toBe(serializeTlsIdentity(first));
    expect(text).toMatch(/^-----BEGIN PRIVATE KEY-----\n[\s\S]+-----BEGIN CERTIFICATE-----\n/);
    if (isPosix) expect((await stat(path)).mode & 0o777).toBe(0o600);

    // The next start uses the same certificate: paired phones keep recognising the HUD.
    const again = await load();
    expect(made).toHaveLength(1);
    expect(again.fingerprint).toBe(first.fingerprint);
    expect(again.keyPem.trim()).toBe(first.keyPem.trim());
  });

  it('replaces a corrupt file, keeping it aside, and says that phones must pair again', async () => {
    const { path, logger, made, load } = await setup();
    await writeFile(path, 'not a certificate');
    const identity = await load();
    expect(made).toHaveLength(1);
    expect(identity.fingerprint).toBe(made[0]?.fingerprint);
    expect(await readFile(`${path}.corrupt`, 'utf8')).toBe('not a certificate');
    expect(parseTlsIdentity(await readFile(path, 'utf8')).fingerprint).toBe(identity.fingerprint);
    expect(logger.text('warn')).toMatch(/corrupt \(no private key\).*HUD certificate changed/);
  });

  it('treats a certificate for another key, or a key without certificate, as corrupt', async () => {
    const a = createHudCertificate({ hostName: 'a', now: NOW });
    const b = createHudCertificate({ hostName: 'b', now: NOW });
    for (const [content, reason] of [
      [`${a.keyPem}${b.certPem}`, 'not for the stored key'],
      [a.keyPem, 'no certificate'],
      [a.certPem, 'no private key'],
      [`${a.keyPem}${a.certPem.replace(/[A-Za-z]{10}\n/, 'AAAAAAAAAA\n')}`, 'corrupt'],
    ] as const) {
      const { path, logger, load } = await setup();
      await writeFile(path, content);
      const identity = await load();
      expect(identity.fingerprint).not.toBe(a.fingerprint);
      expect(logger.text('warn')).toContain(reason);
    }
  });

  it('accepts the certificate after the key or the key after the certificate', async () => {
    const { path, made, load } = await setup();
    const bundle = createHudCertificate({ hostName: 'golf', now: NOW });
    await writeFile(path, `${bundle.certPem}\n${bundle.keyPem}`, { mode: 0o600 });
    expect((await load()).fingerprint).toBe(bundle.fingerprint);
    expect(made).toHaveLength(0);
  });

  it.skipIf(!isPosix)('takes read access away from others', async () => {
    const { path, logger, load } = await setup();
    const bundle = createHudCertificate({ hostName: 'golf', now: NOW });
    await writeFile(path, serializeTlsIdentity(bundle));
    await chmod(path, 0o644);
    expect((await load()).fingerprint).toBe(bundle.fingerprint);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(logger.text('warn')).toContain('readable by the HUD');
  });

  it.skipIf(!isPosix)('keeps a corrupt file set aside private: it may hold a key', async () => {
    const { path, load } = await setup();
    const a = createHudCertificate({ hostName: 'a', now: NOW });
    const b = createHudCertificate({ hostName: 'b', now: NOW });
    // A key copied in by hand, world-readable, with the wrong certificate.
    await writeFile(path, `${a.keyPem}${b.certPem}`);
    await chmod(path, 0o644);
    await load();
    expect(await readFile(`${path}.corrupt`, 'utf8')).toBe(`${a.keyPem}${b.certPem}`);
    expect((await stat(`${path}.corrupt`)).mode & 0o777).toBe(0o600);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('uses a temporary certificate when the file cannot be read, and leaves it alone', async () => {
    const { path, logger, made, load } = await setup();
    await mkdir(join(path, 'keep'), { recursive: true }); // EISDIR (on a car: EACCES or EIO)
    const identity = await load();
    expect(made).toHaveLength(1);
    expect(identity.fingerprint).toBe(made[0]?.fingerprint);
    expect((await stat(join(path, 'keep'))).isDirectory()).toBe(true);
    expect(logger.text('error')).toMatch(/cannot read .*temporary certificate/);
  });

  it('logs a certificate it cannot save and still serves it', async () => {
    const { dir, logger, made } = await setup();
    // The data directory vanished (on a car: a read-only or failing card).
    const path = join(dir, 'gone', TLS_FILE);
    const identity = await loadTlsIdentity(path, logger, { hostName: 'golf', now: () => NOW });
    expect(isCertFingerprint(identity.fingerprint)).toBe(true);
    expect(made).toHaveLength(0);
    expect(logger.text('error')).toMatch(
      /cannot save .*different certificate after the next restart/,
    );
    expect(await stat(path).catch(() => null)).toBeNull();
  });
});
