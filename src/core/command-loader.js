import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCommandsDir,
  getProjectCommandsDir,
  getProjectSkillsDir,
  getSkillsDir
} from './paths.js';
import { readSkillRegistry } from './skill-registry.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS_DIR = path.resolve(MODULE_DIR, '..', '..', 'skills');
const SKILL_CATALOG_FILE = 'codemini.skills.json';
const FRONTMATTER_READ_BYTES = 16 * 1024;

function parseArrayText(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((item) => item.trim().replace(/^["']|["']$/g, ''));
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) {
    return { metadata: {}, content: raw };
  }
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) {
    return { metadata: {}, content: raw };
  }

  const metaRaw = raw.slice(4, end).trim();
  const content = raw.slice(end + 5).trim();
  const metadata = {};

  for (const line of metaRaw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      metadata[key] = parseArrayText(value);
    } else {
      metadata[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return { metadata, content };
}

function readFrontmatterMetadata(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(FRONTMATTER_READ_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const raw = buffer.subarray(0, bytesRead).toString('utf8');
    if (!raw.startsWith('---\n')) return {};
    const end = raw.indexOf('\n---\n', 4);
    if (end === -1) return {};
    return parseFrontmatter(raw.slice(0, end + 5)).metadata;
  } catch {
    return {};
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function readSkillCatalog(baseDir) {
  const catalogPath = path.join(baseDir, SKILL_CATALOG_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.skills && typeof parsed.skills === 'object'
      ? parsed.skills
      : {};
  } catch {
    return {};
  }
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function catalogMetadata(catalog, name) {
  const entry = catalog?.[name];
  if (!entry || typeof entry !== 'object') return {};
  return {
    ...(entry.description ? { description: String(entry.description) } : {}),
    ...(entry.mode ? { mode: String(entry.mode) } : {}),
    ...(entry.enabled !== undefined ? { enabled: entry.enabled !== false } : {}),
    ...(entry.priority !== undefined ? { priority: Number(entry.priority) } : {}),
    triggers: normalizeStringArray(entry.triggers)
  };
}

function commandWithContent(command, parsedContent) {
  if (parsedContent !== undefined) {
    return { ...command, content: parsedContent };
  }

  let cached;
  let loaded = false;
  return Object.defineProperty({ ...command }, 'content', {
    enumerable: true,
    configurable: true,
    get() {
      if (!loaded) {
        const raw = fs.readFileSync(command.path, 'utf8');
        cached = parseFrontmatter(raw).content;
        loaded = true;
      }
      return cached;
    }
  });
}

function safeEntries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isSafeEntry(entry) {
  return entry !== '.' && entry !== '..' && !entry.includes('/') && !entry.includes('\\');
}

function setCommand(out, name, command) {
  const existing = out.get(name);
  if (existing?.source === 'bundled-skill') return;
  out.set(name, command);
}

function loadMarkdownCommandsFromDir(baseDir, source, out) {
  if (!fs.existsSync(baseDir)) return;
  for (const entry of safeEntries(baseDir)) {
    if (!isSafeEntry(entry)) continue;
    const full = path.join(baseDir, entry);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      const commandFile = path.join(full, `${entry}.md`);
      if (fs.existsSync(commandFile)) {
        const raw = fs.readFileSync(commandFile, 'utf8');
        const parsed = parseFrontmatter(raw);
        setCommand(out, entry, {
          name: entry,
          source,
          path: commandFile,
          metadata: parsed.metadata,
          content: parsed.content
        });
      }
      continue;
    }

    if (entry.endsWith('.md')) {
      const name = entry.replace(/\.md$/, '');
      const raw = fs.readFileSync(full, 'utf8');
      const parsed = parseFrontmatter(raw);
      setCommand(out, name, {
        name,
        source,
        path: full,
        metadata: parsed.metadata,
        content: parsed.content
      });
    }
  }
}

function loadLegacySkillsFromDir(baseDir, source, out) {
  if (!fs.existsSync(baseDir)) return;
  const catalog = readSkillCatalog(baseDir);
  for (const entry of safeEntries(baseDir)) {
    if (!isSafeEntry(entry)) continue;
    const full = path.join(baseDir, entry);
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) continue;
    const catalogMeta = catalogMetadata(catalog, entry);
    const skillFile = path.join(full, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const frontmatter = readFrontmatterMetadata(skillFile);
    setCommand(out, entry, commandWithContent({
      name: entry,
      source: `${source}-skill`,
      path: skillFile,
      metadata: {
        ...frontmatter,
        ...catalogMeta,
        description: catalogMeta.description || frontmatter.description || 'Legacy skill',
        type: 'skill'
      }
    }));
  }
}

function loadBundledSkillsFromDir(baseDir, out) {
  if (!fs.existsSync(baseDir)) return;
  const catalog = readSkillCatalog(baseDir);
  for (const entry of safeEntries(baseDir)) {
    if (!isSafeEntry(entry)) continue;
    const full = path.join(baseDir, entry);
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) continue;
    const catalogMeta = catalogMetadata(catalog, entry);
    const skillFile = path.join(full, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const frontmatter = readFrontmatterMetadata(skillFile);
    setCommand(out, entry, commandWithContent({
      name: entry,
      source: 'bundled-skill',
      path: skillFile,
      metadata: {
        ...frontmatter,
        ...catalogMeta,
        type: 'skill',
        version: frontmatter.version || '0.1.0',
        description: catalogMeta.description || frontmatter.description || 'Bundled skill'
      }
    }));
  }
}

function applySkillCatalogPatches(baseDir, out) {
  const catalog = readSkillCatalog(baseDir);
  for (const name of Object.keys(catalog)) {
    const existing = out.get(name);
    if (!existing || existing.metadata?.type !== 'skill') continue;
    const meta = catalogMetadata(catalog, name);
    existing.metadata = {
      ...existing.metadata,
      ...meta,
      description: meta.description || existing.metadata.description || ''
    };
  }
}

function loadInstalledSkillsFromRegistry(baseDir, registry, out) {
  if (!registry || !Array.isArray(registry.skills)) return;
  const catalog = readSkillCatalog(baseDir);
  for (const skill of registry.skills) {
    if (skill.enabled === false) continue;
    const name = skill.name;
    if (out.has(name)) continue;
    const catalogMeta = catalogMetadata(catalog, name);
    const entry = skill.entryFile || 'SKILL.md';
    const full = path.join(baseDir, name, entry);
    if (!fs.existsSync(full)) continue;
    const frontmatter = readFrontmatterMetadata(full);
    setCommand(out, name, commandWithContent({
      name,
      source: 'registry-skill',
      path: full,
      metadata: {
        ...frontmatter,
        ...catalogMeta,
        type: 'skill',
        version: skill.version || frontmatter.version || '0.0.0',
        description: catalogMeta.description || skill.description || frontmatter.description || 'Installed skill'
      }
    }));
  }
}

export function formatLocalDate(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function substituteVariables(text, args = []) {
  let out = text;
  args.forEach((arg, index) => {
    out = out.replaceAll(`{{${index + 1}}}`, arg);
  });
  out = out.replaceAll('{{args}}', args.join(' '));
  out = out.replaceAll('{{cwd}}', process.cwd());
  out = out.replaceAll('{{date}}', formatLocalDate());
  return out;
}

export async function loadCommandsAndSkills(cwd = process.cwd()) {
  const commands = new Map();

  loadBundledSkillsFromDir(BUNDLED_SKILLS_DIR, commands);
  applySkillCatalogPatches(getProjectSkillsDir(cwd), commands);
  loadMarkdownCommandsFromDir(getCommandsDir(), 'global', commands);
  loadMarkdownCommandsFromDir(getProjectCommandsDir(cwd), 'project', commands);
  loadLegacySkillsFromDir(getSkillsDir(), 'global', commands);
  loadLegacySkillsFromDir(getProjectSkillsDir(cwd), 'project', commands);
  applySkillCatalogPatches(getProjectSkillsDir(cwd), commands);
  const registry = await readSkillRegistry();
  loadInstalledSkillsFromRegistry(getSkillsDir(), registry, commands);

  return commands;
}

export function renderCommandPrompt(command, args) {
  return `[Executing ${command.metadata.type === 'skill' ? 'skill' : 'command'}: /${command.name}]\n\n${substituteVariables(command.content, args)}`;
}
