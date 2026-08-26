import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSandboxProbeCommand,
  parseSandboxProbeOutput,
  summarizeSandboxCapabilities,
  sandboxCapabilityKey,
  probeSandboxCapabilities,
  clearSandboxCapabilityCache,
  __setSandboxCapabilitiesTestHooks,
  SANDBOX_CAPABILITY_COMMANDS,
} from '../src/core/sandbox-capabilities.js';

function withTempSnapshot(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemini-cap-'));
  const file = path.join(dir, 'snapshot.json');
  return run(file);
}

function resetHooks() {
  clearSandboxCapabilityCache();
  // Safety-net: tests must never write capability snapshots into the real
  // config dir, so point the snapshot at a throwaway location unless an
  // individual test overrides it with its own snapshotPath.
  __setSandboxCapabilitiesTestHooks({ snapshotPath: () => null });
}

test.afterEach(() => resetHooks());

test('buildSandboxProbeCommand produces a bash command -v probe for each tool', () => {
  const command = buildSandboxProbeCommand('bash');
  for (const tool of SANDBOX_CAPABILITY_COMMANDS) {
    assert.match(command, new RegExp(`command -v '${tool}'`));
    assert.match(command, new RegExp(`echo '${tool}:1'`));
    assert.match(command, new RegExp(`echo '${tool}:0'`));
  }
});

test('buildSandboxProbeCommand produces a Get-Command probe for powershell', () => {
  const command = buildSandboxProbeCommand('powershell');
  assert.match(command, /Get-Command/);
  for (const tool of SANDBOX_CAPABILITY_COMMANDS) {
    assert.match(command, new RegExp(`'${tool}'`));
  }
});

test('parseSandboxProbeOutput maps name:0|1 lines into booleans and ignores noise', () => {
  const parsed = parseSandboxProbeOutput(
    'bash:1\ngit:1\nrg:0\n\nnode:1\njq:0\nsome-noise\njunk:::1\n',
  );
  assert.equal(parsed.bash, true);
  assert.equal(parsed.git, true);
  assert.equal(parsed.rg, false);
  assert.equal(parsed.node, true);
  assert.equal(parsed.jq, false);
  assert.equal(parsed['some-noise'], undefined);
  assert.equal(parsed['junk:::1'.slice(0, -3)], undefined);
});

test('summarizeSandboxCapabilities formats a single capability line', () => {
  const line = summarizeSandboxCapabilities({ bash: true, git: true, rg: false, node: true });
  assert.match(line, /^sandbox commands: /);
  assert.match(line, /bash ✓/);
  assert.match(line, /git ✓/);
  assert.match(line, /rg ✗/);
  assert.match(line, /node ✓/);
});

test('sandboxCapabilityKey is stable per backend/mode/platform/image', () => {
  const config = {
    sandbox: { enabled: true, mode: 'workspace-write', image: 'node:22-bookworm' },
  };
  const a = sandboxCapabilityKey(config, { cwd: '/x', platform: 'win32' });
  const b = sandboxCapabilityKey(config, { cwd: '/x', platform: 'win32' });
  assert.equal(a, b);

  const otherImage = sandboxCapabilityKey({
    sandbox: { ...config.sandbox, image: 'node:24-bookworm' },
  }, { cwd: '/x', platform: 'win32' });
  assert.notEqual(otherImage, a);
});

test('probeSandboxCapabilities caches the result per image and probes once', async () => {
  let runnerCalls = 0;
  __setSandboxCapabilitiesTestHooks({
    snapshotPath: () => null,
    runShellCommand: async ({ shell }) => {
      runnerCalls += 1;
      assert.equal(shell, 'bash');
      return { stdout: 'bash:1\ngit:1\nrg:1\nnode:0\n' };
    },
  });
  const config = { sandbox: { enabled: true, mode: 'workspace-write' } };

  const first = await probeSandboxCapabilities(config, { cwd: '/x', platform: 'linux' });
  const second = await probeSandboxCapabilities(config, { cwd: '/x', platform: 'linux' });

  assert.equal(first.rg, true);
  assert.equal(first.node, false);
  assert.equal(runnerCalls, 1, 'probe should run only once for the same image key');
  assert.deepEqual(second, first);
});

test('probeSandboxCapabilities returns {} when the shell is not sandboxed', async () => {
  let runnerCalls = 0;
  __setSandboxCapabilitiesTestHooks({
    runShellCommand: async () => {
      runnerCalls += 1;
      return { stdout: 'bash:1\n' };
    },
  });
  const config = { sandbox: { enabled: false } };
  const caps = await probeSandboxCapabilities(config, { cwd: '/x', platform: 'linux' });
  assert.deepEqual(caps, {});
  assert.equal(runnerCalls, 0);
});

test('probeSandboxCapabilities degrades to {} when the probe fails', async () => {
  __setSandboxCapabilitiesTestHooks({
    snapshotPath: () => null,
    runShellCommand: async () => {
      throw new Error('sandbox unavailable');
    },
  });
  const config = { sandbox: { enabled: true, mode: 'workspace-write' } };
  const caps = await probeSandboxCapabilities(config, { cwd: '/x', platform: 'linux' });
  assert.deepEqual(caps, {});
});

test('probeSandboxCapabilities persists to and reuses the snapshot across sessions', async () => {
  await withTempSnapshot(async (file) => {
    let runnerCalls = 0;
    __setSandboxCapabilitiesTestHooks({
      snapshotPath: () => file,
      runShellCommand: async () => {
        runnerCalls += 1;
        return { stdout: 'bash:1\ngit:1\nrg:1\nnode:0\njq:1\n' };
      },
    });
    const config = { sandbox: { enabled: true, mode: 'workspace-write' } };
    const options = { cwd: '/x', platform: 'linux' };

    const first = await probeSandboxCapabilities(config, options);
    assert.equal(first.rg, true);
    assert.equal(first.node, false);

    // Simulate a fresh process / new session: in-memory cache is gone, but the
    // on-disk snapshot should still satisfy a second probe without re-running.
    clearSandboxCapabilityCache();
    const second = await probeSandboxCapabilities(config, options);

    assert.equal(runnerCalls, 1, 'snapshot should serve the second probe');
    assert.deepEqual(second, first);
  });
});

test('stale snapshot is re-probed after the ttl window', async () => {
  await withTempSnapshot(async (file) => {
    const config = { sandbox: { enabled: true, mode: 'workspace-write' } };
    const options = { cwd: '/x', platform: 'linux' };
    const key = sandboxCapabilityKey(config, options);
    // Seed a snapshot entry with an ancient timestamp so it is always stale.
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: { [key]: { capabilities: { bash: true, rg: false }, at: 0 } } }));

    let runnerCalls = 0;
    __setSandboxCapabilitiesTestHooks({
      snapshotPath: () => file,
      runShellCommand: async () => {
        runnerCalls += 1;
        return { stdout: 'bash:1\nrg:1\n' };
      },
    });

    const caps = await probeSandboxCapabilities(config, { ...options, ttlMs: 1 });
    assert.equal(runnerCalls, 1, 'stale snapshot should be re-probed');
    assert.equal(caps.rg, true);
  });
});

test('snapshot file is written with version and fresh at timestamp', async () => {
  await withTempSnapshot(async (file) => {
    __setSandboxCapabilitiesTestHooks({
      snapshotPath: () => file,
      runShellCommand: async () => ({ stdout: 'bash:1\ngit:1\n' }),
    });
    const config = { sandbox: { enabled: true, mode: 'workspace-write' } };
    await probeSandboxCapabilities(config, { cwd: '/x', platform: 'linux' });

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.version, 1);
    assert.ok(parsed.entries);
    const entry = Object.values(parsed.entries)[0];
    assert.equal(entry.capabilities.bash, true);
    assert.equal(entry.capabilities.git, true);
    assert.ok(Number(entry.at) > 0);
  });
});
