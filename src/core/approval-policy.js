import fs from 'node:fs/promises';
import path from 'node:path';
import { isShellToolName } from './shell-tool-name.js';

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
  isDeterministicCommandGate = false,
  isSandboxEscalation = false,
  isOutsideWorkspaceMutation = false,
  osSandboxConfining = false,
  alwaysAllowTools = []
} = {}) {
  const normalizedApprovalMode = ['review', 'auto', 'full_access'].includes(String(approvalMode || '').toLowerCase())
    ? String(approvalMode || '').toLowerCase()
    : 'review';
  const rawName = String(toolName || '').trim();
  const name = isShellToolName(rawName) ? 'run' : rawName;
  const alwaysAllowSet = new Set(
    (Array.isArray(alwaysAllowTools) ? alwaysAllowTools : []).map((item) => String(item || '').trim()).filter(Boolean)
  );

  // Outside the opened project is a soft trust boundary on Windows / when OS sandbox is off.
  // When OS sandbox is confining, the fence already blocks those writes — skip the prompt.
  if (isOutsideWorkspaceMutation && !osSandboxConfining) return true;
  if (isDeterministicCommandGate) return true;
  if (isSandboxEscalation) return true;
  if (normalizedApprovalMode === 'full_access') return false;
  if (normalizedApprovalMode === 'auto') {
    return Boolean(isSafeModeRun);
  }
  return name === 'delete' || Boolean(isSafeModeRun) || !alwaysAllowSet.has(name);
}

const FILE_MUTATION_TOOLS = new Set([
  'edit',
  'create',
  'write',
  'commit_write',
  'apply_patch',
  'delete',
  'add_code_comment',
  'update_code_comment'
]);

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolvePhysicalPath(targetPath) {
  const absolute = path.resolve(targetPath);
  try {
    return await fs.realpath(absolute);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let probe = path.dirname(absolute);
  while (true) {
    try {
      const physicalParent = await fs.realpath(probe);
      return path.resolve(physicalParent, path.relative(probe, absolute));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(probe);
    if (parent === probe) return absolute;
    probe = parent;
  }
}

export function getFileMutationPaths(toolName, args = {}) {
  const name = String(toolName || '').trim();
  if (!FILE_MUTATION_TOOLS.has(name)) return [];
  if (name === 'apply_patch') {
    const patchText = String(args?.patch_text || '');
    return [
      ...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm),
      ...patchText.matchAll(/^\*\*\* Move to: (.+)$/gm)
    ].map((match) => String(match[1] || '').trim()).filter(Boolean);
  }
  if (name === 'delete') {
    return [args?.path || args?.file || args?.file_path || args?.target];
  }
  if (name === 'edit') {
    return [args?.path || args?.ast_target?.path];
  }
  return [args?.path];
}

/**
 * Build approval metadata when a built-in file mutation resolves outside the
 * opened project. The normal allowed_paths policy still decides whether the
 * target is reachable; this function only adds a mandatory review boundary.
 */
export async function inspectOutsideWorkspaceMutation({
  workspaceRoot = process.cwd(),
  toolName = '',
  arguments: args = {}
} = {}) {
  const rawPaths = [...new Set(getFileMutationPaths(toolName, args).map((item) => String(item || '').trim()).filter(Boolean))];
  if (rawPaths.length === 0) return null;

  const lexicalRoot = path.resolve(workspaceRoot);
  const physicalRoot = await resolvePhysicalPath(lexicalRoot);
  const targets = [];
  for (const rawPath of rawPaths) {
    const absolutePath = path.resolve(lexicalRoot, rawPath);
    const physicalPath = await resolvePhysicalPath(absolutePath);
    if (pathIsWithin(physicalRoot, physicalPath)) continue;
    targets.push({ path: rawPath, absolutePath, physicalPath });
  }
  if (targets.length === 0) return null;

  return {
    outsideWorkspace: true,
    workspaceRoot: lexicalRoot,
    paths: [...new Set(targets.map((target) => target.physicalPath))],
    targets
  };
}
