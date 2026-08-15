import { parseModelJsonObject } from './model-json.js';

const GRAPH_VERSION = 'coding-turn-route-v11';
const MAX_SELECTED_SKILLS = 2;
const CONTEXT_ADVISORY_PCT = 60;
const CONTEXT_HARD_PCT = 80;
const EXPLICIT_DELEGATION_INTENT_RE =
  /\b(?:use|run|spawn)\s+(?:an?\s+)?sub-?agents?\b|\bdelegate\b.{0,24}\bsub-?agents?\b|(?:使用|启用|调用|委派|让).{0,12}(?:子代理|子智能体)/iu;
const DELEGATION_OPTOUT_RE =
  /\b(?:do not|don't|never|without)\b.{0,24}\bsub-?agents?\b|(?:不要|别|无需).{0,12}(?:子代理|子智能体)/iu;

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
  return !DELEGATION_OPTOUT_RE.test(input) && EXPLICIT_DELEGATION_INTENT_RE.test(input);
}

function hasDelegationOptOut(text = '') {
  return DELEGATION_OPTOUT_RE.test(String(text || ''));
}

function hasMultiStepTaskIntent(text = '') {
  const input = String(text || '');
  const numberedSteps = input.match(/(?:^|\n)\s*(?:\d+[.)、]|[-*])\s*\S/gm) || [];
  return numberedSteps.length >= 2
    || /\b(?:implement|fix|refactor|debug)\b[\s\S]{0,100}\b(?:test|verify|build)\b/iu.test(input)
    || /(?:实现|修改|修复|重构|排查)[\s\S]{0,50}(?:测试|验证|构建)/u.test(input);
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
    next: 'complete',
    decision: 'memory',
    enforcement: 'hard_gate',
    evaluate: normalizeMemoryDecision,
  }),
  skill_selection_gate: Object.freeze({
    next: 'task_gate',
    decision: 'skills',
    enforcement: 'injection',
    evaluate: normalizeSkillDecision,
  }),
  subagent_gate: Object.freeze({
    next: 'memory_gate',
    decision: 'subagents',
    enforcement: 'advisory',
    evaluate: normalizeSubagentDecision,
  }),
  task_gate: Object.freeze({
    next: 'subagent_gate',
    decision: 'tasks',
    enforcement: 'directive',
    evaluate: normalizeTaskDecision,
  }),
  clarification_gate: Object.freeze({
    next: 'skill_selection_gate',
    decision: 'clarification',
    enforcement: 'directive',
    evaluate: normalizeClarificationDecision,
  }),
  complete: Object.freeze({ next: null }),
});

function executeGraph({ coding = false, raw = {}, fallback = {}, context = {} } = {}) {
  const path = ['mode_gate'];
  const decisions = {};
  let node = coding ? GRAPH_NODES.mode_gate.coding : GRAPH_NODES.mode_gate.bypass;
  while (node) {
    path.push(node);
    const definition = GRAPH_NODES[node];
    if (definition?.decision && typeof definition.evaluate === 'function') {
      decisions[definition.decision] = {
        ...definition.evaluate(raw, fallback, context),
        enforcement: definition.enforcement,
      };
    }
    node = definition?.next || null;
  }
  return { path, decisions: coding ? decisions : null };
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
      'Route one coding turn through five nodes. Return strict JSON and no prose.',
      '- clarification: "ask" only when a material choice remains after repository inspection; otherwise "auto". request_user_input always remains available.',
      '- skills: none by default; select at most two exact indexed names only for strong workflow matches.',
      '- tasks: required for 2+ meaningful steps, multiple files/phases, implementation plus verification, or multi-hypothesis debugging. A required heuristic route cannot be downgraded.',
      '- subagents: enable only for bounded independent work, parallel read-only investigation, or independent verification. At >=80% context usage require two.',
      '- memory: may downgrade but never upgrade the heuristic. Save only explicit durable preferences, remember requests, or stable project conventions; never secrets. Coding discoveries go to later Dream/session review.',
      '',
      'Return {"clarification":{"mode":"ask|auto","suggested_questions":["focused question"],"reason":"..."},"skills":{"selected_names":["exact-name"],"reason":"..."},"tasks":{"required":true,"items":[{"content":"Inspect implementation"}],"reason":"..."},"subagents":{"enabled":true,"recommended_count":1,"focus":["bounded focus"],"reason":"..."},"memory":{"leaf":"save_memory|dream_inbox|ignore","reason":"..."}}',
    ].join('\n'),
    userPrompt: [
      `User turn:\n${String(text || '').trim()}`,
      `Heuristic task route:\n${JSON.stringify(autoRoute || {})}`,
      `Heuristic memory route:\n${JSON.stringify(memoryRoute || {})}`,
      `Main-session context usage:\n${JSON.stringify(contextUsage || {})}`,
      `Previous-turn tool trace:\n${JSON.stringify(toolTrace || {})}`,
      `Eligible indexed skills:\n${compactSkillIndex(skillIndexPrompt) || '(none)'}`,
    ].join('\n\n'),
  };
}

function fallbackDecision({
  autoRoute,
  memoryRoute,
  hasSkillIndex,
  contextUsage,
  text,
  toolTrace = {},
}) {
  const complexity = String(autoRoute?.complexity || 'simple');
  const pressure = contextPressure(contextUsage);
  const delegationIntent = hasExplicitDelegationIntent(text);
  const taskRequired = complexity === 'medium'
    || complexity === 'complex'
    || hasMultiStepTaskIntent(text)
    || hasEditContinuationIntent(text, toolTrace);
  const enableSubagents =
    pressure.hard
    || delegationIntent
    || complexity === 'medium'
    || complexity === 'complex';
  return {
    memory: {
      leaf: VALID_MEMORY_LEAVES.has(memoryRoute?.leaf) ? memoryRoute.leaf : 'ignore',
      reason: 'deterministic memory-route fallback',
    },
    skills: {
      selected_names: [],
      inject_index: Boolean(hasSkillIndex),
      reason: 'preserve the candidate index when semantic selection is unavailable',
    },
    subagents: {
      enabled: enableSubagents,
      recommended_count:
        complexity === 'complex' || pressure.hard
          ? 2
          : complexity === 'medium' || delegationIntent
            ? 1
            : 0,
      focus: [],
      reason: pressure.hard
        ? 'hard context-isolation fallback'
        : delegationIntent
          ? 'explicit delegation request'
          : 'task-complexity fallback',
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
  const optedOut = hasDelegationOptOut(text);
  const subagentsEnabled =
    !optedOut && (pressure.hard || delegationIntent || raw?.subagents?.enabled === true);
  const fallbackCount = Math.min(2, Math.max(1, fallback.subagents.recommended_count || 1));
  const requestedCount = Number.parseInt(raw?.subagents?.recommended_count, 10) || fallbackCount;
  const recommendedCount = subagentsEnabled
    ? pressure.hard
      ? 2
      : Math.min(2, Math.max(1, requestedCount))
    : 0;
  const subagentFocus = subagentsEnabled
    ? (Array.isArray(raw?.subagents?.focus) ? raw.subagents.focus : [])
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
          : raw?.subagents?.reason || fallback.subagents.reason || '',
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
  const fallback = fallbackDecision({
    autoRoute,
    memoryRoute,
    hasSkillIndex,
    contextUsage,
    text,
    toolTrace,
  });
  let raw = fallback;
  let source = 'fallback';
  if (typeof judge === 'function') {
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

  const graph = executeGraph({
    coding: true,
    raw,
    fallback,
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
  };
}

export function isCodingRouteToolAllowed(result, toolName) {
  if (toolName === 'run_subagent') {
    return result?.decisions?.subagents?.opted_out !== true;
  }
  if (toolName === 'save_memory') {
    return result?.decisions?.memory?.allow_save_memory === true;
  }
  return true;
}

export function buildCodingRouteDecisionBlock(result) {
  if (!result?.active || !result.decisions) return '';
  const { clarification, memory, skills, subagents, tasks } = result.decisions;
  const skillSelection = skills.selected_names.length > 0
    ? skills.selected_names.join(', ')
    : skills.inject_index
      ? 'candidate index fallback'
      : 'none';
  const subagentFocus = subagents.focus.length > 0
    ? `; focus=${subagents.focus.join(' | ')}`
    : '';
  const suggestedTasks = tasks.items.length > 0
    ? `; suggested=${tasks.items.map((item) => item.content).join(' | ')}`
    : '';
  const questionHint = clarification.suggested_questions.length > 0
    ? `; suggested=${clarification.suggested_questions.join(' | ')}`
    : '';
  return [
    `<coding_harness version="${result.graph_version}" source="${result.source}">`,
    `clarification=${clarification.mode}${questionHint}`,
    `skills=${skillSelection}`,
    `tasks=${tasks.required ? `required${suggestedTasks}` : 'optional'}`,
    `subagents=${subagents.opted_out ? 'disabled' : subagents.enabled ? `recommended:${subagents.recommended_count}${subagentFocus}` : 'optional'}`,
    `memory=${memory.leaf}; save_memory=${memory.allow_save_memory ? 'enabled' : 'disabled'}`,
    skills.selected_names.length > 0
      ? 'Apply selected skills as active workflows.'
      : '',
    subagents.enabled
      ? 'Delegate only the routed bounded work; the parent owns integration and final verification.'
      : '',
    tasks.required
      ? 'Call tasks before major tool work; keep one item in_progress and settle the list before final.'
      : '',
    clarification.mode === 'ask'
      ? 'Inspect first; if the material choice remains unresolved, ask before mutation.'
      : '',
    '</coding_harness>',
  ].filter(Boolean).join('\n');
}

export { GRAPH_VERSION as CODING_ROUTE_GRAPH_VERSION };
