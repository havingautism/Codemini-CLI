import { classifyMemoryRoute, isSensitiveMemoryContent } from './memory-policy.js';

const SUBAGENT_OPTOUT_RE = /\b(?:do not|don't|never|without)\b.{0,24}\bsub-?agents?\b|(?:不要|别|无需)[^，。；,;\n]{0,12}(?:子代理|子智能体)/iu;
const FORK_OPTOUT_RE = /\b(?:do not|don't|never|without)\b.{0,24}\b(?:forks?|parallel (?:tasks?|branches?))\b|(?:不要|别|无需)[^，。；,;\n]{0,12}(?:并行任务|并行分支|分支任务)/iu;
const DELEGATION_OPTOUT_RE = /\b(?:do not|don't|never)\s+delegate\b|(?:不要|别|无需)(?:委派|并行)/iu;

export function createCodingTurnPolicy({ text = '', crewActive = false } = {}) {
  const input = String(text || '');
  const delegationText = input
    // “分别”表示分开执行，“这部分别委派”中的“别”则单独表示禁止。
    .replace(/(?<!部)分别|特别|(?<![这那])个别/gu, '')
    // “包括……”仍属于前一个要求，普通逗号可以引出新的指令。
    .replace(/[，,]\s*(?=包括|包含|例如|比如|尤其|甚至|哪怕)/gu, '');
  const noDelegation = DELEGATION_OPTOUT_RE.test(delegationText);
  return {
    crewActive,
    allowSubagent: !noDelegation && !SUBAGENT_OPTOUT_RE.test(delegationText),
    allowFork: !crewActive && !noDelegation && !FORK_OPTOUT_RE.test(delegationText),
    allowSaveMemory: !isSensitiveMemoryContent(input) && classifyMemoryRoute(input).leaf === 'save_memory',
  };
}

export function isCodingTurnToolAllowed(policy, toolName) {
  if (toolName === 'run_subagent') return policy.allowSubagent;
  if (toolName === 'fork_task') return policy.allowFork;
  if (
    toolName === 'land_workers'
    || toolName === 'crew_rebase'
    || toolName === 'crew_status'
    || toolName === 'crew_send'
    || toolName === 'crew_inbox'
    || toolName === 'crew_plan'
    || toolName === 'crew_finish'
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
