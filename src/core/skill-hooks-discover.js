import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import { normalizeHooksObject, resolveHooksByPriority } from './skill-hooks-normalize.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseDisableModelInvocation(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  return parsed.disableModelInvocation === true || parsed['disable-model-invocation'] === true;
}

export async function readHooksJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeHooksObject(parsed && typeof parsed === 'object' ? parsed : {});
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

export async function readHooksJsonRaw(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') return {};
    throw err;
  }
}

export async function readFrontmatterHooks(skillMdPath) {
  let raw;
  try {
    raw = await fs.readFile(skillMdPath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return { hooks: {}, disableModelInvocation: false };
    }
    throw err;
  }

  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) {
    return { hooks: {}, disableModelInvocation: false };
  }

  let parsed;
  try {
    parsed = yaml.parse(match[1]);
  } catch {
    return { hooks: {}, disableModelInvocation: false };
  }

  const hooks =
    parsed && typeof parsed === 'object' && parsed.hooks && typeof parsed.hooks === 'object'
      ? normalizeHooksObject(parsed.hooks)
      : {};

  return {
    hooks,
    disableModelInvocation: parseDisableModelInvocation(parsed),
  };
}

async function readSettingsHooks(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const hooks =
      parsed && typeof parsed === 'object' && parsed.hooks && typeof parsed.hooks === 'object'
        ? parsed.hooks
        : {};
    return normalizeHooksObject(hooks);
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

export async function discoverSkillHooks({
  skillRoot,
  packageRoot = null,
  adoptSettings = false,
} = {}) {
  const candidates = [];
  const skillMdPath = path.join(skillRoot, 'SKILL.md');
  const frontmatter = await readFrontmatterHooks(skillMdPath);

  if (Object.keys(frontmatter.hooks).length > 0) {
    candidates.push({ source: 'frontmatter', hooks: frontmatter.hooks });
  }

  const skillJsonHooks = await readHooksJson(path.join(skillRoot, 'hooks', 'hooks.json'));
  if (Object.keys(skillJsonHooks).length > 0) {
    candidates.push({ source: 'skill-json', hooks: skillJsonHooks });
  }

  if (packageRoot) {
    const packageHooks = await readHooksJson(path.join(packageRoot, 'hooks', 'hooks.json'));
    if (Object.keys(packageHooks).length > 0) {
      candidates.push({ source: 'package', hooks: packageHooks });
    }

    if (adoptSettings) {
      const settingsHooks = await readSettingsHooks(
        path.join(packageRoot, '.claude', 'settings.json'),
      );
      if (Object.keys(settingsHooks).length > 0) {
        candidates.push({ source: 'settings', hooks: settingsHooks });
      }
    }
  }

  const resolved = resolveHooksByPriority(candidates, { adoptSettings });
  return {
    hooks: resolved.hooks,
    provenance: resolved.provenance,
    disableModelInvocation: frontmatter.disableModelInvocation,
  };
}

export async function writeSkillHooksJson(skillRoot, hooksObject) {
  const stored = hooksObject && typeof hooksObject === 'object' && !Array.isArray(hooksObject)
    ? hooksObject
    : {};
  await fs.mkdir(path.join(skillRoot, 'hooks'), { recursive: true });
  await fs.writeFile(
    path.join(skillRoot, 'hooks', 'hooks.json'),
    `${JSON.stringify(stored, null, 2)}\n`,
  );
  return stored;
}
