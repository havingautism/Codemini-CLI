import { createRequire } from 'node:module';
import { resolveSandboxPolicy, writableRootsForMode, normalizeSandboxNetwork } from './sandbox-policy.js';
import { SandboxUnavailableError } from './sandbox-runtime.js';

const require = createRequire(import.meta.url);

let initializedKey = '';
let landlockVerdict = null;
let testHooks = null;

/** Test-only: inject SandboxManager-like API or reset caches. */
export function __setSandboxOsTestHooks(hooks = null) {
  testHooks = hooks;
  initializedKey = '';
  landlockVerdict = null;
}

function landlockApi() {
  if (testHooks?.Landlock) return testHooks.Landlock;
  try {
    return require('node-addon-landlock-run');
  } catch {
    return {
      grantArgs: () => [],
      launcherPath: () => '',
      probe: () => 'unusable',
    };
  }
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

function buildSrtConfig(policy, config = {}) {
  const allowWrite =
    policy.mode === 'read-only'
      ? []
      : (writableRootsForMode(policy) || []).filter(Boolean);

  // Mirror the VM backend's sandbox.network knob. The srt package filters by
  // domain; `deniedDomains: ['*']` is a best-effort deny-all mapping for the
  // OS fallback (VM backend semantics are authoritative for this setting).
  const denyAllNetwork = normalizeSandboxNetwork(config?.sandbox?.network) === 'none';

  const configDoc = {
    network: {
      allowedDomains: [],
      deniedDomains: denyAllNetwork ? ['*'] : [],
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
    configDoc.ripgrep = {
      command: require.resolve(`@vscode/ripgrep-${policy.platform}-${process.arch}/bin/${binary}`),
    };
  } catch {}

  return configDoc;
}

async function loadSandboxManager() {
  if (testHooks?.SandboxManager) return testHooks.SandboxManager;
  const mod = await import('@anthropic-ai/sandbox-runtime');
  return mod.SandboxManager;
}

async function ensureInitialized(policy, config = {}) {
  const SandboxManager = await loadSandboxManager();
  const key = `${policy.mode}|${policy.workspaceRoot}`;
  if (initializedKey === key && SandboxManager.isSandboxingEnabled?.()) {
    return SandboxManager;
  }
  const runtimeConfig = buildSrtConfig(policy, config);
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
    const spawnSpec = buildLandlockSpawn(policy, command, binShell);
    return {
      command: String(command || ''),
      executable: spawnSpec.executable,
      args: spawnSpec.args,
      enforcement: spawnSpec.enforcement,
      wrapped: true,
      policy: { ...policy, backend: 'os' },
    };
  }

  const SandboxManager = await ensureInitialized(policy, config);
  try {
    const wrapped = await SandboxManager.wrapWithSandbox(
      String(command || ''),
      binShell,
      buildSrtConfig(policy, config),
      abortSignal,
    );
    return {
      command: String(wrapped || command || ''),
      wrapped: true,
      policy: { ...policy, backend: 'os' },
    };
  } catch (error) {
    if (error instanceof SandboxUnavailableError) throw error;
    throw new SandboxUnavailableError(
      `sandbox mode "${policy.mode}" is requested but wrapWithSandbox failed; refusing to run unconfined. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error, mode: policy.mode },
    );
  }
}

export async function annotateSandboxStderrAsync(command, stderr) {
  if (testHooks?.annotateStderr) {
    return testHooks.annotateStderr(command, stderr);
  }
  if (process.platform !== 'darwin') return stderr;
  try {
    const SandboxManager = await loadSandboxManager();
    if (typeof SandboxManager.annotateStderrWithSandboxFailures === 'function') {
      return SandboxManager.annotateStderrWithSandboxFailures(command, stderr);
    }
  } catch {}
  return stderr;
}
