import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SANDBOX_MODES = Object.freeze([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);

export function normalizeSandboxMode(value, { platform = process.platform } = {}) {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (SANDBOX_MODES.includes(raw)) return raw;
  return platform === 'win32' ? 'danger-full-access' : 'workspace-write';
}

export function isSandboxEnabled(config = {}, { platform = process.platform } = {}) {
  const raw = config?.sandbox?.enabled;
  if (raw === false || raw === 'false' || raw === 'off' || raw === 'never') return false;
  if (raw === true || raw === 'true' || raw === 'on' || raw === 'always') return true;
  // auto / unset
  return platform !== 'win32';
}

/**
 * Resolve per-call sandbox policy. Windows defaults to danger-full-access
 * (no OS confine); Linux/mac default to workspace-write when enabled.
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
  if (!enabled || platform === 'win32') {
    return {
      enabled: false,
      mode: 'danger-full-access',
      workspaceRoot,
      platform,
    };
  }
  const mode = normalizeSandboxMode(
    modeOverride ?? config?.sandbox?.mode,
    { platform },
  );
  return {
    enabled: mode !== 'danger-full-access',
    mode,
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
  if (!current.enabled || platform === 'win32') {
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
 * Windows always shows approval (no OS sandbox).
 */
export function resolveApprovalUiEnabled({
  config = {},
  cwd = process.cwd(),
  platform = process.platform,
} = {}) {
  const policy = resolveSandboxPolicy({ config, cwd, platform });
  if (platform === 'win32') return true;
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
  // Also grant unresolved tmpdir spelling (Seatbelt/Landlock often need both).
  const tmp = path.resolve(os.tmpdir());
  if (!roots.includes(tmp)) roots.push(tmp);
  return roots;
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
  if (!policy || policy.platform === 'win32' || !policy.enabled) return null;
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
