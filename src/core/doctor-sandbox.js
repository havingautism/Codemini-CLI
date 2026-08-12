import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { resolveSandboxPolicy } from './sandbox-policy.js';

const require = createRequire(import.meta.url);

const MICROSANDBOX_DOCTOR_TIMEOUT_MS = 90_000;
const OPERATIONS_HINT = 'see OPERATIONS.md (Microsandbox troubleshooting)';

export function shouldCheckMicrosandbox(config = {}, { cwd = process.cwd() } = {}) {
  return resolveSandboxPolicy({ config, cwd }).enabled;
}

export function describeSandboxDoctorSkip(config = {}, { cwd = process.cwd() } = {}) {
  const policy = resolveSandboxPolicy({ config, cwd });
  if (!policy.enabled) {
    const mode = String(config?.sandbox?.mode || policy.mode || '').trim();
    if (mode === 'danger-full-access') {
      return 'sandbox disabled (danger-full-access mode)';
    }
    const enabled = config?.sandbox?.enabled;
    if (enabled === false || enabled === 'false' || enabled === 'off' || enabled === 'never') {
      return 'sandbox disabled (sandbox.enabled=false)';
    }
    return 'sandbox disabled';
  }
  return '';
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, [command], { stdio: 'ignore' });
  return result.status === 0;
}

export function resolveMicrosandboxDoctorCommand({
  execPath = process.execPath,
  existsSync = fs.existsSync,
} = {}) {
  try {
    const entry = require.resolve('microsandbox');
    const bin = path.join(path.dirname(entry), '..', 'bin', 'microsandbox.cjs');
    if (existsSync(bin)) {
      return { command: execPath, args: [bin, 'doctor'], label: 'microsandbox doctor' };
    }
  } catch {}

  if (commandExists('msb')) {
    return { command: 'msb', args: ['doctor'], label: 'msb doctor' };
  }
  if (commandExists('microsandbox')) {
    return { command: 'microsandbox', args: ['doctor'], label: 'microsandbox doctor' };
  }
  return { command: 'npx', args: ['microsandbox', 'doctor'], label: 'npx microsandbox doctor' };
}

function summarizeDoctorOutput(stdout = '', stderr = '', status = 1) {
  const output = [stdout, stderr]
    .map((chunk) => String(chunk || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!output) return `exit ${status}`;
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-2).join(' | ') || `exit ${status}`;
}

export async function checkMicrosandboxDoctor({
  commandSpec,
  spawnFn = spawnSync,
  timeoutMs = MICROSANDBOX_DOCTOR_TIMEOUT_MS,
} = {}) {
  const spec = commandSpec ?? resolveMicrosandboxDoctorCommand();
  const result = spawnFn(spec.command, spec.args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result?.error) {
    const message = result.error.code === 'ETIMEDOUT'
      ? `timed out after ${timeoutMs}ms`
      : result.error.message;
    return { ok: false, reason: `${message}; ${OPERATIONS_HINT}` };
  }

  const status = Number.isInteger(result?.status) ? result.status : 1;
  const summary = summarizeDoctorOutput(result?.stdout, result?.stderr, status);
  if (status === 0) {
    return { ok: true, reason: summary || `${spec.label} passed` };
  }
  return { ok: false, reason: `${summary}; ${OPERATIONS_HINT}` };
}
