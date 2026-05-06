import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { copyRecursive } from '../core/fs-utils.js';
import { loadConfig, saveConfig } from '../core/config-store.js';
import { loadCommandsAndSkills } from '../core/command-loader.js';
import { getProjectSkillsDir, getSkillsDir } from '../core/paths.js';
import {
  computeFileSha256,
  readSkillRegistry,
  upsertSkillRegistryEntry,
  writeSkillRegistry
} from '../core/skill-registry.js';

function parseScopeArgs(args = [], { defaultScope = 'project', allowAll = false } = {}) {
  let scope = defaultScope;
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '');
    if (arg === '--global') {
      scope = 'global';
      continue;
    }
    if (arg === '--project') {
      scope = 'project';
      continue;
    }
    if (arg === '--scope') {
      const next = String(args[index + 1] || '').toLowerCase();
      if (['project', 'global', ...(allowAll ? ['all', 'builtin'] : [])].includes(next)) {
        scope = next;
        index += 1;
        continue;
      }
    }
    if (arg.startsWith('--scope=')) {
      const value = arg.slice('--scope='.length).toLowerCase();
      if (['project', 'global', ...(allowAll ? ['all', 'builtin'] : [])].includes(value)) {
        scope = value;
        continue;
      }
    }
    rest.push(arg);
  }
  return { scope, rest };
}

function baseDirForScope(scope, cwd = process.cwd()) {
  return scope === 'global' ? getSkillsDir() : getProjectSkillsDir(cwd);
}

function scopeFromSource(source = '') {
  if (source === 'bundled-skill') return 'builtin';
  if (source === 'project-skill') return 'project';
  if (source === 'global-skill' || source === 'registry-skill') return 'global';
  return source || 'unknown';
}

async function setSkillEnabledConfig(name, enabled) {
  const config = await loadConfig();
  config.skills = config.skills || {};
  config.skills.enabled = config.skills.enabled || {};
  config.skills.enabled[name] = enabled;
  await saveConfig(config);
}

export async function listSkillEntries({ scope = 'all', cwd = process.cwd() } = {}) {
  const commands = await loadCommandsAndSkills(cwd);
  const config = await loadConfig();
  const entries = [];
  for (const command of commands.values()) {
    if (command.metadata?.type !== 'skill') continue;
    const itemScope = scopeFromSource(command.source);
    if (scope !== 'all' && itemScope !== scope) continue;
    entries.push({
      name: command.name,
      version: command.metadata?.version || '0.0.0',
      description: command.metadata?.description || '',
      scope: itemScope,
      path: command.path,
      enabled: itemScope === 'builtin' ? true : config.skills?.enabled?.[command.name] !== false
    });
  }
  return entries.sort((a, b) => `${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`));
}

async function readSkillMeta(name, { scope = 'all', cwd = process.cwd() } = {}) {
  const entries = await listSkillEntries({ scope, cwd });
  const found = entries.find((item) => item.name === name);
  if (!found) {
    return { exists: false, path: '', preview: '', manifest: null };
  }
  const dir = path.dirname(found.path);
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    manifest = null;
  }
  const entryFile = manifest?.entry || 'SKILL.md';
  const skillPath = found.path || path.join(dir, entryFile);
  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const firstLines = content.split('\n').slice(0, 20).join('\n');
    return { exists: true, path: skillPath, preview: firstLines, manifest, scope: found.scope };
  } catch {
    return { exists: false, path: skillPath, preview: '', manifest, scope: found.scope };
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

async function installSkill(sourcePath, { scope = 'project', cwd = process.cwd() } = {}) {
  const resolved = await resolveSkillSourceDir(sourcePath);
  const manifest = await readManifestSafe(resolved.dir);
  const folderName = manifest?.name || path.basename(resolved.dir);
  const bundled = (await listSkillEntries({ scope: 'builtin', cwd })).find((item) => item.name === folderName);
  if (bundled) {
    throw new Error(`cannot install over builtin skill: ${folderName}`);
  }
  const targetDir = path.join(baseDirForScope(scope, cwd), folderName);
  await fs.rm(targetDir, { recursive: true, force: true });
  await copyRecursive(resolved.dir, targetDir);

  const entryFile = manifest?.entry || 'SKILL.md';
  const entryPath = path.join(targetDir, entryFile);
  await fs.access(entryPath);

  const hash = await computeFileSha256(entryPath);
  if (scope === 'global') {
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
  }
  await setSkillEnabledConfig(folderName, true);

  if (resolved.cleanupDir) {
    await fs.rm(resolved.cleanupDir, { recursive: true, force: true });
  }

  return folderName;
}

async function setEnabled(name, enabled, { cwd = process.cwd() } = {}) {
  const entries = await listSkillEntries({ scope: 'all', cwd });
  const found = entries.find((item) => item.name === name);
  if (!found) {
    throw new Error(`skill not found: ${name}`);
  }
  if (found.scope === 'builtin') {
    throw new Error(`builtin skill cannot be ${enabled ? 'enabled' : 'disabled'}: ${name}`);
  }
  await setSkillEnabledConfig(name, enabled);
  const registry = await readSkillRegistry();
  const idx = registry.skills.findIndex((s) => s.name === name);
  if (idx !== -1) {
    registry.skills[idx].enabled = enabled;
    await writeSkillRegistry(undefined, registry);
  }
}

async function reindexSkills({ scope = 'global', cwd = process.cwd() } = {}) {
  const baseDir = baseDirForScope(scope, cwd);
  await fs.mkdir(baseDir, { recursive: true });
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const registry = await readSkillRegistry();
  const byName = new Map((registry.skills || []).map((s) => [s.name, s]));
  const rebuilt = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const dir = path.join(baseDir, name);
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

  if (scope === 'global') {
    await writeSkillRegistry(undefined, {
      version: 1,
      skills: rebuilt
    });
  }

  return rebuilt.length;
}

function usage() {
  console.log(`Usage:
  codemini skill list [--scope=all|project|global|builtin]
  codemini skill install [--scope=project|global] <path>
  codemini skill enable <name>
  codemini skill disable <name>
  codemini skill inspect [--scope=all|project|global|builtin] <name>
  codemini skill reindex [--scope=project|global]`);
}

export async function handleSkill(args) {
  const [sub, ...rest] = args;
  if (!sub) {
    usage();
    return;
  }

  if (sub === 'list') {
    const { scope } = parseScopeArgs(rest, { defaultScope: 'all', allowAll: true });
    const entries = await listSkillEntries({ scope });
    if (entries.length === 0) {
      console.log('No installed skills');
      return;
    }
    for (const item of entries) {
      const state = item.scope === 'builtin' ? 'builtin/default' : (item.enabled !== false ? 'enabled' : 'disabled');
      console.log(`${item.name}@${item.version || '0.0.0'} [${item.scope}] (${state})`);
    }
    return;
  }

  if (sub === 'install') {
    const { scope, rest: positional } = parseScopeArgs(rest, { defaultScope: 'project' });
    const sourcePath = positional[0];
    if (!sourcePath) {
      throw new Error('skill install requires <path>');
    }
    const installedName = await installSkill(sourcePath, { scope });
    console.log(`Installed skill: ${installedName} (${scope})`);
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
    const { scope, rest: positional } = parseScopeArgs(rest, { defaultScope: 'all', allowAll: true });
    const name = positional[0];
    if (!name) {
      throw new Error('skill inspect requires <name>');
    }
    const meta = await readSkillMeta(name, { scope });
    if (!meta.exists) {
      throw new Error(`skill not found: ${name}`);
    }
    if (meta.manifest) {
      console.log(`Manifest: ${JSON.stringify(meta.manifest, null, 2)}\n`);
    }
    console.log(`Scope: ${meta.scope}\n`);
    console.log(`Path: ${meta.path}\n`);
    console.log(meta.preview);
    return;
  }

  if (sub === 'reindex') {
    const { scope } = parseScopeArgs(rest, { defaultScope: 'global' });
    const count = await reindexSkills({ scope });
    console.log(`Reindexed skills: ${count} (${scope})`);
    return;
  }

  usage();
}
