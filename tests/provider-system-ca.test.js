import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

test('Windows provider requests retain Node roots and trust system roots', { skip: process.platform !== 'win32' }, async () => {
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;
  const bundled = tls.getCACertificates('default');
  const system = tls.getCACertificates('system');
  await import('../src/core/provider/fetch-with-retry.js');
  const fingerprint = (certificate) => new X509Certificate(certificate).fingerprint256;
  const trusted = new Set(tls.getCACertificates('default').map(fingerprint));
  for (const certificate of [...bundled, ...system]) {
    assert.ok(trusted.has(fingerprint(certificate)));
  }
});
