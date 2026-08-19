import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { resolveSandboxPolicy, readonlySandboxVolumes } from './sandbox-policy.js';

const GUEST_WORKSPACE = '/workspace';
const sandboxCache = new Map();
let testHooks = null;
let microsandboxApi = null;

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
}

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
  let builder = Sandbox.builder(sandboxName(key))
    .image(image)
    .cpus(numericSetting(config?.sandbox?.cpus, 2))
    .memory(numericSetting(config?.sandbox?.memory_mb, 2048, 128))
    .workdir(GUEST_WORKSPACE)
    .shell('/bin/bash')
    .security('restricted')
    .network((network) => network.enabled(true).policy(NetworkPolicy.allowAll()))
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
  return builder.create();
}

function getSandbox({ policy, config, port = 0 }) {
  const image = String(config?.sandbox?.image || 'node:22-bookworm').trim();
  const readonlyKey = readonlySandboxVolumes(policy)
    .map((volume) => `${volume.hostPath}>${volume.guestPath}`)
    .join(',');
  const key = [policy.workspaceRoot, policy.mode, image, port || 0, readonlyKey].join('|');
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
