import fs from 'node:fs';
import path from 'node:path';
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

export function __setSandboxProbeTestHooks(hooks = null) {
  testHooks = hooks;
  osFallbackForced = false;
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
  if (canUseOsConfine(platform)) return 'os';
  return 'none';
}
