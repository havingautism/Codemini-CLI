import fs from 'node:fs/promises';
import path from 'node:path';

function checkpointsDir(cwd = process.cwd()) {
  return path.join(cwd, '.coder', 'checkpoints');
}

function makeId(name = '') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${stamp}-${slug || 'checkpoint'}`;
}

export async function createCheckpoint({ name, session, config, tasks }, cwd = process.cwd()) {
  const dir = checkpointsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const id = makeId(name);
  const filePath = path.join(dir, `${id}.json`);
  const payload = {
    id,
    name: String(name || ''),
    createdAt: new Date().toISOString(),
    session,
    config,
    tasks: Array.isArray(tasks) ? tasks : []
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export async function listCheckpoints(cwd = process.cwd()) {
  const dir = checkpointsDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const filePath = path.join(dir, e.name);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      out.push({
        id: parsed.id || path.basename(e.name, '.json'),
        name: parsed.name || '',
        createdAt: parsed.createdAt || '',
        sessionId: parsed?.session?.id || '',
        filePath
      });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

export async function loadCheckpoint(id, cwd = process.cwd()) {
  const dir = checkpointsDir(cwd);
  const filePath = path.join(dir, `${id}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}
