import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { resolveSandboxPolicy, readonlySandboxVolumes, normalizeSandboxNetwork } from './sandbox-policy.js';

const GUEST_WORKSPACE = '/workspace';
const sandboxCache = new Map();
let testHooks = null;
let microsandboxApi = null;
let closeAllPromise = null;

export class SandboxUnavailableError extends Error {
  constructor(message, { cause, mode } = {}) {
    super(message);
    this.name = 'SandboxUnavailableError';
    this.code = 'SANDBOX_UNAVAILABLE';
    this.mode = mode || '';
    if (cause) this.cause = cause;
  }
}

/** Test-only: inject sandbox creation or reset the process-local cache. */
export function __setSandboxRuntimeTestHooks(hooks = null) {
  testHooks = hooks;
  sandboxCache.clear();
  microsandboxApi = null;
  closeAllPromise = null;
}

/**
 * Best-effort stop of every cached sandbox VM. Safe to call at shutdown only —
 * mid-session callers would tear down live VMs. Runs at most once per process.
 * The native msb agent also reaps sandboxes whose client disconnected; this is
 * an explicit stop so RAM is released promptly on a clean exit.
 */
export function closeAllSandboxes() {
  if (closeAllPromise) return closeAllPromise;
  const entries = [...sandboxCache.values()];
  sandboxCache.clear();
  closeAllPromise = Promise.allSettled(
    entries.map(async (pending) => {
      try {
        const sandbox = await pending;
        await sandbox.stop?.().catch(() => {});
      } catch {
        // creation failed or already stopped — nothing to tear down
      }
    }),
  ).then(() => undefined);
  return closeAllPromise;
}

// Only act on real process exit, never mid-session. 'beforeExit' lets the
// async stop complete on a natural exit; 'exit' is the last-chance fallback
// (fire-and-forget — the native agent still reaps on client disconnect).
process.on('beforeExit', () => {
  void closeAllSandboxes().catch(() => {});
});
process.on('exit', () => {
  try {
    void closeAllSandboxes().catch(() => {});
  } catch {
    // never throw from an exit handler
  }
});

function sandboxName(key) {
  return `codemini-${createHash('sha256').update(`${process.pid}|${key}`).digest('hex').slice(0, 16)}`;
}

function numericSetting(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

async function loadMicrosandbox() {
  if (!microsandboxApi) {
    try {
      microsandboxApi = await import('microsandbox');
    } catch (error) {
      throw new SandboxUnavailableError(
        `Microsandbox is not available on this platform (${process.platform}-${process.arch}); refusing to run unconfined. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return microsandboxApi;
}

async function createSandbox({ key, policy, config, port }) {
  const readonlyVolumes = readonlySandboxVolumes(policy);
  if (testHooks?.createSandbox) {
    return testHooks.createSandbox({
      key,
      policy,
      config,
      port,
      guestWorkspace: GUEST_WORKSPACE,
      readonlyVolumes,
    });
  }

  const { NetworkPolicy, Sandbox } = await loadMicrosandbox();
  const image = String(config?.sandbox?.image || 'node:22-bookworm').trim() || 'node:22-bookworm';
  // Network confinement knob: 'none' denies all egress, anything else (default)
  // keeps the current allow-all behavior so npm/pip/git keep working unchanged.
  const networkMode = normalizeSandboxNetwork(config?.sandbox?.network);
  const networkPolicy = networkMode === 'none'
    ? NetworkPolicy.none()
    : NetworkPolicy.allowAll();
  let builder = Sandbox.builder(sandboxName(key))
    .image(image)
    .pullPolicy('if-missing')
    .cpus(numericSetting(config?.sandbox?.cpus, 2))
    .memory(numericSetting(config?.sandbox?.memory_mb, 2048, 128))
    .workdir(GUEST_WORKSPACE)
    .shell('/bin/bash')
    .security('restricted')
    .network((network) => {
      let configured = network.enabled(true).policy(networkPolicy);
      // Windows proxy/TUN clients commonly return RFC 2544 fake-IP answers
      // (198.18.0.0/15). Microsandbox's DNS rebinding guard rejects those
      // answers as non-public, turning every lookup in the guest into
      // ENOTFOUND even though outbound networking is explicitly allow-all.
      // Rebinding protection adds no boundary in this mode because callers can
      // already connect to private IPs directly; keep the default for deny-all.
      if (networkMode === 'allow-all') {
        configured = configured.dns((dns) => dns.rebindProtection(false));
      }
      return configured;
    })
    .quietLogs()
    .ephemeral(true)
    .volume(GUEST_WORKSPACE, (mount) => {
      const bound = mount.bind(policy.workspaceRoot).nosuid().nodev();
      return policy.mode === 'read-only' ? bound.readonly() : bound;
    });

  for (const volume of readonlyVolumes) {
    await fs.mkdir(volume.hostPath, { recursive: true });
    builder = builder.volume(volume.guestPath, (mount) => (
      mount.bind(volume.hostPath).nosuid().nodev().readonly()
    ));
  }

  builder = builder.replace();
  if (port > 0) builder = builder.portBind('127.0.0.1', port, port);
  // createWithPullProgress is equivalent to create() when the image is already
  // cached (no progress events), and surfaces first-run pulls so a slow image
  // download is not mistaken for a hang. One notice line, throttled.
  const created = await builder.createWithPullProgress();
  let pullNoticeShown = false;
  for await (const event of created.progress) {
    const kind = String(event?.kind || '');
    const isDownload = kind === 'downloading' || Number(event?.downloadedBytes || 0) > 0;
    if (isDownload && !pullNoticeShown) {
      pullNoticeShown = true;
      const reference = String(event?.reference || image || '');
      process.stderr.write(
        `\n[msb] pulling sandbox image ${reference} (first run — one-time cost)...\n`,
      );
    }
  }
  return created.awaitSandbox();
}

function getSandbox({ policy, config, port = 0 }) {
  const image = String(config?.sandbox?.image || 'node:22-bookworm').trim();
  const networkMode = normalizeSandboxNetwork(config?.sandbox?.network);
  const readonlyKey = readonlySandboxVolumes(policy)
    .map((volume) => `${volume.hostPath}>${volume.guestPath}`)
    .join(',');
  const key = [policy.workspaceRoot, policy.mode, image, networkMode, port || 0, readonlyKey].join('|');
  if (!sandboxCache.has(key)) {
    const pending = createSandbox({ key, policy, config, port }).catch((error) => {
      sandboxCache.delete(key);
      throw new SandboxUnavailableError(
        `Microsandbox could not start for sandbox mode "${policy.mode}"; refusing to run on the host. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, mode: policy.mode },
      );
    });
    sandboxCache.set(key, pending);
  }
  return { key, sandbox: sandboxCache.get(key) };
}

export async function ensureVmSandbox({ policy, config, port = 0 } = {}) {
  const cached = getSandbox({ policy, config, port });
  await cached.sandbox;
  return cached;
}

class MicrosandboxProcess extends EventEmitter {
  constructor(options) {
    super();
    this.sandboxProcess = true;
    this.pid = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.handle = null;
    this.pendingSignal = 0;
    this.closed = false;
    void this.run(options);
  }

  async run({ command, policy, config, port }) {
    const cached = getSandbox({ policy, config, port });
    try {
      const sandbox = await cached.sandbox;
      this.handle = await sandbox.execStreamWith('/bin/bash', (exec) =>
        exec.args(['-lc', String(command || '')]).cwd(GUEST_WORKSPACE),
      );
      if (this.pendingSignal) await this.signal(this.pendingSignal);

      let exitCode = 0;
      for await (const event of this.handle) {
        if (event.kind === 'started') this.pid = event.pid;
        if (event.kind === 'stdout') this.stdout.write(event.data);
        if (event.kind === 'stderr') this.stderr.write(event.data);
        if (event.kind === 'exited') exitCode = event.code;
      }
      this.finish(exitCode, null);
    } catch (error) {
      sandboxCache.delete(cached.key);
      this.emit('error', error);
      this.finish(null, null);
    }
  }

  async signal(number) {
    if (!this.handle) {
      this.pendingSignal = number;
      return;
    }
    try {
      await this.handle.signal(number);
    } catch {
      await this.handle.kill().catch(() => {});
    }
  }

  kill(signal = 'SIGTERM') {
    const number = signal === 'SIGKILL' ? 9 : 15;
    void this.signal(number);
    return true;
  }

  finish(code, signal) {
    if (this.closed) return;
    this.closed = true;
    this.stdout.end();
    this.stderr.end();
    this.emit('close', code, signal);
  }
}

export function createSandboxProcess({ command, config, cwd, mode, port = 0 } = {}) {
  const policy = resolveSandboxPolicy({ config, cwd, mode });
  if (!policy.enabled) return null;
  return {
    child: new MicrosandboxProcess({ command, policy, config, port }),
    policy,
  };
}
