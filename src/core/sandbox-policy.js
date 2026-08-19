import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSkillsDir } from './paths.js';
import { selectSandboxBackend } from './sandbox-probe.js';

export const SANDBOX_MODES = Object.freeze([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);

export function normalizeSandboxMode(value, { platform = process.platform } = {}) {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (SANDBOX_MODES.includes(raw)) return raw;
  return 'workspace-write';
}

export function isSandboxEnabled(config = {}, { platform = process.platform } = {}) {
  const raw = config?.sandbox?.enabled;
  if (raw === false || raw === 'false' || raw === 'off' || raw === 'never') return false;
  if (raw === true || raw === 'true' || raw === 'on' || raw === 'always') return true;
  // auto / unset
  return true;
}

export function isVmSandbox(policy) {
  return Boolean(policy?.enabled && policy.backend === 'vm');
}

export function isOsSandbox(policy) {
  return Boolean(policy?.enabled && policy.backend === 'os');
}

/**
 * Resolve per-call sandbox policy. `backend` is vm | os | none.
 */
export function resolveSandboxPolicy({
  config = {},
  cwd = process.cwd(),
  platform = process.platform,
  mode: modeOverride,
} = {}) {
  const enabled = isSandboxEnabled(config, { platform });
  const workspaceRoot = path.resolve(
    String(config?.sandbox?.workspace_root || cwd || process.cwd()),
  );
  if (!enabled) {
    return {
      enabled: false,
      mode: 'danger-full-access',
      backend: 'none',
      workspaceRoot,
      platform,
    };
  }
  const mode = normalizeSandboxMode(
    modeOverride ?? config?.sandbox?.mode,
    { platform },
  );
  if (mode === 'danger-full-access') {
    return {
      enabled: false,
      mode,
      backend: 'none',
      workspaceRoot,
      platform,
    };
  }
  const backend = selectSandboxBackend({
    preferred: config?.sandbox?.backend,
    platform,
  });
  return {
    enabled: true,
    mode,
    backend,
    workspaceRoot,
    platform,
  };
}

export function validateSandboxEscalationArgs(
  args = {},
  {
    config = {},
    cwd = process.cwd(),
    platform = process.platform,
  } = {},
) {
  const hasMode = args?.sandbox_permissions !== undefined;
  const hasJustification = args?.justification !== undefined;
  if (hasMode !== hasJustification) {
    throw new Error(
      hasMode
        ? 'sandbox_permissions requires a justification'
        : 'justification is only valid together with sandbox_permissions',
    );
  }
  if (!hasMode) return null;

  const justification = String(args.justification || '').trim();
  if (!justification) throw new Error('justification must be a non-empty sentence');

  const rawMode = String(args.sandbox_permissions || '').trim().toLowerCase().replace(/_/g, '-');
  if (!['workspace-write', 'danger-full-access'].includes(rawMode)) {
    throw new Error(`invalid sandbox_permissions: ${args.sandbox_permissions}`);
  }
  const current = resolveSandboxPolicy({ config, cwd, platform });
  if (!current.enabled) {
    throw new Error('sandbox_permissions is not available without a confining sandbox');
  }
  if (SANDBOX_MODES.indexOf(rawMode) <= SANDBOX_MODES.indexOf(current.mode)) {
    throw new Error(
      `sandbox_permissions "${rawMode}" must be strictly wider than current mode "${current.mode}"`,
    );
  }
  return {
    mode: rawMode,
    justification,
    policy: resolveSandboxPolicy({ config, cwd, platform, mode: rawMode }),
  };
}

/**
 * Soft approval is redundant when OS sandbox is already read-only (no writes).
 * Read-only confinement makes the soft approval surface redundant.
 */
export function resolveApprovalUiEnabled({
  config = {},
  cwd = process.cwd(),
  platform = process.platform,
} = {}) {
  const policy = resolveSandboxPolicy({ config, cwd, platform });
  return !(policy.enabled && policy.mode === 'read-only');
}

export function writableRootsForMode(policy) {
  const mode = policy?.mode || 'danger-full-access';
  if (mode === 'danger-full-access') return null; // unrestricted
  if (mode === 'read-only') return [];
  const roots = [path.resolve(policy.workspaceRoot || process.cwd())];
  try {
    roots.push(fs.realpathSync(os.tmpdir()));
  } catch {
    roots.push(path.resolve(os.tmpdir()));
  }
  // Also grant the unresolved tmpdir spelling for in-process file tools.
  const tmp = path.resolve(os.tmpdir());
  if (!roots.includes(tmp)) roots.push(tmp);
  return roots;
}

/**
 * Host paths the sandbox may read in addition to the workspace.
 * Global skills stay available for SKILL.md scripts/references; sessions,
 * memory, and config stay out.
 */
export function readonlySandboxRoots(policy = {}) {
  const workspace = path.resolve(policy.workspaceRoot || process.cwd());
  const skillsDir = path.resolve(getSkillsDir());
  if (pathUnderRoot(skillsDir, workspace)) return [];
  return [skillsDir];
}

export const SANDBOX_SKILLS_GUEST_PATH = '/codemini-skills';

/**
 * VM bind mounts for {@link readonlySandboxRoots}.
 * Always use a Linux guest path. Binding the macOS host path
 * (`/Users/.../Library/...`) into the microVM can stall sandbox
 * create and leave session terminal/SSE waiting on startup.
 */
export function readonlySandboxVolumes(policy = {}) {
  return readonlySandboxRoots(policy).map((hostPath) => ({
    hostPath,
    guestPath: SANDBOX_SKILLS_GUEST_PATH,
    readonly: true,
  }));
}

/** Map a host skill path to the microVM path used by `run`. Identity on POSIX. */
export function toSandboxSkillPath(hostPath, policy = {}) {
  const abs = path.resolve(String(hostPath || ''));
  const volumes = readonlySandboxVolumes(policy);
  for (const volume of volumes) {
    if (!pathUnderRoot(abs, volume.hostPath)) continue;
    const rel = path.relative(volume.hostPath, abs);
    const guestRel = rel.split(/[\\/]/).filter(Boolean).join('/');
    const guestRoot = String(volume.guestPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return guestRel ? `${guestRoot}/${guestRel}` : guestRoot;
  }
  return abs;
}

function pathUnderRoot(targetAbs, rootAbs) {
  const rel = path.relative(rootAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * In-process fs fence for unix sandbox modes. Returns null if allowed,
 * or an error message string if denied.
 */
export function assertSandboxWriteAllowed(targetPath, policy) {
  if (!policy || !policy.enabled) return null;
  if (policy.mode === 'danger-full-access') return null;

  let resolved;
  try {
    resolved = path.resolve(String(targetPath || ''));
  } catch {
    return `[sandbox: file access denied under ${policy.mode} mode]`;
  }

  if (policy.mode === 'read-only') {
    return `[sandbox: file access denied under read-only mode]`;
  }

  const roots = writableRootsForMode(policy) || [];
  for (const root of roots) {
    let rootReal = root;
    try {
      rootReal = fs.realpathSync(root);
    } catch {}
    let targetReal = resolved;
    try {
      // Prefer realpath of existing path or its nearest existing ancestor.
      let cursor = resolved;
      while (cursor && cursor !== path.dirname(cursor)) {
        try {
          if (fs.existsSync(cursor)) {
            targetReal = path.join(
              fs.realpathSync(cursor),
              path.relative(cursor, resolved),
            );
            break;
          }
        } catch {
          break;
        }
        cursor = path.dirname(cursor);
      }
    } catch {}
    if (pathUnderRoot(targetReal, rootReal) || pathUnderRoot(resolved, root)) {
      return null;
    }
  }
  return `[sandbox: file access denied under workspace-write mode]`;
}
