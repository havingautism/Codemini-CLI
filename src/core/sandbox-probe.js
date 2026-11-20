import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const MSB_TRIPLES = {
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu',
  'linux-arm64': 'linux-arm64-gnu',
  'win32-x64': 'win32-x64-msvc',
  'win32-arm64': 'win32-arm64-msvc',
};

export const SANDBOX_BACKENDS = Object.freeze(['auto', 'microsandbox', 'os']);

let testHooks = null;
let osFallbackForced = false;
let linuxConfineCache = null;

export function __setSandboxProbeTestHooks(hooks = null) {
  testHooks = hooks;
  osFallbackForced = false;
  linuxConfineCache = null;
}

export function rememberOsFallback() {
  osFallbackForced = true;
}

export function isOsFallbackForced() {
  return osFallbackForced;
}

export function canUseOsConfine(platform = process.platform) {
  return platform === 'linux' || platform === 'darwin';
}

function commandOnPath(name) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, [name], { stdio: 'ignore' });
  return result.status === 0;
}

function landlockReady() {
  try {
    const api = require('node-addon-landlock-run');
    const launcher = typeof api.launcherPath === 'function' ? api.launcherPath() : '';
    if (!launcher || !fs.existsSync(launcher)) return false;
    const enforcement = typeof api.probe === 'function'
      ? api.probe(launcher, { timeoutMs: 1000 })
      : 'unusable';
    return enforcement !== 'unusable';
  } catch {
    return false;
  }
}

function linuxConfineReady() {
  if (linuxConfineCache !== null) return linuxConfineCache;
  linuxConfineCache = landlockReady() || commandOnPath('bwrap');
  return linuxConfineCache;
}

/** Seatbelt on macOS, Landlock (or bubblewrap) on Linux. Foreign platforms stay assumed. */
export function osConfineReady(platform = process.platform) {
  if (typeof testHooks?.osConfineReady === 'function') return Boolean(testHooks.osConfineReady(platform));
  if (!canUseOsConfine(platform)) return false;
  if (platform !== process.platform) return true;
  if (platform === 'darwin') return fs.existsSync('/usr/bin/sandbox-exec');
  return linuxConfineReady();
}

export function normalizeSandboxBackend(value) {
  const raw = String(value || 'auto').trim().toLowerCase();
  if (raw === 'vm') return 'microsandbox';
  if (SANDBOX_BACKENDS.includes(raw)) return raw;
  return 'auto';
}

function msbFileName(platform = process.platform) {
  return platform === 'win32' ? 'msb.exe' : 'msb';
}

export function resolveMsbBinary({
  platform = process.platform,
  arch = process.arch,
  existsSync = fs.existsSync,
} = {}) {
  if (typeof testHooks?.resolveMsbBinary === 'function') {
    return testHooks.resolveMsbBinary({ platform, arch });
  }
  const fromEnv = String(process.env.MSB_PATH || '').trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const triple = MSB_TRIPLES[`${platform}-${arch}`];
  if (!triple) return null;
  try {
    const pkgPath = require.resolve(`@superradcompany/microsandbox-${triple}/package.json`);
    const candidate = path.join(path.dirname(pkgPath), 'bin', msbFileName(platform));
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function hasMicrosandboxBinary(options = {}) {
  return Boolean(resolveMsbBinary(options));
}

export function inspectSandboxAvailability({
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const backend = selectSandboxBackend({ preferred: 'auto', platform, arch });
  return {
    backend,
    vm: backend === 'vm',
    os: backend === 'os',
    osKind: backend === 'os' ? (platform === 'darwin' ? 'seatbelt' : 'landlock') : '',
    confineAvailable: backend !== 'none',
    platform,
  };
}

export function selectSandboxBackend({
  preferred = 'auto',
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (osFallbackForced && canUseOsConfine(platform)) return 'os';
  const normalized = normalizeSandboxBackend(preferred);
  if (normalized === 'os') return canUseOsConfine(platform) ? 'os' : 'none';
  if (normalized === 'microsandbox') return 'vm';
  if (hasMicrosandboxBinary({ platform, arch })) return 'vm';
  if (osConfineReady(platform)) return 'os';
  return 'none';
}
