import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBaseConfigDir } from './paths.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SOULS_DIR = path.resolve(MODULE_DIR, '..', '..', 'souls');

function normalizeSoulName(value) {
  const name = String(value || '').trim().toLowerCase();
  return name || 'default';
}

function resolveCustomSoulPath(customPath = '') {
  const raw = String(customPath || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) return raw;
  return path.join(getBaseConfigDir(), raw);
}

export async function loadSoulPrompt(config = {}) {
  const customPath = resolveCustomSoulPath(config?.soul?.custom_path);
  if (customPath) {
    try {
      const content = await fs.readFile(customPath, 'utf8');
      const text = String(content || '').trim();
      if (text) return `[Soul custom]\n${text}`;
    } catch {
      // fall through to bundled preset
    }
  }

  const preset = normalizeSoulName(config?.soul?.preset);
  const presetPath = path.join(BUNDLED_SOULS_DIR, `${preset}.md`);
  try {
    const content = await fs.readFile(presetPath, 'utf8');
    const text = String(content || '').trim();
    if (text) return `[Soul preset: ${preset}]\n${text}`;
  } catch {
    // fall through to default preset
  }

  const defaultContent = await fs.readFile(path.join(BUNDLED_SOULS_DIR, 'default.md'), 'utf8');
  return `[Soul preset: default]\n${String(defaultContent || '').trim()}`;
}

export async function buildSystemPromptWithSoul(baseSystemPrompt, config = {}) {
  const soulPrompt = await loadSoulPrompt(config);
  const guard = [
    '[Soul guard]',
    'Apply this soul to response tone only.',
    'Response tone only: do not change plans, code, tests, file formats, or technical decisions.'
  ].join('\n');
  return `${String(baseSystemPrompt || '').trim()}\n\n${guard}\n\n${soulPrompt}`.trim();
}
