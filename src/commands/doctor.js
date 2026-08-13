import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getConfigFilePath, getSessionsDir, getSkillsDir } from '../core/paths.js';
import { loadConfig } from '../core/config-store.js';
import { resolveSandboxPolicy } from '../core/sandbox-policy.js';
import {
  checkMicrosandboxDoctor,
  describeSandboxDoctorSkip,
  describeSandboxDoctorUnavailable,
  shouldCheckMicrosandbox,
} from '../core/doctor-sandbox.js';

async function checkPathWritable(targetPath) {
  try {
    await fs.mkdir(targetPath, { recursive: true });
    const tmp = `${targetPath}/.doctor-write-test`;
    await fs.writeFile(tmp, 'ok', 'utf8');
    await fs.unlink(tmp);
    return true;
  } catch {
    return false;
  }
}

async function checkGateway(config) {
  if (!config.gateway.base_url || !config.gateway.api_key) {
    return { ok: false, reason: 'gateway.base_url or gateway.api_key missing' };
  }
  const url = `${config.gateway.base_url.replace(/\/$/, '')}/models`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.gateway.api_key}` }
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    return { ok: true, reason: 'reachable' };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, [command], { stdio: 'ignore' });
  return result.status === 0;
}

export async function handleDoctor({
  loadConfigFn = loadConfig,
  checkPathWritableFn = checkPathWritable,
  checkGatewayFn = checkGateway,
  commandExistsFn = commandExists,
  checkMicrosandboxDoctorFn = checkMicrosandboxDoctor,
  shouldCheckMicrosandboxFn = shouldCheckMicrosandbox,
  writeLine = (line) => console.log(line)
} = {}) {
  const config = await loadConfigFn();
  const checks = [];

  checks.push({
    name: 'Node.js version',
    ok: Number(process.versions.node.split('.')[0]) >= 20,
    detail: process.versions.node
  });

  checks.push({
    name: 'Platform',
    ok: process.platform === 'win32',
    detail: process.platform === 'win32' ? 'win32' : `non-win32 (${process.platform})`
  });

  checks.push({
    name: 'Config file writable',
    ok: await checkPathWritableFn(path.dirname(getConfigFilePath())),
    detail: getConfigFilePath()
  });

  checks.push({
    name: 'Sessions dir writable',
    ok: await checkPathWritableFn(getSessionsDir()),
    detail: getSessionsDir()
  });

  checks.push({
    name: 'Skills dir writable',
    ok: await checkPathWritableFn(getSkillsDir()),
    detail: getSkillsDir()
  });

  const gateway = await checkGatewayFn(config);
  checks.push({
    name: 'Gateway connectivity',
    ok: gateway.ok,
    detail: gateway.reason
  });

  const hasFff = await commandExistsFn('fff-mcp');
  checks.push({
    name: 'FFF MCP availability',
    ok: hasFff,
    detail: hasFff ? 'found fff-mcp' : 'fff-mcp not found in PATH'
  });

  if (shouldCheckMicrosandboxFn(config)) {
    const sandbox = await checkMicrosandboxDoctorFn();
    checks.push({
      name: 'Microsandbox host runtime',
      ok: sandbox.ok,
      detail: sandbox.reason,
    });
  } else {
    const policy = resolveSandboxPolicy({ config });
    if (policy.enabled && policy.backend === 'none') {
      checks.push({
        name: 'Microsandbox host runtime',
        ok: false,
        detail: describeSandboxDoctorUnavailable(config),
      });
    } else {
      checks.push({
        name: 'Microsandbox host runtime',
        skip: true,
        detail: describeSandboxDoctorSkip(config),
      });
    }
  }

  for (const check of checks) {
    if (check.skip) {
      writeLine(`[SKIP] ${check.name}: ${check.detail}`);
      continue;
    }
    const mark = check.ok ? 'OK' : 'FAIL';
    writeLine(`[${mark}] ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.skip && !check.ok).length;
  if (failed > 0) {
    process.exitCode = 1;
  }
}
