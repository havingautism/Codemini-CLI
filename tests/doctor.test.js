import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

import { handleDoctor } from '../src/commands/doctor.js';
import {
  checkMicrosandboxDoctor,
  describeSandboxDoctorSkip,
  describeSandboxDoctorUnavailable,
  resolveMicrosandboxDoctorCommand,
  shouldCheckMicrosandbox,
} from '../src/core/doctor-sandbox.js';

const require = createRequire(import.meta.url);

test('shouldCheckMicrosandbox follows resolveSandboxPolicy', () => {
  assert.equal(
    shouldCheckMicrosandbox({ sandbox: { enabled: false, mode: 'workspace-write' } }),
    false,
  );
  assert.equal(
    shouldCheckMicrosandbox({ sandbox: { enabled: 'auto', mode: 'danger-full-access' } }),
    false,
  );
  assert.equal(
    shouldCheckMicrosandbox({ sandbox: { enabled: 'auto', mode: 'workspace-write', backend: 'os' } }),
    false,
  );
  assert.equal(
    shouldCheckMicrosandbox({ sandbox: { enabled: 'auto', mode: 'workspace-write', backend: 'microsandbox' } }),
    true,
  );
});

test('describeSandboxDoctorSkip explains disabled sandbox and OS confinement', () => {
  assert.match(
    describeSandboxDoctorSkip({ sandbox: { enabled: false, mode: 'workspace-write' } }),
    /sandbox disabled/,
  );
  assert.match(
    describeSandboxDoctorSkip({ sandbox: { enabled: 'auto', mode: 'danger-full-access' } }),
    /danger-full-access/,
  );
  assert.match(
    describeSandboxDoctorSkip(
      { sandbox: { enabled: 'auto', mode: 'workspace-write', backend: 'os' } },
      { platform: 'darwin' },
    ),
    /OS confinement \(Seatbelt\)/,
  );
  assert.match(
    describeSandboxDoctorSkip(
      { sandbox: { enabled: 'auto', mode: 'workspace-write', backend: 'os' } },
      { platform: 'linux' },
    ),
    /OS confinement \(Landlock\)/,
  );
});

test('describeSandboxDoctorUnavailable explains Windows fail-closed', () => {
  assert.match(
    describeSandboxDoctorUnavailable(
      { sandbox: { enabled: 'auto', mode: 'workspace-write' } },
      { platform: 'win32' },
    ),
    /Windows has no Landlock\/Seatbelt fallback/,
  );
});

test('resolveMicrosandboxDoctorCommand prefers bundled microsandbox binary', () => {
  const entry = require.resolve('microsandbox');
  const expectedBin = path.join(path.dirname(entry), '..', 'bin', 'microsandbox.cjs');
  const spec = resolveMicrosandboxDoctorCommand();
  assert.equal(spec.command, process.execPath);
  assert.deepEqual(spec.args, [expectedBin, 'doctor']);
});

test('checkMicrosandboxDoctor reports success and failure from doctor output', async () => {
  const ok = await checkMicrosandboxDoctor({
    commandSpec: { command: 'msb', args: ['doctor'], label: 'msb doctor' },
    spawnFn: () => ({
      status: 0,
      stdout: 'Runtime files: ok\nHost prerequisites: ok\n',
      stderr: '',
    }),
  });
  assert.equal(ok.ok, true);
  assert.match(ok.reason, /Host prerequisites: ok/);

  const fail = await checkMicrosandboxDoctor({
    commandSpec: { command: 'msb', args: ['doctor'], label: 'msb doctor' },
    spawnFn: () => ({
      status: 1,
      stdout: '',
      stderr: 'Windows Hypervisor Platform is disabled',
    }),
  });
  assert.equal(fail.ok, false);
  assert.match(fail.reason, /Windows Hypervisor Platform is disabled/);
  assert.match(fail.reason, /OPERATIONS\.md/);
});

test('handleDoctor skips microsandbox when sandbox is disabled', async () => {
  const lines = [];
  process.exitCode = 0;
  try {
    await handleDoctor({
      loadConfigFn: async () => ({
        gateway: { base_url: 'https://example.com/v1', api_key: 'token' },
        sandbox: { enabled: false, mode: 'workspace-write' },
      }),
      checkPathWritableFn: async () => true,
      checkGatewayFn: async () => ({ ok: true, reason: 'reachable' }),
      commandExistsFn: async () => true,
      checkMicrosandboxDoctorFn: async () => {
        throw new Error('should not run microsandbox doctor when sandbox is disabled');
      },
      writeLine: (line) => lines.push(line),
    });
    assert.match(lines.join('\n'), /\[SKIP\] Microsandbox host runtime: sandbox disabled/);
    assert.doesNotMatch(lines.join('\n'), /\[FAIL\] Microsandbox host runtime/);
  } finally {
    process.exitCode = 0;
  }
});

test('handleDoctor skips microsandbox doctor when using OS confinement', async () => {
  const lines = [];
  process.exitCode = 0;
  try {
    await handleDoctor({
      loadConfigFn: async () => ({
        gateway: { base_url: 'https://example.com/v1', api_key: 'token' },
        sandbox: { enabled: 'auto', mode: 'workspace-write', backend: 'os' },
      }),
      checkPathWritableFn: async () => true,
      checkGatewayFn: async () => ({ ok: true, reason: 'reachable' }),
      commandExistsFn: async () => true,
      checkMicrosandboxDoctorFn: async () => {
        throw new Error('should not run microsandbox doctor for OS confinement');
      },
      writeLine: (line) => lines.push(line),
    });
    assert.match(lines.join('\n'), /\[SKIP\] Microsandbox host runtime: using OS confinement/);
    assert.doesNotMatch(lines.join('\n'), /\[FAIL\] Microsandbox host runtime/);
  } finally {
    process.exitCode = 0;
  }
});

test('handleDoctor runs microsandbox doctor when sandbox is enabled', async () => {
  const lines = [];
  let ran = false;
  process.exitCode = 0;
  try {
    await handleDoctor({
      loadConfigFn: async () => ({
        gateway: { base_url: 'https://example.com/v1', api_key: 'token' },
        sandbox: { enabled: 'auto', mode: 'workspace-write', backend: 'microsandbox' },
      }),
      checkPathWritableFn: async () => true,
      checkGatewayFn: async () => ({ ok: true, reason: 'reachable' }),
      commandExistsFn: async () => true,
      shouldCheckMicrosandboxFn: () => true,
      checkMicrosandboxDoctorFn: async () => {
        ran = true;
        return { ok: true, reason: 'host prerequisites met' };
      },
      writeLine: (line) => lines.push(line),
    });
    assert.equal(ran, true);
    assert.match(lines.join('\n'), /\[OK\] Microsandbox host runtime: host prerequisites met/);
  } finally {
    process.exitCode = 0;
  }
});
