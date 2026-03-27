import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCommandsDir,
  getLegacyGlobalSkillsDir,
  getLegacyProjectSkillsDir,
  getProjectCommandsDir,
  getSkillsDir
} from './paths.js';
import { readSkillRegistry } from './skill-registry.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS_DIR = path.resolve(MODULE_DIR, '..', '..', 'skills');

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
        out.set(entry, {
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
      out.set(name, {
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
  for (const entry of safeEntries(baseDir)) {
    if (!isSafeEntry(entry)) continue;
    const full = path.join(baseDir, entry);
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) continue;
    const skillFile = path.join(full, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const raw = fs.readFileSync(skillFile, 'utf8');
    const parsed = parseFrontmatter(raw);
    out.set(entry, {
      name: entry,
      source: `${source}-skill`,
      path: skillFile,
      metadata: {
        description: parsed.metadata.description || 'Legacy skill',
        type: 'skill'
      },
      content: parsed.content
    });
  }
}

function loadBundledSkillsFromDir(baseDir, out) {
  if (!fs.existsSync(baseDir)) return;
  for (const entry of safeEntries(baseDir)) {
    if (!isSafeEntry(entry)) continue;
    const full = path.join(baseDir, entry);
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) continue;
    const skillFile = path.join(full, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const raw = fs.readFileSync(skillFile, 'utf8');
    const parsed = parseFrontmatter(raw);
    out.set(entry, {
      name: entry,
      source: 'bundled-skill',
      path: skillFile,
      metadata: {
        ...parsed.metadata,
        type: 'skill',
        version: parsed.metadata.version || '0.1.0',
        description: parsed.metadata.description || 'Bundled skill'
      },
      content: parsed.content
    });
  }
}

function loadInstalledSkillsFromRegistry(baseDir, registry, out) {
  if (!registry || !Array.isArray(registry.skills)) return;
  for (const skill of registry.skills) {
    if (skill.enabled === false) continue;
    const name = skill.name;
    const entry = skill.entryFile || 'SKILL.md';
    const full = path.join(baseDir, name, entry);
    if (!fs.existsSync(full)) continue;
    const raw = fs.readFileSync(full, 'utf8');
    const parsed = parseFrontmatter(raw);
    out.set(name, {
      name,
      source: 'registry-skill',
      path: full,
      metadata: {
        ...parsed.metadata,
        type: 'skill',
        version: skill.version || parsed.metadata.version || '0.0.0',
        description: skill.description || parsed.metadata.description || 'Installed skill'
      },
      content: parsed.content
    });
  }
}

function substituteVariables(text, args = []) {
  let out = text;
  args.forEach((arg, index) => {
    out = out.replaceAll(`{{${index + 1}}}`, arg);
  });
  out = out.replaceAll('{{args}}', args.join(' '));
  out = out.replaceAll('{{cwd}}', process.cwd());
  return out;
}

export async function loadCommandsAndSkills(cwd = process.cwd()) {
  const commands = new Map();

  loadBundledSkillsFromDir(BUNDLED_SKILLS_DIR, commands);
  loadMarkdownCommandsFromDir(getCommandsDir(), 'global', commands);
  loadMarkdownCommandsFromDir(getProjectCommandsDir(cwd), 'project', commands);
  loadLegacySkillsFromDir(getLegacyGlobalSkillsDir(), 'global', commands);
  loadLegacySkillsFromDir(getLegacyProjectSkillsDir(cwd), 'project', commands);
  const registry = await readSkillRegistry();
  loadInstalledSkillsFromRegistry(getSkillsDir(), registry, commands);

  return commands;
}

export function renderCommandPrompt(command, args) {
  return `[Executing ${command.metadata.type === 'skill' ? 'skill' : 'command'}: /${command.name}]\n\n${substituteVariables(command.content, args)}`;
}
