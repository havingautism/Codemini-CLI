import fs from 'node:fs/promises';
import path from 'node:path';
import { getGlobalHooksDir, getProjectHooksDir } from './paths.js';
import { normalizeHooksObject, unwrapHooksContainer } from './skill-hooks-normalize.js';

export const PACKAGE_HOOKS_ARM_PREFIX = '__package__:';

function normalizeProfileId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function profilesDir(scope, cwd) {
  const hooksDir = scope === 'global' ? getGlobalHooksDir() : getProjectHooksDir(cwd);
  return path.join(hooksDir, 'profiles');
}

function packageRootsDir(scope, cwd) {
  const hooksDir = scope === 'global' ? getGlobalHooksDir() : getProjectHooksDir(cwd);
  return path.join(hooksDir, 'packages');
}

export function packageHookInstallRoot(scope, cwd, profileId) {
  const id = normalizeProfileId(profileId);
  if (!id) throw new Error('Package hook profile id is required');
  return path.join(packageRootsDir(scope === 'global' ? 'global' : 'project', cwd), id);
}

function pathIsWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function copyPackageRuntimeRoot(sourceRoot, targetRoot, managedPackagesDir) {
  const stat = await fs.stat(sourceRoot);
  if (!stat.isDirectory()) throw new Error('Package hook root must be a directory');
  await fs.mkdir(targetRoot, { recursive: true });
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    if (entry.name === '.git' || entry.name === '.codemini' || pathIsWithin(sourcePath, managedPackagesDir)) continue;
    const targetPath = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await copyPackageRuntimeRoot(sourcePath, targetPath, managedPackagesDir);
    } else if (entry.isSymbolicLink()) {
      // Do not let a remote package copy files from outside its checkout, and
      // avoid Windows symlink privilege requirements in the managed install.
      continue;
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

export async function persistPackageHookRoot(sourceRoot, { scope = 'project', cwd = process.cwd(), id } = {}) {
  const source = path.resolve(String(sourceRoot || ''));
  const normalizedScope = scope === 'global' ? 'global' : 'project';
  const destination = packageHookInstallRoot(normalizedScope, cwd, id);
  if (source === path.resolve(destination)) return destination;

  const packagesDir = packageRootsDir(normalizedScope, cwd);
  await fs.mkdir(packagesDir, { recursive: true });
  const stagingDir = await fs.mkdtemp(path.join(packagesDir, `.${normalizeProfileId(id)}-`));
  const stagedRoot = path.join(stagingDir, 'package');
  try {
    await copyPackageRuntimeRoot(source, stagedRoot, packagesDir);
    await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(stagedRoot, destination);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
  return destination;
}

function normalizeActivation(value = 'always') {
  return ['always', 'coding', 'daily'].includes(value) ? value : 'always';
}

/** Map skill contexts (coding/daily) → hook profile activation. Both → always (UI: 全局). */
export function hookActivationFromContexts(contexts) {
  const list = Array.isArray(contexts) ? contexts : [];
  const hasCoding = list.includes('coding');
  const hasDaily = list.includes('daily');
  if (hasCoding && hasDaily) return 'always';
  if (hasDaily && !hasCoding) return 'daily';
  if (hasCoding) return 'coding';
  // Empty / unknown → global (same default as normalizeSkillContexts).
  return 'always';
}

function normalizeProfileKind(value = 'custom') {
  if (value === 'package') return 'package';
  return 'custom';
}

export { unwrapHooksContainer };

function normalizeStoredProfile(raw, fallback = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const kind = normalizeProfileKind(source.kind || fallback.kind);
  const hooksRaw =
    source.hooks && typeof source.hooks === 'object' && !Array.isArray(source.hooks)
      ? source.hooks
      : {};
  return {
    id: normalizeProfileId(source.id || fallback.id),
    name: String(source.name || fallback.name || source.id || fallback.id || 'Hook profile').trim(),
    scope: source.scope === 'global' ? 'global' : fallback.scope === 'global' ? 'global' : 'project',
    activation: normalizeActivation(source.activation),
    enabled: source.enabled !== false,
    hooks: unwrapHooksContainer(hooksRaw),
    kind,
    editable: kind !== 'package',
    packageSource: String(source.packageSource || fallback.packageSource || '').trim(),
    packageName: String(source.packageName || fallback.packageName || '').trim(),
    packageRoot: String(source.packageRoot || fallback.packageRoot || '').trim(),
  };
}

function profileFilePayload(profile) {
  const payload = {
    id: profile.id,
    name: profile.name,
    scope: profile.scope,
    activation: profile.activation,
    enabled: profile.enabled,
    kind: profile.kind,
    hooks: profile.hooks && typeof profile.hooks === 'object' ? profile.hooks : {},
  };
  if (profile.kind === 'package') {
    payload.packageSource = profile.packageSource || '';
    payload.packageName = profile.packageName || profile.name || '';
    payload.packageRoot = profile.packageRoot || '';
  }
  return payload;
}

async function readProfileDir(scope, cwd) {
  const dir = profilesDir(scope, cwd);
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const profiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf8'));
      const normalized = normalizeStoredProfile(parsed, {
        id: entry.name.slice(0, -5),
        scope,
      });
      normalized.hooks = normalizeHooksObject(normalized.hooks);
      if (normalized.kind === 'package') {
        const managedRoot = packageHookInstallRoot(scope, cwd, normalized.id);
        try {
          await fs.access(managedRoot);
          normalized.packageRoot = managedRoot;
        } catch {
          // Older profiles may not have a managed package root until updated.
        }
      }
      profiles.push(normalized);
    } catch {
      // A malformed profile is ignored by runtime and can be repaired on disk.
    }
  }
  return profiles;
}

export async function listCustomHookProfiles(cwd = process.cwd()) {
  const [globalProfiles, projectProfiles] = await Promise.all([
    readProfileDir('global', cwd),
    readProfileDir('project', cwd),
  ]);
  return [...globalProfiles, ...projectProfiles];
}

export async function listPackageHookProfiles(cwd = process.cwd()) {
  return (await listCustomHookProfiles(cwd)).filter((profile) => profile.kind === 'package');
}

export async function saveCustomHookProfile(profile, cwd = process.cwd()) {
  const normalized = normalizeStoredProfile(
    { ...profile, kind: profile?.kind === 'package' ? 'package' : 'custom' },
    { scope: profile?.scope },
  );
  if (!normalized.id) throw new Error('Hook profile id is required');
  normalized.hooks = normalizeHooksObject(unwrapHooksContainer(profile?.hooks || normalized.hooks));
  const dir = profilesDir(normalized.scope, cwd);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${normalized.id}.json`),
    `${JSON.stringify(profileFilePayload(normalized), null, 2)}\n`,
    'utf8',
  );
  return normalized;
}

export async function savePackageHookProfile(profile, cwd = process.cwd()) {
  const packageSource = String(profile?.packageSource || profile?.source || '').trim();
  const packageName = String(profile?.packageName || profile?.name || '').trim();
  const id = normalizeProfileId(
    profile?.id || `pkg-${packageSource || packageName || 'package'}`,
  );
  if (!id) throw new Error('Package hook profile id is required');
  return saveCustomHookProfile({
    ...profile,
    id,
    name: packageName || id,
    kind: 'package',
    activation: profile?.activation || 'always',
    scope: profile?.scope === 'global' ? 'global' : 'project',
    enabled: profile?.enabled !== false,
    packageSource,
    packageName: packageName || id,
    packageRoot: String(profile?.packageRoot || '').trim(),
    hooks: unwrapHooksContainer(profile?.hooks || {}),
  }, cwd);
}

export async function deleteCustomHookProfile({ id, scope }, cwd = process.cwd()) {
  const normalizedId = normalizeProfileId(id);
  if (!normalizedId) throw new Error('Hook profile id is required');
  const normalizedScope = scope === 'global' ? 'global' : 'project';
  await fs.rm(path.join(profilesDir(normalizedScope, cwd), `${normalizedId}.json`), {
    force: true,
  });
  await fs.rm(packageHookInstallRoot(normalizedScope, cwd, normalizedId), {
    recursive: true,
    force: true,
  });
  return true;
}

export function packageHooksArmName(profileId = '') {
  return `${PACKAGE_HOOKS_ARM_PREFIX}${normalizeProfileId(profileId)}`;
}

export function isPackageHooksArmName(name = '') {
  return String(name || '').startsWith(PACKAGE_HOOKS_ARM_PREFIX);
}

export function hookProfileIsActive(profile, executionMode = 'normal') {
  if (profile?.enabled === false) return false;
  const activation = normalizeActivation(profile?.activation);
  if (activation === 'always') return true;
  const active = ['plan', 'code', 'coding', 'spec'].includes(String(executionMode || '').toLowerCase())
    ? 'coding'
    : 'daily';
  return activation === active;
}

export function mergeHookProfileHooks(profiles = []) {
  const merged = {};
  for (const profile of profiles) {
    const hooks = normalizeHooksObject(profile?.hooks || {});
    for (const [eventName, groups] of Object.entries(hooks)) {
      merged[eventName] = [...(merged[eventName] || []), ...groups];
    }
  }
  return merged;
}

export function packageProfileArmEntry(profile, workspaceRoot = '') {
  const id = String(profile?.id || '').trim();
  const hooks = normalizeHooksObject(profile?.hooks || {});
  return {
    name: packageHooksArmName(id),
    hooks,
    provenance: Object.fromEntries(
      Object.keys(hooks).map((eventName) => [
        eventName,
        { source: 'package', priority: 3, packageName: profile?.packageName || profile?.name || id },
      ]),
    ),
    pluginRoot: profile?.packageRoot || workspaceRoot,
    packageName: profile?.packageName || profile?.name || id,
  };
}
