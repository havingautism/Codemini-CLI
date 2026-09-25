import fs from 'node:fs';
import path from 'node:path';
import { runShellCommand, resolveSandboxShell } from './shell.js';
import { resolveShellContext } from './shell-profile.js';
import { getSandboxCapabilitySnapshotPath } from './paths.js';

/** Commands probed once per sandbox image and injected into the Bash tool context. */
export const SANDBOX_CAPABILITY_COMMANDS = Object.freeze([
  'bash',
  'git',
  'rg',
  'find',
  'sed',
  'awk',
  'grep',
  'node',
  'python',
  'jq',
  'curl',
]);

const cache = new Map();
let testHooks = null;

const SNAPSHOT_VERSION = 1;
const DEFAULT_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/** In-memory mirror of the on-disk snapshot, loaded lazily once per process. */
const snapshot = { loaded: false, entries: {} };

export function __setSandboxCapabilitiesTestHooks(hooks = null) {
  testHooks = hooks;
}

export function clearSandboxCapabilityCache() {
  cache.clear();
  snapshot.loaded = false;
  snapshot.entries = {};
}

function snapshotPath() {
  if (typeof testHooks?.snapshotPath === 'function') {
    return testHooks.snapshotPath();
  }
  try {
    return getSandboxCapabilitySnapshotPath();
  } catch {
    return null;
  }
}

function loadSnapshotEntries() {
  if (snapshot.loaded) return snapshot.entries;
  const file = snapshotPath();
  let entries = {};
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        parsed &&
        Number(parsed.version) === SNAPSHOT_VERSION &&
        parsed.entries &&
        typeof parsed.entries === 'object'
      ) {
        entries = parsed.entries;
      }
    } catch {
      entries = {};
    }
  }
  snapshot.entries = entries;
  snapshot.loaded = true;
  return entries;
}

function saveSnapshotEntry(key, value) {
  const file = snapshotPath();
  const entries = loadSnapshotEntries();
  entries[key] = value;
  snapshot.entries = entries;
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ version: SNAPSHOT_VERSION, entries }, null, 2),
    );
  } catch {}
}

/** Build the probe command for a given shell name ('bash' | 'powershell'). */
export function buildSandboxProbeCommand(shell = 'bash') {
  const resolved = resolveSandboxShell(shell);
  if (resolved === 'pwsh') {
    const items = SANDBOX_CAPABILITY_COMMANDS.map((name) => `'${name}'`).join(',');
    return (
      '$cmds = @(' + items + '); ' +
      'foreach ($c in $cmds) { ' +
      '$r = (Get-Command $c -ErrorAction SilentlyContinue) ? 1 : 0; ' +
      'Write-Output "$($c):$r" }'
    );
  }
  return SANDBOX_CAPABILITY_COMMANDS.map((name) => {
    return (
      `if command -v '${name}' >/dev/null 2>&1; ` +
      `then echo '${name}:1'; else echo '${name}:0'; fi`
    );
  }).join('\n');
}

/** Parse 'name:0|1' probe output into a booleans map. */
export function parseSandboxProbeOutput(output = '') {
  const result = {};
  for (const raw of String(output).split(/\r?\n/)) {
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    const name = trimmed.slice(0, idx).trim();
    const value = String(trimmed.slice(idx + 1)).trim();
    if (name) result[name] = /^(1|true|yes|ok)$/i.test(value);
  }
  return result;
}

/** Cache key per sandbox image: backend | mode | execution platform | image. */
export function sandboxCapabilityKey(config = {}, { cwd = process.cwd(), platform = process.platform } = {}) {
  const context = resolveShellContext(config, { cwd, platform });
  const execPlatform = context.commandPlatform || platform;
  const image = context.sandbox.backend === 'vm'
    ? String(config?.sandbox?.image || 'node:22-bookworm').trim() || 'node:22-bookworm'
    : 'host';
  return `${context.sandbox.backend || 'none'}|${context.sandbox.mode || 'none'}|${execPlatform}|${image}`;
}

/**
 * Probe which commands the sandbox execution environment provides, once per
 * sandbox image. Returns {} when the shell is not sandboxed so retrieval tools
 * and callers never treat it as authoritative. Failures degrade to {}.
 */
export async function probeSandboxCapabilities(
  config = {},
  {
    cwd = process.cwd(),
    platform = process.platform,
    force = false,
    timeoutMs = 15000,
    ttlMs = DEFAULT_SNAPSHOT_TTL_MS,
  } = {},
) {
  if (typeof testHooks?.probe === 'function') {
    return testHooks.probe({ config, cwd, platform, force });
  }
  const context = resolveShellContext(config, { cwd, platform });
  // Only probe when sandboxing is genuinely in effect (vm/os). A 'none'
  // backend (or disabled sandbox) means the probe would run on the host shell,
  // which is not what this capability manifest is for.
  if (!context.sandbox.enabled) return {};
  if (context.sandbox.backend !== 'vm' && context.sandbox.backend !== 'os') {
    return {};
  }

  const key = sandboxCapabilityKey(config, { cwd, platform });
  if (!force) {
    if (cache.has(key)) return cache.get(key);
    // Cross-session reuse: fall back to the on-disk snapshot, if fresh.
    const snap = loadSnapshotEntries()[key];
    if (snap && Date.now() - Number(snap.at || 0) <= ttlMs) {
      cache.set(key, snap.capabilities);
      return snap.capabilities;
    }
  }

  const shell = resolveSandboxShell(context.shell);
  const command = buildSandboxProbeCommand(shell);
  const runner =
    typeof testHooks?.runShellCommand === 'function'
      ? testHooks.runShellCommand
      : runShellCommand;
  let capabilities = {};
  try {
    const res = await runner({
      command,
      cwd,
      shell,
      timeoutMs,
      config,
      sandboxMode: context.sandbox.mode,
    });
    capabilities = parseSandboxProbeOutput(res?.stdout || '');
  } catch {
    capabilities = {};
  }
  cache.set(key, capabilities);
  if (capabilities && Object.keys(capabilities).length > 0) {
    saveSnapshotEntry(key, { capabilities, at: Date.now() });
  }
  return capabilities;
}

/** Human-readable one-line summary, used in the Bash tool output. */
export function summarizeSandboxCapabilities(capabilities = {}) {
  const parts = SANDBOX_CAPABILITY_COMMANDS.map(
    (name) => `${name} ${capabilities[name] ? '✓' : '✗'}`,
  );
  return `sandbox commands: ${parts.join(' ')}`;
}

/** Probe (cached) and return a summary string, or '' when unavailable. */
export async function resolveSandboxCapabilitySummary(config, options = {}) {
  const caps = await probeSandboxCapabilities(config, options);
  if (!caps || Object.keys(caps).length === 0) return '';
  return summarizeSandboxCapabilities(caps);
}
