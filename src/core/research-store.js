import { randomUUID } from 'node:crypto';

import { getGlobalDatabase, transaction } from './sqlite-database.js';

export const DEFAULT_RESEARCH_BUDGET = Object.freeze({
  maxWaves: 1,
  maxParallelScouts: 3,
  maxSearches: 25,
  maxFetches: 200,
});

export const DEFAULT_BUDGET_USED = Object.freeze({
  waves: 0,
  searches: 0,
  fetches: 0,
});

/**
 * Soft-stop Scout: max tool calls (research_web_search + research_web_fetch + successful read_artifact) per success criterion.
 * Depth no longer gates per-criterion search counts.
 */
export const RESEARCH_SCOUT_TOOLS_PER_CRITERION = 10;
/** @deprecated Kept for older tests; investigation uses RESEARCH_SCOUT_TOOLS_PER_CRITERION. */
export const RESEARCH_CRITERION_SEARCHES_PER_WAVE = RESEARCH_SCOUT_TOOLS_PER_CRITERION;
/**
 * Single investigation round (no multi-wave chase). Depth only sizes the plan skeleton.
 */
export const RESEARCH_DEPTH_RUNTIME_LIMITS = Object.freeze({
  brief: Object.freeze({ maxWaves: 1, toolsPerCriterion: RESEARCH_SCOUT_TOOLS_PER_CRITERION }),
  standard: Object.freeze({ maxWaves: 1, toolsPerCriterion: RESEARCH_SCOUT_TOOLS_PER_CRITERION }),
  deep: Object.freeze({ maxWaves: 1, toolsPerCriterion: RESEARCH_SCOUT_TOOLS_PER_CRITERION }),
});
/** Loose session fetch ceiling vs planned tool budget (runaway fuse only). */
export const RESEARCH_BUDGET_FETCHES_PER_SEARCH = 1;
/** Explicit tiny budgets below this stay untouched by ensureResearchSessionBudget. */
export const RESEARCH_BUDGET_MIN_SEARCHES = 25;
export const RESEARCH_BUDGET_MIN_FETCHES = 200;
export const RESEARCH_PLAN_DEPTHS = Object.freeze(['brief', 'standard', 'deep']);
export const RESEARCH_PLAN_DEPTH_LIMITS = Object.freeze({
  brief: Object.freeze({ maxQuestions: 2, maxCriteriaPerQuestion: 2 }),
  standard: Object.freeze({ maxQuestions: 4, maxCriteriaPerQuestion: 3 }),
  deep: Object.freeze({ maxQuestions: 6, maxCriteriaPerQuestion: 3 }),
});

export function normalizeResearchPlanDepth(value, fallback = 'standard') {
  const raw = String(value || '').trim().toLowerCase();
  if (RESEARCH_PLAN_DEPTHS.includes(raw)) return raw;
  const fb = String(fallback || 'standard').trim().toLowerCase();
  return RESEARCH_PLAN_DEPTHS.includes(fb) ? fb : 'standard';
}

export function researchPlanDepthLimits(depth) {
  const key = normalizeResearchPlanDepth(depth);
  return RESEARCH_PLAN_DEPTH_LIMITS[key] || RESEARCH_PLAN_DEPTH_LIMITS.standard;
}

/** Max waves for investigation (always one round) + tools-per-criterion fuse. */
export function researchDepthRuntimeLimits(depth) {
  const key = normalizeResearchPlanDepth(depth);
  const row = RESEARCH_DEPTH_RUNTIME_LIMITS[key] || RESEARCH_DEPTH_RUNTIME_LIMITS.standard;
  return {
    maxWaves: 1,
    toolsPerCriterion: Number(row.toolsPerCriterion) || RESEARCH_SCOUT_TOOLS_PER_CRITERION,
    // Compat alias for older call sites / UI that still read search caps.
    searchesPerCriterionPerWave: Number(row.toolsPerCriterion) || RESEARCH_SCOUT_TOOLS_PER_CRITERION,
  };
}

/**
 * Infer a plan depth when the model omits it, from the main question / goal wording.
 */
export function inferResearchPlanDepth({ question = '', goal = '' } = {}) {
  const text = `${question} ${goal}`.toLowerCase();
  const briefHints = [
    '简短', '简单', '快速', '概览', '简介', '一眼', '一句话',
    'brief', 'quick', 'short', 'simple', 'overview', 'tl;dr', 'tldr', 'eli5',
  ];
  const deepHints = [
    '深入', '详尽', '全面', '对比决策', '系统梳理', '调研报告',
    'deep', 'thorough', 'comprehensive', 'exhaustive', 'in-depth', 'detailed analysis',
  ];
  if (briefHints.some((hint) => text.includes(hint))) return 'brief';
  if (deepHints.some((hint) => text.includes(hint))) return 'deep';
  return 'standard';
}

/**
 * Normalize plan questions without truncating. Returns depth + normalized questions.
 */
export function normalizeResearchPlanDraft(plan = {}, options = {}) {
  const src = plan && typeof plan === 'object' ? plan : {};
  const depth = normalizeResearchPlanDepth(
    options.depth || src.depth,
    options.fallbackDepth || 'standard',
  );
  const questions = (Array.isArray(src.questions) ? src.questions : [])
    .map((question, index) => {
      const criteria = normalizeSuccessCriteria(
        question?.successCriteria ?? question?.success_criteria ?? [],
      );
      return {
        tempId: String(question?.tempId || question?.id || `q${index + 1}`),
        text: String(question?.text || '').trim(),
        successCriteria: criteria,
        dependsOn: Array.isArray(question?.dependsOn)
          ? question.dependsOn.map(String)
          : [],
      };
    })
    .filter((question) => question.text);
  return {
    ...src,
    depth,
    questions,
  };
}

/**
 * Validate plan size against depth budgets. Does not truncate — caller should
 * reject and ask the planner to resubmit a smaller plan.
 */
export function validateResearchPlanByDepth(plan = {}, options = {}) {
  const normalized = normalizeResearchPlanDraft(plan, options);
  const limits = researchPlanDepthLimits(normalized.depth);
  if (!normalized.questions.length) {
    return {
      ok: false,
      error: 'questions array is required',
      depth: normalized.depth,
      limits,
      plan: normalized,
    };
  }
  if (normalized.questions.length > limits.maxQuestions) {
    return {
      ok: false,
      error: `depth "${normalized.depth}" allows at most ${limits.maxQuestions} sub-questions; got ${normalized.questions.length}. Resubmit a smaller plan that fits this depth.`,
      depth: normalized.depth,
      limits,
      plan: normalized,
      questionCount: normalized.questions.length,
    };
  }
  for (const question of normalized.questions) {
    const count = question.successCriteria.length;
    if (count > limits.maxCriteriaPerQuestion) {
      return {
        ok: false,
        error: `depth "${normalized.depth}" allows at most ${limits.maxCriteriaPerQuestion} success criteria per sub-question; "${question.tempId}" has ${count}. Resubmit with fewer criteria.`,
        depth: normalized.depth,
        limits,
        plan: normalized,
        questionId: question.tempId,
        criteriaCount: count,
      };
    }
  }
  return {
    ok: true,
    depth: normalized.depth,
    limits,
    plan: {
      ...normalized,
      questions: normalized.questions.map((question) => ({
        ...question,
        successCriteria: question.successCriteria.length
          ? question.successCriteria
          : [{ text: 'Answer with reliable, attributable evidence' }],
      })),
    },
  };
}

export function normalizeSuccessCriterion(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const text = String(item.text || item.criterion || item.description || '').trim();
    return { text };
  }
  return {
    text: String(item || '').trim(),
  };
}

export function normalizeSuccessCriteria(list = []) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeSuccessCriterion).filter((item) => item.text);
}

export function countResearchCriteria(questions = []) {
  return (Array.isArray(questions) ? questions : []).reduce((sum, question) => {
    const criteria = normalizeSuccessCriteria(
      question?.successCriteria ?? question?.success_criteria ?? [],
    );
    return sum + Math.max(1, criteria.length);
  }, 0);
}

/**
 * Plan flat session tool budgets from criterion count.
 * maxWaves is always 1 (single investigation round).
 * maxSearches/maxFetches are loose session fuses ≈ criteria × tools-per-criterion.
 */
export function planResearchBudget(criterionCount, overrides = {}) {
  const count = Math.max(1, Math.floor(Number(criterionCount) || 1));
  const maxWaves = 1;
  const toolsPerCriterion = Number(overrides.toolsPerCriterion) > 0
    ? Math.floor(Number(overrides.toolsPerCriterion))
    : (Number(overrides.searchesPerWave) > 0
      ? Math.floor(Number(overrides.searchesPerWave))
      : RESEARCH_SCOUT_TOOLS_PER_CRITERION);
  const toolBudget = count * toolsPerCriterion;
  const maxSearches = overrides.maxSearches != null
    ? Math.max(0, Math.floor(Number(overrides.maxSearches) || 0))
    : toolBudget;
  const maxFetches = overrides.maxFetches != null
    ? Math.max(0, Math.floor(Number(overrides.maxFetches) || 0))
    : toolBudget * RESEARCH_BUDGET_FETCHES_PER_SEARCH;
  return normalizeBudget({
    maxWaves,
    maxParallelScouts: overrides.maxParallelScouts,
    maxSearches,
    maxFetches,
  });
}

/**
 * Expand an auto-sized session budget when the plan has more criteria than
 * the previous defaults could support. Leaves intentionally tiny budgets alone.
 */
export function ensureResearchSessionBudget(sessionId) {
  const detail = getResearchSessionDetail(sessionId);
  if (!detail) return null;
  const criterionCount = countResearchCriteria(detail.questions?.length
    ? detail.questions
    : detail.plan?.questions || []);
  if (!criterionCount) return detail;
  const runtime = researchDepthRuntimeLimits(detail.plan?.depth);
  const planned = planResearchBudget(criterionCount, {
    maxWaves: runtime.maxWaves,
    searchesPerWave: runtime.searchesPerCriterionPerWave,
    maxParallelScouts: detail.budget.maxParallelScouts,
  });
  const currentSearches = Number(detail.budget.maxSearches) || 0;
  const currentFetches = Number(detail.budget.maxFetches) || 0;
  const currentWaves = Number(detail.budget.maxWaves) || 0;
  // Test / explicit tight budgets stay below the auto floor.
  if (
    currentSearches < RESEARCH_BUDGET_MIN_SEARCHES
    && currentFetches < RESEARCH_BUDGET_MIN_FETCHES
  ) {
    return detail;
  }
  const next = normalizeBudget({
    ...detail.budget,
    maxWaves: runtime.maxWaves,
    maxParallelScouts: detail.budget.maxParallelScouts,
    maxSearches: Math.max(currentSearches, planned.maxSearches),
    maxFetches: Math.max(currentFetches, planned.maxFetches),
  });
  if (
    next.maxSearches === currentSearches
    && next.maxFetches === currentFetches
    && next.maxWaves === currentWaves
  ) {
    return detail;
  }
  return updateResearchSession(sessionId, { budget: next });
}

const QUESTION_STATUSES = new Set([
  'pending',
  'in_progress',
  'open',
  'partial',
  'done',
  'blocked',
]);

const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);
const EVIDENCE_STATUSES = new Set(['accepted', 'revoked']);
const CREATED_FROM = new Set(['scout_handoff', 'lead_direct', 'seed']);
const UNFINISHED_STATUSES = new Set(['pending', 'in_progress', 'open', 'partial', 'blocked']);
const WAVE_STATUSES = new Set(['running', 'evaluating', 'completed', 'failed', 'aborted']);
const SCOUT_RUN_STATUSES = new Set(['running', 'done', 'partial', 'blocked', 'failed', 'aborted']);
const RESEARCH_RUN_STATES = new Set(['idle', 'running', 'paused', 'failed', 'completed']);
const RESEARCH_RUN_PHASES = new Set(['planning', 'investigating', 'writing']);

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function sumLegacyPools(pools, field) {
  if (!pools || typeof pools !== 'object') return 0;
  const base = Number(pools.base?.[field]) || 0;
  const followup = Number(pools.followup?.[field]) || 0;
  return Math.max(0, Math.floor(base + followup));
}

function normalizeBudget(input) {
  const src = input && typeof input === 'object' ? input : {};
  let maxSearches = Number(src.maxSearches) > 0 ? Math.floor(Number(src.maxSearches)) : 0;
  let maxFetches = Number(src.maxFetches) > 0 ? Math.floor(Number(src.maxFetches)) : 0;
  // Migrate legacy dual-pool sessions by summing pool caps into flat totals.
  if (src.pools && typeof src.pools === 'object') {
    const pooledSearches = sumLegacyPools(src.pools, 'maxSearches');
    const pooledFetches = sumLegacyPools(src.pools, 'maxFetches');
    if (pooledSearches > maxSearches) maxSearches = pooledSearches;
    if (pooledFetches > maxFetches) maxFetches = pooledFetches;
  }
  return {
    maxWaves: Number(src.maxWaves) > 0 ? Math.floor(Number(src.maxWaves)) : DEFAULT_RESEARCH_BUDGET.maxWaves,
    maxParallelScouts: Number(src.maxParallelScouts) > 0
      ? Math.floor(Number(src.maxParallelScouts))
      : DEFAULT_RESEARCH_BUDGET.maxParallelScouts,
    maxSearches: maxSearches > 0 ? maxSearches : DEFAULT_RESEARCH_BUDGET.maxSearches,
    maxFetches: maxFetches > 0 ? maxFetches : DEFAULT_RESEARCH_BUDGET.maxFetches,
  };
}

function normalizeBudgetUsed(input) {
  const src = input && typeof input === 'object' ? input : {};
  let searches = Math.max(0, Math.floor(Number(src.searches) || 0));
  let fetches = Math.max(0, Math.floor(Number(src.fetches) || 0));
  if (src.pools && typeof src.pools === 'object') {
    searches = Math.max(searches, sumLegacyPools(src.pools, 'searches'));
    fetches = Math.max(fetches, sumLegacyPools(src.pools, 'fetches'));
  }
  return {
    waves: Math.max(0, Math.floor(Number(src.waves) || 0)),
    searches,
    fetches,
  };
}

function normalizeSeed(seeds = []) {
  if (!Array.isArray(seeds)) return [];
  return seeds
    .map((item) => ({
      label: String(item?.label || item?.name || 'seed').trim() || 'seed',
      text: String(item?.text || '').trim(),
    }))
    .filter((item) => item.text);
}

function normalizePreferences(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    goal: String(src.goal || '').trim(),
    constraints: String(src.constraints || '').trim(),
    clarify: src.clarify && typeof src.clarify === 'object' ? src.clarify : {},
  };
}

function normalizeConfidence(value) {
  const raw = String(value || 'medium').toLowerCase();
  return CONFIDENCE_LEVELS.has(raw) ? raw : 'medium';
}

const CONCLUSION_COMPLETENESS = new Set(['complete', 'partial', 'insufficient']);

export function normalizeResearchConclusions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const completeness = String(item.completeness || 'partial').toLowerCase();
      return {
        questionId: String(item.questionId || item.question_id || '').trim(),
        completeness: CONCLUSION_COMPLETENESS.has(completeness) ? completeness : 'partial',
        summary: String(item.summary || '').trim(),
        limitations: String(item.limitations || '').trim(),
        evidenceIds: Array.isArray(item.evidenceIds || item.evidence_ids)
          ? [...new Set((item.evidenceIds || item.evidence_ids).map((id) => String(id || '').trim()).filter(Boolean))]
          : [],
      };
    })
    .filter((item) => item.questionId);
}

function normalizeResearchRunState(value) {
  const state = String(value || 'idle').toLowerCase();
  return RESEARCH_RUN_STATES.has(state) ? state : 'idle';
}

function normalizeResearchRunPhase(value) {
  const phase = String(value || '').toLowerCase();
  return RESEARCH_RUN_PHASES.has(phase) ? phase : '';
}

export function extractResearchResumeCheckpoint(timeline = []) {
  const list = Array.isArray(timeline) ? timeline : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index];
    if (entry?.type !== 'resume_checkpoint') continue;
    const step = String(entry.step || '').trim();
    if (!step) continue;
    return {
      step,
      questionId: String(entry.questionId || ''),
      criterionId: String(entry.criterionId || ''),
      scoutRunId: String(entry.scoutRunId || ''),
      error: String(entry.error || ''),
      at: String(entry.at || ''),
    };
  }
  return null;
}

function mapSession(row) {
  if (!row) return null;
  const timeline = Array.isArray(parseJson(row.timeline_json, []))
    ? parseJson(row.timeline_json, [])
    : [];
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    question: row.question || '',
    preferences: normalizePreferences(parseJson(row.preferences_json, {})),
    seed: normalizeSeed(parseJson(row.seed_json, [])),
    budget: normalizeBudget(parseJson(row.budget_json, {})),
    budgetUsed: normalizeBudgetUsed(parseJson(row.budget_used_json, {})),
    phase: row.phase || 'planning',
    runState: normalizeResearchRunState(row.run_state),
    lastRunPhase: normalizeResearchRunPhase(row.last_run_phase),
    lastError: row.last_error || '',
    plan: parseJson(row.plan_json, {}) || {},
    timeline,
    resumeCheckpoint: extractResearchResumeCheckpoint(timeline),
    conclusions: normalizeResearchConclusions(parseJson(row.conclusions_json, [])),
    reportMarkdown: row.report_markdown || '',
  };
}

function mapQuestion(row) {
  if (!row) return null;
  const coverage = parseJson(row.coverage_json, {}) || {};
  return {
    id: row.id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ordinal: Number(row.ordinal) || 0,
    text: row.text || '',
    successCriteria: normalizeSuccessCriteria(parseJson(row.success_criteria_json, [])),
    dependsOn: Array.isArray(parseJson(row.depends_on_json, []))
      ? parseJson(row.depends_on_json, [])
      : [],
    status: row.status || 'pending',
    criteriaMet: Array.isArray(parseJson(row.criteria_met_json, []))
      ? parseJson(row.criteria_met_json, [])
      : [],
    gaps: Array.isArray(parseJson(row.gaps_json, [])) ? parseJson(row.gaps_json, []) : [],
    coverage: coverage && typeof coverage === 'object' && !Array.isArray(coverage) ? coverage : {},
    lastScoutAt: row.last_scout_at || '',
  };
}

function normalizeEvidenceSources(item = {}) {
  const raw = Array.isArray(item?.sources) && item.sources.length
    ? item.sources
    : (String(item?.url || '').trim() || String(item?.snippet || '').trim()
      ? [{
        url: item.url,
        snippet: item.snippet,
        artifactId: item.artifactId || '',
      }]
      : []);
  const seen = new Set();
  const sources = [];
  for (const source of raw) {
    const url = String(source?.url || '').trim().replace(/\/$/, '');
    const snippet = String(source?.snippet || '').trim().slice(0, 1200);
    const artifactId = String(source?.artifactId || '').trim().slice(0, 120);
    if (!url && !snippet) continue;
    const key = url || `snippet:${snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ url, snippet, artifactId });
    if (sources.length >= 3) break;
  }
  return sources;
}

function mapEvidence(row) {
  if (!row) return null;
  const criterionIds = parseJson(row.criterion_ids_json, []);
  const sources = normalizeEvidenceSources({
    sources: parseJson(row.sources_json, []),
    url: row.url,
    snippet: row.snippet,
  });
  return {
    id: row.id,
    sessionId: row.session_id,
    questionId: row.question_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claim: row.claim || '',
    sources,
    // Compatibility mirrors for older readers.
    snippet: sources[0]?.snippet || row.snippet || '',
    url: sources[0]?.url || row.url || '',
    sourceLabel: row.source_label || '',
    confidence: normalizeConfidence(row.confidence),
    status: row.status || 'accepted',
    createdFrom: row.created_from || 'scout_handoff',
    originCandidateId: row.origin_candidate_id || '',
    criterionIds: Array.isArray(criterionIds) ? criterionIds.map(String).filter(Boolean) : [],
  };
}

function mapWave(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    wave: Number(row.wave_no) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || '',
    completedAt: row.completed_at || '',
    status: row.status || 'running',
    targets: Array.isArray(parseJson(row.targets_json, [])) ? parseJson(row.targets_json, []) : [],
    evaluation: parseJson(row.evaluation_json, {}) || {},
  };
}

function mapScoutRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    waveId: row.wave_id,
    questionId: row.question_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || '',
    name: row.name || 'Investigator',
    status: row.status || 'running',
    ledger: parseJson(row.ledger_json, {}) || {},
    decision: parseJson(row.decision_json, {}) || {},
    handoffMarkdown: row.handoff_markdown || '',
    searchCount: Math.max(0, Number(row.search_count) || 0),
    fetchCount: Math.max(0, Number(row.fetch_count) || 0),
    committedCandidateIds: Array.isArray(parseJson(row.committed_candidate_ids_json, []))
      ? parseJson(row.committed_candidate_ids_json, [])
      : [],
    committedEvidenceIds: Array.isArray(parseJson(row.committed_evidence_ids_json, []))
      ? parseJson(row.committed_evidence_ids_json, [])
      : [],
    error: row.error_text || '',
  };
}

export function createResearchSession({
  question,
  preferences = {},
  seed = [],
  budget = {},
  phase = 'planning',
} = {}) {
  const trimmed = String(question || '').trim();
  if (!trimmed) throw new Error('question is required');
  const id = `rs_${randomUUID()}`;
  const now = nowIso();
  const prefs = normalizePreferences(preferences);
  const seeds = normalizeSeed(seed);
  const budgetNorm = normalizeBudget(budget);
  const used = { ...DEFAULT_BUDGET_USED };
  getGlobalDatabase().prepare(`
    INSERT INTO research_sessions(
      id, created_at, updated_at, question, preferences_json, seed_json,
      budget_json, budget_used_json, phase, plan_json, timeline_json, report_markdown
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '[]', '')
  `).run(
    id,
    now,
    now,
    trimmed,
    toJson(prefs),
    toJson(seeds),
    toJson(budgetNorm),
    toJson(used),
    String(phase || 'planning'),
  );
  return getResearchSession(id);
}

export function listResearchSessions({ query = '' } = {}) {
  const db = getGlobalDatabase();
  const trimmed = String(query || '').trim();
  const rows = trimmed
    ? db.prepare(`
        SELECT * FROM research_sessions
        WHERE lower(question) LIKE '%' || lower(?) || '%'
           OR lower(report_markdown) LIKE '%' || lower(?) || '%'
        ORDER BY updated_at DESC, created_at DESC
      `).all(trimmed, trimmed)
    : db.prepare(`
        SELECT * FROM research_sessions
        ORDER BY updated_at DESC, created_at DESC
      `).all();
  return rows.map(mapSession);
}

export function getResearchSession(sessionId) {
  const row = getGlobalDatabase()
    .prepare('SELECT * FROM research_sessions WHERE id = ?')
    .get(String(sessionId || ''));
  return mapSession(row);
}

export function deleteResearchSession(sessionId) {
  const result = getGlobalDatabase()
    .prepare('DELETE FROM research_sessions WHERE id = ?')
    .run(String(sessionId || ''));
  return result.changes > 0;
}

export function updateResearchSession(sessionId, patch = {}) {
  const current = getResearchSession(sessionId);
  if (!current) return null;
  const next = {
    question: patch.question != null ? String(patch.question) : current.question,
    preferences: patch.preferences != null
      ? normalizePreferences({ ...current.preferences, ...patch.preferences })
      : current.preferences,
    seed: patch.seed != null ? normalizeSeed(patch.seed) : current.seed,
    budget: patch.budget != null ? normalizeBudget(patch.budget) : current.budget,
    budgetUsed: patch.budgetUsed != null
      ? normalizeBudgetUsed(patch.budgetUsed)
      : current.budgetUsed,
    phase: patch.phase != null ? String(patch.phase) : current.phase,
    runState: patch.runState != null
      ? normalizeResearchRunState(patch.runState)
      : current.runState,
    lastRunPhase: patch.lastRunPhase != null
      ? normalizeResearchRunPhase(patch.lastRunPhase)
      : current.lastRunPhase,
    lastError: patch.lastError != null ? String(patch.lastError) : current.lastError,
    plan: patch.plan != null ? patch.plan : current.plan,
    timeline: patch.timeline != null
      ? (Array.isArray(patch.timeline) ? patch.timeline : current.timeline)
      : current.timeline,
    reportMarkdown: patch.reportMarkdown != null
      ? String(patch.reportMarkdown)
      : current.reportMarkdown,
    conclusions: patch.conclusions != null
      ? normalizeResearchConclusions(patch.conclusions)
      : current.conclusions,
  };
  const now = nowIso();
  getGlobalDatabase().prepare(`
    UPDATE research_sessions
    SET updated_at = ?, question = ?, preferences_json = ?, seed_json = ?,
        budget_json = ?, budget_used_json = ?, phase = ?, run_state = ?,
        last_run_phase = ?, last_error = ?, plan_json = ?, timeline_json = ?,
        conclusions_json = ?, report_markdown = ?
    WHERE id = ?
  `).run(
    now,
    next.question,
    toJson(next.preferences),
    toJson(next.seed),
    toJson(next.budget),
    toJson(next.budgetUsed),
    next.phase,
    next.runState,
    next.lastRunPhase,
    next.lastError,
    toJson(next.plan || {}),
    toJson(next.timeline || []),
    toJson(next.conclusions || []),
    next.reportMarkdown,
    current.id,
  );
  return getResearchSession(current.id);
}

export function updateResearchRunState(sessionId, {
  state,
  phase,
  error,
} = {}) {
  return updateResearchSession(sessionId, {
    runState: state,
    lastRunPhase: phase,
    lastError: error == null ? undefined : String(error),
  });
}

export function appendResearchTimeline(sessionId, entry) {
  const current = getResearchSession(sessionId);
  if (!current) return null;
  const nextEntry = {
    id: String(entry?.id || `tl_${randomUUID()}`),
    at: String(entry?.at || nowIso()),
    type: String(entry?.type || 'event'),
    ...(entry && typeof entry === 'object' ? entry : {}),
  };
  const timeline = [...(current.timeline || []), nextEntry];
  return updateResearchSession(sessionId, { timeline });
}

export function setResearchResumeCheckpoint(sessionId, checkpoint = {}) {
  const current = getResearchSession(sessionId);
  if (!current) return null;
  const timeline = (current.timeline || []).filter((entry) => entry?.type !== 'resume_checkpoint');
  timeline.push({
    id: `tl_${randomUUID()}`,
    at: nowIso(),
    type: 'resume_checkpoint',
    step: String(checkpoint.step || ''),
    questionId: String(checkpoint.questionId || ''),
    criterionId: String(checkpoint.criterionId || ''),
    scoutRunId: String(checkpoint.scoutRunId || ''),
    error: String(checkpoint.error || ''),
  });
  return updateResearchSession(sessionId, { timeline });
}

export function clearResearchResumeCheckpoint(sessionId) {
  const current = getResearchSession(sessionId);
  if (!current) return null;
  const timeline = (current.timeline || []).filter((entry) => entry?.type !== 'resume_checkpoint');
  if (timeline.length === (current.timeline || []).length) return current;
  return updateResearchSession(sessionId, { timeline });
}

export function listResearchQuestions(sessionId) {
  const rows = getGlobalDatabase().prepare(`
    SELECT * FROM research_questions
    WHERE session_id = ?
    ORDER BY ordinal ASC, created_at ASC
  `).all(String(sessionId || ''));
  return rows.map(mapQuestion);
}

export function getResearchQuestion(questionId) {
  const row = getGlobalDatabase()
    .prepare('SELECT * FROM research_questions WHERE id = ?')
    .get(String(questionId || ''));
  return mapQuestion(row);
}

export function updateResearchQuestion(questionId, patch = {}) {
  const current = getResearchQuestion(questionId);
  if (!current) return null;
  const status = patch.status != null ? String(patch.status) : current.status;
  if (!QUESTION_STATUSES.has(status)) {
    throw new Error(`invalid question status: ${status}`);
  }
  const next = {
    text: patch.text != null ? String(patch.text) : current.text,
    successCriteria: patch.successCriteria != null
      ? normalizeSuccessCriteria(
        Array.isArray(patch.successCriteria) ? patch.successCriteria : current.successCriteria,
      )
      : current.successCriteria,
    dependsOn: patch.dependsOn != null
      ? (Array.isArray(patch.dependsOn) ? patch.dependsOn : current.dependsOn)
      : current.dependsOn,
    status,
    criteriaMet: patch.criteriaMet != null
      ? (Array.isArray(patch.criteriaMet) ? patch.criteriaMet : current.criteriaMet)
      : current.criteriaMet,
    gaps: patch.gaps != null
      ? (Array.isArray(patch.gaps) ? patch.gaps.map((g) => String(g)) : current.gaps)
      : current.gaps,
    coverage: patch.coverage != null
      ? (patch.coverage && typeof patch.coverage === 'object' && !Array.isArray(patch.coverage)
        ? patch.coverage
        : current.coverage)
      : current.coverage,
    lastScoutAt: patch.lastScoutAt != null ? String(patch.lastScoutAt) : current.lastScoutAt,
    ordinal: patch.ordinal != null ? Number(patch.ordinal) : current.ordinal,
  };
  const now = nowIso();
  getGlobalDatabase().prepare(`
    UPDATE research_questions
    SET updated_at = ?, ordinal = ?, text = ?, success_criteria_json = ?, depends_on_json = ?,
        status = ?, criteria_met_json = ?, gaps_json = ?, coverage_json = ?, last_scout_at = ?
    WHERE id = ?
  `).run(
    now,
    next.ordinal,
    next.text,
    toJson(next.successCriteria),
    toJson(next.dependsOn),
    next.status,
    toJson(next.criteriaMet),
    toJson(next.gaps),
    toJson(next.coverage || {}),
    next.lastScoutAt,
    current.id,
  );
  return getResearchQuestion(current.id);
}

export function createResearchWave(sessionId, {
  wave,
  targets = [],
  status = 'running',
  evaluation = {},
} = {}) {
  const session = getResearchSession(sessionId);
  if (!session) throw new Error('research session not found');
  const waveNo = Math.max(1, Math.floor(Number(wave) || 1));
  const normalizedStatus = WAVE_STATUSES.has(String(status)) ? String(status) : 'running';
  const id = `rw_${randomUUID()}`;
  const now = nowIso();
  getGlobalDatabase().prepare(`
    INSERT INTO research_waves(
      id, session_id, wave_no, created_at, updated_at, started_at,
      completed_at, status, targets_json, evaluation_json
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)
  `).run(
    id,
    session.id,
    waveNo,
    now,
    now,
    now,
    normalizedStatus,
    toJson(Array.isArray(targets) ? targets : []),
    toJson(evaluation || {}),
  );
  return getResearchWave(id);
}

export function getResearchWave(waveId) {
  const row = getGlobalDatabase()
    .prepare('SELECT * FROM research_waves WHERE id = ?')
    .get(String(waveId || ''));
  return mapWave(row);
}

export function listResearchWaves(sessionId) {
  return getGlobalDatabase().prepare(`
    SELECT * FROM research_waves
    WHERE session_id = ?
    ORDER BY wave_no ASC
  `).all(String(sessionId || '')).map(mapWave);
}

export function updateResearchWave(waveId, patch = {}) {
  const current = getResearchWave(waveId);
  if (!current) return null;
  const status = patch.status != null ? String(patch.status) : current.status;
  if (!WAVE_STATUSES.has(status)) throw new Error(`invalid research wave status: ${status}`);
  const now = nowIso();
  const completedAt = patch.completedAt != null
    ? String(patch.completedAt)
    : ['completed', 'failed', 'aborted'].includes(status)
      ? (current.completedAt || now)
      : current.completedAt;
  getGlobalDatabase().prepare(`
    UPDATE research_waves
    SET updated_at = ?, completed_at = ?, status = ?, targets_json = ?, evaluation_json = ?
    WHERE id = ?
  `).run(
    now,
    completedAt,
    status,
    toJson(patch.targets != null ? patch.targets : current.targets),
    toJson(patch.evaluation != null ? patch.evaluation : current.evaluation),
    current.id,
  );
  return getResearchWave(current.id);
}

export function createResearchScoutRun({
  sessionId,
  waveId,
  questionId,
  name = 'Investigator',
  ledger = {},
  status = 'running',
} = {}) {
  const wave = getResearchWave(waveId);
  const question = getResearchQuestion(questionId);
  if (!wave || wave.sessionId !== String(sessionId || '')) throw new Error('research wave not found');
  if (!question || question.sessionId !== wave.sessionId) throw new Error('research question not found');
  const normalizedStatus = SCOUT_RUN_STATUSES.has(String(status)) ? String(status) : 'running';
  const id = `sr_${randomUUID()}`;
  const now = nowIso();
  getGlobalDatabase().prepare(`
    INSERT INTO research_scout_runs(
      id, session_id, wave_id, question_id, created_at, updated_at, completed_at,
      name, status, ledger_json, decision_json, handoff_markdown,
      search_count, fetch_count, committed_candidate_ids_json,
      committed_evidence_ids_json, error_text
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, '{}', '', 0, 0, '[]', '[]', '')
  `).run(
    id,
    wave.sessionId,
    wave.id,
    question.id,
    now,
    now,
    String(name || 'Investigator'),
    normalizedStatus,
    toJson(ledger || {}),
  );
  return getResearchScoutRun(id);
}

export function getResearchScoutRun(runId) {
  const row = getGlobalDatabase()
    .prepare('SELECT * FROM research_scout_runs WHERE id = ?')
    .get(String(runId || ''));
  return mapScoutRun(row);
}

export function listResearchScoutRuns({ sessionId, waveId, questionId } = {}) {
  const clauses = [];
  const params = [];
  if (sessionId) {
    clauses.push('session_id = ?');
    params.push(String(sessionId));
  }
  if (waveId) {
    clauses.push('wave_id = ?');
    params.push(String(waveId));
  }
  if (questionId) {
    clauses.push('question_id = ?');
    params.push(String(questionId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getGlobalDatabase().prepare(`
    SELECT * FROM research_scout_runs
    ${where}
    ORDER BY created_at ASC
  `).all(...params).map(mapScoutRun);
}

export function updateResearchScoutRun(runId, patch = {}) {
  const current = getResearchScoutRun(runId);
  if (!current) return null;
  const status = patch.status != null ? String(patch.status) : current.status;
  if (!SCOUT_RUN_STATUSES.has(status)) throw new Error(`invalid scout run status: ${status}`);
  const now = nowIso();
  const completedAt = patch.completedAt != null
    ? String(patch.completedAt)
    : ['done', 'partial', 'blocked', 'failed', 'aborted'].includes(status)
      ? (current.completedAt || now)
      : current.completedAt;
  getGlobalDatabase().prepare(`
    UPDATE research_scout_runs
    SET updated_at = ?, completed_at = ?, name = ?, status = ?, ledger_json = ?,
        decision_json = ?, handoff_markdown = ?, search_count = ?, fetch_count = ?,
        committed_candidate_ids_json = ?, committed_evidence_ids_json = ?, error_text = ?
    WHERE id = ?
  `).run(
    now,
    completedAt,
    patch.name != null ? String(patch.name) : current.name,
    status,
    toJson(patch.ledger != null ? patch.ledger : current.ledger),
    toJson(patch.decision != null ? patch.decision : current.decision),
    patch.handoffMarkdown != null ? String(patch.handoffMarkdown) : current.handoffMarkdown,
    patch.searchCount != null ? Math.max(0, Math.floor(Number(patch.searchCount) || 0)) : current.searchCount,
    patch.fetchCount != null ? Math.max(0, Math.floor(Number(patch.fetchCount) || 0)) : current.fetchCount,
    toJson(patch.committedCandidateIds != null ? patch.committedCandidateIds : current.committedCandidateIds),
    toJson(patch.committedEvidenceIds != null ? patch.committedEvidenceIds : current.committedEvidenceIds),
    patch.error != null ? String(patch.error) : current.error,
    current.id,
  );
  return getResearchScoutRun(current.id);
}

/**
 * Confirm plan: insert research_questions from plan_json.questions and set phase investigating.
 */
export function confirmResearchPlan(sessionId, planOverride = null) {
  const session = getResearchSession(sessionId);
  if (!session) throw new Error('research session not found');
  const rawPlan = planOverride && typeof planOverride === 'object' ? planOverride : session.plan;
  const inferred = inferResearchPlanDepth({
    question: session.question,
    goal: rawPlan?.goal || session.preferences?.goal,
  });
  const requested = normalizeResearchPlanDepth(rawPlan?.depth, inferred);
  const depth = inferred === 'brief' ? 'brief' : requested;
  const validated = validateResearchPlanByDepth({ ...rawPlan, depth }, { depth });
  if (!validated.ok) throw new Error(validated.error || 'plan exceeds depth budget');
  const plan = validated.plan;
  const questions = Array.isArray(plan?.questions) ? plan.questions : [];
  if (!questions.length) throw new Error('plan must include at least one question');

  const tempIds = questions.map((q, index) => String(q.tempId || q.id || `q${index + 1}`));
  const idByTemp = new Map();
  for (const tempId of tempIds) {
    if (idByTemp.has(tempId)) throw new Error(`duplicate tempId: ${tempId}`);
    idByTemp.set(tempId, `rq_${randomUUID()}`);
  }

  for (const q of questions) {
    const tempId = String(q.tempId || q.id || '');
    const deps = Array.isArray(q.dependsOn) ? q.dependsOn.map(String) : [];
    for (const dep of deps) {
      if (!idByTemp.has(dep)) throw new Error(`unknown dependsOn tempId: ${dep}`);
    }
  }

  const now = nowIso();
  const db = getGlobalDatabase();
  return transaction(db, () => {
    db.prepare('DELETE FROM research_waves WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM research_evidence WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM research_questions WHERE session_id = ?').run(session.id);

    const insertQ = db.prepare(`
      INSERT INTO research_questions(
        id, session_id, created_at, updated_at, ordinal, text,
        success_criteria_json, depends_on_json, status, criteria_met_json, gaps_json,
        coverage_json, last_scout_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', '[]', '{}', '')
    `);

    const resolvedQuestions = questions.map((q, index) => {
      const tempId = String(q.tempId || q.id || `q${index + 1}`);
      const id = idByTemp.get(tempId);
      const dependsOn = (Array.isArray(q.dependsOn) ? q.dependsOn : [])
        .map((dep) => idByTemp.get(String(dep)))
        .filter(Boolean);
      const successCriteria = normalizeSuccessCriteria(
        Array.isArray(q.successCriteria) ? q.successCriteria : [],
      );
      insertQ.run(
        id,
        session.id,
        now,
        now,
        index,
        String(q.text || '').trim(),
        toJson(successCriteria),
        toJson(dependsOn),
      );
      return {
        tempId,
        id,
        text: String(q.text || '').trim(),
        successCriteria,
        dependsOn,
      };
    });

    const goal = String(plan?.goal || session.preferences?.goal || '').trim();
    const preferences = normalizePreferences({
      ...session.preferences,
      ...(goal ? { goal } : {}),
    });
    const nextPlan = {
      ...plan,
      goal,
      depth: plan.depth || depth,
      questions: resolvedQuestions.map((q) => ({
        id: q.id,
        tempId: q.tempId,
        text: q.text,
        successCriteria: q.successCriteria,
        dependsOn: q.dependsOn,
      })),
      coverageChecklist: Array.isArray(plan?.coverageChecklist) ? plan.coverageChecklist : [],
    };
    const criterionCount = countResearchCriteria(resolvedQuestions);
    const runtime = researchDepthRuntimeLimits(depth);
    const autoBudget = planResearchBudget(criterionCount, {
      maxWaves: runtime.maxWaves,
      searchesPerWave: runtime.searchesPerCriterionPerWave,
      maxParallelScouts: session.budget.maxParallelScouts,
    });
    const looksLikeDefaultBudget = session.budget.maxSearches === DEFAULT_RESEARCH_BUDGET.maxSearches
      && session.budget.maxFetches === DEFAULT_RESEARCH_BUDGET.maxFetches;
    const plannedBudget = looksLikeDefaultBudget
      ? autoBudget
      : normalizeBudget({
        ...session.budget,
        maxWaves: runtime.maxWaves,
      });

    db.prepare(`
      UPDATE research_sessions
      SET updated_at = ?, phase = 'investigating', plan_json = ?, preferences_json = ?,
          timeline_json = '[]', budget_json = ?, budget_used_json = ?, run_state = 'idle',
          last_run_phase = 'investigating', last_error = ''
      WHERE id = ?
    `).run(
      now,
      toJson(nextPlan),
      toJson(preferences),
      toJson(plannedBudget),
      toJson(DEFAULT_BUDGET_USED),
      session.id,
    );

    return getResearchSessionDetail(session.id);
  });
}

export function listResearchEvidence(sessionId, { status = null } = {}) {
  const db = getGlobalDatabase();
  const sid = String(sessionId || '');
  const rows = status
    ? db.prepare(`
        SELECT * FROM research_evidence
        WHERE session_id = ? AND status = ?
        ORDER BY created_at ASC
      `).all(sid, String(status))
    : db.prepare(`
        SELECT * FROM research_evidence
        WHERE session_id = ?
        ORDER BY created_at ASC
      `).all(sid);
  return rows.map(mapEvidence);
}

/**
 * Apply Lead commit: insert evidence, revoke, update question statuses, optional checklist.
 */
export function applyResearchCommit(sessionId, commit = {}) {
  const session = getResearchSession(sessionId);
  if (!session) throw new Error('research session not found');
  const errors = [];
  const acceptEvidence = Array.isArray(commit.acceptEvidence) ? commit.acceptEvidence : [];
  const revokeEvidence = Array.isArray(commit.revokeEvidence) ? commit.revokeEvidence : [];
  const questionUpdates = Array.isArray(commit.questionUpdates) ? commit.questionUpdates : [];
  const checklistUpdates = Array.isArray(commit.checklistUpdates) ? commit.checklistUpdates : [];

  const questions = listResearchQuestions(session.id);
  const questionIds = new Set(questions.map((q) => q.id));

  for (const item of acceptEvidence) {
    const qid = String(item?.questionId || '');
    if (!questionIds.has(qid)) errors.push(`unknown questionId for evidence: ${qid}`);
    if (!String(item?.claim || '').trim()) errors.push('evidence claim is required');
  }
  for (const item of questionUpdates) {
    const qid = String(item?.questionId || '');
    if (!questionIds.has(qid)) errors.push(`unknown questionId in questionUpdates: ${qid}`);
    if (item?.status != null && !QUESTION_STATUSES.has(String(item.status))) {
      errors.push(`invalid status: ${item.status}`);
    }
  }

  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.errors = errors;
    throw err;
  }

  const db = getGlobalDatabase();
  return transaction(db, () => {
    const now = nowIso();
    const insertedEvidenceIds = [];
    const reusedEvidenceIds = [];
    const revokedEvidenceIds = [];
    const updatedQuestionIds = [];

    const insertEv = db.prepare(`
      INSERT INTO research_evidence(
        id, session_id, question_id, created_at, updated_at, claim, snippet, url,
        source_label, confidence, status, created_from, origin_candidate_id, criterion_ids_json,
        sources_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?)
    `);
    const existingCandidate = db.prepare(`
      SELECT id FROM research_evidence
      WHERE session_id = ? AND origin_candidate_id = ? AND origin_candidate_id <> ''
    `);

    for (const item of acceptEvidence) {
      const candidateId = String(item?.candidateId || item?.originCandidateId || '').trim();
      const existing = candidateId ? existingCandidate.get(session.id, candidateId) : null;
      if (existing?.id) {
        reusedEvidenceIds.push(String(existing.id));
        continue;
      }
      const id = `ev_${randomUUID()}`;
      const createdFrom = CREATED_FROM.has(String(item.createdFrom || ''))
        ? String(item.createdFrom)
        : 'scout_handoff';
      const criterionIds = Array.isArray(item.criterionIds)
        ? item.criterionIds.map(String).filter(Boolean)
        : (item.criterionId ? [String(item.criterionId)] : []);
      const sources = normalizeEvidenceSources(item);
      insertEv.run(
        id,
        session.id,
        String(item.questionId),
        now,
        now,
        String(item.claim || '').trim(),
        String(sources[0]?.snippet || item.snippet || '').trim(),
        String(sources[0]?.url || item.url || '').trim(),
        String(item.sourceLabel || '').trim(),
        normalizeConfidence(item.confidence),
        createdFrom,
        candidateId,
        toJson(criterionIds),
        toJson(sources),
      );
      insertedEvidenceIds.push(id);
    }

    const revokeStmt = db.prepare(`
      UPDATE research_evidence
      SET status = 'revoked', updated_at = ?
      WHERE id = ? AND session_id = ? AND status = 'accepted'
    `);
    for (const item of revokeEvidence) {
      const evId = String(item?.id || item?.evidenceId || '');
      if (!evId) continue;
      const result = revokeStmt.run(now, evId, session.id);
      if (result.changes > 0) revokedEvidenceIds.push(evId);
    }

    for (const item of questionUpdates) {
      const qid = String(item.questionId);
      const patch = {};
      if (item.status != null) patch.status = String(item.status);
      if (item.gaps != null) patch.gaps = Array.isArray(item.gaps) ? item.gaps.map(String) : [];
      if (item.criteriaMet != null) {
        patch.criteriaMet = Array.isArray(item.criteriaMet) ? item.criteriaMet : [];
      }
      if (item.coverage != null
        && typeof item.coverage === 'object'
        && !Array.isArray(item.coverage)) {
        patch.coverage = item.coverage;
      }
      if (item.lastScoutAt != null) patch.lastScoutAt = String(item.lastScoutAt);
      updateResearchQuestion(qid, patch);
      updatedQuestionIds.push(qid);
    }

    if (checklistUpdates.length) {
      const plan = { ...(session.plan || {}) };
      const checklist = Array.isArray(plan.coverageChecklist) ? [...plan.coverageChecklist] : [];
      for (const upd of checklistUpdates) {
        const cid = String(upd?.id || '');
        const idx = checklist.findIndex((c) => String(c?.id) === cid);
        if (idx >= 0) {
          checklist[idx] = { ...checklist[idx], met: Boolean(upd.met) };
        }
      }
      plan.coverageChecklist = checklist;
      db.prepare(`
        UPDATE research_sessions SET updated_at = ?, plan_json = ? WHERE id = ?
      `).run(now, toJson(plan), session.id);
    } else {
      db.prepare('UPDATE research_sessions SET updated_at = ? WHERE id = ?').run(now, session.id);
    }

    return {
      ok: true,
      insertedEvidenceIds,
      reusedEvidenceIds,
      revokedEvidenceIds,
      updatedQuestionIds,
    };
  });
}

export function incrementResearchBudgetUsed(sessionId, delta = {}) {
  const session = getResearchSession(sessionId);
  if (!session) return null;
  const used = normalizeBudgetUsed({
    waves: session.budgetUsed.waves + (Number(delta.waves) || 0),
    searches: session.budgetUsed.searches + (Number(delta.searches) || 0),
    fetches: session.budgetUsed.fetches + (Number(delta.fetches) || 0),
  });
  return updateResearchSession(sessionId, { budgetUsed: used });
}

/**
 * Atomically reserve flat session tool budget (searches | fetches | waves).
 */
export function reserveResearchBudget(sessionId, field, amount = 1) {
  const key = String(field || '');
  const count = Math.max(1, Math.floor(Number(amount) || 1));
  if (!['searches', 'fetches', 'waves'].includes(key)) {
    throw new Error(`invalid research budget field: ${key}`);
  }
  const db = getGlobalDatabase();
  return transaction(db, () => {
    const row = db.prepare(`
      SELECT budget_json, budget_used_json
      FROM research_sessions
      WHERE id = ?
    `).get(String(sessionId || ''));
    if (!row) return { ok: false, reason: 'session_not_found', used: 0, limit: 0 };
    const budget = normalizeBudget(parseJson(row.budget_json, {}));
    const used = normalizeBudgetUsed(parseJson(row.budget_used_json, {}));
    if (key === 'waves') {
      const limit = Number(budget.maxWaves) || 0;
      if (used.waves + count > limit) {
        return { ok: false, reason: 'exhausted', used: used.waves, limit };
      }
      used.waves += count;
      db.prepare(`
        UPDATE research_sessions
        SET updated_at = ?, budget_used_json = ?
        WHERE id = ?
      `).run(nowIso(), toJson(used), String(sessionId || ''));
      return { ok: true, used: used.waves, limit };
    }
    const limit = Number(key === 'searches' ? budget.maxSearches : budget.maxFetches) || 0;
    const current = Number(used[key]) || 0;
    if (current + count > limit) {
      return {
        ok: false,
        reason: 'exhausted',
        used: current,
        limit,
      };
    }
    used[key] = current + count;
    db.prepare(`
      UPDATE research_sessions
      SET updated_at = ?, budget_used_json = ?
      WHERE id = ?
    `).run(nowIso(), toJson(used), String(sessionId || ''));
    return {
      ok: true,
      used: used[key],
      limit,
      totals: { searches: used.searches, fetches: used.fetches },
    };
  });
}

export function getResearchSessionDetail(sessionId) {
  const session = getResearchSession(sessionId);
  if (!session) return null;
  const questions = listResearchQuestions(sessionId);
  const evidence = listResearchEvidence(sessionId);
  const waves = listResearchWaves(sessionId).map((wave) => ({
    ...wave,
    scouts: listResearchScoutRuns({ waveId: wave.id }),
  }));
  return { ...session, questions, evidence, waves };
}

export function buildResearchDbSummary(detail) {
  if (!detail) return '';
  const lines = [];
  lines.push(`Main question: ${detail.question}`);
  if (detail.preferences?.goal) lines.push(`Goal: ${detail.preferences.goal}`);
  const budget = detail.budget || DEFAULT_RESEARCH_BUDGET;
  const used = detail.budgetUsed || DEFAULT_BUDGET_USED;
  lines.push(
    `Budget left: waves ${Math.max(0, budget.maxWaves - used.waves)}/${budget.maxWaves}, `
    + `searches ${Math.max(0, budget.maxSearches - used.searches)}/${budget.maxSearches}, `
    + `fetches ${Math.max(0, budget.maxFetches - used.fetches)}/${budget.maxFetches}`,
  );
  lines.push('Questions:');
  const evidenceByQ = new Map();
  for (const ev of detail.evidence || []) {
    if (ev.status !== 'accepted') continue;
    const list = evidenceByQ.get(ev.questionId) || [];
    list.push(ev);
    evidenceByQ.set(ev.questionId, list);
  }
  for (const q of detail.questions || []) {
    if (!UNFINISHED_STATUSES.has(q.status)) {
      lines.push(`- ${q.id} [done] ${q.text}`);
      continue;
    }
    lines.push(`- ${q.id} [${q.status}] ${q.text}`);
    if (q.gaps?.length) lines.push(`  gaps: ${q.gaps.join('; ')}`);
    const evs = evidenceByQ.get(q.id) || [];
    for (const ev of evs) {
      lines.push(
        `  - ${ev.id} (${ev.confidence}): ${ev.claim}`
        + (ev.url ? ` | ${ev.url}` : ''),
      );
    }
    if (!evs.length) lines.push('  (no accepted evidence yet)');
  }
  return lines.join('\n');
}

export function buildResearchWritingPack(detail) {
  if (!detail) return '';
  const depth = normalizeResearchPlanDepth(detail.plan?.depth, 'standard');
  const lines = [];
  lines.push(`Main question: ${detail.question}`);
  if (detail.preferences?.goal) lines.push(`Goal: ${detail.preferences.goal}`);
  if (detail.preferences?.constraints) lines.push(`Constraints: ${detail.preferences.constraints}`);
  lines.push(`Depth: ${depth}`);
  lines.push('');

  const questions = detail.questions || [];
  const accepted = (detail.evidence || []).filter((ev) => ev.status === 'accepted');
  const evidenceByQuestion = new Map();
  for (const ev of accepted) {
    const list = evidenceByQuestion.get(ev.questionId) || [];
    list.push(ev);
    evidenceByQuestion.set(ev.questionId, list);
  }

  lines.push('Suggested outline (organize freely; do not invent facts):');
  if (!questions.length) {
    lines.push('(no sub-questions)');
  } else {
    questions.forEach((question, index) => {
      lines.push(`${index + 1}. ${question.text || question.id}`);
    });
    lines.push(`${questions.length + 1}. Limitations / unresolved gaps`);
  }
  lines.push('');

  for (const question of questions) {
    const criteria = Array.isArray(question?.coverage?.criteria) ? question.coverage.criteria : [];
    const qEvidence = evidenceByQuestion.get(question.id) || [];
    lines.push(`## ${question.id} — ${question.text || ''}`.trim());
    lines.push(`Status: ${question.status || 'pending'}`);

    if (criteria.length) {
      lines.push('Criteria:');
      for (const criterion of criteria) {
        lines.push(
          `- [${criterion.id}] [${criterion.status || 'missing'}]`
          + (criterion.verification ? ` verify=${criterion.verification}` : '')
          + ` ${criterion.text || ''}`.trimEnd(),
        );
        if (criterion.summary) lines.push(`  summary: ${criterion.summary}`);
        if (criterion.gap) lines.push(`  gap: ${criterion.gap}`);
        if (criterion.warning) lines.push(`  warning: ${criterion.warning}`);
        const linked = qEvidence.filter((ev) =>
          Array.isArray(ev.criterionIds) && ev.criterionIds.includes(criterion.id));
        for (const ev of linked) {
          lines.push(`  evidence ${ev.id} (${ev.confidence}): ${ev.claim}`);
          const sources = Array.isArray(ev.sources) && ev.sources.length
            ? ev.sources
            : ((ev.url || ev.snippet)
              ? [{ url: ev.url || '', snippet: ev.snippet || '', artifactId: '' }]
              : []);
          for (const source of sources) {
            if (source.snippet) lines.push(`    snippet: ${source.snippet}`);
            if (source.url) lines.push(`    url: ${source.url}`);
          }
        }
      }
    } else {
      lines.push('Criteria: (none recorded)');
    }

    const unlinked = qEvidence.filter((ev) =>
      !Array.isArray(ev.criterionIds) || !ev.criterionIds.length
      || !criteria.some((criterion) => ev.criterionIds.includes(criterion.id)));
    if (unlinked.length) {
      lines.push('Additional accepted evidence:');
      for (const ev of unlinked) {
        lines.push(`- ${ev.id} (${ev.confidence}): ${ev.claim}`);
        const sources = Array.isArray(ev.sources) && ev.sources.length
          ? ev.sources
          : ((ev.url || ev.snippet)
            ? [{ url: ev.url || '', snippet: ev.snippet || '', artifactId: '' }]
            : []);
        for (const source of sources) {
          if (source.snippet) lines.push(`  snippet: ${source.snippet}`);
          if (source.url) lines.push(`  url: ${source.url}`);
        }
      }
    }

    const riskBits = [
      ...(Array.isArray(question.gaps) ? question.gaps : []),
      ...criteria
        .filter((item) => item.status !== 'covered')
        .flatMap((item) => [item.gap, item.warning].filter(Boolean)),
    ].map((text) => String(text || '').trim()).filter(Boolean);
    if (riskBits.length) {
      lines.push('Risks / limitations for this section:');
      for (const bit of [...new Set(riskBits)].slice(0, 8)) {
        lines.push(`- ${bit}`);
      }
    }
    lines.push('');
  }

  if (!questions.length) {
    lines.push('Accepted evidence:');
    if (!accepted.length) {
      lines.push('(none)');
    } else {
      for (const ev of accepted) {
        lines.push(`- ${ev.id} [q=${ev.questionId}] (${ev.confidence}) ${ev.claim}`);
        const sources = Array.isArray(ev.sources) && ev.sources.length
          ? ev.sources
          : ((ev.url || ev.snippet)
            ? [{ url: ev.url || '', snippet: ev.snippet || '', artifactId: '' }]
            : []);
        for (const source of sources) {
          if (source.snippet) lines.push(`  snippet: ${source.snippet}`);
          if (source.url) lines.push(`  url: ${source.url}`);
        }
      }
    }
  }

  return lines.join('\n').trim() + '\n';
}

/** Flatten coverage / wave limitations into short lines (UI / diagnostics). */
export function collectResearchSessionLimitations(detail) {
  const lines = [];
  const seen = new Set();
  const push = (text) => {
    const cleaned = String(text || '').trim();
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    lines.push(cleaned);
  };
  for (const question of detail.questions || []) {
    const criteria = Array.isArray(question?.coverage?.criteria) ? question.coverage.criteria : [];
    for (const item of criteria) {
      if (!item || item.status === 'covered') continue;
      const gap = String(item.gap || '').trim();
      if (!gap) continue;
      push([question.text || question.id, item.id, gap].filter(Boolean).join(' — '));
    }
  }
  for (const wave of detail.waves || []) {
    const evaluation = wave.evaluation || {};
    for (const item of evaluation.limitations || []) {
      if (typeof item === 'string') {
        push(item);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const question = (detail.questions || []).find((q) => q.id === item.questionId);
      const label = question?.text || item.questionId || '';
      const gap = String(item.gap || '').trim();
      if (!gap) continue;
      push([label, item.criterionId, gap].filter(Boolean).join(' — '));
    }
  }
  return lines;
}

export function buildDeterministicResearchConclusions(detail) {
  const accepted = (detail.evidence || []).filter((ev) => ev.status === 'accepted');
  const byQuestion = new Map();
  for (const ev of accepted) {
    const list = byQuestion.get(ev.questionId) || [];
    list.push(ev);
    byQuestion.set(ev.questionId, list);
  }
  return (detail.questions || []).map((question) => {
    const evidence = byQuestion.get(question.id) || [];
    const criteria = Array.isArray(question?.coverage?.criteria) ? question.coverage.criteria : [];
    const uncovered = criteria.filter((item) => item.status !== 'covered');
    const completeness = !criteria.length && !evidence.length
      ? 'insufficient'
      : uncovered.length === 0 && evidence.length
        ? 'complete'
        : evidence.length
          ? 'partial'
          : 'insufficient';
    const gapBits = [
      ...(Array.isArray(question.gaps) ? question.gaps : []),
      ...uncovered.map((item) => item.gap || item.id).filter(Boolean),
    ];
    return {
      questionId: question.id,
      completeness,
      summary: evidence.length
        ? `Accepted evidence covers ${evidence.length} claim(s). `
          + (completeness === 'complete'
            ? 'Criteria look covered.'
            : 'Some criteria remain incomplete.')
        : 'No accepted evidence was retained for this sub-question.',
      limitations: gapBits.length
        ? gapBits.slice(0, 6).join('; ')
        : (completeness === 'complete' ? '' : 'Coverage remains incomplete.'),
      evidenceIds: evidence.map((item) => item.id),
    };
  });
}

export {
  CONFIDENCE_LEVELS,
  EVIDENCE_STATUSES,
  QUESTION_STATUSES,
  SCOUT_RUN_STATUSES,
  UNFINISHED_STATUSES,
  WAVE_STATUSES,
};
