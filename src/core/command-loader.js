import fs from 'node:fs';
import path from 'node:path';
import {
  getCommandsDir,
  getProjectCommandsDir,
  getSkillsDir
} from './paths.js';
import { readSkillRegistry } from './skill-registry.js';
import { normalizeSkillContexts, skillIsEligible } from './skill-contexts.js';

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

  const lines = metaRaw.split('\n');
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
    const raw = buffer.subarray(0, bytesRead).toString('utf8').replace(/\r\n/g, '\n');
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

function normalizeSkillMode(value) {
  const mode = String(value || '').trim();
  if (mode === 'auto_attach') return 'agent_requested';
  return mode;
}

function resolveSkillIndexMode(metadata = {}, source = '') {
  const mode = normalizeSkillMode(metadata.mode);
  if (mode === 'manual' || mode === 'always' || mode === 'agent_requested') return mode;
  if (source === 'registry-skill' || source === 'global-skill') {
    return 'agent_requested';
  }
  return mode || 'agent_requested';
}

export function isSkillIndexEligible(command) {
  if (command?.metadata?.type !== 'skill') return false;
  return resolveSkillIndexMode(command.metadata, command.source) === 'agent_requested';
}

export function isUserInvocableSkill(command) {
  if (command?.metadata?.type !== 'skill') return false;
  const metadata = command.metadata || {};
  if (Object.prototype.hasOwnProperty.call(metadata, 'userInvocable')) {
    return metadata.userInvocable !== false && String(metadata.userInvocable).trim().toLowerCase() !== 'false';
  }
  if (Object.prototype.hasOwnProperty.call(metadata, 'user-invocable')) {
    return metadata['user-invocable'] !== false
      && String(metadata['user-invocable']).trim().toLowerCase() !== 'false';
  }
  return true;
}

function normalizeBooleanFlag(value) {
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

export function isSkillModelInvocationDisabled(command) {
  const metadata = command?.metadata || {};
  return (
    normalizeBooleanFlag(metadata.disableModelInvocation) ||
    normalizeBooleanFlag(metadata['disable-model-invocation'])
  );
}

function catalogMetadata(catalog, name) {
  const entry = catalog?.[name];
  if (!entry || typeof entry !== 'object') return {};
  const has = (key) => Object.prototype.hasOwnProperty.call(entry, key);
  return {
    ...(entry.description ? { description: String(entry.description) } : {}),
    ...(has('mode') && entry.mode ? { mode: normalizeSkillMode(entry.mode) } : {}),
    ...(has('enabled') ? { enabled: entry.enabled !== false } : {}),
    ...(has('disableModelInvocation')
      ? { disableModelInvocation: normalizeBooleanFlag(entry.disableModelInvocation) }
      : {}),
    ...(has('userInvocable')
      ? { userInvocable: entry.userInvocable !== false }
      : {}),
    ...(has('routingAuthorLocked')
      ? { routingAuthorLocked: entry.routingAuthorLocked === true }
      : {}),
    ...(has('hooksImported') ? { hooksImported: entry.hooksImported !== false } : {}),
    ...(has('priority') && entry.priority !== undefined ? { priority: Number(entry.priority) } : {}),
    ...(entry.source ? { source: String(entry.source) } : {}),
    ...(entry.packageSource ? { packageSource: String(entry.packageSource) } : {}),
    ...(entry.packageName ? { packageName: String(entry.packageName) } : {}),
    ...(entry.installedAt ? { installedAt: String(entry.installedAt) } : {}),
    // Only overlay triggers when the catalog explicitly stores them, so a missing
    // key does not wipe SKILL.md frontmatter triggers with [].
    ...(has('triggers') ? { triggers: normalizeStringArray(entry.triggers) } : {}),
  };
}

function listExistingSkillDirs(skillRoot) {
  const dirs = [];
  for (const name of ['references', 'scripts', 'assets']) {
    const full = path.join(skillRoot, name);
    try {
      if (fs.statSync(full).isDirectory()) dirs.push({ name, path: full });
    } catch {
      continue;
    }
  }
  return dirs;
}

function renderSkillPackageContext(command) {
  if (command.metadata?.type !== 'skill') return '';
  const root = command.metadata?.rootPath || path.dirname(command.path);
  const dirs = listExistingSkillDirs(root);
  const lines = [
    '<codemini-skill-package>',
    `Skill root: ${root}`,
    `Entry file: ${command.path}`
  ];
  if (dirs.length > 0) {
    lines.push('Auxiliary directories:');
    for (const dir of dirs) {
      lines.push(`- ${dir.name}: ${dir.path}`);
    }
    lines.push('Load reference files or run scripts from these paths only when the skill instructions call for them.');
  } else {
    lines.push('Auxiliary directories: none detected.');
  }
  lines.push('</codemini-skill-package>');
  return lines.join('\n');
}

function commandWithContent(command, parsedContent) {
  const withPackageContext = (content) => {
    if (command.metadata?.type !== 'skill') return content;
    return `${content}\n\n${renderSkillPackageContext(command)}`;
  };

  if (parsedContent !== undefined) {
    return { ...command, content: withPackageContext(parsedContent) };
  }

  let cached;
  let loaded = false;
  return Object.defineProperty({ ...command }, 'content', {
    enumerable: true,
    configurable: true,
    get() {
      if (!loaded) {
        const raw = fs.readFileSync(command.path, 'utf8');
        cached = withPackageContext(parseFrontmatter(raw).content);
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
        rootPath: full,
        entryFile: 'SKILL.md',
        description: catalogMeta.description || frontmatter.description || 'Legacy skill',
        type: 'skill'
      }
    }));
  }
}

function loadIndexedSkillsFromCatalog(baseDir, source, out) {
  if (!fs.existsSync(baseDir)) return;
  const catalog = readSkillCatalog(baseDir);
  for (const entry of Object.keys(catalog)) {
    if (!isSafeEntry(entry)) continue;
    const full = path.join(baseDir, entry);
    const skillFile = path.join(full, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const catalogMeta = catalogMetadata(catalog, entry);
    const frontmatter = readFrontmatterMetadata(skillFile);
    setCommand(out, entry, commandWithContent({
      name: entry,
      source,
      path: skillFile,
      metadata: {
        ...frontmatter,
        ...catalogMeta,
        type: 'skill',
        rootPath: full,
        entryFile: 'SKILL.md',
        version: frontmatter.version || '0.0.0',
        description: catalogMeta.description || frontmatter.description || 'Indexed skill'
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
    const root = path.join(baseDir, name);
    setCommand(out, name, commandWithContent({
      name,
      source: 'registry-skill',
      path: full,
      metadata: {
        ...frontmatter,
        ...catalogMeta,
        type: 'skill',
        rootPath: root,
        entryFile: entry,
        source: catalogMeta.source || skill.source || '',
        packageSource: catalogMeta.packageSource || skill.packageSource || skill.source || '',
        packageName: catalogMeta.packageName || skill.packageName || '',
        installedAt: catalogMeta.installedAt || skill.installedAt || '',
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

  loadMarkdownCommandsFromDir(getCommandsDir(), 'global', commands);
  loadMarkdownCommandsFromDir(getProjectCommandsDir(cwd), 'project', commands);
  loadLegacySkillsFromDir(getSkillsDir(), 'global', commands);
  const registry = await readSkillRegistry();
  loadInstalledSkillsFromRegistry(getSkillsDir(), registry, commands);

  return commands;
}

export async function loadIndexedSkills(cwd = process.cwd()) {
  const commands = new Map();

  loadIndexedSkillsFromCatalog(getSkillsDir(), 'global-skill', commands);

  const registry = await readSkillRegistry();
  loadInstalledSkillsFromRegistry(getSkillsDir(), registry, commands);

  for (const command of commands.values()) {
    if (command.metadata?.type !== 'skill') continue;
    command.metadata.mode = resolveSkillIndexMode(command.metadata, command.source);
  }

  return commands;
}

function skillScopeLabel(source = '') {
  if (source === 'bundled-skill') return 'builtin';
  if (source === 'global-skill' || source === 'registry-skill') return 'global';
  return source || 'unknown';
}

function isIndexedSkillEnabledForPrompt(command, config = {}, executionMode = config?.execution?.mode) {
  return skillIsEligible(config?.skills, command?.name, executionMode, command);
}

function formatSkillIndexPromptLine(command) {
  const desc = String(command.metadata?.description || '').trim().replace(/\s+/g, ' ');
  const triggers = Array.isArray(command.metadata?.triggers)
    ? command.metadata.triggers.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  let line = `- /${command.name}`;
  if (desc) line += ` - ${desc}`;
  if (triggers.length) line += ` (triggers: ${triggers.join(', ')})`;
  return line;
}

function skillIndexConfiguredContexts(config = {}, command) {
  const stored = config?.skills?.contexts?.[command?.name];
  if (stored !== undefined) return normalizeSkillContexts(stored);
  const source = String(command?.source || '');
  if (source.startsWith('bundled')) return ['coding'];
  return ['coding', 'daily'];
}

/** Debug-oriented index entries (frontmatter + runtime routing fields). */
export async function buildSkillIndexDebugEntries(cwd = process.cwd(), config = {}, executionMode = config?.execution?.mode) {
  const indexed = await loadIndexedSkills(cwd);
  return Array.from(indexed.values())
    .filter((command) => isSkillIndexEligible(command))
    .filter((command) => isIndexedSkillEnabledForPrompt(command, config, executionMode))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((command) => {
      const metadata = { ...(command.metadata || {}) };
      const mode = resolveSkillIndexMode(metadata, command.source);
      return {
        name: command.name,
        source: command.source,
        path: command.path,
        scope: skillScopeLabel(command.source),
        mode,
        contexts: skillIndexConfiguredContexts(config, command),
        enabled: config?.skills?.enabled?.[command.name] !== false,
        disableModelInvocation: isSkillModelInvocationDisabled(command),
        description: metadata.description || '',
        triggers: Array.isArray(metadata.triggers) ? metadata.triggers : [],
        metadata,
        promptLine: formatSkillIndexPromptLine(command),
      };
    });
}

export async function buildSkillIndexPromptBlock(
  cwd = process.cwd(),
  config = {},
  executionMode = config?.execution?.mode,
  options = {},
) {
  const entries = (await buildSkillIndexDebugEntries(cwd, config, executionMode))
    .filter((entry) => options.modelInvocableOnly !== true || !entry.disableModelInvocation);
  return formatSkillIndexPromptBlock(entries);
}

function formatSkillIndexPromptBlock(entries = []) {
  const lines = entries.map((entry) => entry.promptLine);
  if (!lines.length) return '';
  return [
    '# Indexed skills',
    'Agent-requested skills installed by the user are listed here. Always skills are injected in full and manual skills require explicit invocation, so neither appears in this index. Load full instructions with skill({name:"<name>"}). Search with skill({query:"..."}).',
    ...lines
  ].join('\n');
}

/** Developer debug preview of the index for global / coding / daily panel tabs. */
export async function buildSkillIndexPreview(cwd = process.cwd(), config = {}) {
  const codingExecution = await buildSkillIndexDebugEntries(cwd, config, 'code');
  const dailyExecution = await buildSkillIndexDebugEntries(cwd, config, 'normal');

  const isGlobalBound = (entry) => {
    const contexts = Array.isArray(entry.contexts) ? entry.contexts : [];
    return contexts.includes('coding') && contexts.includes('daily');
  };
  const isCodingOnly = (entry) => {
    const contexts = Array.isArray(entry.contexts) ? entry.contexts : [];
    return contexts.includes('coding') && !contexts.includes('daily');
  };
  const isDailyOnly = (entry) => {
    const contexts = Array.isArray(entry.contexts) ? entry.contexts : [];
    return contexts.includes('daily') && !contexts.includes('coding');
  };

  // Panel tabs are mutually exclusive (same as SkillPanel).
  const globalSkills = codingExecution.filter(isGlobalBound);
  const codingOnly = codingExecution.filter(isCodingOnly);
  const dailyOnly = dailyExecution.filter(isDailyOnly);

  return {
    global: {
      context: 'global',
      note: 'Panel global tab only. Runtime: still injected into both coding and daily execution indexes.',
      count: globalSkills.length,
      skills: globalSkills,
      promptCoding: formatSkillIndexPromptBlock(
        codingExecution.filter((entry) => globalSkills.some((item) => item.name === entry.name)),
      ),
      promptDaily: formatSkillIndexPromptBlock(
        dailyExecution.filter((entry) => globalSkills.some((item) => item.name === entry.name)),
      ),
    },
    coding: {
      context: 'coding',
      note: 'Panel coding tab (coding-only). Global-bound skills are excluded from this list.',
      count: codingOnly.length,
      skills: codingOnly,
      prompt: formatSkillIndexPromptBlock(codingOnly),
      executionPrompt: formatSkillIndexPromptBlock(codingExecution),
    },
    daily: {
      context: 'daily',
      note: 'Panel daily tab (daily-only). Global-bound skills are excluded from this list.',
      count: dailyOnly.length,
      skills: dailyOnly,
      prompt: formatSkillIndexPromptBlock(dailyOnly),
      executionPrompt: formatSkillIndexPromptBlock(dailyExecution),
    },
    empty:
      globalSkills.length === 0 &&
      codingOnly.length === 0 &&
      dailyOnly.length === 0,
  };
}

export function renderCommandPrompt(command, args) {
  const hasArgPlaceholders = /\{\{args\}\}/.test(command.content) || /\{\{\d+\}\}/.test(command.content);
  let content = substituteVariables(command.content, args);
  if (!hasArgPlaceholders && Array.isArray(args) && args.length > 0) {
    content = `${content}\n\n[User task]\n${args.join(' ')}`;
  }
  return `[Executing ${command.metadata.type === 'skill' ? 'skill' : 'command'}: /${command.name}]\n\n${content}`;
}

export function composeExplicitSkillPrompt(commands, names, question, { isEnabled } = {}) {
  const selected = [];
  for (const name of names || []) {
    const command = commands?.get?.(name);
    if (!command || !isUserInvocableSkill(command)) {
      return { error: `Unknown or unavailable skill: ${name}` };
    }
    if (typeof isEnabled === 'function' && !isEnabled(command)) {
      return { error: `Skill is disabled: ${name}` };
    }
    selected.push(command);
  }
  const task = String(question || '').trim();
  if (selected.length === 0) return { error: 'skill:[...] requires at least one skill name.' };
  const effectiveTask = task ||
    'Begin the selected skill workflow. If required information is missing, ask the user for it.';
  const prompt = [
    '[Explicit skill composition]',
    'Apply every selected skill. Preserve declaration order. If instructions conflict, explain the conflict instead of silently overriding one skill.',
    ...selected.map((command) => renderCommandPrompt(command, [])),
    `[User task]\n${effectiveTask}`
  ].join('\n\n');
  return { prompt, selected };
}
