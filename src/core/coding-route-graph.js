import { parseModelJsonObject } from './model-json.js';

const GRAPH_VERSION = 'coding-turn-route-v8';
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
const VALID_MEMORY_LEAVES = new Set(['save_memory', 'dream_inbox', 'ignore']);
const MEMORY_LEAF_RANK = Object.freeze({ ignore: 0, dream_inbox: 1, save_memory: 2 });
const GRAPH_NODES = Object.freeze({
  mode_gate: Object.freeze({
    coding: 'memory_gate',
    bypass: 'bypass_non_coding',
  }),
  bypass_non_coding: Object.freeze({ next: 'complete' }),
  memory_gate: Object.freeze({
    next: 'skill_selection_gate',
    decision: 'memory',
    enforcement: 'hard_gate',
    evaluate: normalizeMemoryDecision,
  }),
  skill_selection_gate: Object.freeze({
    next: 'subagent_gate',
    decision: 'skills',
    enforcement: 'injection',
    evaluate: normalizeSkillDecision,
  }),
  subagent_gate: Object.freeze({
    next: 'todo_gate',
    decision: 'subagents',
    enforcement: 'advisory',
    evaluate: normalizeSubagentDecision,
  }),
  todo_gate: Object.freeze({
    next: 'complete',
    decision: 'todos',
    enforcement: 'directive',
    evaluate: normalizeTodoDecision,
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
}) {
  return {
    systemPrompt: [
      'You are the semantic judge inside a coding-turn routing graph.',
      'Decide only the four named graph nodes. Return strict JSON and no prose.',
      'Optimization objective: maximize useful coding leverage while keeping delegation bounded and purposeful.',
      '',
      'Node rules:',
      '- memory_gate: you may downgrade the heuristic memory route, but cannot upgrade it. Keep save_memory only for durable preferences, explicit remember requests, stable conventions, or reusable verified lessons. Use dream_inbox for a potentially reusable task signal that still needs later evidence. Otherwise ignore.',
      '- skill_selection_gate: Select none by default. Select 1 exact listed skill only for a high-confidence workflow match; select 2 only when both are clearly complementary and necessary. Return exact names without a leading slash.',
      '- subagent_gate: decide autonomously whether subagents improve this turn. Prefer delegation for non-trivial coding work when a worker can independently inspect the repository, implement a bounded chunk, run or triage tests, compare options, or review the result. A simple task may still use one worker when it adds useful evidence. Disable only when the work is truly atomic or cannot be split coherently. Decide from the task structure, not from generic keywords.',
      '- todo_gate: require update_todos for work with 3 or more meaningful steps, multiple files or phases, explicit implementation plus verification, debugging with multiple hypotheses, or any non-trivial task likely to span several tool calls. Apply the same rule independently inside each enabled subagent. Do not require it for atomic edits or purely informational turns.',
      '- Context-pressure rule: usage_pct >= 60 is advisory. usage_pct >= 80 is a hard isolation tier that requires 2 subagents.',
      '- When subagents are eligible, recommend 1 worker for one independent pass and 2 only for clearly complementary work. Provide short actionable focus strings.',
      '- Never route secrets or credentials to save_memory.',
      '',
      'Return:',
      '{"memory":{"leaf":"save_memory|dream_inbox|ignore","reason":"..."},"skills":{"selected_names":["exact-skill-name"],"reason":"..."},"subagents":{"enabled":true,"recommended_count":1,"focus":["independent task or verification focus"],"reason":"..."},"todos":{"required":true,"reason":"..."}}',
    ].join('\n'),
    userPrompt: [
      `User turn:\n${String(text || '').trim()}`,
      `Heuristic task route:\n${JSON.stringify(autoRoute || {})}`,
      `Heuristic memory route:\n${JSON.stringify(memoryRoute || {})}`,
      `Main-session context usage:\n${JSON.stringify(contextUsage || {})}`,
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
}) {
  const complexity = String(autoRoute?.complexity || 'simple');
  const pressure = contextPressure(contextUsage);
  const delegationIntent = hasExplicitDelegationIntent(text);
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
    todos: {
      required: complexity === 'medium' || complexity === 'complex',
      reason: complexity === 'medium' || complexity === 'complex'
        ? 'multi-step task-complexity fallback'
        : 'atomic task fallback',
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

function normalizeTodoDecision(raw, fallback) {
  return {
    required: typeof raw?.todos?.required === 'boolean'
      ? raw.todos.required
      : fallback.todos.required,
    reason: String(raw?.todos?.reason || fallback.todos.reason || '').slice(0, 240),
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
  const { memory, skills, subagents, todos } = result.decisions;
  const skillSelection = skills.selected_names.length > 0
    ? skills.selected_names.join(', ')
    : skills.inject_index
      ? 'candidate index fallback'
      : 'none';
  const subagentFocus = subagents.focus.length > 0
    ? `; focus=${subagents.focus.join(' | ')}`
    : '';
  return [
    `Coding Route Graph: ${result.graph_version} (${result.source})`,
    `- memory_gate [${memory.enforcement}]: ${memory.leaf}; save_memory=${memory.allow_save_memory ? 'enabled' : 'disabled'}`,
    `- skill_selection_gate [${skills.enforcement}]: ${skillSelection}`,
    `- subagent_gate [${subagents.enforcement}]: run_subagent ${subagents.opted_out ? 'unavailable by explicit user request' : subagents.enabled ? `recommended; target=${subagents.recommended_count}${subagentFocus}` : 'available; no pre-routing recommendation'}`,
    `- todo_gate [${todos.enforcement}]: update_todos ${todos.required ? 'required' : 'optional'}`,
    skills.selected_names.length > 0
      ? '- Apply every selected skill as an active workflow for this turn; these are not merely reference material.'
      : '',
    subagents.enabled
      ? '- Delegation directive: call run_subagent for the recommended independent work before the final answer. Prefer subagents for repository exploration, broad code reading, broad tests, failure triage, and independent review so their raw output stays out of the main context. Do not skip delegation merely because you could do the work yourself. Put independent read-only workers in the same response so they run in parallel. After changes, the main agent must still run one authoritative focused verification against the final worktree.'
      : '',
    todos.required
      ? '- Todo directive: call update_todos before major tool work, keep exactly one item in_progress, update it as work advances, and settle it before the final answer. Every subagent with multi-step work must maintain its own todo checklist too.'
      : '',
    '- Follow each decision according to its enforcement mode. Advisory decisions guide tool use but do not remove model autonomy.',
  ].filter(Boolean).join('\n');
}

export { GRAPH_VERSION as CODING_ROUTE_GRAPH_VERSION };
