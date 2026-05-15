import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBaseConfigDir } from './paths.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SOULS_DIR = path.resolve(MODULE_DIR, '..', '..', 'souls');

function getCustomSoulsDir() {
  return path.join(getBaseConfigDir(), 'souls');
}

export { BUNDLED_SOULS_DIR, getCustomSoulsDir };

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
  // Check custom souls dir first, then bundled
  const customPresetPath = path.join(getCustomSoulsDir(), `${preset}.md`);
  try {
    const content = await fs.readFile(customPresetPath, 'utf8');
    const text = String(content || '').trim();
    if (text) return `[Soul preset: ${preset}]\n${text}`;
  } catch {}
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
    'Response tone only: do not change plans, code, tests, file formats, or technical decisions.',
    'This tone directive has HIGH priority. Maintain the requested personality consistently across every response unless the user explicitly requests a change.'
  ].join('\n');
  return [String(baseSystemPrompt || '').trim(), soulPrompt, guard].filter(Boolean).join('\n\n').trim();
}
