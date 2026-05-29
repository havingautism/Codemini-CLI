import path from 'node:path';
import { loadConfig, saveConfig } from './config-store.js';
import { getBaseConfigDir } from './paths.js';
import { normalizePath } from './string-utils.js';

const GENERAL_WORKSPACE_MARKER = '__codemini_general__';

export function getGeneralWorkspaceDir() {
  return path.join(getBaseConfigDir(), 'workspace');
}

/** General/workspace chats are not scoped by webui active projects. */
export function isGeneralWorkspaceProjectDir(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw === GENERAL_WORKSPACE_MARKER) return true;
  try {
    return path.resolve(raw) === path.resolve(getGeneralWorkspaceDir());
  } catch {
    return false;
  }
}

/**
 * Stable key for a project directory (forward slashes, resolved path).
 */
export function normalizeProjectDirKey(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'unknown') return raw;

  const win = raw.match(/^([A-Za-z]):[\\/](.*)$/);
  if (win && process.platform !== 'win32') {
    return normalizePath(path.join('/mnt', win[1].toLowerCase(), win[2]));
  }

  let resolved = raw;
  try {
    resolved = path.resolve(raw);
  } catch {
    resolved = raw;
  }

  let key = normalizePath(resolved);
  if (process.platform === 'win32') {
    key = key.replace(/^([A-Za-z]):/, (_, drive) => `${drive.toLowerCase()}:`);
  }
  return key;
}

function uniqueProjectDirs(items = []) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (isGeneralWorkspaceProjectDir(item)) continue;
    const value = normalizeProjectDirKey(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function migrateLegacySidebarConfig(config) {
  const next = config;
  next.webui = next.webui || {};
  next.webui.sidebar = next.webui.sidebar || {};
  const sidebar = next.webui.sidebar;
  let changed = false;
  const hadLegacy =
    sidebar.pinned_project_dirs !== undefined || sidebar.hidden_project_dirs !== undefined;

  const currentActive = uniqueProjectDirs(sidebar.active_project_dirs || []);
  if (currentActive.length === 0 && hadLegacy) {
    const pinned = uniqueProjectDirs(sidebar.pinned_project_dirs || []);
    const hidden = new Set(uniqueProjectDirs(sidebar.hidden_project_dirs || []));
    if (pinned.length) {
      sidebar.active_project_dirs = pinned.filter((dir) => !hidden.has(dir));
      changed = true;
    }
  }

  const normalized = uniqueProjectDirs(sidebar.active_project_dirs || []);
  if (JSON.stringify(normalized) !== JSON.stringify(sidebar.active_project_dirs || [])) {
    sidebar.active_project_dirs = normalized;
    changed = true;
  }

  if (hadLegacy) {
    delete sidebar.pinned_project_dirs;
    delete sidebar.hidden_project_dirs;
    changed = true;
  }

  return { config: next, changed };
}

export function getWebuiActiveProjects(config) {
  const sidebar = config?.webui?.sidebar || {};
  return {
    active: uniqueProjectDirs(sidebar.active_project_dirs)
  };
}

export async function loadWebuiActiveProjects() {
  let config = await loadConfig();
  const { config: migrated, changed } = migrateLegacySidebarConfig(structuredClone(config));
  if (changed) {
    await saveConfig(migrated);
    config = migrated;
  } else {
    config = migrateLegacySidebarConfig(config).config;
  }
  return getWebuiActiveProjects(config);
}

export async function saveWebuiActiveProjects({ active } = {}) {
  const config = await loadConfig();
  config.webui = config.webui || {};
  config.webui.sidebar = config.webui.sidebar || {};
  if (active !== undefined) {
    config.webui.sidebar.active_project_dirs = uniqueProjectDirs(active);
  }
  delete config.webui.sidebar.pinned_project_dirs;
  delete config.webui.sidebar.hidden_project_dirs;
  await saveConfig(config);
  return getWebuiActiveProjects(config);
}

export async function patchWebuiActiveProjects(patch = {}) {
  const current = await loadWebuiActiveProjects();
  let active = [...current.active];
  const rawProjectDir = String(patch.projectDir || '').trim();
  const projectDir = normalizeProjectDirKey(rawProjectDir);
  const isWorkspace = isGeneralWorkspaceProjectDir(rawProjectDir) || isGeneralWorkspaceProjectDir(projectDir);

  if (patch.action === 'activate' && projectDir && !isWorkspace) {
    active = [projectDir, ...active.filter((key) => key !== projectDir)];
  } else if (patch.action === 'deactivate' && projectDir && !isWorkspace) {
    active = active.filter((key) => key !== projectDir);
  }

  if (Array.isArray(patch.active)) active = uniqueProjectDirs(patch.active);

  return saveWebuiActiveProjects({ active });
}

export function sessionMatchesActiveProjects(session, activeSet) {
  if (session?.isGeneral) return true;
  if (isGeneralWorkspaceProjectDir(session?.projectDir)) return true;
  if (!activeSet || activeSet.size === 0) return false;
  const key = normalizeProjectDirKey(session?.projectKey || session?.projectDir);
  if (isGeneralWorkspaceProjectDir(key)) return true;
  return Boolean(key) && activeSet.has(key);
}
