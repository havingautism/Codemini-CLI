import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  grantArgs as defaultLandlockGrantArgs,
  launcherPath as defaultLandlockLauncherPath,
  probe as defaultLandlockProbe,
} from 'node-addon-landlock-run';
import { resolveSandboxPolicy, writableRootsForMode } from './sandbox-policy.js';

const require = createRequire(import.meta.url);

let managerPromise = null;
let initializedKey = '';
let landlockVerdict = null;
let testHooks = null;

export class SandboxUnavailableError extends Error {
  constructor(message, { cause, mode } = {}) {
    super(message);
    this.name = 'SandboxUnavailableError';
    this.code = 'SANDBOX_UNAVAILABLE';
    this.mode = mode || '';
    if (cause) this.cause = cause;
  }
}

/** Test-only: inject SandboxManager-like API or reset caches. */
export function __setSandboxRuntimeTestHooks(hooks = null) {
  testHooks = hooks;
  managerPromise = null;
  initializedKey = '';
  landlockVerdict = null;
}

function landlockApi() {
  return testHooks?.Landlock || {
    grantArgs: defaultLandlockGrantArgs,
    launcherPath: defaultLandlockLauncherPath,
    probe: defaultLandlockProbe,
  };
}

function ensureLandlock(policy) {
  if (!landlockVerdict) {
    const api = landlockApi();
    const launcher = api.launcherPath();
    const enforcement = api.probe(launcher, { timeoutMs: 5000 });
    landlockVerdict = { api, launcher, enforcement };
  }
  if (landlockVerdict.enforcement === 'unusable') {
    throw new SandboxUnavailableError(
      `sandbox mode "${policy.mode}" is requested but the npm-installed Landlock launcher or this Linux kernel is unavailable; refusing to run unconfined. Run npm install in this Linux environment.`,
      { mode: policy.mode },
    );
  }
  return landlockVerdict;
}

function buildLandlockSpawn(policy, command, binShell) {
  const { api, launcher, enforcement } = ensureLandlock(policy);
  const readWrite = ['/dev/null'];
  if (policy.mode === 'workspace-write') {
    readWrite.push(...(writableRootsForMode(policy) || []));
  }
  const shell = binShell || 'bash';
  const shellArgs = shell === 'pwsh'
    ? ['-NoLogo', '-NoProfile', '-Command', String(command || '')]
    : ['-lc', String(command || '')];
  return {
    executable: launcher,
    args: [...api.grantArgs({ readOnly: ['/'], readWrite }), '--', shell, ...shellArgs],
    enforcement,
  };
}

function buildSrtConfig(policy) {
  const allowWrite =
    policy.mode === 'read-only'
      ? []
      : [policy.workspaceRoot, path.resolve(os.tmpdir())].filter(Boolean);

  const config = {
    network: {
      allowedDomains: [],
      deniedDomains: [],
    },
    filesystem: {
      allowWrite,
      denyWrite: [],
      denyRead: [],
      allowRead: [],
    },
  };

  const binary = policy.platform === 'win32' ? 'rg.exe' : 'rg';
  try {
    config.ripgrep = {
      command: require.resolve(`@vscode/ripgrep-${policy.platform}-${process.arch}/bin/${binary}`),
    };
  } catch {}

  return config;
}

async function loadSandboxManager() {
  if (testHooks?.SandboxManager) return testHooks.SandboxManager;
  const mod = await import('@anthropic-ai/sandbox-runtime');
  return mod.SandboxManager;
}

async function ensureInitialized(policy) {
  const SandboxManager = await loadSandboxManager();
  const key = `${policy.mode}|${policy.workspaceRoot}`;
  if (initializedKey === key && SandboxManager.isSandboxingEnabled?.()) {
    return SandboxManager;
  }
  const runtimeConfig = buildSrtConfig(policy);
  try {
    await SandboxManager.initialize(runtimeConfig, async () => true);
  } catch (error) {
    throw new SandboxUnavailableError(
      `sandbox mode "${policy.mode}" is requested but sandbox-runtime failed to initialize; refusing to run the command unconfined. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error, mode: policy.mode },
    );
  }
  if (typeof SandboxManager.isSupportedPlatform === 'function' && !SandboxManager.isSupportedPlatform()) {
    throw new SandboxUnavailableError(
      `sandbox mode "${policy.mode}" is requested but this platform has no usable sandbox backend; refusing to run unconfined.`,
      { mode: policy.mode },
    );
  }
  initializedKey = key;
  return SandboxManager;
}

/**
 * Wrap a shell command string for spawn under OS confinement (Linux/mac only).
 * Returns { command, wrapped, policy } — when not confined, command is unchanged.
 */
export async function wrapShellCommandForSandbox({
  command,
  config,
  cwd,
  platform = process.platform,
  binShell,
  abortSignal,
  mode,
} = {}) {
  const policy = resolveSandboxPolicy({ config, cwd, platform, mode });
  if (!policy.enabled || policy.mode === 'danger-full-access' || platform === 'win32') {
    return { command: String(command || ''), wrapped: false, policy };
  }

  if (platform === 'linux') {
    const spawn = buildLandlockSpawn(policy, command, binShell);
    return {
      command: String(command || ''),
      executable: spawn.executable,
      args: spawn.args,
      enforcement: spawn.enforcement,
      wrapped: true,
      policy,
    };
  }

  const SandboxManager = await ensureInitialized(policy);
  try {
    const wrapped = await SandboxManager.wrapWithSandbox(
      String(command || ''),
      binShell,
      buildSrtConfig(policy),
      abortSignal,
    );
    return {
      command: String(wrapped || command || ''),
      wrapped: true,
      policy,
    };
  } catch (error) {
    if (error instanceof SandboxUnavailableError) throw error;
    throw new SandboxUnavailableError(
      `sandbox mode "${policy.mode}" is requested but wrapWithSandbox failed; refusing to run unconfined. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error, mode: policy.mode },
    );
  }
}

/**
 * Annotate stderr with sandbox violations when available.
 */
export function annotateSandboxStderr(command, stderr) {
  if (testHooks?.annotateStderr) {
    return testHooks.annotateStderr(command, stderr);
  }
  try {
    // Dynamic require path already loaded via ensureInitialized in normal flow.
    // Best-effort: if manager not initialized, return stderr as-is.
    return stderr;
  } catch {
    return stderr;
  }
}

export async function annotateSandboxStderrAsync(command, stderr) {
  if (testHooks?.annotateStderr) {
    return testHooks.annotateStderr(command, stderr);
  }
  // Only the macOS backend still comes from sandbox-runtime. Landlock already
  // reports kernel denials directly and must not initialize the old Linux SRT path.
  if (process.platform !== 'darwin') return stderr;
  try {
    const SandboxManager = await loadSandboxManager();
    if (typeof SandboxManager.annotateStderrWithSandboxFailures === 'function') {
      return SandboxManager.annotateStderrWithSandboxFailures(command, stderr);
    }
  } catch {}
  return stderr;
}
