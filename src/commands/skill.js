import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { copyRecursive } from '../core/fs-utils.js';
import { getSkillsDir } from '../core/paths.js';
import {
  computeFileSha256,
  readSkillRegistry,
  upsertSkillRegistryEntry,
  writeSkillRegistry
} from '../core/skill-registry.js';

async function listSkillEntries() {
  const registry = await readSkillRegistry();
  const byName = new Map((registry.skills || []).map((s) => [s.name, s]));
  await fs.mkdir(getSkillsDir(), { recursive: true });
  const entries = await fs.readdir(getSkillsDir(), { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return names.map((name) => byName.get(name) || { name, version: 'unknown', enabled: true });
}

async function readSkillMeta(name) {
  const dir = path.join(getSkillsDir(), name);
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    manifest = null;
  }
  const entryFile = manifest?.entry || 'SKILL.md';
  const skillPath = path.join(dir, entryFile);
  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const firstLines = content.split('\n').slice(0, 20).join('\n');
    return { exists: true, path: skillPath, preview: firstLines, manifest };
  } catch {
    return { exists: false, path: skillPath, preview: '', manifest };
  }
}

async function runTarExtract(tgzPath, destDir) {
  await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', tgzPath, '-C', destDir], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`tar extract failed: ${stderr || `exit ${code}`}`));
        return;
      }
      resolve();
    });
  });
}

async function readManifestSafe(skillRoot) {
  const p = path.join(skillRoot, 'manifest.json');
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function resolveSkillSourceDir(sourcePath) {
  const absSrc = path.resolve(sourcePath);
  const srcStat = await fs.stat(absSrc);

  if (srcStat.isFile() && absSrc.endsWith('.tgz')) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-'));
    await runTarExtract(absSrc, tmp);
    const candidates = ['package', ...((await fs.readdir(tmp, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name))];
    for (const c of candidates) {
      const dir = path.join(tmp, c);
      try {
        await fs.access(path.join(dir, 'SKILL.md'));
        return { dir, cleanupDir: tmp };
      } catch {
        continue;
      }
    }
    throw new Error('No SKILL.md found in tgz package');
  }

  if (srcStat.isFile() && path.basename(absSrc) === 'SKILL.md') {
    return { dir: path.dirname(absSrc), cleanupDir: null };
  }

  if (srcStat.isDirectory()) {
    await fs.access(path.join(absSrc, 'SKILL.md'));
    return { dir: absSrc, cleanupDir: null };
  }

  throw new Error('skill install supports <skill-dir>, <SKILL.md>, or <skill.tgz>');
}

async function installSkill(sourcePath) {
  const resolved = await resolveSkillSourceDir(sourcePath);
  const manifest = await readManifestSafe(resolved.dir);
  const folderName = manifest?.name || path.basename(resolved.dir);
  const targetDir = path.join(getSkillsDir(), folderName);
  await fs.rm(targetDir, { recursive: true, force: true });
  await copyRecursive(resolved.dir, targetDir);

  const entryFile = manifest?.entry || 'SKILL.md';
  const entryPath = path.join(targetDir, entryFile);
  await fs.access(entryPath);

  const hash = await computeFileSha256(entryPath);
  await upsertSkillRegistryEntry(undefined, {
    name: folderName,
    version: manifest?.version || '0.0.0',
    description: manifest?.description || '',
    enabled: true,
    source: sourcePath,
    entryFile,
    sha256: hash,
    installedAt: new Date().toISOString()
  });

  if (resolved.cleanupDir) {
    await fs.rm(resolved.cleanupDir, { recursive: true, force: true });
  }

  return folderName;
}

async function setEnabled(name, enabled) {
  const registry = await readSkillRegistry();
  const idx = registry.skills.findIndex((s) => s.name === name);
  if (idx === -1) {
    throw new Error(`skill not found: ${name}`);
  }
  registry.skills[idx].enabled = enabled;
  await writeSkillRegistry(undefined, registry);
}

async function reindexSkills() {
  await fs.mkdir(getSkillsDir(), { recursive: true });
  const entries = await fs.readdir(getSkillsDir(), { withFileTypes: true });
  const registry = await readSkillRegistry();
  const byName = new Map((registry.skills || []).map((s) => [s.name, s]));
  const rebuilt = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const dir = path.join(getSkillsDir(), name);
    const manifest = await readManifestSafe(dir);
    const entryFile = manifest?.entry || 'SKILL.md';
    const entryPath = path.join(dir, entryFile);
    try {
      await fs.access(entryPath);
    } catch {
      continue;
    }
    const hash = await computeFileSha256(entryPath);
    const prior = byName.get(name);
    rebuilt.push({
      name: manifest?.name || name,
      version: manifest?.version || prior?.version || '0.0.0',
      description: manifest?.description || prior?.description || '',
      enabled: prior?.enabled !== false,
      source: prior?.source || 'reindex',
      entryFile,
      sha256: hash,
      installedAt: prior?.installedAt || new Date().toISOString()
    });
  }

  await writeSkillRegistry(undefined, {
    version: 1,
    skills: rebuilt
  });

  return rebuilt.length;
}

function usage() {
  console.log(`Usage:
  codemini skill list
  codemini skill install <path>
  codemini skill enable <name>
  codemini skill disable <name>
  codemini skill inspect <name>
  codemini skill reindex`);
}

export async function handleSkill(args) {
  const [sub, ...rest] = args;
  if (!sub) {
    usage();
    return;
  }

  if (sub === 'list') {
    const entries = await listSkillEntries();
    if (entries.length === 0) {
      console.log('No installed skills');
      return;
    }
    for (const item of entries) {
      const state = item.enabled !== false ? 'enabled' : 'disabled';
      console.log(`${item.name}@${item.version || '0.0.0'} (${state})`);
    }
    return;
  }

  if (sub === 'install') {
    const sourcePath = rest[0];
    if (!sourcePath) {
      throw new Error('skill install requires <path>');
    }
    const installedName = await installSkill(sourcePath);
    await setEnabled(installedName, true);
    console.log(`Installed skill: ${installedName}`);
    return;
  }

  if (sub === 'enable' || sub === 'disable') {
    const name = rest[0];
    if (!name) {
      throw new Error(`skill ${sub} requires <name>`);
    }
    await setEnabled(name, sub === 'enable');
    console.log(`${sub}d skill: ${name}`);
    return;
  }

  if (sub === 'inspect') {
    const name = rest[0];
    if (!name) {
      throw new Error('skill inspect requires <name>');
    }
    const meta = await readSkillMeta(name);
    if (!meta.exists) {
      throw new Error(`skill not found: ${name}`);
    }
    if (meta.manifest) {
      console.log(`Manifest: ${JSON.stringify(meta.manifest, null, 2)}\n`);
    }
    console.log(`Path: ${meta.path}\n`);
    console.log(meta.preview);
    return;
  }

  if (sub === 'reindex') {
    const count = await reindexSkills();
    console.log(`Reindexed skills: ${count}`);
    return;
  }

  usage();
}
