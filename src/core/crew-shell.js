import path from 'node:path';
import { classifyCommandRisk, hasShellWriteSyntax } from './command-risk.js';

export const CREW_PARENT_SHELL_BLOCK =
  'Crew parent run is inspect-only. Use land_workers to merge. Do not git merge, checkout, worktree, or copy into the main checkout.';

export const CREW_LEDGER_WRITE_BLOCK =
  'Crew ledger files are written only by crew_plan, crew_complete, crew_rebase, land_workers, crew_finish, crew_send, and submit_crew_review. Do not edit .codemini/crew.';

export function crewLedgerWriteRefusal(filePath, root = process.cwd()) {
  const absolute = path.resolve(root, String(filePath || ''));
  const rel = path.relative(path.resolve(root), absolute).replace(/\\/g, '/');
  if (
    rel === '.codemini/crew/state.json'
    || rel === '.codemini/crew/inbox'
    || rel.startsWith('.codemini/crew/inbox/')
  ) return CREW_LEDGER_WRITE_BLOCK;
  return '';
}

export function evaluateCrewParentCommand(command, platform = process.platform) {
  const cmd = String(command || '').trim();
  if (!cmd) {
    return { allowed: false, reason: 'empty command' };
  }
  if (cmd.includes('.codemini/crew') && (hasShellWriteSyntax(cmd) || classifyCommandRisk(cmd, 'bash', platform) !== 'read-only')) {
    return { allowed: false, reason: CREW_LEDGER_WRITE_BLOCK };
  }
  if (hasShellWriteSyntax(cmd)) {
    return { allowed: false, reason: CREW_PARENT_SHELL_BLOCK };
  }
  if (classifyCommandRisk(cmd, 'bash', platform) !== 'read-only') {
    return { allowed: false, reason: CREW_PARENT_SHELL_BLOCK };
  }
  return { allowed: true };
}
