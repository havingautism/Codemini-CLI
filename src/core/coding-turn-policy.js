import { classifyMemoryRoute, isSensitiveMemoryContent } from './memory-policy.js';

// These are user constraints, not task-complexity or workflow predictions.
const SUBAGENT_OPTOUT_RE = /\b(?:do not|don't|never|without)\b.{0,24}\bsub-?agents?\b|(?:不要|别|无需).{0,12}(?:子代理|子智能体)/iu;
const FORK_OPTOUT_RE = /\b(?:do not|don't|never|without)\b.{0,24}\b(?:forks?|parallel (?:tasks?|branches?))\b|(?:不要|别|无需).{0,12}(?:并行任务|并行分支|分支任务)/iu;
const DELEGATION_OPTOUT_RE = /\b(?:do not|don't|never)\s+delegate\b|(?:不要|别|无需)(?:委派|并行)/iu;

export function createCodingTurnPolicy({ text = '', crewActive = false } = {}) {
  const input = String(text || '');
  const noDelegation = DELEGATION_OPTOUT_RE.test(input);
  return {
    crewActive,
    allowSubagent: !noDelegation && !SUBAGENT_OPTOUT_RE.test(input),
    allowFork: !crewActive && !noDelegation && !FORK_OPTOUT_RE.test(input),
    allowSaveMemory: !isSensitiveMemoryContent(input) && classifyMemoryRoute(input).leaf === 'save_memory',
  };
}

export function isCodingTurnToolAllowed(policy, toolName) {
  if (toolName === 'run_subagent') return policy.allowSubagent;
  if (toolName === 'fork_task') return policy.allowFork;
  if (
    toolName === 'land_workers'
    || toolName === 'crew_status'
    || toolName === 'cancel_worker'
  ) return policy.crewActive;
  if (toolName === 'save_memory') return policy.allowSaveMemory;
  return true;
}

export function buildCodingTurnPolicyBlock(policy) {
  return [
    policy.crewActive
      ? 'Crew is on: every objective goes to run_subagent workers in git worktrees, even a single task. Do not implement in the parent. Do not edit the main checkout.'
      : '',
    policy.crewActive && !policy.allowSubagent
      ? 'Delegation is disabled by the user. Explain the mode conflict before implementation; do not bypass the Crew parent restrictions.'
      : '',
  ].filter(Boolean).join('\n');
}
