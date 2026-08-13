import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import {
  normalizeHooksObject,
  resolveHooksByPriority,
  unwrapHooksContainer,
} from './skill-hooks-normalize.js';

const HOOKS_DISABLED_MARKER = '.codemini-hooks-disabled';

function parseDisableModelInvocation(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  return parsed.disableModelInvocation === true || parsed['disable-model-invocation'] === true;
}

export async function readHooksJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const body = unwrapHooksContainer(parsed && typeof parsed === 'object' ? parsed : {});
    return normalizeHooksObject(body);
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
    return unwrapHooksContainer(
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {},
    );
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

  const parsed = parseFrontmatter(raw).metadata;

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

/**
 * Skill hooks come only from the skill itself (frontmatter + skill hooks.json).
 * Package-level hooks/hooks.json is a separate session-scoped profile layer.
 */
export async function discoverSkillHooks({
  skillRoot,
  packageRoot = null,
  adoptSettings = false,
} = {}) {
  try {
    await fs.access(path.join(skillRoot, HOOKS_DISABLED_MARKER));
    return { hooks: {}, provenance: {}, disableModelInvocation: false, disabled: true };
  } catch {
    // No install-time opt-out marker; discover bundled hook definitions normally.
  }
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

  // Optional legacy: adopt .claude/settings.json hooks into a skill only when
  // explicitly requested. Package hooks.json is never merged into skill hooks.
  if (packageRoot && adoptSettings) {
    const settingsHooks = await readSettingsHooks(
      path.join(packageRoot, '.claude', 'settings.json'),
    );
    if (Object.keys(settingsHooks).length > 0) {
      candidates.push({ source: 'settings', hooks: settingsHooks });
    }
  }

  const resolved = resolveHooksByPriority(candidates, { adoptSettings });
  return {
    hooks: resolved.hooks,
    provenance: resolved.provenance,
    disableModelInvocation: frontmatter.disableModelInvocation,
    disabled: false,
  };
}

export async function disableSkillHooks(skillRoot) {
  await fs.writeFile(path.join(skillRoot, HOOKS_DISABLED_MARKER), '', 'utf8');
}

export async function writeSkillHooksJson(skillRoot, hooksObject) {
  const stored = hooksObject && typeof hooksObject === 'object' && !Array.isArray(hooksObject)
    ? hooksObject
    : {};
  await fs.mkdir(path.join(skillRoot, 'hooks'), { recursive: true });
  await fs.rm(path.join(skillRoot, HOOKS_DISABLED_MARKER), { force: true });
  await fs.writeFile(
    path.join(skillRoot, 'hooks', 'hooks.json'),
    `${JSON.stringify(stored, null, 2)}\n`,
  );
  return stored;
}
