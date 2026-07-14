import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getGlobalHooksFilePath,
  getProjectHooksFilePath,
} from './paths.js';
import { normalizeHooksObject } from './skill-hooks-normalize.js';
import { rewriteMatcherAliases } from './skill-hooks-tool-aliases.js';
import { PROJECT_HOOKS_SKILL_NAME } from './skill-hooks-session.js';

function rewriteHooksMatchers(hooks = {}) {
  const out = {};
  for (const [eventName, groups] of Object.entries(hooks || {})) {
    if (!Array.isArray(groups)) continue;
    out[eventName] = groups.map((group) => {
      if (!group || typeof group !== 'object') return group;
      if (group.matcher == null || group.matcher === '') return group;
      return {
        ...group,
        matcher: rewriteMatcherAliases(group.matcher),
      };
    });
  }
  return out;
}

export async function readWorkspaceHooksFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const hooks =
      parsed && typeof parsed === 'object' && parsed.hooks && typeof parsed.hooks === 'object'
        ? parsed.hooks
        : parsed && typeof parsed === 'object'
          ? parsed
          : {};
    return hooks;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function writeWorkspaceHooksFile(filePath, hooksObject = {}) {
  const stored = hooksObject && typeof hooksObject === 'object' && !Array.isArray(hooksObject)
    ? hooksObject
    : {};
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  return stored;
}

export async function loadProjectHooks(
  cwd = process.cwd(),
  { rewriteMatchers = true, context = 'coding' } = {},
) {
  const normalizedContext = context === 'daily' ? 'daily' : 'coding';
  const filePath = getProjectHooksFilePath(cwd, normalizedContext);
  const rawHooks = await readWorkspaceHooksFile(filePath);
  const hooks = normalizeHooksObject(rawHooks);
  return {
    filePath,
    hooks: rewriteMatchers ? rewriteHooksMatchers(hooks) : hooks,
    scope: normalizedContext,
  };
}

export async function loadGlobalHooks({ rewriteMatchers = true } = {}) {
  const filePath = getGlobalHooksFilePath();
  const rawHooks = await readWorkspaceHooksFile(filePath);
  const hooks = normalizeHooksObject(rawHooks);
  return {
    filePath,
    hooks: rewriteMatchers ? rewriteHooksMatchers(hooks) : hooks,
    scope: 'global',
  };
}

export async function saveProjectHooks(cwd = process.cwd(), hooksObject = {}, context = 'coding') {
  return writeWorkspaceHooksFile(
    getProjectHooksFilePath(cwd, context === 'daily' ? 'daily' : 'coding'),
    hooksObject,
  );
}

export async function saveGlobalHooks(hooksObject = {}) {
  return writeWorkspaceHooksFile(getGlobalHooksFilePath(), hooksObject);
}

/**
 * Merge the active project context + global hooks for session arming. Hook arrays are additive
 * across scopes, matching Claude settings behavior; project handlers run
 * after global handlers for a stable, understandable order.
 */
export function mergeWorkspaceHookLayers(globalHooks = {}, projectHooks = {}) {
  const globalNormalized = normalizeHooksObject(globalHooks);
  const projectNormalized = normalizeHooksObject(projectHooks);
  const merged = {};
  for (const eventName of new Set([
    ...Object.keys(globalNormalized),
    ...Object.keys(projectNormalized),
  ])) {
    merged[eventName] = [
      ...(globalNormalized[eventName] || []),
      ...(projectNormalized[eventName] || []),
    ];
  }
  return merged;
}

export function workspaceHooksArmEntry(hooks, workspaceRoot) {
  return {
    name: PROJECT_HOOKS_SKILL_NAME,
    hooks: normalizeHooksObject(hooks),
    provenance: Object.fromEntries(
      Object.keys(normalizeHooksObject(hooks)).map((eventName) => [
        eventName,
        { source: 'project', priority: 0 },
      ]),
    ),
    pluginRoot: workspaceRoot,
  };
}
