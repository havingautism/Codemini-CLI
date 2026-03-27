import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigFilePath, getSessionsDir, getSkillsDir } from '../core/paths.js';
import { loadConfig } from '../core/config-store.js';

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

export async function handleDoctor() {
  const config = await loadConfig();
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
    ok: await checkPathWritable(path.dirname(getConfigFilePath())),
    detail: getConfigFilePath()
  });

  checks.push({
    name: 'Sessions dir writable',
    ok: await checkPathWritable(getSessionsDir()),
    detail: getSessionsDir()
  });

  checks.push({
    name: 'Skills dir writable',
    ok: await checkPathWritable(getSkillsDir()),
    detail: getSkillsDir()
  });

  const gateway = await checkGateway(config);
  checks.push({
    name: 'Gateway connectivity',
    ok: gateway.ok,
    detail: gateway.reason
  });

  for (const check of checks) {
    const mark = check.ok ? 'OK' : 'FAIL';
    console.log(`[${mark}] ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((c) => !c.ok).length;
  if (failed > 0) {
    process.exitCode = 1;
  }
}
