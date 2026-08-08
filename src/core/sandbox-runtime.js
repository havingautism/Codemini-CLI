import os from 'node:os';
import path from 'node:path';
import { resolveSandboxPolicy } from './sandbox-policy.js';

let managerPromise = null;
let initializedKey = '';
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
}

function buildSrtConfig(policy) {
  const allowWrite =
    policy.mode === 'read-only'
      ? []
      : [policy.workspaceRoot, path.resolve(os.tmpdir())].filter(Boolean);

  const config = {
    filesystem: {
      allowWrite,
      denyWrite: [],
      denyRead: [],
      allowRead: [],
    },
  };

  // v1: workspace-write omits network.allowedDomains → no network fence (npm/git work).
  // read-only: empty allowlist blocks outbound network.
  if (policy.mode === 'read-only') {
    config.network = { allowedDomains: [], deniedDomains: [] };
  }

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
    await SandboxManager.initialize(runtimeConfig);
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
  if (process.platform === 'win32') return stderr;
  try {
    const SandboxManager = await loadSandboxManager();
    if (typeof SandboxManager.annotateStderrWithSandboxFailures === 'function') {
      return SandboxManager.annotateStderrWithSandboxFailures(command, stderr);
    }
  } catch {}
  return stderr;
}
