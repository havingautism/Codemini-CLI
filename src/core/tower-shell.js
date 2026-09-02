import { classifyCommandRisk, hasShellWriteSyntax } from './command-risk.js';

export const TOWER_PARENT_SHELL_BLOCK =
  'Tower parent run is inspect-only. Use land_workers to merge. Do not git merge, checkout, worktree, or copy into the main checkout.';

export function evaluateTowerParentCommand(command, platform = process.platform) {
  const cmd = String(command || '').trim();
  if (!cmd) {
    return { allowed: false, reason: 'empty command' };
  }
  if (hasShellWriteSyntax(cmd)) {
    return { allowed: false, reason: TOWER_PARENT_SHELL_BLOCK };
  }
  if (classifyCommandRisk(cmd, 'bash', platform) !== 'read-only') {
    return { allowed: false, reason: TOWER_PARENT_SHELL_BLOCK };
  }
  return { allowed: true };
}
