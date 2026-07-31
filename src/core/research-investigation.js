import { randomUUID } from 'node:crypto';

import { runAgentLoop } from './agent-loop.js';
import { createChatCompletionStream } from './provider/index.js';
import { getBuiltinTools } from './tools.js';
import { resolveSubAgentModel } from './chat-runtime.js';
import {
  appendResearchTimeline,
  applyResearchCommit,
  createResearchScoutRun,
  createResearchWave,
  getResearchSessionDetail,
  listResearchEvidence,
  listResearchScoutRuns,
  listResearchWaves,
  reserveResearchBudget,
  updateResearchQuestion,
  updateResearchScoutRun,
  updateResearchSession,
  updateResearchWave,
  ensureResearchSessionBudget,
  normalizeSuccessCriteria,
  RESEARCH_CRITERION_SEARCHES_PER_WAVE,
} from './research-store.js';

const CHECKPOINT_TOOL_FUSE = 32;
const MAX_CRITERION_SEARCHES_PER_WAVE = RESEARCH_CRITERION_SEARCHES_PER_WAVE;
const MAX_SCOUT_CYCLES = 24;
const MAX_BATCH_RESULT_CHARS = 18000;
const VALID_COVERAGE = new Set(['missing', 'partial', 'covered', 'conflicted', 'blocked']);
const TERMINAL_COVERAGE = new Set(['covered', 'partial', 'blocked']);
const TERMINAL_SCOUT = new Set(['done', 'partial', 'blocked']);
/** Statuses the evaluator may set via coverageUpdates before allowance clamping. */
const PATCHABLE_COVERAGE = new Set(['missing', 'covered', 'conflicted']);

function text(value, max = 8000) {
  return String(value || '').trim().slice(0, max);
}

function formatCriterionSearchBudget(searchCount) {
  const used = Math.max(0, Math.floor(Number(searchCount) || 0));
  const remaining = Math.max(0, MAX_CRITERION_SEARCHES_PER_WAVE - used);
  return {
    used,
    remaining,
    atCap: used >= MAX_CRITERION_SEARCHES_PER_WAVE,
    label: `${used}/${MAX_CRITERION_SEARCHES_PER_WAVE}`,
    note: remaining > 0
      ? `Program search budget: ${used}/${MAX_CRITERION_SEARCHES_PER_WAVE} used, ${remaining} remaining this wave.`
      : `Program search budget: ${used}/${MAX_CRITERION_SEARCHES_PER_WAVE} used (cap reached this wave).`,
  };
}

/** Strip model claims about quota; program owns searchCount. */
function sanitizeCriterionReason(reason, searchCount, { allowanceDone = false } = {}) {
  const budget = formatCriterionSearchBudget(searchCount);
  let cleaned = text(reason, 600);
  if (!cleaned) return budget.note;
  // Remove false "quota exhausted / 5/5 / last search allowance" claims when not at cap.
  if (!allowanceDone) {
    cleaned = cleaned
      .replace(/搜索配额已用尽[^。；;\n]*/g, '')
      .replace(/search quota (has been )?exhausted[^.;\n]*/gi, '')
      .replace(/\b5\s*\/\s*5\b/g, '')
      .replace(/最后一次搜索配额[^。；;\n]*/g, '')
      .replace(/last search (quota|allowance)[^.;\n]*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s·,;；。]+|[\s·,;；。]+$/g, '')
      .trim();
    return text(`${budget.note} ${cleaned}`.trim(), 600);
  }
  if (!/\d+\s*\/\s*5/.test(cleaned) && !/Program search budget/i.test(cleaned)) {
    return text(`${budget.note} ${cleaned}`.trim(), 600);
  }
  return cleaned || budget.note;
}

function normalizeQuery(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value || '').trim().replace(/\/$/, '');
  }
}

function collectUrlsFromSearchResult(result) {
  const urls = new Set();
  const results = Array.isArray(result?.results) ? result.results : [];
  for (const item of results) {
    const url = normalizeUrl(item?.url);
    if (url) urls.add(url);
  }
  return urls;
}

function normalizeClaim(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 500);
}

function parseJsonObject(raw) {
  const source = String(raw || '').trim();
  const candidates = [
    source,
    source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1],
    source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next representation.
    }
  }
  return null;
}

function criterionEntries(question) {
  const criteria = normalizeSuccessCriteria(question?.successCriteria);
  const list = criteria.length
    ? criteria
    : [{ text: 'Answer the sub-question with reliable, attributable evidence', priority: 'normal' }];
  return list.map((criterion, index) => ({
    id: `c${index + 1}`,
    text: String(criterion.text || '').trim(),
    priority: criterion.priority || 'normal',
    status: 'missing',
    candidateIds: [],
    attempts: 0,
    searchCount: 0,
    reason: '',
  }));
}

function createInitialLedger(question) {
  const criteria = criterionEntries(question);
  return {
    version: 1,
    questionId: question.id,
    criteria,
    candidates: [],
    queries: [],
    gaps: criteria.map((criterion) => ({
      criterionId: criterion.id,
      text: criterion.text,
      status: 'open',
    })),
    decision: 'continue',
    nextGap: criteria[0]
      ? { criterionId: criteria[0].id, reason: criteria[0].text }
      : null,
    cycles: 0,
  };
}

function compactLedger(ledger) {
  return {
    version: ledger.version || 1,
    questionId: ledger.questionId,
    criteria: (ledger.criteria || []).map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      priority: criterion.priority || 'normal',
      status: criterion.status,
      candidateIds: criterion.candidateIds || [],
      attempts: Number(criterion.attempts) || 0,
      searchCount: Number(criterion.searchCount) || 0,
      reason: criterion.reason || '',
    })),
    candidates: (ledger.candidates || []).map((candidate) => ({
      id: candidate.id,
      criterionIds: candidate.criterionIds || [],
      claim: candidate.claim,
      confidence: candidate.confidence,
      relation: candidate.relation || 'supports',
      sources: (candidate.sources || []).slice(0, 5),
    })),
    queries: (ledger.queries || []).slice(-20),
    gaps: ledger.gaps || [],
    nextGap: ledger.nextGap || null,
    cycles: Number(ledger.cycles) || 0,
  };
}

function ledgerProgressSignature(ledger) {
  return JSON.stringify({
    criteria: (ledger.criteria || []).map((criterion) => ({
      id: criterion.id,
      candidateIds: criterion.candidateIds || [],
    })),
    candidates: (ledger.candidates || []).map((candidate) => ({
      id: candidate.id,
      sources: (candidate.sources || []).map((source) => source.url),
    })),
  });
}

/**
 * Checkpoint ends only when the Scout calls finish_scout_cycle (or a safety fuse trips).
 * One web_search is allowed per cycle; further searches are rejected until finish.
 */
function createScoutCheckpointController() {
  let finished = false;
  let searchStartedThisCycle = false;
  return {
    hasSearchStarted() {
      return searchStartedThisCycle;
    },
    markSearchStarted() {
      searchStartedThisCycle = true;
    },
    markFinished() {
      finished = true;
    },
    isFinished() {
      return finished;
    },
    shouldCheckpoint({ budgetExhausted = false, tools = 0 } = {}) {
      return finished || budgetExhausted || tools >= CHECKPOINT_TOOL_FUSE;
    },
  };
}

function createFinishScoutCycleDefinition() {
  return {
    type: 'function',
    function: {
      name: 'finish_scout_cycle',
      description: [
        'End this Scout checkpoint cycle so the evaluator can score the current target criterion.',
        'Call after you have searched once and fetched any useful allowlisted URLs from that search.',
        'Do not call web_search again in this cycle — finish first; the next cycle may search again.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Optional short note on why this search batch is done.',
          },
        },
      },
    },
  };
}

function findDefinition(definitions, name) {
  return (definitions || []).find((definition) =>
    String(definition?.function?.name || definition?.name || '') === name);
}

function createResearchSearchDefinition(baseDefinition) {
  const cloned = baseDefinition ? structuredClone(baseDefinition) : {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for the current research criterion.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  };
  const fn = cloned.function || cloned;
  fn.description = [
    String(fn.description || 'Search the web.'),
    'Research Scout rule: criterionId must match the current target criterion.',
  ].join(' ');
  const parameters = fn.parameters && typeof fn.parameters === 'object'
    ? fn.parameters
    : { type: 'object', properties: {} };
  parameters.properties = {
    ...(parameters.properties || {}),
    criterionId: {
      type: 'string',
      description: 'The current target criterion id supplied by the Scout prompt.',
    },
  };
  parameters.required = [...new Set([...(parameters.required || []), 'criterionId'])];
  fn.parameters = parameters;
  return cloned;
}

function filterScoutBundle(bundle) {
  const active = [...(bundle.definitions || [])];
  const deferred = bundle.deferredDefinitions || {};
  const webSearch = findDefinition(active, 'web_search') || deferred.web_search;
  const webFetch = findDefinition(active, 'web_fetch') || deferred.web_fetch;
  const definitions = [
    createResearchSearchDefinition(webSearch),
    ...(webFetch ? [structuredClone(webFetch)] : []),
    createFinishScoutCycleDefinition(),
  ];
  return { definitions, handlers: bundle.handlers || {} };
}

function makeStreamingCompletion(config, emit, reasoningEffort = 'low') {
  return async ({ messages, tools, model, toolChoice, signal }) => {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      emit?.({ type: 'assistant:start', model });
    };
    const result = await createChatCompletionStream({
      sdkProvider: config.sdk?.provider,
      baseUrl: config.gateway.base_url,
      apiKey: config.gateway.api_key,
      model,
      messages,
      tools,
      toolChoice,
      signal,
      reasoningEffort,
      timeoutMs: config.gateway.timeout_ms || 1800000,
      maxRetries: config.gateway.max_retries ?? 2,
      onTextDelta: (delta) => {
        start();
        emit?.({ type: 'assistant:delta', text: delta });
      },
      onReasoningDelta: (delta) => {
        start();
        emit?.({ type: 'assistant:reasoning_delta', text: delta });
      },
      onToolCallDelta: (toolCall) => {
        start();
        emit?.({ type: 'assistant:tool_call_delta', toolCall });
      },
    });
    if (!started && (result?.text || result?.toolCalls?.length)) start();
    return result;
  };
}

async function callJsonModel({
  config,
  model,
  fallbackModel,
  systemPrompt,
  userPrompt,
  reasoningEffort = 'medium',
  signal,
  validate,
}) {
  const models = [...new Set([model, fallbackModel].map((value) => String(value || '').trim()).filter(Boolean))];
  const attempts = models.flatMap((selectedModel) => [
    { selectedModel, attempt: 1 },
    { selectedModel, attempt: 2 },
  ]);
  let lastError = null;
  for (const { selectedModel, attempt } of attempts) {
    try {
      const result = await createChatCompletionStream({
        sdkProvider: config.sdk?.provider,
        baseUrl: config.gateway.base_url,
        apiKey: config.gateway.api_key,
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: [],
        signal,
        reasoningEffort,
        timeoutMs: config.gateway.timeout_ms || 1800000,
        maxRetries: config.gateway.max_retries ?? 2,
      });
      const parsed = parseJsonObject(result?.text);
      if (!parsed) {
        lastError = new Error(`Evaluator returned invalid JSON (${selectedModel})`);
        continue;
      }
      const validated = typeof validate === 'function' ? validate(parsed) : parsed;
      return {
        data: validated,
        model: selectedModel,
        attempt,
        rawText: text(result?.text, 12000),
      };
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
    }
  }
  throw lastError || new Error('Evaluator failed');
}

function normalizeObjectList(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
  if (!value || typeof value !== 'object') return [];
  if ('claim' in value || 'id' in value || 'candidateId' in value) return [value];
  return Object.values(value).filter((item) => item && typeof item === 'object');
}

function normalizeCoverageUpdates(value) {
  if (!value || typeof value !== 'object') return {};
  if (!Array.isArray(value)) return value;
  const updates = {};
  for (const item of value) {
    if (Array.isArray(item)) {
      const criterionId = String(item[0] || '');
      if (criterionId) updates[criterionId] = item[1];
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const criterionId = String(item.criterionId || item.criterion_id || item.id || '');
    if (!criterionId) continue;
    const status = item.status || item.coverage || item.value;
    updates[criterionId] = item.reason
      ? { status, reason: text(item.reason, 600) }
      : status;
  }
  return updates;
}

function normalizeCriterionStatus(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['covered', 'done', 'complete', 'completed'].includes(normalized)) return 'covered';
  if (['partial', 'incomplete'].includes(normalized)) return 'partial';
  if (['blocked', 'unavailable'].includes(normalized)) return 'blocked';
  if (['needs_more', 'continue', 'missing', 'conflicted'].includes(normalized)) return 'needs_more';
  return '';
}

function validateScoutEvaluatorPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Scout evaluator output must be an object');
  }
  const rawDecision = String(value.decision || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const decision = ['done', 'complete', 'completed'].includes(rawDecision)
    ? 'done'
    : ['partial', 'incomplete'].includes(rawDecision)
      ? 'partial'
      : rawDecision === 'blocked'
        ? 'blocked'
        : 'continue';
  const rawCriterionDecision =
    value.criterionDecision
    || value.criterion_decision
    || value.currentCriterion
    || null;
  const criterionDecision = rawCriterionDecision && typeof rawCriterionDecision === 'object'
    ? {
      criterionId: String(
        rawCriterionDecision.criterionId
        || rawCriterionDecision.criterion_id
        || rawCriterionDecision.id
        || '',
      ),
      status: normalizeCriterionStatus(
        rawCriterionDecision.status || rawCriterionDecision.decision,
      ),
      reason: text(rawCriterionDecision.reason || rawCriterionDecision.rationale, 600),
    }
    : null;
  return {
    newCandidates: normalizeObjectList(value.newCandidates || value.new_candidates),
    updateCandidates: normalizeObjectList(value.updateCandidates || value.update_candidates),
    coverageUpdates: normalizeCoverageUpdates(
      value.coverageUpdates || value.coverage_updates || value.coverage,
    ),
    gaps: Array.isArray(value.gaps) ? value.gaps : null,
    decision,
    nextGap: (
      value.nextGap
      || value.next_gap
    ) && typeof (value.nextGap || value.next_gap) === 'object'
      ? (value.nextGap || value.next_gap)
      : null,
    criterionDecision,
  };
}

function normalizeEvaluatorCandidate(item, targetId) {
  if (!item || typeof item !== 'object') return [];
  const rawClaims = [
    item.claim,
    ...(Array.isArray(item.claims) ? item.claims : []),
  ];
  const claims = [...new Set(rawClaims.map((claim) => text(claim, 1000)).filter(Boolean))];
  if (!claims.length) return [];
  const rawSources = Array.isArray(item.sources) && item.sources.length
    ? item.sources
    : item.url
      ? [{
        url: item.url,
        snippet: item.snippet || item.excerpt || item.quote,
        label: item.source || item.sourceLabel || item.sourceType,
      }]
      : [];
  const sources = rawSources.map((source) => {
    if (typeof source === 'string') return { url: source, snippet: '', label: '' };
    return {
      url: source?.url || source?.href,
      snippet: source?.snippet || source?.excerpt || source?.quote || '',
      label: source?.label || source?.sourceLabel || source?.title || '',
    };
  }).filter((source) => source.url);
  return claims.map((claim) => ({
    criterionIds: [targetId],
    claim,
    confidence: item.confidence,
    relation: item.relation,
    sources: sources.map((source) => ({
      ...source,
      snippet: source.snippet || claim,
    })),
  }));
}

function scopeScoutEvaluatorPatch(value, ledger) {
  const patch = validateScoutEvaluatorPatch(value);
  const targetId = String(ledger?.nextGap?.criterionId || '');
  if (!targetId) throw new Error('Scout ledger has no current criterion');
  const targetCriterion = (ledger?.criteria || []).find((item) => item.id === targetId);
  const searchCount = Number(targetCriterion?.searchCount) || 0;
  const allowanceDone = searchCount >= MAX_CRITERION_SEARCHES_PER_WAVE;
  const rawCoverage = patch.coverageUpdates[targetId];
  const rawCoverageStatus = typeof rawCoverage === 'object' ? rawCoverage?.status : rawCoverage;
  let inferredStatus =
    normalizeCriterionStatus(patch.criterionDecision?.status)
    || normalizeCriterionStatus(rawCoverageStatus)
    || (patch.decision === 'done'
      ? 'covered'
      : patch.decision === 'partial'
        ? 'partial'
        : patch.decision === 'blocked'
          ? 'blocked'
          : 'needs_more');
  // Program owns early-stop rules: only covered may finish before search cap.
  if (!allowanceDone && (inferredStatus === 'partial' || inferredStatus === 'blocked')) {
    inferredStatus = 'needs_more';
  }
  patch.criterionDecision = {
    criterionId: targetId,
    status: inferredStatus,
    reason: text(
      patch.criterionDecision?.reason
      || (typeof rawCoverage === 'object' ? rawCoverage?.reason : '')
      || patch.nextGap?.reason
      || patch.nextGap?.text,
      600,
    ),
  };
  const targetCandidateIds = new Set(
    (ledger?.candidates || [])
      .filter((candidate) => (candidate.criterionIds || []).includes(targetId))
      .map((candidate) => candidate.id),
  );
  const criterionStatus = String(patch.criterionDecision.status || '');
  const rawStatus = typeof rawCoverage === 'object' ? rawCoverage?.status : rawCoverage;
  let scopedCoverage = criterionStatus === 'needs_more'
    ? (rawStatus === 'conflicted' ? 'conflicted' : 'missing')
    : criterionStatus;
  // coverageUpdates must never carry partial/blocked — advanceLedger owns those terminals.
  if (scopedCoverage === 'partial' || scopedCoverage === 'blocked' || !PATCHABLE_COVERAGE.has(scopedCoverage)) {
    scopedCoverage = scopedCoverage === 'covered' ? 'covered' : (rawStatus === 'conflicted' ? 'conflicted' : 'missing');
  }
  if (scopedCoverage === 'covered' && criterionStatus !== 'covered') {
    scopedCoverage = 'missing';
  }
  return {
    ...patch,
    newCandidates: patch.newCandidates
      .filter((candidate) => {
        const ids = Array.isArray(candidate?.criterionIds)
          ? candidate.criterionIds.map(String)
          : [String(candidate?.criterionId || '')];
        return ids.every((id) => !id) || ids.includes(targetId);
      })
      .flatMap((candidate) => normalizeEvaluatorCandidate(candidate, targetId)),
    updateCandidates: patch.updateCandidates
      .filter((candidate) =>
        targetCandidateIds.has(String(candidate?.id || candidate?.candidateId || '')))
      .map((candidate) => {
        const normalized = normalizeEvaluatorCandidate({
          ...candidate,
          claim: candidate.claim || 'Existing candidate update',
        }, targetId)[0];
        return {
          ...candidate,
          attachSources: normalized?.sources || candidate.attachSources || candidate.sources || [],
        };
      }),
    coverageUpdates: { [targetId]: scopedCoverage },
  };
}

function validateLeadReview(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.acceptCandidateIds)) {
    throw new Error('Lead reviewer must return acceptCandidateIds');
  }
  return {
    acceptCandidateIds: value.acceptCandidateIds.map(String),
    reason: text(value.reason, 1000),
  };
}

function validateWaveEvaluation(value) {
  if (!value || typeof value !== 'object') throw new Error('Wave evaluator output must be an object');
  const decision = String(value.decision || '');
  if (!['ready_for_report', 'next_wave'].includes(decision)) {
    throw new Error(`Wave evaluator returned invalid decision: ${decision || '(empty)'}`);
  }
  if (decision === 'next_wave' && !Array.isArray(value.targets)) {
    throw new Error('Wave evaluator next_wave decision requires targets');
  }
  return {
    decision,
    reason: text(value.reason, 1000),
    targets: Array.isArray(value.targets) ? value.targets : [],
    limitations: Array.isArray(value.limitations) ? value.limitations : [],
  };
}

function targetKey(item = {}) {
  return `${String(item.questionId || '')}:${String(item.criterionId || '')}`;
}

function normalizeWaveTargetList(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      questionId: String(item?.questionId || ''),
      criterionId: String(item?.criterionId || ''),
      gap: text(item?.gap || item?.reason || item?.text, 600),
      status: item?.status ? String(item.status) : undefined,
    }))
    .filter((item) => item.questionId && item.criterionId);
}

/** Targets and limitations are mutually exclusive per criterion. Targets win. */
function partitionWaveTargetsAndLimitations({
  targets = [],
  limitations = [],
  unresolved = [],
} = {}) {
  const cleanTargets = [];
  const seenTargets = new Set();
  for (const target of normalizeWaveTargetList(targets)) {
    const key = targetKey(target);
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    cleanTargets.push(target);
  }
  const cleanLimitations = [];
  const seenLimitations = new Set();
  for (const item of [
    ...normalizeWaveTargetList(limitations),
    ...normalizeWaveTargetList(unresolved),
  ]) {
    const key = targetKey(item);
    if (seenTargets.has(key) || seenLimitations.has(key)) continue;
    seenLimitations.add(key);
    cleanLimitations.push({
      questionId: item.questionId,
      criterionId: item.criterionId,
      gap: item.gap,
      status: item.status,
    });
  }
  return { targets: cleanTargets, limitations: cleanLimitations };
}

function collectAllowedUrls(batchEvents) {
  const urls = new Set();
  const regex = /https?:\/\/[^\s"'<>()[\]{}]+/g;
  for (const event of batchEvents) {
    const values = [
      event?.arguments?.url,
      event?.content,
      event?.summary,
    ];
    for (const value of values) {
      const source = String(value || '');
      if (/^https?:\/\//i.test(source)) urls.add(normalizeUrl(source));
      for (const match of source.match(regex) || []) urls.add(normalizeUrl(match.replace(/[.,;:]+$/, '')));
    }
  }
  return urls;
}

function mergeSources(existing, incoming, allowedUrls) {
  const merged = [...(Array.isArray(existing) ? existing : [])];
  const seen = new Set(merged.map((source) => normalizeUrl(source?.url)));
  for (const source of Array.isArray(incoming) ? incoming : []) {
    const url = normalizeUrl(source?.url);
    if (!url || !allowedUrls.has(url) || seen.has(url)) continue;
    merged.push({
      url,
      snippet: text(source?.snippet, 1200),
      label: text(source?.label || source?.sourceLabel, 160),
    });
    seen.add(url);
  }
  return merged.slice(0, 8);
}

function applyLedgerPatch(ledger, patch, batchEvents) {
  const next = structuredClone(ledger);
  const criterionIds = new Set((next.criteria || []).map((criterion) => criterion.id));
  const allowedUrls = collectAllowedUrls(batchEvents);
  const candidateById = new Map((next.candidates || []).map((candidate) => [candidate.id, candidate]));
  const candidateByClaim = new Map(
    (next.candidates || []).map((candidate) => [
      `${(candidate.criterionIds || []).slice().sort().join(',')}:${normalizeClaim(candidate.claim)}`,
      candidate,
    ]),
  );

  for (const update of Array.isArray(patch?.updateCandidates) ? patch.updateCandidates : []) {
    const candidate = candidateById.get(String(update?.id || update?.candidateId || ''));
    if (!candidate) continue;
    candidate.sources = mergeSources(candidate.sources, update.attachSources || update.sources, allowedUrls);
    if (['high', 'medium', 'low'].includes(String(update.confidence))) {
      candidate.confidence = String(update.confidence);
    }
  }

  for (const item of Array.isArray(patch?.newCandidates) ? patch.newCandidates : []) {
    const claim = text(item?.claim, 1000);
    const ids = [...new Set(
      (Array.isArray(item?.criterionIds) ? item.criterionIds : [item?.criterionId])
        .map(String)
        .filter((id) => criterionIds.has(id)),
    )];
    if (!claim || !ids.length) continue;
    const key = `${ids.slice().sort().join(',')}:${normalizeClaim(claim)}`;
    const existing = candidateByClaim.get(key);
    if (existing) {
      existing.sources = mergeSources(existing.sources, item.sources, allowedUrls);
      continue;
    }
    const sources = mergeSources([], item.sources, allowedUrls);
    if (!sources.length) continue;
    const candidate = {
      id: `cand_${randomUUID()}`,
      criterionIds: ids,
      claim,
      confidence: ['high', 'medium', 'low'].includes(String(item?.confidence))
        ? String(item.confidence)
        : 'medium',
      relation: ['supports', 'conflicts'].includes(String(item?.relation))
        ? String(item.relation)
        : 'supports',
      sources,
    };
    next.candidates.push(candidate);
    candidateById.set(candidate.id, candidate);
    candidateByClaim.set(key, candidate);
  }

  const updates = patch?.coverageUpdates && typeof patch.coverageUpdates === 'object'
    ? patch.coverageUpdates
    : {};
  for (const criterion of next.criteria || []) {
    const raw = updates[criterion.id];
    const status = typeof raw === 'object' ? raw.status : raw;
    // Never apply partial/blocked from the model here — only covered may early-stop,
    // and partial/blocked are decided later from program searchCount.
    if (PATCHABLE_COVERAGE.has(String(status))) criterion.status = String(status);
    criterion.candidateIds = (next.candidates || [])
      .filter((candidate) => (candidate.criterionIds || []).includes(criterion.id))
      .map((candidate) => candidate.id);
  }

  const executedQueries = batchEvents
    .filter((event) => event.type === 'tool:result' && event.name === 'web_search' && !event.error)
    .map((event) => ({
      criterionId: String(event?.arguments?.criterionId || ''),
      query: text(event?.arguments?.query, 500),
      normalized: normalizeQuery(event?.arguments?.query),
    }))
    .filter((entry) => entry.query);
  const seenQueries = new Set((next.queries || []).map((entry) => entry.normalized || normalizeQuery(entry.query)));
  for (const query of executedQueries) {
    if (!seenQueries.has(query.normalized)) {
      next.queries.push(query);
      seenQueries.add(query.normalized);
    }
  }

  next.gaps = Array.isArray(patch?.gaps)
    ? patch.gaps.map((gap) => ({
      criterionId: String(gap?.criterionId || ''),
      text: text(gap?.text || gap?.reason, 600),
      status: String(gap?.status || 'open'),
    })).filter((gap) => criterionIds.has(gap.criterionId) && gap.text)
    : (next.criteria || [])
      .filter((criterion) => criterion.status !== 'covered')
      .map((criterion) => ({
        criterionId: criterion.id,
        text: criterion.text,
        status: criterion.status === 'conflicted' ? 'conflicted' : 'open',
      }));

  const unresolved = (next.criteria || []).filter((criterion) => criterion.status !== 'covered');
  let decision = ['continue', 'done', 'partial'].includes(String(patch?.decision))
    ? String(patch.decision)
    : unresolved.length ? 'continue' : 'done';
  if (decision === 'done' && unresolved.length) decision = 'partial';
  let nextGap = null;
  if (decision === 'continue') {
    const proposedId = String(patch?.nextGap?.criterionId || patch?.nextCriterionId || '');
    const criterion = unresolved.find((item) => item.id === proposedId) || unresolved[0];
    if (!criterion) {
      decision = 'done';
    } else {
      nextGap = {
        criterionId: criterion.id,
        reason: text(patch?.nextGap?.reason || patch?.nextGap?.text || criterion.text, 600),
        suggestedQuery: text(patch?.nextGap?.suggestedQuery || patch?.nextQuery, 500),
      };
    }
  }

  next.decision = decision;
  next.nextGap = nextGap;
  next.cycles = (Number(next.cycles) || 0) + 1;
  return next;
}

function advanceLedgerAfterCheckpoint(ledger, {
  patch,
  targetCriterionId,
  budgetExhausted = false,
} = {}) {
  const next = structuredClone(ledger);
  const current = (next.criteria || []).find((criterion) => criterion.id === targetCriterionId);
  if (!current) throw new Error(`Unknown target criterion: ${targetCriterionId}`);
  current.attempts = (Number(current.attempts) || 0) + 1;
  const searchesUsed = Number(current.searchCount) || 0;
  const searchBudgetSpent = searchesUsed >= MAX_CRITERION_SEARCHES_PER_WAVE;
  const allowanceDone = searchBudgetSpent || budgetExhausted;
  const hasCandidates = (criterion) => (criterion.candidateIds || []).length > 0;
  const budget = formatCriterionSearchBudget(searchesUsed);

  const criterionDecision = patch?.criterionDecision;
  let requestedStatus = '';
  if (criterionDecision && String(criterionDecision.criterionId || '') === current.id) {
    requestedStatus = String(criterionDecision.status || '');
    if (requestedStatus === 'covered') {
      // Only covered may early-close, and only with attributable candidates.
      if (hasCandidates(current)) {
        current.status = 'covered';
      } else if (!TERMINAL_COVERAGE.has(current.status) || current.status === 'partial' || current.status === 'blocked') {
        current.status = current.status === 'conflicted' ? 'conflicted' : 'missing';
        current.reason = 'Evaluator marked covered without attributable candidate evidence.';
      }
    } else if (requestedStatus === 'conflicted') {
      current.status = 'conflicted';
    } else if (requestedStatus === 'partial' || requestedStatus === 'blocked') {
      // Intent only — program decides terminal partial/blocked after allowance.
      if (!allowanceDone) {
        current.status = 'missing';
      }
    } else if (requestedStatus === 'needs_more' || requestedStatus === 'missing') {
      if (!TERMINAL_COVERAGE.has(current.status) || current.status === 'partial' || current.status === 'blocked') {
        if (!allowanceDone) current.status = 'missing';
      }
    }
  }

  // Hard clamp: coverageUpdates or stale state must not leave early partial/blocked.
  if (!allowanceDone && (current.status === 'partial' || current.status === 'blocked')) {
    current.status = 'missing';
  }

  if (current.status === 'covered' && !hasCandidates(current)) {
    current.status = 'missing';
    current.reason = current.reason || 'Coverage requires attributable candidate evidence.';
  }

  if (allowanceDone && !TERMINAL_COVERAGE.has(current.status)) {
    if (hasCandidates(current)) {
      current.status = 'partial';
    } else {
      current.status = 'blocked';
    }
  }

  // Normalize end-state split: evidence ⇒ partial, no evidence ⇒ blocked (only at allowance end).
  if (allowanceDone) {
    if (current.status === 'partial' && !hasCandidates(current)) {
      current.status = 'blocked';
    } else if (current.status === 'blocked' && hasCandidates(current)) {
      current.status = 'partial';
    } else if (current.status === 'covered' && !hasCandidates(current)) {
      current.status = 'blocked';
    }
  }

  // Program owns budget wording; keep useful evidence notes from the model when present.
  const modelReason = text(criterionDecision?.reason, 600);
  if (current.status === 'covered') {
    current.reason = sanitizeCriterionReason(
      modelReason || current.reason || 'Covered with attributable evidence.',
      searchesUsed,
      { allowanceDone: true },
    );
  } else if (allowanceDone && (current.status === 'partial' || current.status === 'blocked')) {
    const fallback = current.status === 'partial'
      ? 'Search allowance used with incomplete but attributable evidence.'
      : (searchBudgetSpent
        ? 'Per-criterion search limit reached for this wave before the criterion was resolved.'
        : 'Research safety budget exhausted before this criterion was resolved.');
    current.reason = sanitizeCriterionReason(modelReason || current.reason || fallback, searchesUsed, {
      allowanceDone: true,
    });
  } else {
    const continueHint = requestedStatus === 'partial' || requestedStatus === 'blocked'
      ? 'Early partial/blocked ignored; continue searching this criterion.'
      : '';
    current.reason = sanitizeCriterionReason(
      [modelReason || current.reason || current.text, continueHint].filter(Boolean).join(' '),
      searchesUsed,
      { allowanceDone: false },
    );
  }

  const unresolved = (next.criteria || []).filter((criterion) => !TERMINAL_COVERAGE.has(criterion.status));
  if (!unresolved.length) {
    next.decision = (next.criteria || []).every((criterion) => criterion.status === 'covered')
      ? 'done'
      : 'partial';
    next.nextGap = null;
  } else {
    const proposedId = String(patch?.nextGap?.criterionId || '');
    const proposed = unresolved.find((criterion) => criterion.id === proposedId);
    const target = !TERMINAL_COVERAGE.has(current.status)
      ? current
      : proposed || unresolved[0];
    next.decision = 'continue';
    const targetBudget = formatCriterionSearchBudget(target.searchCount);
    const modelGap = text(
      target.id === proposedId
        ? patch?.nextGap?.reason || patch?.nextGap?.text
        : target.reason || target.text,
      400,
    );
    next.nextGap = {
      criterionId: target.id,
      reason: sanitizeCriterionReason(modelGap || target.text, target.searchCount, {
        allowanceDone: targetBudget.atCap,
      }),
      suggestedQuery: target.id === proposedId
        ? text(patch?.nextGap?.suggestedQuery || patch?.nextQuery, 500)
        : '',
    };
  }
  next.gaps = (next.criteria || [])
    .filter((criterion) => criterion.status !== 'covered')
    .map((criterion) => ({
      criterionId: criterion.id,
      text: criterion.reason || criterion.text,
      status: TERMINAL_COVERAGE.has(criterion.status) ? criterion.status : 'open',
    }));
  return next;
}

async function evaluateScoutCheckpoint({
  config,
  mainModel,
  question,
  ledger,
  batchEvents,
  signal,
}) {
  const resultText = batchEvents
    .filter((event) => event.type === 'tool:result')
    .map((event) => [
      `TOOL ${event.name}`,
      `ARGS ${JSON.stringify(event.arguments || {})}`,
      text(event.content, 7000),
    ].join('\n'))
    .join('\n\n')
    .slice(0, MAX_BATCH_RESULT_CHARS);
  const fastModel = resolveSubAgentModel(config, mainModel);
  try {
    const evaluated = await callJsonModel({
      config,
      model: fastModel,
      fallbackModel: mainModel,
      reasoningEffort: 'medium',
      signal,
      systemPrompt: [
        'You are a research checkpoint evaluator. You have no tools.',
        'Update the working evidence ledger using only URLs and facts in NEW TOOL RESULTS.',
        'Do not repeat an existing claim; use updateCandidates to attach a new source.',
        'Search-result snippets may become low-confidence candidates when they contain an attributable claim and URL; fetched primary text is preferred for medium/high confidence.',
        'Evaluate the CURRENT target criterion, not the whole sub-question.',
        'Mark a criterion covered only when attributable evidence supports it — that is the only early stop.',
        'Do NOT mark partial or blocked before the program search budget is exhausted. The program tracks searchCount; never invent 5/5 or "quota exhausted" in reasons.',
        'While searchCount is below 5, prefer needs_more and describe evidence gaps only.',
        'After the program has used 5 searches: partial = incomplete but attributable evidence exists; blocked = little or no usable attributable evidence.',
        'Return strict JSON only with keys: newCandidates, updateCandidates, coverageUpdates, gaps, criterionDecision, decision, nextGap.',
        'Each newCandidates item must be {"criterionIds":["c1"],"claim":"","confidence":"high|medium|low","relation":"supports|conflicts","sources":[{"url":"","snippet":"","label":""}]}.',
        'coverageUpdates must be an object map such as {"c1":"covered"} or {"c1":"missing"}, not partial/blocked.',
        'criterionDecision is {"criterionId":"","status":"covered|partial|blocked|needs_more","reason":""}. Prefer needs_more while searchCount is below 5.',
        'decision is continue while any criterion still needs work; done only when every criterion is covered; partial only when all remaining criteria are terminal partial/blocked.',
      ].join('\n'),
      userPrompt: [
        `QUESTION\n${question.text}`,
        `SUCCESS CRITERIA\n${JSON.stringify(criterionEntries(question))}`,
        `PROGRAM SEARCH COUNTS (authoritative)\n${JSON.stringify(
          (ledger.criteria || []).map((criterion) => ({
            id: criterion.id,
            ...formatCriterionSearchBudget(criterion.searchCount),
          })),
        )}`,
        `CURRENT LEDGER\n${JSON.stringify(compactLedger(ledger))}`,
        `NEW TOOL RESULTS\n${resultText || '(none)'}`,
      ].join('\n\n'),
      validate: (value) => scopeScoutEvaluatorPatch(value, ledger),
    });
    return {
      patch: evaluated.data,
      evaluator: {
        ok: true,
        model: evaluated.model,
        attempt: evaluated.attempt,
        rawText: evaluated.rawText,
      },
    };
  } catch (error) {
    return {
      patch: {
        newCandidates: [],
        updateCandidates: [],
        coverageUpdates: {},
        gaps: null,
        decision: 'continue',
        nextGap: ledger.nextGap || null,
        criterionDecision: {
          criterionId: ledger.nextGap?.criterionId || '',
          status: 'needs_more',
          reason: 'Evaluator failed; preserve the criterion for retry.',
        },
      },
      evaluator: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function buildScoutHandoff(question, ledger) {
  const lines = [
    `Question: ${question.id} — ${question.text}`,
    '',
    'Candidate Evidence:',
  ];
  if (!(ledger.candidates || []).length) lines.push('- No attributable candidate evidence found.');
  for (const candidate of ledger.candidates || []) {
    lines.push(`- Candidate ID: ${candidate.id}`);
    lines.push(`  Claim: ${candidate.claim}`);
    lines.push(`  Criteria: ${(candidate.criterionIds || []).join(', ')}`);
    lines.push(`  Confidence: ${candidate.confidence}`);
    for (const source of candidate.sources || []) {
      lines.push(`  URL: ${source.url}`);
      if (source.snippet) lines.push(`  Snippet: ${source.snippet}`);
    }
  }
  lines.push('', 'Suggested Gaps:');
  if (!(ledger.gaps || []).length) lines.push('- None');
  for (const gap of ledger.gaps || []) lines.push(`- [${gap.criterionId}] ${gap.text}`);
  lines.push('', `Self-status: ${ledger.decision === 'done' ? 'done' : 'partial'}`);
  return lines.join('\n');
}

function buildScoutCyclePrompt({ session, question, ledger, targetGap }) {
  const targetCriterion = (ledger.criteria || []).find((item) =>
    item.id === String(targetGap?.criterionId || ''));
  const used = Number(targetCriterion?.searchCount) || 0;
  const remaining = Math.max(0, MAX_CRITERION_SEARCHES_PER_WAVE - used);
  return [
    'Investigate exactly ONE target criterion for this research sub-question.',
    'This checkpoint allows at most ONE web_search.',
    'After that search, fetch as many promising allowlisted URLs as you need (multiple fetch rounds are OK).',
    'When you are done fetching — or if snippets alone are enough — call finish_scout_cycle so the evaluator can run.',
    'If you want a different query, call finish_scout_cycle first. A second web_search in this cycle is rejected.',
    'Every web_search call must include the supplied criterionId.',
    'Do not investigate criteria already marked covered.',
    'Prefer primary and authoritative sources.',
    `Main question: ${session.question}`,
    session.preferences?.goal ? `Goal: ${session.preferences.goal}` : '',
    `Sub-question: ${question.text}`,
    `Target criterion id: ${targetGap.criterionId}`,
    `Target criterion: ${targetGap.reason}`,
    `Search budget for this criterion this wave: ${used} of ${MAX_CRITERION_SEARCHES_PER_WAVE} used (${remaining} remaining).`
      + (remaining > 0
        ? ` You may still search ${remaining} more time(s) across later cycles. The hard cap is ${MAX_CRITERION_SEARCHES_PER_WAVE}/${MAX_CRITERION_SEARCHES_PER_WAVE}, not 4/5.`
        : ' No searches remain for this criterion this wave; finish with current evidence.'),
    targetGap.suggestedQuery ? `Suggested starting query: ${targetGap.suggestedQuery}` : '',
    `Working ledger:\n${JSON.stringify(compactLedger(ledger))}`,
  ].filter(Boolean).join('\n\n');
}

async function runScoutWithCheckpoints({
  session,
  wave,
  question,
  config,
  model,
  workspaceRoot,
  signal,
  emit,
  existingRun = null,
  seedLedger = null,
  followupTargets = [],
}) {
  const initialLedger = seedLedger ? structuredClone(seedLedger) : createInitialLedger(question);
  for (const criterion of initialLedger.criteria || []) {
    criterion.attempts = Number(criterion.attempts) || 0;
    criterion.searchCount = Number(criterion.searchCount) || 0;
    criterion.reason = criterion.reason || '';
    delete criterion.stalledCycles;
  }
  const normalizedFollowups = Array.isArray(followupTargets) ? followupTargets : [];
  if (normalizedFollowups.length && seedLedger) {
    for (const [index, followupTarget] of normalizedFollowups.entries()) {
      let criterion = (initialLedger.criteria || []).find((item) =>
        item.id === String(followupTarget.criterionId || ''));
      if (!criterion) {
        criterion = {
          id: `f${wave.wave}_${index + 1}`,
          text: text(followupTarget.gap, 600),
          status: 'missing',
          candidateIds: [],
          attempts: 0,
          searchCount: 0,
          reason: '',
        };
        initialLedger.criteria = [...(initialLedger.criteria || []), criterion];
      } else {
        criterion.status = 'missing';
        criterion.attempts = 0;
        criterion.searchCount = 0;
        delete criterion.stalledCycles;
      }
      criterion.reason = text(followupTarget.gap || criterion.text, 600);
    }
    const firstFollowup = normalizedFollowups[0];
    const firstCriterion = (initialLedger.criteria || []).find((criterion) =>
      criterion.id === String(firstFollowup.criterionId || ''))
      || (initialLedger.criteria || []).find((criterion) => criterion.status === 'missing');
    initialLedger.decision = 'continue';
    initialLedger.nextGap = firstCriterion
      ? { criterionId: firstCriterion.id, reason: firstCriterion.reason || firstCriterion.text }
      : null;
    initialLedger.gaps = (initialLedger.criteria || [])
      .filter((criterion) => criterion.status !== 'covered')
      .map((criterion) => ({
        criterionId: criterion.id,
        text: criterion.reason || criterion.text,
        status: TERMINAL_COVERAGE.has(criterion.status) ? criterion.status : 'open',
      }));
    initialLedger.cycles = 0;
  }
  let run = existingRun || createResearchScoutRun({
    sessionId: session.id,
    waveId: wave.id,
    questionId: question.id,
    name: `Scout ${question.ordinal + 1}`,
    ledger: initialLedger,
  });
  let ledger = run.ledger && Object.keys(run.ledger).length ? run.ledger : initialLedger;
  const bundle = getBuiltinTools({ workspaceRoot, config });
  const { definitions: baseDefinitions, handlers: baseHandlers } = filterScoutBundle(bundle);
  const allowedFetchUrls = new Set();

  updateResearchQuestion(question.id, { status: 'in_progress', lastScoutAt: new Date().toISOString() });
  emit({
    type: 'scout:start',
    scope: 'scout',
    wave: wave.wave,
    waveId: wave.id,
    scoutRunId: run.id,
    questionId: question.id,
    questionText: question.text,
    name: run.name,
  });

  try {
    while (ledger.decision === 'continue' && Number(ledger.cycles || 0) < MAX_SCOUT_CYCLES) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const targetGap = ledger.nextGap || {
        criterionId: ledger.criteria?.find((criterion) =>
          !TERMINAL_COVERAGE.has(criterion.status))?.id,
        reason: ledger.criteria?.find((criterion) =>
          !TERMINAL_COVERAGE.has(criterion.status))?.text,
      };
      if (!targetGap?.criterionId) {
        ledger.decision = 'done';
        break;
      }

      const batchEvents = [];
      let cycleSearches = 0;
      let cycleFetches = 0;
      let cycleTools = 0;
      let budgetExhausted = false;
      const checkpointController = createScoutCheckpointController();
      const knownQueries = new Set((ledger.queries || []).map((entry) => entry.normalized || normalizeQuery(entry.query)));
      const emitScout = (event) => {
        const stamped = {
          ...event,
          scope: 'scout',
          wave: wave.wave,
          waveId: wave.id,
          scoutRunId: run.id,
          questionId: question.id,
          scoutName: run.name,
        };
        if (event?.type?.startsWith('tool:')) batchEvents.push(stamped);
        emit(stamped);
      };

      const handlers = {
        web_search: async (args = {}, ctx) => {
          cycleTools += 1;
          // Per-cycle gate: count searches started in THIS cycle only (not criterion.searchCount).
          if (checkpointController.hasSearchStarted()) {
            throw new Error(
              'Search rejected: this checkpoint already used its one web_search. '
              + 'Call finish_scout_cycle first; the next cycle may search again.',
            );
          }
          const criterionId = String(args?.criterionId || '');
          if (criterionId !== targetGap.criterionId) {
            throw new Error(`Search rejected: current target criterion is ${targetGap.criterionId}`);
          }
          const query = String(args?.query || '').trim();
          const normalized = normalizeQuery(query);
          if (!normalized) throw new Error('Search rejected: query is required');
          if (knownQueries.has(normalized)) {
            throw new Error('Search rejected: duplicate query in this Scout ledger');
          }
          const criterion = (ledger.criteria || []).find((item) => item.id === criterionId);
          const usedSearches = Number(criterion?.searchCount) || 0;
          if (usedSearches >= MAX_CRITERION_SEARCHES_PER_WAVE) {
            budgetExhausted = true;
            throw new Error(
              `Search rejected: criterion ${criterionId} already used `
              + `${MAX_CRITERION_SEARCHES_PER_WAVE}/${MAX_CRITERION_SEARCHES_PER_WAVE} searches this wave; `
              + 'call finish_scout_cycle with current evidence',
            );
          }
          // Mark before any await so a parallel second search in the same batch is rejected.
          checkpointController.markSearchStarted();
          knownQueries.add(normalized);
          const reserved = reserveResearchBudget(session.id, 'searches', 1);
          if (!reserved.ok) {
            budgetExhausted = reserved.reason === 'exhausted';
            throw new Error('Session search safety budget exhausted; call finish_scout_cycle');
          }
          if (criterion) criterion.searchCount = usedSearches + 1;
          cycleSearches += 1;
          emitScout({
            type: 'budget',
            delta: { searches: 1 },
            scoutUsed: {
              searches: run.searchCount + cycleSearches,
              fetches: run.fetchCount + cycleFetches,
            },
          });
          const result = await baseHandlers.web_search({ ...args, query, criterionId: undefined }, ctx);
          for (const url of collectUrlsFromSearchResult(result)) allowedFetchUrls.add(url);
          return result;
        },
        web_fetch: async (args = {}, ctx) => {
          cycleTools += 1;
          const url = normalizeUrl(args?.url);
          if (!url) throw new Error('Fetch rejected: url is required');
          if (!allowedFetchUrls.has(url)) {
            throw new Error(
              'Fetch rejected: url must come from a web_search result in this Scout wave',
            );
          }
          const reserved = reserveResearchBudget(session.id, 'fetches', 1);
          if (!reserved.ok) {
            budgetExhausted = reserved.reason === 'exhausted';
            throw new Error('Session fetch safety budget exhausted; call finish_scout_cycle');
          }
          cycleFetches += 1;
          emitScout({
            type: 'budget',
            delta: { fetches: 1 },
            scoutUsed: {
              searches: run.searchCount + cycleSearches,
              fetches: run.fetchCount + cycleFetches,
            },
          });
          return baseHandlers.web_fetch(args, ctx);
        },
        finish_scout_cycle: async (args = {}) => {
          cycleTools += 1;
          checkpointController.markFinished();
          const reason = String(args?.reason || '').trim();
          return {
            ok: true,
            finished: true,
            message: reason
              ? `Checkpoint finished: ${reason}`
              : 'Checkpoint finished. Evaluator will review this search batch.',
          };
        },
      };

      emitScout({
        type: 'scout:checkpoint_start',
        cycle: Number(ledger.cycles || 0) + 1,
        targetGap,
      });
      await runAgentLoop({
        systemPrompt: [
          'You are a focused, read-only research Scout.',
          'Investigate only the target criterion in the user prompt.',
          'Search at most once this cycle, then fetch useful allowlisted URLs across as many rounds as needed.',
          'When done with this search batch, call finish_scout_cycle before searching again.',
          'Do not write a final report; gather attributable evidence for the checkpoint evaluator.',
        ].join('\n'),
        userPrompt: buildScoutCyclePrompt({ session, question, ledger, targetGap }),
        model: resolveSubAgentModel(config, model),
        toolDefinitions: baseDefinitions,
        toolHandlers: handlers,
        deferredDefinitions: {},
        toolFormatters: bundle.formatters,
        toolDisplayLabels: {
          ...(bundle.displayLabels || {}),
          finish_scout_cycle: 'Finish cycle',
        },
        executionMode: 'normal',
        approvalMode: 'auto',
        alwaysAllowTools: ['web_search', 'web_fetch', 'finish_scout_cycle'],
        projectIsGit: false,
        toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
        config: { ...config, workspaceRoot },
        signal,
        requestCompletion: makeStreamingCompletion(config, emitScout, 'low'),
        onEvent: emitScout,
        shouldCheckpoint: () => checkpointController.shouldCheckpoint({
          tools: cycleTools,
          budgetExhausted,
        }),
      });

      const before = ledgerProgressSignature(ledger);
      const evaluation = await evaluateScoutCheckpoint({
        config,
        mainModel: model || config.model?.name,
        question,
        ledger,
        batchEvents,
        signal,
      });
      if (!evaluation.evaluator.ok) {
        throw new Error(`Scout checkpoint evaluator failed: ${evaluation.evaluator.error}`);
      }
      const patchedLedger = applyLedgerPatch(ledger, evaluation.patch, batchEvents);
      const after = ledgerProgressSignature(patchedLedger);
      ledger = advanceLedgerAfterCheckpoint(patchedLedger, {
        patch: evaluation.patch,
        targetCriterionId: targetGap.criterionId,
        progressed: before !== after && (cycleSearches > 0 || cycleFetches > 0),
        budgetExhausted,
      });
      run = updateResearchScoutRun(run.id, {
        ledger,
        decision: {
          decision: ledger.decision,
          nextGap: ledger.nextGap,
          evaluatedAt: new Date().toISOString(),
          evaluator: evaluation.evaluator,
        },
        searchCount: run.searchCount + cycleSearches,
        fetchCount: run.fetchCount + cycleFetches,
      });
      emitScout({
        type: 'scout:checkpoint',
        cycle: ledger.cycles,
        decision: ledger.decision,
        coverage: ledger.criteria,
        nextGap: ledger.nextGap,
        candidateCount: ledger.candidates.length,
        searchCount: run.searchCount,
        fetchCount: run.fetchCount,
      });
    }

    if (ledger.decision === 'continue') {
      for (const criterion of ledger.criteria || []) {
        if (!TERMINAL_COVERAGE.has(criterion.status)) {
          criterion.status = 'blocked';
          criterion.reason = 'Scout cycle safety limit reached.';
        }
      }
      ledger.decision = 'partial';
      ledger.nextGap = null;
      ledger.gaps = (ledger.criteria || [])
        .filter((criterion) => criterion.status !== 'covered')
        .map((criterion) => ({
          criterionId: criterion.id,
          text: criterion.reason || criterion.text,
          status: criterion.status,
        }));
    }
    const status = ledger.decision === 'done' ? 'done' : 'partial';
    const handoff = buildScoutHandoff(question, ledger);
    run = updateResearchScoutRun(run.id, {
      status,
      ledger,
      decision: { decision: status, gaps: ledger.gaps || [] },
      handoffMarkdown: handoff,
    });
    updateResearchQuestion(question.id, {
      status,
      criteriaMet: (ledger.criteria || [])
        .filter((criterion) => criterion.status === 'covered')
        .map((criterion) => criterion.id),
      gaps: (ledger.gaps || []).map((gap) => gap.text),
      lastScoutAt: new Date().toISOString(),
    });
    emit({
      type: 'handoff',
      scope: 'scout',
      wave: wave.wave,
      waveId: wave.id,
      scoutRunId: run.id,
      questionId: question.id,
      name: run.name,
      status,
      handoff,
      ledger: compactLedger(ledger),
    });
    return run;
  } catch (error) {
    const aborted = signal?.aborted || error?.name === 'AbortError';
    const errorMessage = error instanceof Error ? error.message : String(error);
    run = updateResearchScoutRun(run.id, {
      status: aborted ? 'aborted' : 'failed',
      ledger,
      error: errorMessage,
    });
    updateResearchQuestion(question.id, {
      status: aborted ? 'open' : 'blocked',
      gaps: [aborted ? 'Investigation stopped by user' : errorMessage],
    });
    emit({
      type: 'scout:error',
      scope: 'scout',
      wave: wave.wave,
      waveId: wave.id,
      scoutRunId: run.id,
      questionId: question.id,
      name: run.name,
      status: aborted ? 'aborted' : 'failed',
      error: errorMessage,
      ledger: compactLedger(ledger),
    });
    throw error;
  } finally {
    await bundle.dispose?.();
  }
}

async function reviewWaveCandidates({ config, model, session, wave, scoutRuns, signal }) {
  const candidates = scoutRuns.flatMap((run) =>
    (run.ledger?.candidates || []).map((candidate) => ({
      ...candidate,
      scoutRunId: run.id,
      questionId: run.questionId,
    })));
  if (!candidates.length) return { acceptCandidateIds: [], reason: 'No candidates' };
  try {
    const reviewed = await callJsonModel({
      config,
      model: model || config.model?.name,
      fallbackModel: resolveSubAgentModel(config, model),
      reasoningEffort: 'medium',
      signal,
      systemPrompt: [
        'You are the Lead research evidence reviewer.',
        'Select candidate IDs that are attributable, relevant, and useful.',
        'Prefer primary sources. Do not rewrite evidence.',
        'Return strict JSON only: {"acceptCandidateIds":[],"reason":""}.',
      ].join('\n'),
      userPrompt: [
        `Main question: ${session.question}`,
        `Wave: ${wave.wave}`,
        `Candidates:\n${JSON.stringify(candidates)}`,
      ].join('\n\n'),
      validate: validateLeadReview,
    });
    const validIds = new Set(candidates.map((candidate) => candidate.id));
    const acceptedCandidateIds = reviewed.data.acceptCandidateIds
      .filter((candidateId) => validIds.has(candidateId));
    const resolvedIds = acceptedCandidateIds.length
      ? acceptedCandidateIds
      : candidates
        .filter((candidate) => candidate.sources?.length)
        .map((candidate) => candidate.id);
    return {
      ...reviewed.data,
      acceptCandidateIds: resolvedIds,
      reason: acceptedCandidateIds.length
        ? reviewed.data.reason
        : 'No candidate was selected; retained attributable candidates with explicit confidence.',
      evaluator: {
        ok: true,
        model: reviewed.model,
        attempt: reviewed.attempt,
        rawText: reviewed.rawText,
      },
    };
  } catch (error) {
    return {
      acceptCandidateIds: candidates
        .filter((candidate) => candidate.sources?.length)
        .map((candidate) => candidate.id),
      reason: 'Deterministic fallback retained attributable candidates with explicit confidence.',
      evaluator: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function candidateToEvidence(candidate, questionId) {
  const primary = candidate.sources?.[0] || {};
  return {
    candidateId: candidate.id,
    questionId,
    claim: candidate.claim,
    snippet: primary.snippet || '',
    url: primary.url || '',
    sourceLabel: primary.label || '',
    confidence: candidate.confidence,
    createdFrom: 'scout_handoff',
  };
}

async function commitWave({ config, model, session, wave, scoutRuns, signal, emit }) {
  const review = await reviewWaveCandidates({ config, model, session, wave, scoutRuns, signal });
  const acceptedIds = new Set(Array.isArray(review?.acceptCandidateIds) ? review.acceptCandidateIds.map(String) : []);
  const acceptEvidence = [];
  for (const run of scoutRuns) {
    for (const candidate of run.ledger?.candidates || []) {
      if (acceptedIds.has(candidate.id)) acceptEvidence.push(candidateToEvidence(candidate, run.questionId));
    }
  }
  const result = applyResearchCommit(session.id, { acceptEvidence });
  const evidence = listResearchEvidence(session.id);
  for (const run of scoutRuns) {
    const candidateIds = (run.ledger?.candidates || [])
      .map((candidate) => candidate.id)
      .filter((id) => acceptedIds.has(id));
    const evidenceIds = evidence
      .filter((item) => candidateIds.includes(item.originCandidateId))
      .map((item) => item.id);
    updateResearchScoutRun(run.id, {
      committedCandidateIds: candidateIds,
      committedEvidenceIds: evidenceIds,
    });
  }
  appendResearchTimeline(session.id, {
    type: 'commit',
    wave: wave.wave,
    insertedEvidenceIds: result.insertedEvidenceIds,
    reusedEvidenceIds: result.reusedEvidenceIds,
    updatedQuestionIds: [],
    revokedEvidenceIds: [],
    reviewer: review?.evaluator || null,
    reviewReason: review?.reason || '',
  });
  emit({
    type: 'commit',
    scope: 'lead',
    wave: wave.wave,
    waveId: wave.id,
    ...result,
    acceptedCandidateIds: [...acceptedIds],
    reason: review?.reason || '',
    evaluator: review?.evaluator || null,
  });
  return result;
}

function deterministicResearchReadiness(detail) {
  const acceptedByQuestion = new Map();
  const acceptedCandidateIds = new Set();
  for (const evidence of detail.evidence || []) {
    if (evidence.status !== 'accepted') continue;
    if (evidence.originCandidateId) acceptedCandidateIds.add(evidence.originCandidateId);
    acceptedByQuestion.set(
      evidence.questionId,
      (acceptedByQuestion.get(evidence.questionId) || 0) + 1,
    );
  }
  const latestByQuestion = new Map();
  for (const run of listResearchScoutRuns({ sessionId: detail.id })) {
    if (TERMINAL_SCOUT.has(run.status) || run.status === 'failed') {
      latestByQuestion.set(run.questionId, run);
    }
  }
  const requiredTargets = [];
  const eligibleTargets = [];
  const limitations = [];
  const pushUnique = (list, item) => {
    const key = `${item.questionId}:${item.criterionId}`;
    if (!list.some((entry) => `${entry.questionId}:${entry.criterionId}` === key)) list.push(item);
  };
  for (const question of detail.questions || []) {
    const run = latestByQuestion.get(question.id);
    const criteria = Array.isArray(run?.ledger?.criteria) && run.ledger.criteria.length
      ? run.ledger.criteria
      : criterionEntries(question);
    for (const criterion of criteria) {
      const attempts = Number(criterion.attempts) || 0;
      const hasAcceptedEvidence = (criterion.candidateIds || [])
        .some((candidateId) => acceptedCandidateIds.has(candidateId));
      const item = {
        questionId: question.id,
        criterionId: criterion.id,
        gap: text(criterion.reason || criterion.text || 'Criterion remains unresolved', 600),
      };
      if (['missing', 'conflicted'].includes(criterion.status)) {
        pushUnique(requiredTargets, item);
        pushUnique(eligibleTargets, item);
        continue;
      }
      if (['partial', 'blocked'].includes(criterion.status)) {
        pushUnique(eligibleTargets, item);
      }
      if (criterion.status !== 'covered' || !hasAcceptedEvidence) {
        limitations.push({
          ...item,
          status: criterion.status,
          attempts,
          reason: criterion.status === 'covered'
            ? 'No accepted evidence was retained for this criterion.'
            : item.gap,
        });
        if (criterion.status === 'covered' && !hasAcceptedEvidence) {
          pushUnique(eligibleTargets, {
            ...item,
            gap: 'No accepted attributable evidence supports this covered criterion.',
          });
        }
      }
    }
  }
  const acceptedEvidenceCount = [...acceptedByQuestion.values()]
    .reduce((sum, count) => sum + count, 0);
  if (!acceptedEvidenceCount && !requiredTargets.length && eligibleTargets.length) {
    requiredTargets.push(eligibleTargets[0]);
  }
  return {
    ready: requiredTargets.length === 0,
    targets: requiredTargets,
    eligibleTargets,
    limitations,
    acceptedEvidenceCount,
  };
}

async function evaluateWave({ config, model, session, wave, scoutRuns, signal }) {
  const detail = getResearchSessionDetail(session.id);
  const readiness = deterministicResearchReadiness(detail);
  const compact = {
    wave: wave.wave,
    maxWaves: detail.budget?.maxWaves || 5,
    questions: (detail.questions || []).map((question) => ({
      id: question.id,
      label: text(question.text, 120),
      text: question.text,
      status: question.status,
      criteriaMet: question.criteriaMet,
      gaps: question.gaps,
      successCriteria: normalizeSuccessCriteria(question.successCriteria).map((criterion, index) => ({
        id: `c${index + 1}`,
        label: text(criterion.text, 80),
        text: criterion.text,
        priority: criterion.priority,
      })),
    })),
    scouts: scoutRuns.map((run) => ({
      questionId: run.questionId,
      questionLabel: text(
        (detail.questions || []).find((question) => question.id === run.questionId)?.text,
        120,
      ),
      status: run.status,
      error: run.error || '',
      coverage: run.ledger?.criteria || [],
      gaps: run.ledger?.gaps || [],
      candidateCount: run.ledger?.candidates?.length || 0,
    })),
    acceptedEvidence: (detail.evidence || [])
      .filter((item) => item.status === 'accepted')
      .map((item) => ({ questionId: item.questionId, claim: item.claim, confidence: item.confidence })),
    requiredTargets: readiness.targets,
    eligibleFollowups: readiness.eligibleTargets,
    seedLimitations: readiness.limitations,
  };
  if (wave.wave >= (detail.budget?.maxWaves || 5) && !readiness.ready) {
    const partitioned = partitionWaveTargetsAndLimitations({
      targets: [],
      limitations: readiness.limitations,
      unresolved: [...readiness.targets, ...readiness.eligibleTargets],
    });
    return {
      decision: 'incomplete',
      reason: 'Maximum research waves reached with unresolved evidence requirements.',
      targets: [],
      limitations: partitioned.limitations,
      readiness,
    };
  }
  try {
    const evaluated = await callJsonModel({
      config,
      model: resolveSubAgentModel(config, model),
      fallbackModel: model || config.model?.name,
      reasoningEffort: 'medium',
      signal,
      systemPrompt: [
        'You are a wave-level research evaluator with no tools.',
        'Decide whether the whole research is ready for a report or needs one targeted follow-up wave.',
        'Use a next wave only for important, researchable gaps. Each targeted criterion gets a fresh search allowance in the next wave.',
        'Return targets for criteria worth deep-following; return limitations for gaps you will NOT chase.',
        'A criterion must not appear in both targets and limitations.',
        'Targets must come from eligibleFollowups. Prefer ready_for_report when no requiredTargets remain.',
        'In reason, refer to sub-questions by their label text and keep questionId/criterionId only in targets/limitations arrays.',
        'Return strict JSON only: {"decision":"ready_for_report|next_wave","reason":"","targets":[{"questionId":"","criterionId":"","gap":""}],"limitations":[{"questionId":"","criterionId":"","gap":""}]}.',
      ].join('\n'),
      userPrompt: JSON.stringify(compact),
      validate: validateWaveEvaluation,
    });
    const result = evaluated.data;
    const validQuestionIds = new Set((detail.questions || []).map((question) => question.id));
    const unresolvedTargetKeys = new Set(
      readiness.eligibleTargets.map((target) => targetKey(target)),
    );
    const modelTargets = (Array.isArray(result?.targets) ? result.targets : [])
      .map((target) => ({
        questionId: String(target?.questionId || ''),
        criterionId: String(target?.criterionId || ''),
        gap: text(target?.gap || target?.reason, 600),
      }))
      .filter((target) =>
        validQuestionIds.has(target.questionId)
        && target.gap
        && unresolvedTargetKeys.has(targetKey(target)));
    let chosenTargets = modelTargets;
    if (!readiness.ready) {
      const combined = [...modelTargets, ...readiness.targets];
      const seen = new Set();
      chosenTargets = combined.filter((target) => {
        const key = targetKey(target);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else if (result.decision !== 'next_wave') {
      chosenTargets = [];
    }
    const partitioned = partitionWaveTargetsAndLimitations({
      targets: chosenTargets,
      limitations: result?.limitations || readiness.limitations,
      unresolved: readiness.eligibleTargets,
    });
    const decision = partitioned.targets.length
      ? 'next_wave'
      : (readiness.ready || readiness.acceptedEvidenceCount > 0 ? 'ready_for_report' : 'incomplete');
    return {
      decision,
      reason: text(
        result.reason
          || (decision === 'next_wave'
            ? 'Follow-up wave approved for important unresolved criteria.'
            : 'Ready for report with explicit limitations.'),
        1000,
      ),
      targets: partitioned.targets,
      limitations: partitioned.limitations,
      readiness,
      evaluator: {
        ok: true,
        model: evaluated.model,
        attempt: evaluated.attempt,
        rawText: evaluated.rawText,
      },
    };
  } catch (error) {
    const errText = error instanceof Error ? error.message : String(error);
    if (!readiness.ready) {
      const partitioned = partitionWaveTargetsAndLimitations({
        targets: readiness.targets,
        limitations: readiness.limitations,
        unresolved: readiness.eligibleTargets,
      });
      return {
        decision: partitioned.targets.length ? 'next_wave' : 'incomplete',
        reason: 'Deterministic readiness checks found unresolved evidence requirements.',
        targets: partitioned.targets,
        limitations: partitioned.limitations,
        readiness,
        evaluator: { ok: false, error: errText },
      };
    }
    const partitioned = partitionWaveTargetsAndLimitations({
      targets: [],
      limitations: readiness.limitations,
      unresolved: [...readiness.targets, ...readiness.eligibleTargets],
    });
    return {
      decision: readiness.ready || readiness.acceptedEvidenceCount > 0 ? 'ready_for_report' : 'incomplete',
      reason: readiness.ready
        ? 'Deterministic readiness checks passed after the wave evaluator failed.'
        : 'Deterministic readiness checks found unresolved evidence requirements.',
      targets: [],
      limitations: partitioned.limitations,
      readiness,
      evaluator: { ok: false, error: errText },
    };
  }
}


function selectWaveTargets(detail, previousEvaluation) {
  if (!previousEvaluation) {
    return (detail.questions || []).map((question) => ({
      questionId: question.id,
      gap: question.text,
    }));
  }
  return Array.isArray(previousEvaluation.targets) ? previousEvaluation.targets : [];
}

async function runWaveScouts({
  session,
  wave,
  config,
  model,
  workspaceRoot,
  signal,
  emit,
}) {
  const detail = getResearchSessionDetail(session.id);
  const questionById = new Map((detail.questions || []).map((question) => [question.id, question]));
  const targets = (wave.targets || []).filter((target) => questionById.has(target.questionId));
  const targetsByQuestion = new Map();
  for (const target of targets) {
    const list = targetsByQuestion.get(target.questionId) || [];
    list.push(target);
    targetsByQuestion.set(target.questionId, list);
  }
  const existingRuns = listResearchScoutRuns({ waveId: wave.id });
  const terminalByQuestion = new Map(
    existingRuns.filter((run) => TERMINAL_SCOUT.has(run.status)).map((run) => [run.questionId, run]),
  );
  const completed = new Set(terminalByQuestion.keys());
  const pending = new Set(targets.map((target) => target.questionId).filter((id) => !completed.has(id)));
  const maxParallel = Math.max(1, Number(session.budget?.maxParallelScouts || 3));

  while (pending.size) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const ready = [...pending].filter((questionId) => {
      const question = questionById.get(questionId);
      return (question?.dependsOn || []).every((dep) => !pending.has(dep) || completed.has(dep));
    });
    const batchIds = (ready.length ? ready : [...pending]).slice(0, maxParallel);
    emit({
      type: 'batch:start',
      scope: 'lead',
      wave: wave.wave,
      waveId: wave.id,
      questionIds: batchIds,
    });
    const settled = await Promise.allSettled(batchIds.map(async (questionId) => {
      const question = questionById.get(questionId);
      const stale = existingRuns.find((run) => run.questionId === questionId && run.status === 'running');
      const prior = listResearchScoutRuns({ questionId })
        .filter((run) => run.waveId !== wave.id && TERMINAL_SCOUT.has(run.status))
        .at(-1);
      return runScoutWithCheckpoints({
        session,
        wave,
        question,
        config,
        model,
        workspaceRoot,
        signal,
        emit,
        existingRun: stale || null,
        seedLedger: prior?.ledger || null,
        followupTargets: wave.wave > 1 ? targetsByQuestion.get(questionId) || [] : [],
      });
    }));
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    for (const [index, result] of settled.entries()) {
      const questionId = batchIds[index];
      if (result.status === 'rejected') {
        completed.add(questionId);
        pending.delete(questionId);
        continue;
      }
      const run = result.value;
      terminalByQuestion.set(run.questionId, run);
      completed.add(run.questionId);
      pending.delete(run.questionId);
    }
    emit({
      type: 'batch:done',
      scope: 'lead',
      wave: wave.wave,
      waveId: wave.id,
      questionIds: batchIds,
      failedQuestionIds: settled
        .map((result, index) => result.status === 'rejected' ? batchIds[index] : '')
        .filter(Boolean),
    });
  }
  return [...terminalByQuestion.values()];
}

export async function runResearchInvestigation({
  sessionId,
  config,
  model,
  workspaceRoot = process.cwd(),
  signal,
  emit = () => {},
}) {
  let detail = getResearchSessionDetail(sessionId);
  if (!detail) throw new Error('research session not found');
  ensureResearchSessionBudget(sessionId);
  detail = getResearchSessionDetail(sessionId);
  let previousEvaluation = null;
  const waves = listResearchWaves(sessionId);
  const completedWaves = waves.filter((wave) => wave.status === 'completed');
  if (completedWaves.length) previousEvaluation = completedWaves.at(-1).evaluation;
  let waveNo = completedWaves.length + 1;

  while (waveNo <= (detail.budget?.maxWaves || 5)) {
    detail = getResearchSessionDetail(sessionId);
    const existing = waves.find((wave) =>
      wave.wave === waveNo && ['running', 'evaluating', 'aborted', 'failed'].includes(wave.status));
    const targets = existing?.targets?.length
      ? existing.targets
      : selectWaveTargets(detail, previousEvaluation);
    if (!targets.length) {
      const readiness = deterministicResearchReadiness(detail);
      updateResearchSession(sessionId, { phase: readiness.ready ? 'ready_for_report' : 'incomplete' });
      return {
        ok: readiness.ready,
        readyForReport: readiness.ready,
        evaluation: previousEvaluation || {
          decision: readiness.ready ? 'ready_for_report' : 'incomplete',
          reason: readiness.ready
            ? 'Deterministic readiness checks passed.'
            : 'No actionable targets were available for unresolved requirements.',
          targets: readiness.targets,
          readiness,
        },
      };
    }
    if (!existing) {
      const reserved = reserveResearchBudget(sessionId, 'waves');
      if (!reserved.ok) {
        updateResearchSession(sessionId, { phase: 'incomplete' });
        return {
          ok: false,
          readyForReport: false,
          evaluation: {
            decision: 'incomplete',
            reason: 'Wave safety budget exhausted.',
            targets,
          },
        };
      }
    }
    const wave = existing || createResearchWave(sessionId, { wave: waveNo, targets });
    if (existing && ['aborted', 'failed'].includes(existing.status)) {
      updateResearchWave(existing.id, { status: 'running', evaluation: {} });
      wave.status = 'running';
      wave.evaluation = {};
    }
    appendResearchTimeline(sessionId, { type: 'wave:start', wave: wave.wave, waveId: wave.id });
    emit({ type: 'wave:start', scope: 'lead', wave: wave.wave, waveId: wave.id, targets });
    try {
      const scoutRuns = await runWaveScouts({
        session: detail,
        wave,
        config,
        model,
        workspaceRoot,
        signal,
        emit,
      });
      updateResearchWave(wave.id, { status: 'evaluating' });
      await commitWave({ config, model, session: detail, wave, scoutRuns, signal, emit });
      const evaluation = await evaluateWave({ config, model, session: detail, wave, scoutRuns, signal });
      updateResearchWave(wave.id, {
        status: 'completed',
        evaluation,
        completedAt: new Date().toISOString(),
      });
      appendResearchTimeline(sessionId, {
        type: 'wave:evaluation',
        wave: wave.wave,
        waveId: wave.id,
        evaluation,
      });
      emit({
        type: 'wave:evaluation',
        scope: 'lead',
        wave: wave.wave,
        waveId: wave.id,
        evaluation,
      });
      if (evaluation.decision === 'ready_for_report') {
        updateResearchSession(sessionId, { phase: 'ready_for_report' });
        return { ok: true, readyForReport: true, evaluation };
      }
      if (evaluation.decision === 'incomplete') {
        updateResearchSession(sessionId, { phase: 'incomplete' });
        return { ok: false, readyForReport: false, evaluation };
      }
      previousEvaluation = evaluation;
      detail = getResearchSessionDetail(sessionId);
      waveNo += 1;
    } catch (error) {
      updateResearchWave(wave.id, {
        status: signal?.aborted || error?.name === 'AbortError' ? 'aborted' : 'failed',
        evaluation: {
          decision: 'interrupted',
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  detail = getResearchSessionDetail(sessionId);
  const readiness = deterministicResearchReadiness(detail);
  updateResearchSession(sessionId, { phase: readiness.ready ? 'ready_for_report' : 'incomplete' });
  return {
    ok: readiness.ready,
    readyForReport: readiness.ready,
    evaluation: readiness.ready
      ? { decision: 'ready_for_report', reason: 'Deterministic readiness checks passed.' }
      : {
        decision: 'incomplete',
        reason: 'Wave safety limit reached with unresolved evidence requirements.',
        targets: readiness.targets,
        readiness,
      },
  };
}

export {
  applyLedgerPatch,
  buildScoutHandoff,
  createInitialLedger,
  createResearchSearchDefinition,
  createScoutCheckpointController,
  deterministicResearchReadiness,
  ledgerProgressSignature,
  advanceLedgerAfterCheckpoint,
  scopeScoutEvaluatorPatch,
  partitionWaveTargetsAndLimitations,
};
