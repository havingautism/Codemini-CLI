import { parseModelJsonObject } from './model-json.js';

const GRAPH_VERSION = 'coding-turn-route-v3';
const MAX_SELECTED_SKILLS = 3;
const CONTEXT_ADVISORY_TOKENS = 12000;
const CONTEXT_ADVISORY_PCT = 25;
const CONTEXT_HARD_TOKENS = 24000;
const CONTEXT_HARD_PCT = 40;
const DELEGATION_INTENT_RE =
  /\b(?:test|tests|testing|verify|verification|review|inspect|explore|search|trace|dependency|dependencies|architecture|codebase|repository|repo)\b|测试|验证|复核|审查|查阅|查看项目|项目结构|代码库|仓库|架构|依赖|检索|搜索|追踪|排查|定位/u;

function contextPressure(contextUsage = {}) {
  const estimatedTokens = Number(contextUsage?.estimated_tokens || 0);
  const usagePct = Number(contextUsage?.usage_pct || 0);
  return {
    advisory:
      estimatedTokens >= CONTEXT_ADVISORY_TOKENS
      || usagePct >= CONTEXT_ADVISORY_PCT,
    hard:
      estimatedTokens >= CONTEXT_HARD_TOKENS
      || usagePct >= CONTEXT_HARD_PCT,
  };
}

function hasDefaultDelegationIntent(text = '') {
  return DELEGATION_INTENT_RE.test(String(text || ''));
}
const VALID_MEMORY_LEAVES = new Set(['save_memory', 'dream_inbox', 'ignore']);
const GRAPH_NODES = Object.freeze({
  mode_gate: Object.freeze({
    coding: 'memory_gate',
    bypass: 'bypass_non_coding',
  }),
  bypass_non_coding: Object.freeze({ next: 'complete' }),
  memory_gate: Object.freeze({ next: 'skill_selection_gate' }),
  skill_selection_gate: Object.freeze({ next: 'subagent_gate' }),
  subagent_gate: Object.freeze({ next: 'complete' }),
  complete: Object.freeze({ next: null }),
});

function traverseGraph({ coding = false } = {}) {
  const path = ['mode_gate'];
  let node = coding ? GRAPH_NODES.mode_gate.coding : GRAPH_NODES.mode_gate.bypass;
  while (node) {
    path.push(node);
    node = GRAPH_NODES[node]?.next || null;
  }
  return path;
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
      'Decide only the three named graph nodes. Return strict JSON and no prose.',
      'Optimization objective: maximize useful, user-visible leverage from installed skills and subagents while avoiding obviously wasteful delegation.',
      '',
      'Node rules:',
      '- memory_gate: save_memory only for durable preferences, explicit remember requests, stable conventions, or reusable verified lessons. Use dream_inbox for a potentially reusable task signal that still needs later evidence. Otherwise ignore.',
      '- skill_selection_gate: positively prefer using installed expertise. Select 1 relevant listed skill for any non-trivial coding turn when plausible; select 2-3 when complementary workflows improve implementation, diagnosis, testing, review, or design. Return exact names without a leading slash. Select none only when the turn is purely mechanical or no candidate genuinely fits.',
      '- subagent_gate: positively prefer delegation when a clean-context worker can investigate, test, review, compare options, or implement an isolated chunk. Enable by default for medium/complex tasks and multi-file work. Also enable for a simple task when one independent verification or research pass would add useful evidence. Disable only when the task is atomic and delegation overhead clearly exceeds its value.',
      '- Project exploration rule: repository lookup, architecture discovery, broad code search, dependency tracing, and evidence gathering should normally use a subagent so raw inspection output stays outside the main context.',
      '- Testing rule: delegate test execution and failure triage by default. The main agent may keep only a tiny focused smoke check; broader or noisy verification belongs in a subagent.',
      '- Context-pressure rule: estimated_tokens >= 12000 or usage_pct >= 25 is an advisory signal to prefer delegation. estimated_tokens >= 24000 or usage_pct >= 40 is a hard isolation tier that requires at least 2 subagents.',
      '- When subagents are enabled, recommend 1 worker for one useful independent pass, 2 for complementary implementation/review or parallel investigation, and 3 only for clearly independent complex work. Provide short actionable focus strings.',
      '- Never route secrets or credentials to save_memory.',
      '',
      'Return:',
      '{"memory":{"leaf":"save_memory|dream_inbox|ignore","reason":"..."},"skills":{"selected_names":["exact-skill-name"],"reason":"..."},"subagents":{"enabled":true,"recommended_count":1,"focus":["independent task or verification focus"],"reason":"..."}}',
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
  const delegationIntent = hasDefaultDelegationIntent(text);
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
          ? 'project exploration or testing fallback'
          : 'task-complexity fallback',
    },
  };
}

function normalizeDecision(
  raw,
  fallback,
  {
    sensitive = false,
    hasSkillIndex = false,
    candidates = [],
    contextUsage = {},
    text = '',
  } = {},
) {
  const leaf = VALID_MEMORY_LEAVES.has(raw?.memory?.leaf)
    ? raw.memory.leaf
    : fallback.memory.leaf;
  const eligible = new Set(candidates);
  const selectedNames = [...new Set(
    (Array.isArray(raw?.skills?.selected_names) ? raw.skills.selected_names : [])
      .map((name) => String(name || '').trim().replace(/^\//, ''))
      .filter((name) => eligible.has(name)),
  )].slice(0, MAX_SELECTED_SKILLS);
  const fallbackIndex = raw === fallback && fallback.skills.inject_index === true;
  const pressure = contextPressure(contextUsage);
  const delegationIntent = hasDefaultDelegationIntent(text);
  const subagentsEnabled =
    raw?.subagents?.enabled === true || pressure.hard || delegationIntent;
  const recommendedCount = subagentsEnabled
    ? Math.min(
        3,
        Math.max(
          pressure.hard ? 2 : 1,
          Number.parseInt(raw?.subagents?.recommended_count, 10) || 1,
        ),
      )
    : 0;
  const subagentFocus = subagentsEnabled
    ? (Array.isArray(raw?.subagents?.focus) ? raw.subagents.focus : [])
        .map((focus) => String(focus || '').trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, recommendedCount)
    : [];
  return {
    memory: {
      leaf: sensitive ? 'ignore' : leaf,
      allow_save_memory: !sensitive && leaf === 'save_memory',
      reason: sensitive
        ? 'hard safety gate rejected secret-like content'
        : String(raw?.memory?.reason || fallback.memory.reason || '').slice(0, 240),
    },
    skills: {
      selected_names: selectedNames,
      inject_index: hasSkillIndex && fallbackIndex,
      reason: String(raw?.skills?.reason || fallback.skills.reason || '').slice(0, 240),
    },
    subagents: {
      enabled: subagentsEnabled,
      recommended_count: recommendedCount,
      focus: subagentFocus,
      reason: String(
        pressure.hard
          ? 'hard context-isolation policy'
          : delegationIntent && raw?.subagents?.enabled !== true
            ? 'project exploration or testing policy'
            : raw?.subagents?.reason || fallback.subagents.reason || '',
      ).slice(0, 240),
    },
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
    return {
      active: false,
      graph_version: GRAPH_VERSION,
      path: traverseGraph({ coding: false }),
      decisions: null,
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

  const decisions = normalizeDecision(raw, fallback, {
    sensitive,
    hasSkillIndex,
    candidates,
    contextUsage,
    text,
  });
  return {
    active: true,
    graph_version: GRAPH_VERSION,
    path: traverseGraph({ coding: true }),
    decisions,
    source,
  };
}

export function buildCodingRouteDecisionBlock(result) {
  if (!result?.active || !result.decisions) return '';
  const { memory, skills, subagents } = result.decisions;
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
    `- memory_gate: ${memory.leaf}; save_memory=${memory.allow_save_memory ? 'enabled' : 'disabled'}`,
    `- skill_selection_gate: ${skillSelection}`,
    `- subagent_gate: run_subagent ${subagents.enabled ? `enabled; target=${subagents.recommended_count}${subagentFocus}` : 'disabled'}`,
    skills.selected_names.length > 0
      ? '- Apply every selected skill as an active workflow for this turn; these are not merely reference material.'
      : '',
    subagents.enabled
      ? '- Delegation directive: call run_subagent for the recommended independent work before the final answer. Prefer subagents for repository exploration, broad code reading, broad tests, failure triage, and independent review so their raw output stays out of the main context. Do not skip delegation merely because you could do the work yourself. Put independent read-only workers in the same response so they run in parallel. After changes, the main agent must still run one authoritative focused verification against the final worktree.'
      : '',
    '- These are enforced runtime decisions for this turn. Do not claim a disabled capability is available.',
  ].filter(Boolean).join('\n');
}

export { GRAPH_VERSION as CODING_ROUTE_GRAPH_VERSION };
