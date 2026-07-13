import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Whether the workspace looks like a git repo (.git file or directory).
 * Used for approval auto-mode even when oplog change tracking failed to enable.
 */
export async function detectWorkspaceIsGit(workspaceRoot = '') {
  const root = path.resolve(String(workspaceRoot || '').trim() || process.cwd());
  try {
    const stat = await fs.stat(path.join(root, '.git'));
    return Boolean(stat?.isDirectory() || stat?.isFile());
  } catch {
    return false;
  }
}

/**
 * Resolve git-ness for approval decisions.
 * Prefer explicit flags; fall back to workspace .git presence.
 */
export function resolveApprovalProjectIsGit({
  projectIsGit = false,
  changeTrackerEnabled = false,
  workspaceHasGit = false
} = {}) {
  return Boolean(projectIsGit || changeTrackerEnabled || workspaceHasGit);
}

/**
 * Mirror agent-loop approval gating so plan/sub-agent callers can reason about it in tests.
 */
export function toolRequiresUserApproval({
  approvalMode = 'review',
  projectIsGit = false,
  toolName = '',
  isSafeModeRun = false,
  alwaysAllowTools = []
} = {}) {
  const normalizedApprovalMode = ['review', 'auto', 'full_access'].includes(String(approvalMode || '').toLowerCase())
    ? String(approvalMode || '').toLowerCase()
    : 'review';
  const name = String(toolName || '').trim();
  const isFileWriteTool = name === 'edit' || name === 'create' || name === 'write' || name === 'apply_patch' || name === 'delete';
  const alwaysAllowSet = new Set(
    (Array.isArray(alwaysAllowTools) ? alwaysAllowTools : []).map((item) => String(item || '').trim()).filter(Boolean)
  );

  if (normalizedApprovalMode === 'full_access') return false;
  if (normalizedApprovalMode === 'auto') {
    return (!projectIsGit && isFileWriteTool) || Boolean(isSafeModeRun);
  }
  return name === 'delete' || Boolean(isSafeModeRun) || !alwaysAllowSet.has(name);
}
