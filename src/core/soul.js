import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBaseConfigDir } from './paths.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SOULS_DIR = path.resolve(MODULE_DIR, '..', '..', 'souls');
const SOUL_CATEGORIES = ['coding', 'daily'];

function getCustomSoulsDir() {
  return path.join(getBaseConfigDir(), 'souls');
}

export { BUNDLED_SOULS_DIR, getCustomSoulsDir, SOUL_CATEGORIES };

export function normalizeSoulCategory(value, fallback = 'coding') {
  const category = String(value || '').trim().toLowerCase();
  return SOUL_CATEGORIES.includes(category) ? category : fallback;
}

export function soulContextFromExecutionMode(mode = 'normal') {
  const normalized = String(mode || '').trim().toLowerCase();
  return ['plan', 'code', 'coding', 'spec'].includes(normalized) ? 'coding' : 'daily';
}

function normalizeSoulName(value) {
  const name = String(value || '').trim();
  return name || 'Default';
}

export function soulNameEquals(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function resolveCustomSoulPath(customPath = '') {
  const raw = String(customPath || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) return raw;
  return path.join(getBaseConfigDir(), raw);
}

async function resolveSoulFilePath(dir, name, category = '') {
  const requested = String(name || '').trim();
  if (!requested) return '';

  const tryDir = async (targetDir) => {
    const directPath = path.join(targetDir, `${requested}.md`);
    try {
      await fs.access(directPath);
      return directPath;
    } catch {}
    try {
      const entries = await fs.readdir(targetDir);
      const expected = `${requested}.md`.toLowerCase();
      const match = entries.find((file) => file.toLowerCase() === expected);
      return match ? path.join(targetDir, match) : '';
    } catch {
      return '';
    }
  };

  const preferred = normalizeSoulCategory(category, '');
  const searchOrder = preferred
    ? [preferred, ...SOUL_CATEGORIES.filter((item) => item !== preferred), '']
    : [...SOUL_CATEGORIES, ''];

  for (const item of searchOrder) {
    const targetDir = item ? path.join(dir, item) : dir;
    const found = await tryDir(targetDir);
    if (found) return found;
  }
  return '';
}

async function readSoulPreset(dir, preset, category = '') {
  const filePath = await resolveSoulFilePath(dir, preset, category);
  if (!filePath) return { content: '', category: '', filePath: '' };
  const content = await fs.readFile(filePath, 'utf8');
  const relative = path.relative(dir, filePath);
  const parts = relative.split(/[/\\]/);
  const resolvedCategory = SOUL_CATEGORIES.includes(parts[0]) ? parts[0] : 'coding';
  return {
    content: String(content || '').trim(),
    category: resolvedCategory,
    filePath,
  };
}

async function listSoulEntriesInRoot(rootDir, scope) {
  const souls = [];
  const pushFile = async (filePath, category) => {
    const base = path.basename(filePath);
    if (!base.toLowerCase().endsWith('.md')) return;
    const name = base.slice(0, -3);
    const content = await fs.readFile(filePath, 'utf8');
    souls.push({
      name,
      category: normalizeSoulCategory(category, 'coding'),
      scope,
      preview: String(content || '').split('\n').slice(0, 3).join('\n').slice(0, 120),
      content: String(content || ''),
    });
  };

  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && SOUL_CATEGORIES.includes(entry.name)) {
        const categoryDir = path.join(rootDir, entry.name);
        const files = await fs.readdir(categoryDir);
        for (const file of files) {
          await pushFile(path.join(categoryDir, file), entry.name);
        }
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        // Legacy flat custom souls → treat as daily (entertainment) by default.
        await pushFile(path.join(rootDir, entry.name), scope === 'custom' ? 'daily' : 'coding');
      }
    }
  } catch {}
  return souls;
}

export function getActiveSoulName(config = {}, category = 'coding') {
  const soul = config?.soul || {};
  const key = normalizeSoulCategory(category, 'coding');
  const fromCategory = String(soul?.[key] || '').trim();
  if (fromCategory) return normalizeSoulName(fromCategory);
  const legacy = String(soul?.preset || '').trim();
  if (legacy) return normalizeSoulName(legacy);
  return key === 'daily' ? 'Playful' : 'Default';
}

export async function listSouls(config = {}) {
  const activeByCategory = {
    coding: getActiveSoulName(config, 'coding'),
    daily: getActiveSoulName(config, 'daily'),
  };
  const bundled = await listSoulEntriesInRoot(BUNDLED_SOULS_DIR, 'builtin');
  const custom = await listSoulEntriesInRoot(getCustomSoulsDir(), 'custom');
  const seen = new Set();
  const souls = [];
  for (const soul of [...custom, ...bundled]) {
    const key = `${soul.scope}:${soul.category}:${soul.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    souls.push({
      name: soul.name,
      category: soul.category,
      scope: soul.scope,
      preview: soul.preview,
      active: soulNameEquals(soul.name, activeByCategory[soul.category]),
    });
  }
  souls.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.scope !== b.scope) return a.scope === 'builtin' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return souls;
}

export async function readSoulContent(name, { preferCategory = '' } = {}) {
  const requested = String(name || '').trim();
  if (!requested) throw new Error('Missing soul name');
  const customPath = await resolveSoulFilePath(getCustomSoulsDir(), requested, preferCategory);
  if (customPath) {
    const content = await fs.readFile(customPath, 'utf8');
    const relative = path.relative(getCustomSoulsDir(), customPath);
    const parts = relative.split(/[/\\]/);
    const category = SOUL_CATEGORIES.includes(parts[0]) ? parts[0] : 'daily';
    return { name: path.basename(customPath, '.md'), content, scope: 'custom', category };
  }
  const bundledPath = await resolveSoulFilePath(BUNDLED_SOULS_DIR, requested, preferCategory);
  if (!bundledPath) throw new Error(`Soul not found: ${requested}`);
  const content = await fs.readFile(bundledPath, 'utf8');
  const relative = path.relative(BUNDLED_SOULS_DIR, bundledPath);
  const parts = relative.split(/[/\\]/);
  const category = SOUL_CATEGORIES.includes(parts[0]) ? parts[0] : 'coding';
  return { name: path.basename(bundledPath, '.md'), content, scope: 'builtin', category };
}

export async function createSoul({ name, content, category = 'daily' } = {}) {
  const safeName = String(name || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeName) throw new Error('Invalid name');
  if (!String(content || '').trim()) throw new Error('Missing content');
  const resolvedCategory = normalizeSoulCategory(category, 'daily');
  const bundledCheck = await resolveSoulFilePath(BUNDLED_SOULS_DIR, safeName);
  if (bundledCheck) throw new Error('Name conflicts with builtin soul');
  const customDir = path.join(getCustomSoulsDir(), resolvedCategory);
  await fs.mkdir(customDir, { recursive: true });
  const existing = await resolveSoulFilePath(getCustomSoulsDir(), safeName);
  if (existing) throw new Error('Soul already exists');
  await fs.writeFile(path.join(customDir, `${safeName}.md`), content, 'utf8');
  return { ok: true, name: safeName, category: resolvedCategory };
}

export async function updateSoulContent(name, content) {
  if (!String(content || '').trim()) throw new Error('Missing content');
  const customPath = await resolveSoulFilePath(getCustomSoulsDir(), name);
  if (!customPath) throw new Error('Custom soul not found');
  await fs.writeFile(customPath, content, 'utf8');
  return { ok: true };
}

export async function deleteSoul(name) {
  const bundledPath = await resolveSoulFilePath(BUNDLED_SOULS_DIR, name);
  if (bundledPath) throw new Error('Cannot delete builtin soul');
  const customPath = await resolveSoulFilePath(getCustomSoulsDir(), name);
  if (!customPath) throw new Error('Custom soul not found');
  await fs.unlink(customPath);
  return { ok: true };
}

export async function loadSoulPrompt(config = {}, { context } = {}) {
  const customPath = resolveCustomSoulPath(config?.soul?.custom_path);
  if (customPath) {
    try {
      const content = await fs.readFile(customPath, 'utf8');
      const text = String(content || '').trim();
      if (text) {
        return {
          prompt: `[Soul custom]\n${text}`,
          category: normalizeSoulCategory(context, 'coding'),
          name: 'custom',
        };
      }
    } catch {
      // fall through to preset
    }
  }

  const category = normalizeSoulCategory(
    context || soulContextFromExecutionMode(config?.execution?.mode),
    'coding',
  );
  const preset = getActiveSoulName(config, category);

  for (const dir of [getCustomSoulsDir(), BUNDLED_SOULS_DIR]) {
    try {
      const result = await readSoulPreset(dir, preset, category);
      if (result.content) {
        return {
          prompt: `[Soul preset: ${preset} · ${result.category}]\n${result.content}`,
          category: result.category,
          name: preset,
        };
      }
    } catch {}
  }

  const fallbackName = category === 'daily' ? 'Playful' : 'Default';
  const fallback = await readSoulPreset(BUNDLED_SOULS_DIR, fallbackName, category);
  return {
    prompt: `[Soul preset: ${fallbackName} · ${fallback.category || category}]\n${String(fallback.content || '').trim()}`,
    category: fallback.category || category,
    name: fallbackName,
  };
}

function buildSoulGuard(category = 'coding') {
  if (category === 'daily') {
    return [
      '[Soul guard]',
      'Apply this soul to response tone and personality only.',
      'Tone only: do not change plans, code, tests, file formats, or technical decisions for entertainment flavor.',
      'This tone directive has HIGH priority. Stay in character consistently unless the user explicitly requests a change.',
      'Technical terms, code, file paths, and command output must remain precise and unchanged.',
    ].join('\n');
  }
  return [
    '[Soul guard]',
    'Apply this coding soul to tone AND coding approach (how you plan, write, and refactor).',
    'Follow the soul methodology when it shapes engineering choices (YAGNI, terseness, seniority, etc.).',
    'Never sacrifice correctness, security, data safety, or explicit user requirements.',
    'Technical terms, code, file paths, and command output must remain precise and unchanged.',
    'This directive has HIGH priority. Stay consistent unless the user explicitly requests a change.',
  ].join('\n');
}

export async function buildSystemPromptWithSoul(baseSystemPrompt, config = {}, options = {}) {
  const loaded = await loadSoulPrompt(config, options);
  const guard = buildSoulGuard(loaded.category);
  return [String(baseSystemPrompt || '').trim(), loaded.prompt, guard].filter(Boolean).join('\n\n').trim();
}
