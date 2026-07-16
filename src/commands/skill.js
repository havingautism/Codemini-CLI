import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { copyRecursive } from '../core/fs-utils.js';
import { loadConfig, saveConfig } from '../core/config-store.js';
import { loadCommandsAndSkills } from '../core/command-loader.js';
import { getProjectSkillsDir, getSkillsDir } from '../core/paths.js';
import { normalizeSkillContexts, skillAppliesToExecutionMode } from '../core/skill-contexts.js';
import {
  computeFileSha256,
  readSkillRegistry,
  upsertSkillRegistryEntry,
  writeSkillRegistry
} from '../core/skill-registry.js';
import { discoverSkillHooks, readHooksJson } from '../core/skill-hooks-discover.js';
import {
  listPackageHookProfiles,
  persistPackageHookRoot,
  savePackageHookProfile,
} from '../core/hook-profiles.js';

const SKILL_CATALOG_FILE = 'codemini.skills.json';
const HOOKS_DISABLED_MARKER = '.codemini-hooks-disabled';

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

function isGitLikeSource(value = '') {
  const text = String(value || '').trim();
  return (
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git|(?:\/tree\/.+)|\/)?$/i.test(text) ||
    /^git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?$/i.test(text) ||
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)
  );
}

function normalizeNpxSkillSource(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/^npx\s+skills(?:@[\w.-]+)?\s+add\s+(.+)$/i);
  return match ? match[1].trim().split(/\s+/)[0] : text;
}

export function normalizeGitSource(source = '') {
  const raw = normalizeNpxSkillSource(source);
  const githubTree = raw.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/tree\/(.+?)\/?$/i);
  if (githubTree) {
    const [, owner, repo, treeRef] = githubTree;
    const [branch, ...pathParts] = treeRef.split('/').filter(Boolean);
    return { url: `https://github.com/${owner}/${repo}.git`, branch, subPath: pathParts.join('/') };
  }
  if (/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\.git\/?$/i.test(raw)) {
    return { url: raw.replace(/\/$/, ''), branch: null, subPath: '' };
  }
  if (/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/i.test(raw)) {
    return { url: raw.replace(/\/$/, '') + '.git', branch: null, subPath: '' };
  }
  if (/^git@github\.com:/i.test(raw)) {
    return { url: raw.endsWith('.git') ? raw : `${raw}.git`, branch: null, subPath: '' };
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) {
    return { url: `https://github.com/${raw}.git`, branch: null, subPath: '' };
  }
  return null;
}

export function packageSourceKey(source = '') {
  const normalized = normalizeGitSource(source);
  if (!normalized?.url) return '';
  let url = String(normalized.url || '').trim();
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) {
    url = `https://github.com/${ssh[1]}/${ssh[2]}.git`;
  }
  url = url
    .toLowerCase()
    .replace(/\.git$/i, '')
    .replace(/\/$/, '');
  const subPath = String(normalized.subPath || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
  return subPath ? `${url}#${subPath}` : url;
}

export function samePackageSource(left = '', right = '') {
  const leftKey = packageSourceKey(left);
  const rightKey = packageSourceKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function canUpdateSkillPackage(skill = {}) {
  if (!skill || skill.scope === 'builtin') return false;
  const source = String(skill.packageSource || skill.source || '').trim();
  return Boolean(packageSourceKey(source));
}

export function getSkillPackageUpdateSource(skill = {}) {
  const source = String(skill.source || '').trim();
  if (packageSourceKey(source)) return source;
  return String(skill.packageSource || '').trim();
}

export function skillBelongsToPackageUpdate(skill = {}, source = '') {
  return samePackageSource(getSkillPackageUpdateSource(skill), source);
}

export function getStaleSkillPackageNames(before = [], installed = []) {
  const installedNames = new Set(installed.map((name) => String(name || '').trim()));
  return before
    .map((item) => String(item?.name || '').trim())
    .filter((name) => name && !installedNames.has(name));
}

export function getSkillRoutingPreferences(entries = []) {
  return new Map(
    entries.map((item) => [
      item.name,
      {
        mode: item.mode || 'agent_requested',
        triggers: Array.isArray(item.triggers) ? [...item.triggers] : [],
        ...(item.priority !== undefined ? { priority: item.priority } : {}),
        enabled: item.enabled !== false,
        hooksImported: item.hooksImported !== false,
      },
    ])
  );
}

async function runGitClone(source, destDir) {
  const normalized = normalizeGitSource(source);
  if (!normalized) {
    throw new Error(`unsupported git skill source: ${source}`);
  }
  await new Promise((resolve, reject) => {
    const args = ['clone', '--depth', '1'];
    if (normalized.branch) args.push('--branch', normalized.branch);
    args.push(normalized.url, destDir);
    const child = execFile('git', args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git clone failed: ${stderr || stdout || error.message}`));
        return;
      }
      resolve();
    });
    child.stdin?.end();
  });
}

function scopeFromSource(source = '') {
  if (source === 'bundled-skill') return 'builtin';
  if (source === 'project-skill') return 'project';
  if (source === 'global-skill' || source === 'registry-skill') return 'global';
  return source || 'unknown';
}

function derivePackageName(source = '') {
  const text = String(source || '').trim();
  const github = text.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/|$)/i);
  if (github) return `${github[1]}/${github[2]}`;
  const ownerRepo = text.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\s|$)/);
  if (ownerRepo) return ownerRepo[1];
  const base = path.basename(text.replace(/[\\/]+$/, ''));
  return base || text || 'local skill package';
}

async function readSkillPackageInfo(packageRoot, sourceLabel) {
  const plugin = await readPluginManifestSafe(packageRoot);
  const displayName =
    plugin?.interface?.displayName ||
    plugin?.name ||
    derivePackageName(plugin?.repository || plugin?.homepage || sourceLabel);
  const packageSource = String(plugin?.repository || plugin?.homepage || sourceLabel || '').trim();
  return {
    source: String(sourceLabel || '').trim(),
    packageSource: packageSource || String(sourceLabel || '').trim(),
    packageName: String(displayName || '').trim() || derivePackageName(sourceLabel),
    installedAt: new Date().toISOString()
  };
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
      mode: command.metadata?.mode || '',
      triggers: Array.isArray(command.metadata?.triggers) ? command.metadata.triggers : [],
      priority: Number.isFinite(Number(command.metadata?.priority))
        ? Number(command.metadata.priority)
        : undefined,
      source: command.metadata?.source || '',
      packageSource: command.metadata?.packageSource || command.metadata?.source || '',
      packageName: command.metadata?.packageName || '',
      installedAt: command.metadata?.installedAt || '',
      hooksImported: command.metadata?.hooksImported !== false,
      contexts: config.skills?.contexts?.[command.name]
        ? normalizeSkillContexts(config.skills.contexts[command.name])
        : ['project', 'builtin'].includes(itemScope)
          ? ['coding']
          : ['coding', 'daily'],
      scope: itemScope,
      path: command.path,
      enabled: config.skills?.enabled?.[command.name] !== undefined
        ? config.skills.enabled[command.name] !== false
        : command.metadata?.enabled !== false,
      appliesToCurrentMode: skillAppliesToExecutionMode(
        config.skills?.contexts?.[command.name],
        config.execution?.mode,
      )
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
  const catalogPath = path.join(path.dirname(dir), 'codemini.skills.json');
  let manifest = null;
  try {
    const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    manifest = catalog?.skills?.[found.name] || null;
  } catch {
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch {
      manifest = null;
    }
  }
  const skillPath = found.path || path.join(dir, 'SKILL.md');
  const auxiliaryDirs = [];
  for (const child of ['references', 'scripts', 'assets']) {
    try {
      const full = path.join(dir, child);
      const stat = await fs.stat(full);
      if (stat.isDirectory()) auxiliaryDirs.push({ name: child, path: full });
    } catch {
      continue;
    }
  }
  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const firstLines = content.split('\n').slice(0, 20).join('\n');
    return { exists: true, path: skillPath, preview: firstLines, manifest, scope: found.scope, auxiliaryDirs };
  } catch {
    return { exists: false, path: skillPath, preview: '', manifest, scope: found.scope, auxiliaryDirs };
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

const PLUGIN_MANIFEST_RELATIVE_PATHS = [
  path.join('.codex-plugin', 'plugin.json'),
  path.join('.claude-plugin', 'plugin.json'),
];

export async function readPluginManifestSafe(rootDir) {
  for (const relativePath of PLUGIN_MANIFEST_RELATIVE_PATHS) {
    try {
      const raw = await fs.readFile(path.join(rootDir, relativePath), 'utf8');
      return JSON.parse(raw);
    } catch {
      // Try the next known plugin-manifest location.
    }
  }
  return null;
}

function normalizeRelativePath(value = '') {
  const cleaned = String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '').trim();
  if (!cleaned || path.isAbsolute(cleaned) || cleaned.split('/').includes('..')) return '';
  return cleaned;
}

function parseArrayText(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((item) => item.trim().replace(/^["']|["']$/g, ''));
}

function normalizeSkillName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseSkillFrontmatter(raw) {
  const normalized = String(raw || '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { metadata: {}, content: normalized };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { metadata: {}, content: normalized };
  }

  const metadata = {};
  const lines = normalized.slice(4, end).trim().split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value === '|' || value === '>') {
      const block = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const nextLine = lines[next];
        if (!/^\s+/.test(nextLine)) break;
        block.push(nextLine.trim());
        index = next;
      }
      metadata[key] = block.join(value === '>' ? ' ' : '\n').trim();
      continue;
    }
    metadata[key] = value.startsWith('[') && value.endsWith(']')
      ? parseArrayText(value)
      : value.replace(/^["']|["']$/g, '');
  }

  return {
    metadata,
    content: normalized.slice(end + 5).trim()
  };
}

function cleanDescriptionText(value) {
  return String(value || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function inferDescriptionFromSkillMarkdown(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  const paragraph = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (!trimmed) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) continue;
    if (/^<!--/.test(trimmed)) continue;
    if (/^[-*_]{3,}$/.test(trimmed)) continue;

    const withoutListMarker = trimmed.replace(/^([-*+]|\d+[.)])\s+/, '');
    if (/^(name|version|author|license|entry)\s*:/i.test(withoutListMarker)) continue;
    paragraph.push(withoutListMarker);
  }

  return cleanDescriptionText(paragraph.join(' '));
}

async function readSkillDocumentMeta(skillRoot, entryFile = 'SKILL.md') {
  const entryPath = path.join(skillRoot, entryFile || 'SKILL.md');
  try {
    const raw = await fs.readFile(entryPath, 'utf8');
    const parsed = parseSkillFrontmatter(raw);
    return {
      name: normalizeSkillName(parsed.metadata.name),
      version: parsed.metadata.version ? String(parsed.metadata.version) : '',
      description: parsed.metadata.description
        ? cleanDescriptionText(parsed.metadata.description)
        : inferDescriptionFromSkillMarkdown(parsed.content)
    };
  } catch {
    return { name: '', version: '', description: '' };
  }
}

async function readSkillCatalogSafe(baseDir) {
  const catalogPath = path.join(baseDir, SKILL_CATALOG_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.skills && typeof parsed.skills === 'object'
      ? parsed
      : { version: 1, skills: {} };
  } catch {
    return { version: 1, skills: {} };
  }
}

async function writeSkillCatalog(baseDir, catalog) {
  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(path.join(baseDir, SKILL_CATALOG_FILE), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

async function upsertSkillCatalogEntry(baseDir, name, entry) {
  const catalog = await readSkillCatalogSafe(baseDir);
  catalog.version = catalog.version || 1;
  catalog.skills = catalog.skills || {};
  catalog.skills[name] = {
    ...(catalog.skills[name] || {}),
    ...entry
  };
  await writeSkillCatalog(baseDir, catalog);
}

async function ensureSkillContextsConfig(name, scope) {
  const config = await loadConfig();
  config.skills = config.skills || {};
  config.skills.contexts = config.skills.contexts || {};
  if (!config.skills.contexts[name]) {
    config.skills.contexts[name] = scope === 'project' ? ['coding'] : ['coding', 'daily'];
    await saveConfig(config);
  }
}

async function removeSkillCatalogEntries(baseDir, names) {
  if (names.length === 0) return;
  const catalog = await readSkillCatalogSafe(baseDir);
  for (const name of names) delete catalog.skills?.[name];
  await writeSkillCatalog(baseDir, catalog);
}

async function removeInstalledSkillEntries(baseDir, names, scope) {
  if (names.length === 0) return;
  for (const name of names) {
    await fs.rm(path.join(baseDir, name), { recursive: true, force: true });
  }
  await removeSkillCatalogEntries(baseDir, names);
  if (scope === 'global') {
    const staleNames = new Set(names);
    const registry = await readSkillRegistry();
    registry.skills = registry.skills.filter((item) => !staleNames.has(item.name));
    await writeSkillRegistry(undefined, registry);
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

async function findSkillDirs(rootDir) {
  const found = [];
  async function walk(dir, depth = 0) {
    if (depth > 5) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      found.push(dir);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['.git', 'node_modules', 'dist', 'build'].includes(entry.name)) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }
  await walk(rootDir);
  return found;
}

export async function findSkillDirsForPackage(rootDir) {
  const plugin = await readPluginManifestSafe(rootDir);
  const skillsPath = normalizeRelativePath(plugin?.skills);
  if (skillsPath) {
    const skillDirs = await findSkillDirs(path.join(rootDir, skillsPath));
    if (skillDirs.length > 0) return skillDirs;
  }

  const conventionalSkillsDir = path.join(rootDir, 'skills');
  try {
    const stat = await fs.stat(conventionalSkillsDir);
    if (stat.isDirectory()) {
      const skillDirs = await findSkillDirs(conventionalSkillsDir);
      if (skillDirs.length > 0) return skillDirs;
    }
  } catch {
    // Fall back to scanning the requested root below.
  }

  return await findSkillDirs(rootDir);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function summarizeSkillDir(skillDir) {
  const manifest = await readManifestSafe(skillDir);
  const entryFile = manifest?.entry || 'SKILL.md';
  const documentMeta = await readSkillDocumentMeta(skillDir, entryFile);
  const name =
    normalizeSkillName(manifest?.name) ||
    documentMeta.name ||
    normalizeSkillName(path.basename(skillDir));
  return {
    name,
    description: String(manifest?.description || documentMeta.description || '').trim(),
    version: String(manifest?.version || documentMeta.version || '0.0.0').trim() || '0.0.0',
    dir: skillDir,
  };
}

function normalizeSkillNameFilter(skillNames) {
  if (!Array.isArray(skillNames)) return null;
  const allow = new Set(
    skillNames.map((name) => normalizeSkillName(name) || String(name || '').trim()).filter(Boolean),
  );
  return allow.size > 0 ? allow : null;
}

async function filterSkillDirsByNames(skillDirs, skillNames) {
  const allow = normalizeSkillNameFilter(skillNames);
  if (!allow) return skillDirs;
  const matched = [];
  for (const dir of skillDirs) {
    const summary = await summarizeSkillDir(dir);
    if (allow.has(summary.name)) matched.push(dir);
  }
  if (matched.length === 0) {
    throw new Error(`No matching skills found for: ${[...allow].join(', ')}`);
  }
  return matched;
}

async function withResolvedSkillPackage(source, fn) {
  const normalizedSource = normalizeNpxSkillSource(source);
  const tmp = isGitLikeSource(normalizedSource)
    ? await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-preview-'))
    : null;
  try {
    if (tmp) {
      await runGitClone(normalizedSource, tmp);
      const normalized = normalizeGitSource(normalizedSource);
      const packageRoot = normalized?.subPath
        ? path.join(tmp, normalizeRelativePath(normalized.subPath))
        : tmp;
      const skillDirs = await findSkillDirsForPackage(packageRoot);
      if (skillDirs.length === 0) {
        throw new Error('No SKILL.md found in git repository');
      }
      const packageInfo = await readSkillPackageInfo(packageRoot, normalizedSource);
      return await fn({
        kind: skillDirs.length > 1 || path.basename(skillDirs[0]) !== path.basename(packageRoot)
          ? 'package'
          : 'package',
        source: normalizedSource,
        packageRoot,
        packageInfo,
        skillDirs,
      });
    }

    try {
      const resolved = await resolveSkillSourceDir(normalizedSource);
      const skillDir = resolved.dir;
      if (resolved.cleanupDir) {
        // Keep temp extract alive for the callback, then clean up.
        try {
          const packageInfo = await readSkillPackageInfo(skillDir, normalizedSource);
          return await fn({
            kind: 'skill',
            source: normalizedSource,
            packageRoot: skillDir,
            packageInfo,
            skillDirs: [skillDir],
          });
        } finally {
          await fs.rm(resolved.cleanupDir, { recursive: true, force: true });
        }
      }
      // Local single-skill path: may still be a package directory.
      try {
        const skillDirs = await findSkillDirsForPackage(skillDir);
        if (skillDirs.length > 1 || (skillDirs.length === 1 && skillDirs[0] !== skillDir)) {
          const packageInfo = await readSkillPackageInfo(skillDir, normalizedSource);
          return await fn({
            kind: 'package',
            source: normalizedSource,
            packageRoot: skillDir,
            packageInfo,
            skillDirs,
          });
        }
      } catch {
        // Fall through to single-skill summary.
      }
      const packageInfo = await readSkillPackageInfo(skillDir, normalizedSource);
      return await fn({
        kind: 'skill',
        source: normalizedSource,
        packageRoot: skillDir,
        packageInfo,
        skillDirs: [skillDir],
      });
    } catch (err) {
      const absSrc = path.resolve(normalizedSource);
      let stat;
      try {
        stat = await fs.stat(absSrc);
      } catch {
        throw err;
      }
      if (!stat.isDirectory()) throw err;
      const skillDirs = await findSkillDirsForPackage(absSrc);
      if (skillDirs.length === 0) throw err;
      const packageInfo = await readSkillPackageInfo(absSrc, normalizedSource);
      return await fn({
        kind: skillDirs.length > 1 ? 'package' : 'package',
        source: normalizedSource,
        packageRoot: absSrc,
        packageInfo,
        skillDirs,
      });
    }
  } finally {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
}

export async function previewSkillSource(source, { cwd = process.cwd() } = {}) {
  void cwd;
  return withResolvedSkillPackage(source, async ({ kind, source: sourceLabel, packageInfo, skillDirs }) => {
    const skills = [];
    for (const dir of skillDirs) {
      const summary = await summarizeSkillDir(dir);
      skills.push({
        name: summary.name,
        description: summary.description,
        version: summary.version,
      });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return {
      kind: skills.length > 1 ? 'package' : kind,
      source: sourceLabel,
      packageName: packageInfo?.packageName || '',
      packageSource: packageInfo?.packageSource || sourceLabel,
      skills,
    };
  });
}

export async function previewSkillPackageUpdate({
  name = '',
  packageSource = '',
  scope = '',
  cwd = process.cwd(),
} = {}) {
  const entries = await listSkillEntries({ scope: 'all', cwd });
  let skill = null;
  let source = String(packageSource || '').trim();
  let targetScope = String(scope || '').trim();

  if (name) {
    skill = entries.find((item) => item.name === name);
    if (!skill) throw new Error(`skill not found: ${name}`);
    if (skill.scope === 'builtin') throw new Error(`cannot update builtin skill: ${name}`);
    source = getSkillPackageUpdateSource(skill);
    targetScope = skill.scope;
  }
  if (!['global', 'project'].includes(targetScope)) {
    throw new Error('skill package update requires scope=project|global');
  }
  if (!packageSourceKey(source)) {
    throw new Error(`skill package source is not updatable: ${source || '(empty)'}`);
  }

  const preview = await previewSkillSource(source, { cwd });
  const installedNames = new Set(
    entries
      .filter((item) => item.scope === targetScope && skillBelongsToPackageUpdate(item, source))
      .map((item) => item.name),
  );

  return {
    ...preview,
    scope: targetScope,
    packageName: skill?.packageName || preview.packageName || '',
    skills: preview.skills.map((item) => ({
      ...item,
      installed: installedNames.has(item.name),
    })),
  };
}

// Skill hooks stay on the skill. Package-level hooks/hooks.json and their runtime
// root are persisted as a separate scoped package profile, not copied into each skill.
async function reconcileSkillHooksOnInstall(targetDir, { includeHooks = true } = {}) {
  const disabledMarker = path.join(targetDir, HOOKS_DISABLED_MARKER);
  if (!includeHooks) {
    await fs.rm(path.join(targetDir, 'hooks'), { recursive: true, force: true });
    await fs.writeFile(disabledMarker, 'Hooks were excluded during skill installation.\n', 'utf8');
    return { hooks: {}, provenance: {}, disableModelInvocation: false };
  }
  await fs.rm(disabledMarker, { force: true });
  return await discoverSkillHooks({ skillRoot: targetDir });
}

async function reconcilePackageHooksOnInstall(packageRoot, packageInfo, {
  scope = 'project',
  cwd = process.cwd(),
  includeHooks = true,
} = {}) {
  if (!packageRoot) return null;
  const packageHooksPath = path.join(packageRoot, 'hooks', 'hooks.json');
  if (!(await pathExists(packageHooksPath))) return null;
  const hooks = await readHooksJson(packageHooksPath);
  if (Object.keys(hooks).length === 0) return null;

  const packageSource = String(packageInfo?.packageSource || packageInfo?.source || '').trim();
  const packageName = String(packageInfo?.packageName || '').trim() || derivePackageName(packageSource);
  const idBase = packageSource || packageName || path.basename(packageRoot);
  const id = `pkg-${String(idBase)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)}`;

  const existing = (await listPackageHookProfiles(cwd)).find(
    (profile) =>
      profile.id === id ||
      (packageSource && profile.packageSource === packageSource) ||
      (packageName && profile.packageName === packageName),
  );

  let enabled = true;
  if (includeHooks === false) enabled = false;
  else if (existing) enabled = existing.enabled !== false;

  const packageInstallRoot = await persistPackageHookRoot(packageRoot, {
    scope,
    cwd,
    id: existing?.id || id,
  });

  return savePackageHookProfile({
    id: existing?.id || id,
    name: packageName || existing?.name || id,
    scope: scope === 'global' ? 'global' : 'project',
    activation: existing?.activation || 'always',
    enabled,
    packageSource: packageSource || existing?.packageSource || '',
    packageName: packageName || existing?.packageName || id,
    packageRoot: packageInstallRoot,
    hooks,
  }, cwd);
}

export async function snapshotSkillHooksDir(skillDir) {
  const hooksDir = path.join(skillDir, 'hooks');
  if (!(await pathExists(hooksDir))) return null;
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-skill-hooks-snapshot-'));
  await copyRecursive(hooksDir, snapshotDir);
  return snapshotDir;
}

export async function restoreSkillHooksDir(skillDir, snapshotDir) {
  if (!snapshotDir) return;
  const hooksDir = path.join(skillDir, 'hooks');
  await fs.rm(hooksDir, { recursive: true, force: true });
  await copyRecursive(snapshotDir, hooksDir);
}

export async function installSkill(sourcePath, {
  scope = 'project',
  cwd = process.cwd(),
  sourceLabel = sourcePath,
  packageInfo = null,
  packageRoot = null,
  includeHooks = true,
} = {}) {
  const resolved = await resolveSkillSourceDir(sourcePath);
  const manifest = await readManifestSafe(resolved.dir);
  const manifestEntry = manifest?.entry || 'SKILL.md';
  const documentMeta = await readSkillDocumentMeta(resolved.dir, manifestEntry);
  const folderName = normalizeSkillName(manifest?.name) || documentMeta.name || normalizeSkillName(path.basename(resolved.dir));
  const bundled = (await listSkillEntries({ scope: 'builtin', cwd })).find((item) => item.name === folderName);
  if (bundled) {
    throw new Error(`cannot install over builtin skill: ${folderName}`);
  }
  const targetDir = path.join(baseDirForScope(scope, cwd), folderName);
  await fs.rm(targetDir, { recursive: true, force: true });
  await copyRecursive(resolved.dir, targetDir);

  const entryFile = manifestEntry;
  const entryPath = path.join(targetDir, entryFile);
  await fs.access(entryPath);

  const hash = await computeFileSha256(entryPath);
  const description = manifest?.description || documentMeta.description || '';
  const version = manifest?.version || documentMeta.version || '0.0.0';
  const packageMetadata = packageInfo || {
    source: sourceLabel,
    packageSource: sourceLabel,
    packageName: '',
    installedAt: new Date().toISOString()
  };
  const discoveredHooks = await reconcileSkillHooksOnInstall(targetDir, { includeHooks });
  const catalogEntry = {
    description,
    mode: 'agent_requested',
    enabled: true,
    source: sourceLabel,
    packageSource: packageMetadata.packageSource || sourceLabel,
    packageName: packageMetadata.packageName || '',
    installedAt: packageMetadata.installedAt || new Date().toISOString(),
    disableModelInvocation: discoveredHooks.disableModelInvocation,
    hooksProvenance: discoveredHooks.provenance,
    hooksImported: includeHooks !== false,
  };
  if (scope === 'global') {
    await upsertSkillRegistryEntry(undefined, {
      name: folderName,
      version,
      description,
      enabled: true,
      source: sourceLabel,
      packageSource: packageMetadata.packageSource || sourceLabel,
      packageName: packageMetadata.packageName || '',
      entryFile,
      sha256: hash,
      installedAt: packageMetadata.installedAt || new Date().toISOString()
    });
    await upsertSkillCatalogEntry(baseDirForScope(scope, cwd), folderName, catalogEntry);
  } else {
    await upsertSkillCatalogEntry(baseDirForScope(scope, cwd), folderName, catalogEntry);
  }
  await setSkillEnabledConfig(folderName, true);
  await ensureSkillContextsConfig(folderName, scope);

  if (resolved.cleanupDir) {
    await fs.rm(resolved.cleanupDir, { recursive: true, force: true });
  }

  return folderName;
}

async function installSkillDirs(skillDirs, {
  scope,
  cwd,
  sourceLabel,
  packageInfo,
  packageRoot,
  includeHooks,
  skillNames,
}) {
  const selectedDirs = await filterSkillDirsByNames(skillDirs, skillNames);
  const installed = [];
  const skipped = [];
  for (const dir of selectedDirs) {
    try {
      installed.push(await installSkill(dir, {
        scope,
        cwd,
        sourceLabel,
        packageInfo,
        packageRoot,
        includeHooks,
      }));
    } catch (err) {
      if (/cannot install over builtin skill:/i.test(err.message || '')) {
        skipped.push({ dir, reason: err.message });
        continue;
      }
      throw err;
    }
  }
  if (installed.length === 0 && skipped.length > 0) {
    throw new Error(skipped.map((item) => item.reason).join('\n'));
  }
  if (packageRoot && installed.length > 0) {
    await reconcilePackageHooksOnInstall(packageRoot, packageInfo, {
      scope,
      cwd,
      includeHooks,
    });
  }
  return installed;
}

export async function installSkillSource(source, {
  scope = 'project',
  cwd = process.cwd(),
  includeHooks = false,
  skillNames = null,
} = {}) {
  return withResolvedSkillPackage(source, async ({ packageRoot, packageInfo, skillDirs, source: sourceLabel }) => {
    // Single local skill path that resolveSkillSourceDir handled as one dir:
    // installSkillSource historically called installSkill(path) directly for
    // non-package dirs. withResolvedSkillPackage always returns skillDirs.
    if (
      skillDirs.length === 1 &&
      path.resolve(skillDirs[0]) === path.resolve(packageRoot) &&
      !(await pathExists(path.join(packageRoot, 'skills')))
    ) {
      const allow = normalizeSkillNameFilter(skillNames);
      if (allow) {
        const summary = await summarizeSkillDir(skillDirs[0]);
        if (!allow.has(summary.name)) {
          throw new Error(`No matching skills found for: ${[...allow].join(', ')}`);
        }
      }
      return [await installSkill(skillDirs[0], {
        scope,
        cwd,
        sourceLabel,
        packageInfo,
        packageRoot: null,
        includeHooks,
      })];
    }
    return installSkillDirs(skillDirs, {
      scope,
      cwd,
      sourceLabel,
      packageInfo,
      packageRoot,
      includeHooks,
      skillNames,
    });
  });
}

export async function updateSkillPackage({
  name = '',
  packageSource = '',
  scope = '',
  cwd = process.cwd(),
  resetHooks = false,
  includeHooks,
  skillNames = null,
} = {}) {
  const entries = await listSkillEntries({ scope: 'all', cwd });
  let skill = null;
  let source = String(packageSource || '').trim();
  let targetScope = String(scope || '').trim();

  if (name) {
    skill = entries.find((item) => item.name === name);
    if (!skill) {
      throw new Error(`skill not found: ${name}`);
    }
    if (skill.scope === 'builtin') {
      throw new Error(`cannot update builtin skill: ${name}`);
    }
    source = getSkillPackageUpdateSource(skill);
    targetScope = skill.scope;
  }

  if (!['global', 'project'].includes(targetScope)) {
    throw new Error('skill package update requires scope=project|global');
  }
  if (!packageSourceKey(source)) {
    throw new Error(`skill package source is not updatable: ${source || '(empty)'}`);
  }

  const baseDir = baseDirForScope(targetScope, cwd);
  const scopedEntries = await listSkillEntries({ scope: targetScope, cwd });
  const before = scopedEntries.filter((item) => skillBelongsToPackageUpdate(item, source));
  const preferences = getSkillRoutingPreferences(before);
  const selectedNames = normalizeSkillNameFilter(skillNames);
  // Default includeHooks: preserve prior import preference when omitted.
  const resolvedIncludeHooks = includeHooks === undefined
    ? before.some((item) => item.hooksImported !== false)
    : includeHooks === true;

  const preserveHooks = resetHooks !== true;
  const hooksSnapshots = new Map();
  if (preserveHooks) {
    for (const item of before) {
      if (selectedNames && !selectedNames.has(item.name)) continue;
      const snapshot = await snapshotSkillHooksDir(path.join(baseDir, item.name));
      if (snapshot) hooksSnapshots.set(item.name, snapshot);
    }
  }

  try {
    const installed = await installSkillSource(source, {
      scope: targetScope,
      cwd,
      includeHooks: resolvedIncludeHooks,
      skillNames: selectedNames ? [...selectedNames] : null,
    });
    // Only remove stale skills when updating the full package without an
    // explicit selection. Partial selection leaves unchecked locals untouched.
    if (!selectedNames) {
      const stale = getStaleSkillPackageNames(before, installed);
      await removeInstalledSkillEntries(baseDir, stale, targetScope);
    }

    for (const skillName of installed) {
      const skillDir = path.join(baseDir, skillName);
      const hasHooksSnapshot = preserveHooks && hooksSnapshots.has(skillName);
      const prior = preferences.get(skillName);
      if (!prior && !hasHooksSnapshot) continue;

      if (hasHooksSnapshot) {
        await restoreSkillHooksDir(skillDir, hooksSnapshots.get(skillName));
        const discovered = await discoverSkillHooks({ skillRoot: skillDir });
        await upsertSkillCatalogEntry(baseDir, skillName, {
          disableModelInvocation: discovered.disableModelInvocation,
          hooksProvenance: discovered.provenance,
        });
      }

      if (prior?.hooksImported === false) {
        await reconcileSkillHooksOnInstall(skillDir, { includeHooks: false });
        await upsertSkillCatalogEntry(baseDir, skillName, {
          hooksImported: false,
          hooksProvenance: {},
          disableModelInvocation: false,
        });
      }

      if (prior) {
        const patch = {
          mode: prior.mode,
          triggers: prior.triggers,
          enabled: prior.enabled,
        };
        if (prior.priority !== undefined) patch.priority = prior.priority;
        await upsertSkillCatalogEntry(baseDir, skillName, patch);
        await setSkillEnabledConfig(skillName, prior.enabled);
        if (targetScope === 'global') {
          await upsertSkillRegistryEntry(undefined, {
            name: skillName,
            enabled: prior.enabled,
          });
        }
      }
    }

    return {
      installed,
      packageSource: source,
      packageName: skill?.packageName || before[0]?.packageName || '',
      scope: targetScope,
      previouslyInstalled: before.map((item) => item.name),
      removed: selectedNames ? [] : getStaleSkillPackageNames(before, installed),
    };
  } finally {
    await Promise.all(
      [...hooksSnapshots.values()].map((dir) => fs.rm(dir, { recursive: true, force: true }))
    );
  }
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
    const documentMeta = await readSkillDocumentMeta(dir, entryFile);
    rebuilt.push({
      name: manifest?.name || name,
      version: manifest?.version || documentMeta.version || prior?.version || '0.0.0',
      description: manifest?.description || documentMeta.description || prior?.description || '',
      enabled: prior?.enabled !== false,
      source: prior?.source || 'reindex',
      packageSource: prior?.packageSource || prior?.source || '',
      packageName: prior?.packageName || '',
      entryFile,
      sha256: hash,
      installedAt: prior?.installedAt || new Date().toISOString()
    });
  }

  const catalog = await readSkillCatalogSafe(baseDir);
  catalog.version = catalog.version || 1;
  catalog.skills = catalog.skills || {};
  for (const item of rebuilt) {
    catalog.skills[item.name] = {
      ...(catalog.skills[item.name] || {}),
      description: item.description,
      mode: catalog.skills[item.name]?.mode || 'agent_requested',
      enabled: item.enabled !== false,
      ...(item.source ? { source: item.source } : {}),
      ...(item.packageSource ? { packageSource: item.packageSource } : {}),
      ...(item.packageName ? { packageName: item.packageName } : {}),
      triggers: Array.isArray(catalog.skills[item.name]?.triggers) ? catalog.skills[item.name].triggers : []
    };
  }
  if (scope === 'global') {
    await writeSkillRegistry(undefined, {
      version: 1,
      skills: rebuilt
    });
    await writeSkillCatalog(baseDir, catalog);
  } else if (scope === 'project') {
    await writeSkillCatalog(baseDir, catalog);
  }

  return rebuilt.length;
}

function usage() {
  console.log(`Usage:
  codemini skill list [--scope=all|project|global|builtin]
  codemini skill install [--scope=project|global] [--no-hooks] <path>
  codemini skill update <name>
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
    const includeHooks = !rest.includes('--no-hooks');
    const installArgs = rest.filter((arg) => arg !== '--no-hooks');
    const { scope, rest: positional } = parseScopeArgs(installArgs, { defaultScope: 'project' });
    const sourcePath = positional.join(' ').trim();
    if (!sourcePath) {
      throw new Error('skill install requires <path>');
    }
    const installedNames = await installSkillSource(sourcePath, { scope, includeHooks });
    console.log(`Installed skill${installedNames.length === 1 ? '' : 's'}: ${installedNames.join(', ')} (${scope})`);
    return;
  }

  if (sub === 'update') {
    const name = rest[0];
    if (!name) {
      throw new Error('skill update requires <name>');
    }
    const result = await updateSkillPackage({ name, cwd: process.cwd() });
    console.log(
      `Updated skill package${result.packageName ? ` ${result.packageName}` : ''}: ${result.installed.join(', ')} (${result.scope})`
    );
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
    if (meta.auxiliaryDirs?.length > 0) {
      console.log('Auxiliary directories:');
      for (const dir of meta.auxiliaryDirs) {
        console.log(`- ${dir.name}: ${dir.path}`);
      }
      console.log('');
    }
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
