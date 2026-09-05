import { parseModelJsonObject } from './model-json.js';

const GRAPH_VERSION = 'coding-turn-route-v16';
const MAX_SELECTED_SKILLS = 2;
const CONTEXT_ADVISORY_PCT = 60;
const CONTEXT_HARD_PCT = 80;
const EXPLICIT_DELEGATION_INTENT_RE =
  /\b(?:use|run|spawn)\s+(?:an?\s+)?sub-?agents?\b|\bdelegate\b.{0,24}\bsub-?agents?\b|(?:使用|启用|调用|委派|让).{0,12}(?:子代理|子智能体)/iu;
const SUBAGENT_OPTOUT_RE =
  /\b(?:do not|don't|never|without)\b.{0,24}\bsub-?agents?\b|(?:不要|别|无需).{0,12}(?:子代理|子智能体)/iu;
const EXPLICIT_FORK_INTENT_RE =
  /\b(?:use|run|spawn)\s+(?:an?\s+)?(?:forks?|parallel (?:tasks?|branches?))\b|(?:使用|启用|调用).{0,12}(?:并行任务|并行分支|分支任务)/iu;
const FORK_OPTOUT_RE =
  /\b(?:do not|don't|never|without)\b.{0,24}\b(?:forks?|parallel (?:tasks?|branches?))\b|(?:不要|别|无需).{0,12}(?:并行任务|并行分支|分支任务)/iu;
// Fork branches replay the parent's full prefix, so they fit same-state
// parallel work — explicit "in parallel / separately" markers or 分别/并行
// style phrasing — rather than generic exploration words.
const PARALLEL_FORK_INTENT_PATTERNS = [
  /\b(?:inspect|review|analy[sz]e|check|audit|compare|investigate)\b[\s\S]{0,120}\b(?:in parallel|separately|independently|concurrently)\b/iu,
  /\b(?:in parallel|separately|concurrently)\b[\s\S]{0,80}\b(?:inspect|review|analy[sz]e|check|audit)\b/iu,
  /(?:并行|同时|分别|分头|各自).{0,24}(?:检查|审查|分析|调研|评估|排查|对比)/u,
  /(?:检查|审查|分析|调研|评估|排查|对比).{0,24}(?:和|与|、).{0,24}(?:检查|审查|分析|调研|评估|排查|对比)/u,
];

function contextPressure(contextUsage = {}) {
  const estimatedTokens = Number(contextUsage?.estimated_tokens || 0);
  const maxTokens = Number(contextUsage?.max_tokens || 0);
  const reportedUsagePct = Number(contextUsage?.usage_pct || 0);
  const usagePct = reportedUsagePct > 0
    ? reportedUsagePct
    : maxTokens > 0
      ? (estimatedTokens / maxTokens) * 100
      : 0;
  return {
    advisory: usagePct >= CONTEXT_ADVISORY_PCT,
    hard: usagePct >= CONTEXT_HARD_PCT,
  };
}

function hasExplicitDelegationIntent(text = '') {
  const input = String(text || '');
  return !SUBAGENT_OPTOUT_RE.test(input) && EXPLICIT_DELEGATION_INTENT_RE.test(input);
}

function hasSubagentOptOut(text = '') {
  return SUBAGENT_OPTOUT_RE.test(String(text || ''));
}

function hasExplicitForkIntent(text = '') {
  const input = String(text || '');
  return !FORK_OPTOUT_RE.test(input) && EXPLICIT_FORK_INTENT_RE.test(input);
}

function hasForkOptOut(text = '') {
  return FORK_OPTOUT_RE.test(String(text || ''));
}

function hasParallelInvestigationIntent(text = '') {
  const input = String(text || '');
  return PARALLEL_FORK_INTENT_PATTERNS.some((re) => re.test(input));
}

function hasMultiStepTaskIntent(text = '') {
  const input = String(text || '');
  const numberedSteps = input.match(/(?:^|\n)\s*(?:\d+[.)、]|[-*])\s*\S/gm) || [];
  return numberedSteps.length >= 2
    || /\b(?:implement|fix|refactor|debug)\b[\s\S]{0,100}\b(?:test|verify|build)\b/iu.test(input)
    || /(?:实现|修改|修复|重构|排查)[\s\S]{0,50}(?:测试|验证|构建)/u.test(input);
}

const VALID_DELEGATION_MODES = new Set([
  'direct',
  'parallel_task',
  'subagent',
  'subagent_dag',
]);

function requestedDelegationMode(raw = {}) {
  const mode = String(raw?.delegation?.mode || '').trim().toLowerCase();
  return VALID_DELEGATION_MODES.has(mode) ? mode : '';
}

function resolveDelegationMode(raw = {}, { text = '', contextUsage = {}, taskRequired = false } = {}) {
  const pressure = contextPressure(contextUsage);
  const subagentOptOut = hasSubagentOptOut(text);
  const forkOptOut = hasForkOptOut(text);
  const explicitSubagent = hasExplicitDelegationIntent(text);
  const explicitFork = hasExplicitForkIntent(text);
  const parallelIntent = hasParallelInvestigationIntent(text);
  const requested = requestedDelegationMode(raw);
  const nonAtomic = taskRequired || raw?.tasks?.required === true || parallelIntent;

  if (requested === 'subagent_dag' && !subagentOptOut) return 'subagent_dag';
  if (explicitSubagent && !subagentOptOut) return 'subagent';
  if (explicitFork && !forkOptOut) return 'parallel_task';
  if (pressure.hard && nonAtomic && !subagentOptOut) return 'subagent';

  if (requested === 'parallel_task' && !forkOptOut && !pressure.hard) return requested;
  if ((requested === 'subagent' || requested === 'subagent_dag') && !subagentOptOut) return requested;
  if (requested === 'direct') return requested;

  if (!forkOptOut && !pressure.hard && raw?.forks?.enabled === true) return 'parallel_task';
  if (!subagentOptOut && raw?.subagents?.enabled === true) return 'subagent';
  if (!forkOptOut && !pressure.hard && parallelIntent) return 'parallel_task';
  return 'direct';
}

const TASK_CONTINUATION_RE = /(?:继续|接着|然后|顺便|还有|另外|再(?:改|加|补|跑|测|调)|也(?:要|需要|想|把))/u;

/**
 * Detect carry-on intent from the immediately previous turn. This is a
 * deterministic floor so judge failures or underestimates cannot drop tasks.
 */
function hasEditContinuationIntent(text = '', toolTrace = {}) {
  const editCount = Number(toolTrace?.editCount || 0);
  if (editCount <= 0) return false;
  return editCount >= 2 || TASK_CONTINUATION_RE.test(String(text || ''));
}
const VALID_MEMORY_LEAVES = new Set(['save_memory', 'dream_inbox', 'ignore']);
const MEMORY_LEAF_RANK = Object.freeze({ ignore: 0, dream_inbox: 1, save_memory: 2 });
const GRAPH_NODES = Object.freeze({
  mode_gate: Object.freeze({
    coding: 'clarification_gate',
    bypass: 'bypass_non_coding',
  }),
  bypass_non_coding: Object.freeze({ next: 'complete' }),
  memory_gate: Object.freeze({
    decision: 'memory',
    enforcement: 'hard_gate',
    evaluate: normalizeMemoryDecision,
  }),
  skill_selection_gate: Object.freeze({
    decision: 'skills',
    enforcement: 'injection',
    evaluate: normalizeSkillDecision,
  }),
  subagent_gate: Object.freeze({
    decision: 'subagents',
    enforcement: 'hard_gate',
    evaluate: normalizeSubagentDecision,
  }),
  fork_gate: Object.freeze({
    decision: 'forks',
    enforcement: 'directive',
    evaluate: normalizeForkDecision,
  }),
  task_gate: Object.freeze({
    decision: 'tasks',
    enforcement: 'directive',
    evaluate: normalizeTaskDecision,
  }),
  clarification_gate: Object.freeze({
    decision: 'clarification',
    enforcement: 'directive',
    evaluate: normalizeClarificationDecision,
  }),
  complete: Object.freeze({}),
});
const CODING_GATE_ORDER = Object.freeze([
  ['clarification', 'clarification_gate'],
  ['skills', 'skill_selection_gate'],
  ['tasks', 'task_gate'],
  ['subagents', 'subagent_gate'],
  ['forks', 'fork_gate'],
  ['memory', 'memory_gate'],
]);

export function selectCodingRouteGates({
  text = '',
  toolTrace = {},
  contextUsage = {},
  raw = {},
} = {}) {
  const selectedSkills = Array.isArray(raw?.skills?.selected_names)
    ? raw.skills.selected_names.filter(Boolean)
    : [];
  const delegationMode = resolveDelegationMode(raw, {
    text,
    contextUsage,
    taskRequired: hasMultiStepTaskIntent(text) || hasEditContinuationIntent(text, toolTrace),
  });
  return {
    clarification: raw?.clarification?.mode === 'ask',
    skills: selectedSkills.length > 0 || raw?.skills?.inject_index === true,
    tasks: hasMultiStepTaskIntent(text)
      || hasEditContinuationIntent(text, toolTrace)
      || raw?.tasks?.required === true,
    subagents: hasSubagentOptOut(text)
      || hasExplicitDelegationIntent(text)
      || delegationMode === 'subagent'
      || delegationMode === 'subagent_dag'
      || raw?.subagents?.enabled === true,
    forks: hasForkOptOut(text)
      || delegationMode === 'parallel_task'
      || hasParallelInvestigationIntent(text)
      || raw?.forks?.enabled === true,
    memory: true,
  };
}

function enabledCodingGates(gates = {}) {
  return CODING_GATE_ORDER
    .filter(([key]) => gates[key] === true)
    .map(([, node]) => node);
}

function executeGraph({ coding = false, raw = {}, fallback = {}, context = {}, gates = {} } = {}) {
  const path = ['mode_gate'];
  const decisions = {};
  if (!coding) {
    path.push('bypass_non_coding', 'complete');
    return { path, decisions: null };
  }
  for (const node of enabledCodingGates(gates)) {
    path.push(node);
    const definition = GRAPH_NODES[node];
    if (definition?.decision && typeof definition.evaluate === 'function') {
      decisions[definition.decision] = {
        ...definition.evaluate(raw, fallback, context),
        enforcement: definition.enforcement,
      };
    }
  }
  path.push('complete');
  return { path, decisions };
}

function parseJudgeResult(value) {
  return parseModelJsonObject(value);
}

function compactSkillIndex(value, maxChars = 5000) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function skillCandidateNames(skillIndexPrompt = '') {
  return [...String(skillIndexPrompt || '').matchAll(/^- \/([^\s]+)(?:\s|$)/gm)]
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
}

function judgeRequest({
  text,
  autoRoute,
  memoryRoute,
  skillIndexPrompt,
  contextUsage,
  toolTrace,
}) {
  return {
    systemPrompt: [
      'You are the semantic judge inside a coding-turn routing graph.',
      'Judge difficulty from meaning, not keywords. A short request can still need tasks, skills, or subagents; a long or jargon-heavy request can still be atomic.',
      'Route one coding turn through six nodes. Return strict JSON and no prose.',
      '- clarification: "ask" only when a material choice remains after repository inspection; otherwise "auto". request_user_input always remains available.',
      '- skills: none by default; select at most two exact indexed names only for strong workflow matches.',
      '- tasks: required for 2+ meaningful steps, multiple files/phases, implementation plus verification, or multi-hypothesis debugging. A required heuristic route cannot be downgraded.',
      '- delegation: choose exactly one execution recommendation. direct for atomic work; parallel_task recommends the always-available fork_task tool for bounded independent work sharing the same state/prefix; subagent enables clean-context run_subagent for a different role/model or independent verification; subagent_dag enables run_subagent only when downstream work depends on upstream findings. At >=80% context usage prefer subagent over parallel_task for non-atomic work.',
      '- memory: may downgrade but never upgrade the heuristic. Save only explicit durable preferences, remember requests, or stable project conventions; never secrets. Coding discoveries go to later Dream/session review.',
      '',
      'Return {"clarification":{"mode":"ask|auto","suggested_questions":["focused question"],"reason":"..."},"skills":{"selected_names":["exact-name"],"reason":"..."},"tasks":{"required":true,"items":[{"content":"Inspect implementation"}],"reason":"..."},"delegation":{"mode":"direct|parallel_task|subagent|subagent_dag","recommended_count":2,"focus":["bounded focus"],"reason":"..."},"memory":{"leaf":"save_memory|dream_inbox|ignore","reason":"..."}}',
    ].join('\n'),
    userPrompt: [
      `User turn:\n${String(text || '').trim()}`,
      `Heuristic memory route:\n${JSON.stringify(memoryRoute || {})}`,
      `Main-session context usage:\n${JSON.stringify(contextUsage || {})}`,
      `Previous-turn tool trace:\n${JSON.stringify(toolTrace || {})}`,
      `Eligible indexed skills:\n${compactSkillIndex(skillIndexPrompt) || '(none)'}`,
    ].join('\n\n'),
  };
}

function fallbackDecision({
  memoryRoute,
  hasSkillIndex,
  contextUsage,
  text,
  toolTrace = {},
  injectSkillIndex = false,
}) {
  const pressure = contextPressure(contextUsage);
  const delegationIntent = hasExplicitDelegationIntent(text);
  const forkIntent = hasParallelInvestigationIntent(text);
  const taskRequired = hasMultiStepTaskIntent(text)
    || hasEditContinuationIntent(text, toolTrace);
  const delegationMode = resolveDelegationMode({}, {
    text,
    contextUsage,
    taskRequired,
  });
  const enableSubagents = delegationMode === 'subagent' || delegationMode === 'subagent_dag';
  const enableForks = delegationMode === 'parallel_task';
  return {
    delegation: {
      mode: delegationMode,
      recommended_count: enableForks ? 2 : enableSubagents ? (pressure.hard ? 2 : 1) : 0,
      focus: [],
      reason: enableForks
        ? 'parallel same-state investigation'
        : enableSubagents
          ? pressure.hard
            ? 'hard context-isolation fallback'
            : 'explicit delegation request'
          : 'direct execution fallback',
    },
    memory: {
      leaf: VALID_MEMORY_LEAVES.has(memoryRoute?.leaf) ? memoryRoute.leaf : 'ignore',
      reason: 'deterministic memory-route fallback',
    },
    skills: {
      selected_names: [],
      inject_index: Boolean(hasSkillIndex && injectSkillIndex),
      reason: injectSkillIndex
        ? 'preserve the candidate index when semantic selection is unavailable'
        : 'skip the candidate index when the semantic judge is not invoked',
    },
    subagents: {
      enabled: enableSubagents,
      recommended_count: enableSubagents ? (pressure.hard ? 2 : 1) : 0,
      focus: [],
      reason: pressure.hard
        ? 'hard context-isolation fallback'
        : delegationIntent
          ? 'explicit delegation request'
          : 'semantic-difficulty fallback',
    },
    forks: {
      enabled: enableForks,
      recommended_count: enableForks ? 2 : 0,
      focus: [],
      reason: pressure.hard
        ? 'hard context pressure prefers clean-context subagents'
        : forkIntent
          ? 'parallel same-state investigation'
          : 'semantic-difficulty fallback',
    },
    tasks: {
      required: taskRequired,
      items: [],
      reason: taskRequired
        ? 'multi-step task-complexity fallback'
        : 'atomic task fallback',
    },
    clarification: {
      mode: 'auto',
      suggested_questions: [],
      reason: 'no material ambiguity signal',
    },
  };
}

function normalizeMemoryDecision(raw, fallback, { sensitive = false } = {}) {
  const requestedLeaf = VALID_MEMORY_LEAVES.has(raw?.memory?.leaf)
    ? raw.memory.leaf
    : fallback.memory.leaf;
  const leaf = MEMORY_LEAF_RANK[requestedLeaf] <= MEMORY_LEAF_RANK[fallback.memory.leaf]
    ? requestedLeaf
    : fallback.memory.leaf;
  return {
    leaf: sensitive ? 'ignore' : leaf,
    allow_save_memory: !sensitive && leaf === 'save_memory',
    reason: sensitive
      ? 'hard safety gate rejected secret-like content'
      : String(raw?.memory?.reason || fallback.memory.reason || '').slice(0, 240),
  };
}

function normalizeSkillDecision(raw, fallback, {
  hasSkillIndex = false,
  candidates = [],
} = {}) {
  const eligible = new Set(candidates);
  const selectedNames = [...new Set(
    (Array.isArray(raw?.skills?.selected_names) ? raw.skills.selected_names : [])
      .map((name) => String(name || '').trim().replace(/^\//, ''))
      .filter((name) => eligible.has(name)),
  )].slice(0, MAX_SELECTED_SKILLS);
  const fallbackIndex = raw === fallback && fallback.skills.inject_index === true;
  return {
    selected_names: selectedNames,
    inject_index: hasSkillIndex && fallbackIndex,
    reason: String(raw?.skills?.reason || fallback.skills.reason || '').slice(0, 240),
  };
}

function normalizeSubagentDecision(raw, fallback, { contextUsage = {}, text = '' } = {}) {
  const pressure = contextPressure(contextUsage);
  const delegationIntent = hasExplicitDelegationIntent(text);
  const optedOut = hasSubagentOptOut(text);
  const delegationMode = resolveDelegationMode(raw, {
    text,
    contextUsage,
    taskRequired: fallback.tasks.required,
  });
  const subagentsEnabled = delegationMode === 'subagent' || delegationMode === 'subagent_dag';
  const request = requestedDelegationMode(raw) === delegationMode
    ? raw.delegation
    : raw?.subagents;
  const fallbackCount = Math.min(2, Math.max(1, fallback.subagents.recommended_count || 1));
  const requestedCount = Number.parseInt(request?.recommended_count, 10) || fallbackCount;
  const recommendedCount = subagentsEnabled
    ? delegationMode === 'subagent_dag'
      ? 2
      : pressure.hard
      ? 2
      : Math.min(2, Math.max(1, requestedCount))
    : 0;
  const subagentFocus = subagentsEnabled
    ? (Array.isArray(request?.focus) ? request.focus : [])
        .map((focus) => String(focus || '').trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, recommendedCount)
    : [];
  return {
    enabled: subagentsEnabled,
    opted_out: optedOut,
    recommended_count: recommendedCount,
    focus: subagentFocus,
    reason: String(
      pressure.hard
        ? 'hard context-isolation policy'
        : delegationIntent
          ? 'explicit delegation request'
          : request?.reason || fallback.subagents.reason || '',
    ).slice(0, 240),
  };
}

const MAX_FORK_BRANCHES = 3;

function normalizeForkDecision(raw, fallback, { contextUsage = {}, text = '' } = {}) {
  const pressure = contextPressure(contextUsage);
  const forkIntent = hasParallelInvestigationIntent(text);
  const optedOut = hasForkOptOut(text) || raw?.forks?.opted_out === true;
  const delegationMode = resolveDelegationMode(raw, {
    text,
    contextUsage,
    taskRequired: fallback.tasks.required,
  });
  const forksEnabled = delegationMode === 'parallel_task';
  const request = requestedDelegationMode(raw) === delegationMode
    ? raw.delegation
    : raw?.forks;
  const fallbackCount = Math.min(
    MAX_FORK_BRANCHES,
    Math.max(1, Number(fallback.forks?.recommended_count) || 2),
  );
  const requestedCount = Number.parseInt(request?.recommended_count, 10) || fallbackCount;
  const recommendedCount = forksEnabled
    ? Math.min(MAX_FORK_BRANCHES, Math.max(1, requestedCount))
    : 0;
  const focus = forksEnabled
    ? (Array.isArray(request?.focus) ? request.focus : [])
        .map((focus) => String(focus || '').trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, recommendedCount)
    : [];
  return {
    enabled: forksEnabled,
    opted_out: optedOut,
    recommended_count: recommendedCount,
    focus,
    reason: String(
      optedOut
        ? 'delegation opt-out'
        : pressure.hard
          ? 'hard context pressure prefers clean-context subagents'
          : forkIntent
            ? 'parallel same-state investigation'
            : request?.reason || fallback.forks.reason || '',
    ).slice(0, 240),
  };
}

function normalizeTaskDecision(raw, fallback) {
  const items = (Array.isArray(raw?.tasks?.items) ? raw.tasks.items : [])
    .map((item) => ({
      content: String(item?.content || '').trim().slice(0, 160),
      activeForm: String(item?.activeForm || '').trim().slice(0, 160),
      status: 'pending',
    }))
    .filter((item) => item.content)
    .slice(0, 8);
  return {
    required: fallback.tasks.required || raw?.tasks?.required === true,
    items,
    reason: String(raw?.tasks?.reason || fallback.tasks.reason || '').slice(0, 240),
  };
}

const VALID_CLARIFICATION_MODES = new Set(['auto', 'ask']);
const MAX_SUGGESTED_QUESTIONS = 3;

function normalizeClarificationDecision(raw, fallback) {
  const rawMode = raw?.clarification?.mode;
  const mode = VALID_CLARIFICATION_MODES.has(rawMode) ? rawMode : fallback.clarification.mode;
  const suggestedQuestions = mode === 'ask'
    ? (Array.isArray(raw?.clarification?.suggested_questions) ? raw.clarification.suggested_questions : [])
        .map((q) => String(q || '').trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, MAX_SUGGESTED_QUESTIONS)
    : [];
  return {
    mode,
    suggested_questions: suggestedQuestions,
    reason: String(raw?.clarification?.reason || fallback.clarification.reason || '').slice(0, 240),
  };
}

/**
 * Execute the coding-only routing graph.
 *
 * The injected judge is the semantic adapter. It receives a prepared prompt
 * and returns either parsed JSON or model text. All policy normalization and
 * fallback behavior stays behind this interface.
 */
export async function evaluateCodingRouteGraph({
  executionMode = 'normal',
  text = '',
  autoRoute = {},
  memoryRoute = {},
  skillIndexPrompt = '',
  contextUsage = {},
  sensitive = false,
  judge = null,
  toolTrace = {},
  towerActive = false,
} = {}) {
  if (String(executionMode || '').toLowerCase() !== 'plan') {
    const graph = executeGraph({ coding: false });
    return {
      active: false,
      graph_version: GRAPH_VERSION,
      ...graph,
      source: 'bypass',
    };
  }

  const hasSkillIndex = Boolean(String(skillIndexPrompt || '').trim());
  const candidates = skillCandidateNames(skillIndexPrompt);
  const invokeJudge = typeof judge === 'function';
  const fallback = fallbackDecision({
    memoryRoute,
    hasSkillIndex,
    contextUsage,
    text,
    toolTrace,
    injectSkillIndex: invokeJudge,
  });
  let raw = fallback;
  let source = 'fallback';
  if (invokeJudge) {
    try {
      const request = judgeRequest({
        text,
        autoRoute,
        memoryRoute,
        skillIndexPrompt,
        contextUsage,
        toolTrace,
      });
      const judged = parseJudgeResult(await judge(request));
      if (judged) {
        raw = judged;
        source = 'llm';
      }
    } catch {
      // Fail closed for memory writes and preserve existing coding capabilities
      // through the normalized fallback decision.
    }
  }
  const gates = selectCodingRouteGates({
    text,
    toolTrace,
    contextUsage,
    raw,
  });
  let delegationMode = resolveDelegationMode(raw, {
    text,
    contextUsage,
    taskRequired: fallback.tasks.required || raw?.tasks?.required === true,
  });
  if (towerActive === true && delegationMode !== 'subagent' && delegationMode !== 'subagent_dag') {
    delegationMode = 'subagent';
  }

  const graph = executeGraph({
    coding: true,
    raw,
    fallback,
    gates,
    context: {
      sensitive,
      hasSkillIndex,
      candidates,
      contextUsage,
      text,
    },
  });
  return {
    active: true,
    graph_version: GRAPH_VERSION,
    ...graph,
    source,
    delegation_mode: delegationMode,
  };
}

export function isCodingRouteToolAllowed(result, toolName, options = {}) {
  if (toolName === 'run_subagent') {
    if (options.towerActive === true) return true;
    return result?.delegation_mode === 'subagent' || result?.delegation_mode === 'subagent_dag';
  }
  if (toolName === 'fork_task') {
    return options.towerActive !== true;
  }
  if (toolName === 'land_workers' || toolName === 'tower_status') {
    return options.towerActive === true;
  }
  if (toolName === 'save_memory') {
    return result?.decisions?.memory?.allow_save_memory === true;
  }
  return true;
}

export function buildCodingRouteDecisionBlock(result, options = {}) {
  if (!result?.active || !result.decisions) return '';
  const { clarification, memory, skills, subagents, forks, tasks } = result.decisions;
  const delegationMode = result.delegation_mode || 'direct';
  const skillSelection = !skills
    ? ''
    : skills.selected_names.length > 0
      ? skills.selected_names.join(', ')
      : skills.inject_index
        ? 'candidate index fallback'
        : 'none';
  const delegationDecision = delegationMode === 'parallel_task' ? forks : subagents;
  const delegationCount = delegationDecision?.recommended_count > 0
    ? `; count=${delegationDecision.recommended_count}`
    : '';
  const delegationFocus = delegationDecision?.focus?.length > 0
    ? `; focus=${delegationDecision.focus.join(' | ')}`
    : '';
  const suggestedTasks = tasks?.items?.length > 0
    ? `; suggested=${tasks.items.map((item) => item.content).join(' | ')}`
    : '';
  const questionHint = clarification?.suggested_questions?.length > 0
    ? `; suggested=${clarification.suggested_questions.join(' | ')}`
    : '';
  return [
    `<coding_harness version="${result.graph_version}" source="${result.source}">`,
    clarification
      ? `clarification=${clarification.mode}${questionHint}`
      : '',
    skills ? `skills=${skillSelection}` : '',
    tasks ? `tasks=${tasks.required ? `required${suggestedTasks}` : 'optional'}` : '',
    `delegation=${delegationMode}${delegationCount}${delegationFocus}`,
    memory
      ? `memory=${memory.leaf}; save_memory=${memory.allow_save_memory ? 'enabled' : 'disabled'}`
      : '',
    skills?.selected_names?.length > 0
      ? 'Apply selected skills as active workflows.'
      : '',
    options.towerActive === true
      ? 'Crew is on: every objective goes to run_subagent workers in git worktrees, even a single task. Do not implement in the parent. fork_task is not available. Do not edit the main checkout.'
      : '',
    delegationMode === 'subagent'
      ? 'Use run_subagent only for the routed bounded clean-context work; the parent owns integration and final verification.'
      : '',
    delegationMode === 'subagent_dag'
      ? 'Use run_subagent with task_id and depends_on for the routed dependency DAG; the parent owns integration and final verification.'
      : '',
    !options.towerActive && delegationMode === 'parallel_task'
      ? 'Use fork_task for the routed parallel work; do not call run_subagent. Keep branches read-only or assign disjoint files.'
      : '',
    tasks?.required
      ? 'Call tasks before major tool work; keep one item in_progress and settle the list before final.'
      : '',
    clarification?.mode === 'ask'
      ? 'Inspect first; if the material choice remains unresolved, ask before mutation.'
      : '',
    '</coding_harness>',
  ].filter(Boolean).join('\n');
}

export { GRAPH_VERSION as CODING_ROUTE_GRAPH_VERSION };
