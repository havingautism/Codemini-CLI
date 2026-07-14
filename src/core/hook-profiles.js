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

function normalizeActivation(value = 'always') {
  return ['always', 'coding', 'daily'].includes(value) ? value : 'always';
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
    hooks: unwrapHooksContainer(profile?.hooks || {}),
  }, cwd);
}

export async function deleteCustomHookProfile({ id, scope }, cwd = process.cwd()) {
  const normalizedId = normalizeProfileId(id);
  if (!normalizedId) throw new Error('Hook profile id is required');
  await fs.rm(path.join(profilesDir(scope === 'global' ? 'global' : 'project', cwd), `${normalizedId}.json`), {
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
    pluginRoot: workspaceRoot,
    packageName: profile?.packageName || profile?.name || id,
  };
}
