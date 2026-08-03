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
  normalizeResearchPlanDepth,
  buildDeterministicResearchConclusions,
  normalizeResearchConclusions,
  researchDepthRuntimeLimits,
  RESEARCH_SCOUT_TOOLS_PER_CRITERION,
} from './research-store.js';

const MAX_URL_TEXT_CHARS = 6000;
const VALID_COVERAGE = new Set(['missing', 'partial', 'covered', 'conflicted', 'blocked']);
const TERMINAL_COVERAGE = new Set(['covered', 'partial', 'blocked']);
const TERMINAL_SCOUT = new Set(['done', 'partial', 'blocked']);
const MAX_URL_TEXT_FOR_VERIFY = 2500;

function text(value, max = 8000) {
  return String(value || '').trim().slice(0, max);
}

function resolveToolsCap(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : RESEARCH_SCOUT_TOOLS_PER_CRITERION;
}

function appendToolBudgetNote(payload, used, cap) {
  const remaining = Math.max(0, cap - used);
  const note = `[tools ${used}/${cap} used, ${remaining} left]`;
  if (payload == null) return note;
  if (typeof payload === 'string') return `${payload}\n\n${note}`;
  try {
    return `${JSON.stringify(payload)}\n\n${note}`;
  } catch {
    return `${String(payload)}\n\n${note}`;
  }
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
    : [{ text: 'Answer the sub-question with reliable, attributable evidence' }];
  return list.map((criterion, index) => ({
    id: `c${index + 1}`,
    text: String(criterion.text || '').trim(),
    status: 'missing',
    evidenceIds: [],
    toolCount: 0,
    reason: '',
  }));
}

function createEmptyCoverage(question) {
  return {
    version: 1,
    questionId: question.id,
    criteria: criterionEntries(question),
  };
}

function coverageFromLegacyLedger(question, ledger) {
  const base = createEmptyCoverage(question);
  if (!ledger || typeof ledger !== 'object') return base;
  const byId = new Map((base.criteria || []).map((item) => [item.id, item]));
  for (const criterion of ledger.criteria || []) {
    const id = String(criterion?.id || '');
    if (!id) continue;
    const current = byId.get(id) || {
      id,
      text: text(criterion.text, 600),
      status: 'missing',
      evidenceIds: [],
      toolCount: 0,
      reason: '',
    };
    const status = VALID_COVERAGE.has(criterion.status) ? criterion.status : current.status;
    current.status = status;
    current.toolCount = Number(criterion.toolCount) || 0;
    current.reason = text(criterion.reason, 600);
    current.evidenceIds = [];
    byId.set(id, current);
  }
  return {
    version: 1,
    questionId: question.id,
    criteria: [...byId.values()],
  };
}

function resolveQuestionCoverage(question, scoutRun = null) {
  const stored = question?.coverage;
  if (stored && Array.isArray(stored.criteria) && stored.criteria.length) {
    return {
      version: Number(stored.version) || 1,
      questionId: question.id,
      criteria: stored.criteria.map((item) => ({
        id: String(item.id || ''),
        text: text(item.text, 600),
        status: VALID_COVERAGE.has(item.status) ? item.status : 'missing',
        evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.map(String) : [],
        toolCount: Number(item.toolCount) || 0,
        reason: text(item.reason, 600),
      })).filter((item) => item.id),
    };
  }
  if (scoutRun?.ledger?.criteria?.length) {
    return coverageFromLegacyLedger(question, scoutRun.ledger);
  }
  return createEmptyCoverage(question);
}

function createInitialLedger(question) {
  // Kept for resume compatibility / empty scout_run seed. Candidates are no longer stored here.
  const coverage = createEmptyCoverage(question);
  return {
    version: 2,
    questionId: question.id,
    criteria: coverage.criteria.map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      status: criterion.status,
      candidateIds: [],
      attempts: 0,
      searchCount: 0,
      toolCount: criterion.toolCount,
      reason: criterion.reason,
    })),
    candidates: [],
    queries: [],
    gaps: coverage.criteria.map((criterion) => ({
      criterionId: criterion.id,
      text: criterion.text,
      status: 'open',
    })),
    decision: 'continue',
    nextGap: coverage.criteria[0]
      ? { criterionId: coverage.criteria[0].id, reason: coverage.criteria[0].text }
      : null,
    cycles: 0,
  };
}

function compactProgress(coverage) {
  return {
    questionId: coverage.questionId,
    criteria: (coverage.criteria || []).map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      status: criterion.status,
      evidenceIds: criterion.evidenceIds || [],
      toolCount: Number(criterion.toolCount) || 0,
      reason: criterion.reason || '',
    })),
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
    'Search and fetch freely within the per-criterion tool fuse; finish by calling submit_criterion_candidates.',
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

function createSubmitCandidatesDefinition() {
  return {
    type: 'function',
    function: {
      name: 'submit_criterion_candidates',
      description: [
        'End search/fetch for the current criterion and deliver candidate findings.',
        'Call this when you have enough attributable evidence, or with an empty candidates array if blocked.',
        'This tool does not count toward the search/fetch fuse.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                urls: { type: 'array', items: { type: 'string' } },
                quote: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
              required: ['claim', 'urls'],
            },
          },
          note: { type: 'string' },
        },
        required: ['candidates'],
      },
    },
  };
}

function filterScoutBundle(bundle) {
  const active = [...(bundle.definitions || [])];
  const deferred = bundle.deferredDefinitions || {};
  const webSearch = findDefinition(active, 'web_search') || deferred.web_search;
  const webFetch = findDefinition(active, 'web_fetch') || deferred.web_fetch;
  const definitions = [
    createResearchSearchDefinition(webSearch),
    ...(webFetch ? [structuredClone(webFetch)] : []),
    createSubmitCandidatesDefinition(),
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
    emit?.({ type: 'assistant:done', text: result?.text || '', toolCalls: result?.toolCalls || [] });
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

function indexSearchResult(urlIndex, result) {
  const results = Array.isArray(result?.results) ? result.results : [];
  for (const item of results) {
    const url = normalizeUrl(item?.url);
    if (!url) continue;
    const existing = urlIndex.get(url);
    if (existing?.source === 'fetch') continue;
    const snippet = [item?.title, item?.snippet || item?.content || item?.description]
      .map((part) => text(part, 800))
      .filter(Boolean)
      .join('\n');
    urlIndex.set(url, {
      source: 'search',
      text: text(snippet || url, MAX_URL_TEXT_CHARS),
    });
  }
}

function indexFetchResult(urlIndex, args, result) {
  const requested = normalizeUrl(args?.url);
  const finalUrl = normalizeUrl(result?.final_url || result?.finalUrl || result?.url || requested);
  const body = text(
    result?.text || result?.content || result?.markdown || result?.body || '',
    MAX_URL_TEXT_CHARS,
  );
  if (finalUrl && body) {
    urlIndex.set(finalUrl, { source: 'fetch', text: body });
  }
  if (requested && requested !== finalUrl && body) {
    const existing = urlIndex.get(requested);
    if (!existing || existing.source !== 'fetch') {
      urlIndex.set(requested, { source: 'fetch', text: body });
    }
  }
}

function normalizeSubmittedCandidates(rawCandidates, criterionId) {
  const list = Array.isArray(rawCandidates) ? rawCandidates : [];
  const out = [];
  for (const item of list) {
    const claim = text(item?.claim, 1000);
    const urls = [...new Set(
      (Array.isArray(item?.urls) ? item.urls : [item?.url])
        .map((url) => normalizeUrl(url))
        .filter(Boolean),
    )];
    if (!claim || !urls.length) continue;
    out.push({
      id: `cand_${randomUUID()}`,
      criterionIds: [String(criterionId)],
      claim,
      quote: text(item?.quote, 1200),
      confidence: ['high', 'medium', 'low'].includes(String(item?.confidence))
        ? String(item.confidence)
        : 'medium',
      urls,
    });
  }
  return out;
}

function parseCandidatesFromText(raw, criterionId) {
  const parsed = parseJsonObject(raw);
  if (!parsed) return [];
  const list = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  return normalizeSubmittedCandidates(list, criterionId);
}

function gateCandidatesByUrl(candidates, urlIndex) {
  const accepted = [];
  const rejected = [];
  for (const candidate of candidates) {
    const urls = (candidate.urls || []).map(normalizeUrl).filter(Boolean);
    const missing = urls.filter((url) => !urlIndex.has(url));
    if (!urls.length || missing.length) {
      rejected.push({
        ...candidate,
        reason: missing.length
          ? `URL(s) not seen in tool results: ${missing.join(', ')}`
          : 'No URLs provided',
      });
      continue;
    }
    accepted.push({
      ...candidate,
      urls,
      slices: urls.map((url) => ({
        url,
        toolText: text(urlIndex.get(url)?.text, MAX_URL_TEXT_FOR_VERIFY),
      })),
    });
  }
  return { accepted, rejected };
}

function validateSupportVerdicts(value, candidateIds) {
  if (!value || typeof value !== 'object') throw new Error('Support check must return an object');
  const raw = Array.isArray(value.verdicts) ? value.verdicts : [];
  const byId = new Map();
  for (const item of raw) {
    const id = String(item?.candidateId || item?.id || '');
    if (!id) continue;
    byId.set(id, {
      candidateId: id,
      supported: Boolean(item?.supported ?? item?.accept ?? item?.ok),
      reason: text(item?.reason, 400),
    });
  }
  return candidateIds.map((id) => byId.get(id) || {
    candidateId: id,
    supported: false,
    reason: 'Missing verdict',
  });
}

async function verifyCandidateSupport({
  config,
  model,
  question,
  criterion,
  gatedCandidates,
  signal,
}) {
  if (!gatedCandidates.length) return [];
  try {
    const reviewed = await callJsonModel({
      config,
      model: resolveSubAgentModel(config, model),
      fallbackModel: model || config.model?.name,
      reasoningEffort: 'low',
      signal,
      systemPrompt: [
        'You verify whether tool-result text supports research claims.',
        'For each candidate, judge ONLY from the provided URL toolText slices — not from the candidate quote alone.',
        'A claim may paraphrase the source; accept if the tool text substantively supports the claim.',
        'If any one URL slice supports the claim, mark supported=true.',
        'Return strict JSON only: {"verdicts":[{"candidateId":"","supported":true,"reason":""}]}',
      ].join('\n'),
      userPrompt: [
        `Sub-question: ${question.text}`,
        `Criterion (${criterion.id}): ${criterion.text}`,
        `Candidates:\n${JSON.stringify(gatedCandidates.map((item) => ({
          candidateId: item.id,
          claim: item.claim,
          slices: item.slices,
        })))}`,
      ].join('\n\n'),
      validate: (value) => ({
        verdicts: validateSupportVerdicts(value, gatedCandidates.map((item) => item.id)),
      }),
    });
    return reviewed.data.verdicts;
  } catch (error) {
    // Deterministic fallback: accept gated candidates that have fetch-backed text or non-empty snippets.
    return gatedCandidates.map((item) => ({
      candidateId: item.id,
      supported: item.slices.some((slice) => text(slice.toolText, 80).length >= 40),
      reason: error instanceof Error ? error.message : String(error),
    }));
  }
}

function candidateToEvidence(candidate, questionId) {
  const primaryUrl = candidate.urls?.[0] || '';
  const primarySlice = (candidate.slices || []).find((slice) => slice.url === primaryUrl)
    || candidate.slices?.[0]
    || {};
  return {
    candidateId: candidate.id,
    questionId,
    claim: candidate.claim,
    snippet: text(candidate.quote || primarySlice.toolText, 1200),
    url: primaryUrl,
    sourceLabel: '',
    confidence: candidate.confidence || 'medium',
    createdFrom: 'scout_handoff',
    criterionIds: candidate.criterionIds || [],
  };
}

function buildScoutHandoff(question, coverage, evidence = []) {
  const lines = [
    `Question: ${question.id} — ${question.text}`,
    '',
    'Accepted Evidence:',
  ];
  const forQuestion = evidence.filter((item) => item.questionId === question.id && item.status === 'accepted');
  if (!forQuestion.length) lines.push('- No accepted evidence yet.');
  for (const item of forQuestion) {
    lines.push(`- ${item.id}: ${item.claim}`);
    if (item.url) lines.push(`  URL: ${item.url}`);
    if (item.criterionIds?.length) lines.push(`  Criteria: ${item.criterionIds.join(', ')}`);
  }
  lines.push('', 'Coverage:');
  for (const criterion of coverage.criteria || []) {
    lines.push(`- [${criterion.id}] ${criterion.status}: ${criterion.reason || criterion.text}`);
  }
  return lines.join('\n');
}

function buildScoutCriterionPrompt({ session, question, criterion, toolsCap, toolsUsed = 0 }) {
  const cap = resolveToolsCap(toolsCap);
  const remaining = Math.max(0, cap - toolsUsed);
  return [
    'Investigate exactly ONE target criterion for this research sub-question.',
    'Use web_search and web_fetch freely and continuously.',
    'There is no URL allowlist — fetch any relevant URL.',
    `Hard fuse: at most ${cap} search/fetch tool calls combined for this criterion.`,
    'submit_criterion_candidates does NOT count toward the fuse.',
    'Every web_search call must include the supplied criterionId.',
    'When finished searching, you MUST call submit_criterion_candidates with your candidates.',
    'Do not stop with only prose — always submit candidates (empty array if blocked).',
    'Prefer primary and authoritative sources.',
    `Main question: ${session.question}`,
    session.preferences?.goal ? `Goal: ${session.preferences.goal}` : '',
    `Sub-question: ${question.text}`,
    `Target criterion id: ${criterion.id}`,
    `Target criterion: ${criterion.text}`,
    `Tool budget for this criterion: ${toolsUsed} of ${cap} used (${remaining} remaining).`,
  ].filter(Boolean).join('\n\n');
}

async function runCriterionScoutLoop({
  session,
  wave,
  question,
  criterion,
  run,
  coverage,
  config,
  model,
  workspaceRoot,
  signal,
  emit,
  toolsCap,
  baseDefinitions,
  baseHandlers,
  bundle,
}) {
  const urlIndex = new Map();
  const knownQueries = new Set();
  let toolsUsed = 0;
  let cycleSearches = 0;
  let cycleFetches = 0;
  let findingsSubmitted = false;
  let submittedCandidates = [];
  let submitNote = '';
  let fuseRejectCount = 0;
  let forceAfterFuseMiss = false;
  let budgetExhausted = false;

  const emitScout = (event) => {
    const stamped = {
      ...event,
      scope: 'scout',
      wave: wave.wave,
      waveId: wave.id,
      scoutRunId: run.id,
      questionId: question.id,
      scoutName: run.name,
      toolsUsed,
      toolsCap,
      criterionId: criterion.id,
    };
    emit(stamped);
  };

  const handlers = {
    web_search: async (args = {}, ctx) => {
      if (toolsUsed >= toolsCap) {
        fuseRejectCount += 1;
        if (fuseRejectCount >= 2) forceAfterFuseMiss = true;
        return `Tool fuse reached (${toolsCap}/${toolsCap}). Call submit_criterion_candidates with your candidates now.`;
      }
      const criterionId = String(args?.criterionId || '');
      if (criterionId !== criterion.id) {
        throw new Error(`Search rejected: current target criterion is ${criterion.id}`);
      }
      const query = String(args?.query || '').trim();
      const normalized = normalizeQuery(query);
      if (!normalized) throw new Error('Search rejected: query is required');
      if (knownQueries.has(normalized)) {
        throw new Error('Search rejected: duplicate query for this criterion');
      }
      knownQueries.add(normalized);
      const reserved = reserveResearchBudget(session.id, 'searches', 1);
      if (!reserved.ok) {
        budgetExhausted = reserved.reason === 'exhausted';
        throw new Error('Session search safety budget exhausted');
      }
      toolsUsed += 1;
      cycleSearches += 1;
      emitScout({
        type: 'budget',
        delta: { searches: 1 },
        scoutUsed: {
          searches: run.searchCount + cycleSearches,
          fetches: run.fetchCount + cycleFetches,
          tools: toolsUsed,
          toolsCap,
        },
      });
      const result = await baseHandlers.web_search({
        ...args,
        query,
        criterionId: undefined,
      }, ctx);
      indexSearchResult(urlIndex, result);
      return appendToolBudgetNote(result, toolsUsed, toolsCap);
    },
    web_fetch: async (args = {}, ctx) => {
      if (toolsUsed >= toolsCap) {
        fuseRejectCount += 1;
        if (fuseRejectCount >= 2) forceAfterFuseMiss = true;
        return `Tool fuse reached (${toolsCap}/${toolsCap}). Call submit_criterion_candidates with your candidates now.`;
      }
      const url = normalizeUrl(args?.url);
      if (!url) throw new Error('Fetch rejected: url is required');
      const reserved = reserveResearchBudget(session.id, 'fetches', 1);
      if (!reserved.ok) {
        budgetExhausted = reserved.reason === 'exhausted';
        throw new Error('Session fetch safety budget exhausted');
      }
      toolsUsed += 1;
      cycleFetches += 1;
      emitScout({
        type: 'budget',
        delta: { fetches: 1 },
        scoutUsed: {
          searches: run.searchCount + cycleSearches,
          fetches: run.fetchCount + cycleFetches,
          tools: toolsUsed,
          toolsCap,
        },
      });
      const result = await baseHandlers.web_fetch(args, ctx);
      indexFetchResult(urlIndex, args, result);
      return appendToolBudgetNote(result, toolsUsed, toolsCap);
    },
    submit_criterion_candidates: async (args = {}) => {
      submittedCandidates = normalizeSubmittedCandidates(args?.candidates, criterion.id);
      submitNote = text(args?.note, 600);
      findingsSubmitted = true;
      emitScout({
        type: 'finding',
        candidateCount: submittedCandidates.length,
        note: submitNote,
      });
      return {
        ok: true,
        acceptedForVerification: submittedCandidates.length,
        message: 'Candidates received. Criterion search is complete.',
      };
    },
  };

  emitScout({
    type: 'criterion:start',
    targetGap: { criterionId: criterion.id, reason: criterion.text },
    toolsCap,
  });
  // Compatibility alias for older UI listeners.
  emitScout({
    type: 'scout:checkpoint_start',
    cycle: Number(coverage.criteria?.findIndex((item) => item.id === criterion.id) || 0) + 1,
    targetGap: { criterionId: criterion.id, reason: criterion.text },
    toolsCap,
  });

  const systemPrompt = [
    'You are a focused, read-only research Scout.',
    'Investigate only the target criterion in the user prompt.',
    'Search and fetch freely. When done, call submit_criterion_candidates.',
    'Do not write a final report.',
  ].join('\n');

  let loopResult = await runAgentLoop({
    systemPrompt,
    userPrompt: buildScoutCriterionPrompt({
      session, question, criterion, toolsCap, toolsUsed: 0,
    }),
    model: resolveSubAgentModel(config, model),
    toolDefinitions: baseDefinitions,
    toolHandlers: handlers,
    deferredDefinitions: {},
    toolFormatters: bundle.formatters,
    toolDisplayLabels: bundle.displayLabels || {},
    executionMode: 'normal',
    approvalMode: 'auto',
    alwaysAllowTools: ['web_search', 'web_fetch', 'submit_criterion_candidates'],
    projectIsGit: false,
    toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
    config: { ...config, workspaceRoot },
    signal,
    skipAnalysisNudge: true,
    requestCompletion: makeStreamingCompletion(config, emitScout, 'low'),
    onEvent: emitScout,
    shouldCheckpoint: () => findingsSubmitted || forceAfterFuseMiss || budgetExhausted,
  });

  if (!findingsSubmitted && !signal?.aborted) {
    const priorMessages = Array.isArray(loopResult?.messages)
      ? loopResult.messages.filter((message) => message?.role !== 'system')
      : [];
    loopResult = await runAgentLoop({
      systemPrompt,
      userPrompt: [
        'You have not called submit_criterion_candidates yet.',
        'Call submit_criterion_candidates now with your candidates array.',
        'If you cannot produce attributable candidates, submit an empty array.',
        'Alternatively reply with JSON only: {"candidates":[{"claim":"","urls":[""],"quote":""}]}',
      ].join(' '),
      initialMessages: priorMessages,
      model: resolveSubAgentModel(config, model),
      toolDefinitions: baseDefinitions,
      toolHandlers: handlers,
      deferredDefinitions: {},
      toolFormatters: bundle.formatters,
      toolDisplayLabels: bundle.displayLabels || {},
      executionMode: 'normal',
      approvalMode: 'auto',
      alwaysAllowTools: ['web_search', 'web_fetch', 'submit_criterion_candidates'],
      projectIsGit: false,
      toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
      config: { ...config, workspaceRoot },
      signal,
      skipAnalysisNudge: true,
      requestCompletion: makeStreamingCompletion(config, emitScout, 'low'),
      onEvent: emitScout,
      shouldCheckpoint: () => findingsSubmitted || true,
    });
  }

  if (!findingsSubmitted) {
    submittedCandidates = parseCandidatesFromText(loopResult?.text, criterion.id);
    findingsSubmitted = true;
  }

  const { accepted: gated, rejected: urlRejected } = gateCandidatesByUrl(submittedCandidates, urlIndex);
  const verdicts = await verifyCandidateSupport({
    config,
    model,
    question,
    criterion,
    gatedCandidates: gated,
    signal,
  });
  const verdictById = new Map(verdicts.map((item) => [item.candidateId, item]));
  const supported = gated.filter((item) => verdictById.get(item.id)?.supported);
  const supportRejected = gated.filter((item) => !verdictById.get(item.id)?.supported);

  const acceptEvidence = supported.map((candidate) => candidateToEvidence(candidate, question.id));
  const commitResult = acceptEvidence.length
    ? applyResearchCommit(session.id, { acceptEvidence })
    : { insertedEvidenceIds: [], reusedEvidenceIds: [] };
  const evidenceIds = [
    ...(commitResult.insertedEvidenceIds || []),
    ...(commitResult.reusedEvidenceIds || []),
  ];

  let status = 'blocked';
  let reason = submitNote || 'No attributable candidates were verified.';
  if (supported.length) {
    status = supportRejected.length || urlRejected.length ? 'partial' : 'covered';
    reason = status === 'covered'
      ? `Accepted ${supported.length} verified claim(s).`
      : `Accepted ${supported.length} claim(s); ${supportRejected.length + urlRejected.length} rejected.`;
  } else if (submittedCandidates.length) {
    status = 'blocked';
    reason = urlRejected[0]?.reason
      || supportRejected.map((item) => verdictById.get(item.id)?.reason).filter(Boolean)[0]
      || 'Candidates failed URL or support checks.';
  } else if (toolsUsed <= 0) {
    reason = 'Scout ended without searching or submitting candidates.';
  }

  const coverageCriterion = (coverage.criteria || []).find((item) => item.id === criterion.id);
  if (coverageCriterion) {
    coverageCriterion.status = status;
    coverageCriterion.toolCount = toolsUsed;
    coverageCriterion.reason = reason;
    coverageCriterion.evidenceIds = evidenceIds;
  }

  for (const evidenceId of commitResult.insertedEvidenceIds || []) {
    emitScout({ type: 'evidence:accepted', evidenceId, criterionId: criterion.id });
  }

  emitScout({
    type: 'criterion:coverage',
    criterionId: criterion.id,
    status,
    reason,
    toolCount: toolsUsed,
    evidenceIds,
    coverage: compactProgress(coverage),
  });
  // Compatibility alias.
  emitScout({
    type: 'scout:checkpoint',
    cycle: (coverage.criteria || []).filter((item) => TERMINAL_COVERAGE.has(item.status)).length,
    decision: 'continue',
    coverage: coverage.criteria,
    nextGap: null,
    candidateCount: supported.length,
    searchCount: run.searchCount + cycleSearches,
    fetchCount: run.fetchCount + cycleFetches,
    toolsUsed,
    toolsCap,
  });

  return {
    toolsUsed,
    cycleSearches,
    cycleFetches,
    evidenceIds,
    status,
    reason,
    commitResult,
  };
}

async function runScoutForQuestion({
  session,
  wave,
  question,
  config,
  model,
  workspaceRoot,
  signal,
  emit,
  existingRun = null,
}) {
  const coverage = resolveQuestionCoverage(question, existingRun);
  for (const criterion of coverage.criteria || []) {
    if (!TERMINAL_COVERAGE.has(criterion.status)) {
      criterion.status = 'missing';
      criterion.evidenceIds = [];
      criterion.toolCount = 0;
      criterion.reason = '';
    }
  }

  let run = existingRun || createResearchScoutRun({
    sessionId: session.id,
    waveId: wave.id,
    questionId: question.id,
    name: `Investigator ${question.ordinal + 1}`,
    ledger: { version: 2, questionId: question.id, queries: [] },
  });

  const bundle = getBuiltinTools({ workspaceRoot, config });
  const { definitions: baseDefinitions, handlers: baseHandlers } = filterScoutBundle(bundle);
  const depth = normalizeResearchPlanDepth(session?.plan?.depth);
  const toolsCap = researchDepthRuntimeLimits(depth).toolsPerCriterion
    || RESEARCH_SCOUT_TOOLS_PER_CRITERION;

  updateResearchQuestion(question.id, {
    status: 'in_progress',
    coverage,
    lastScoutAt: new Date().toISOString(),
  });
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
    const pending = (coverage.criteria || []).filter((item) => !TERMINAL_COVERAGE.has(item.status));
    let totalSearches = 0;
    let totalFetches = 0;
    const committedEvidenceIds = [];

    for (const criterion of pending) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const result = await runCriterionScoutLoop({
        session,
        wave,
        question,
        criterion,
        run,
        coverage,
        config,
        model,
        workspaceRoot,
        signal,
        emit,
        toolsCap,
        baseDefinitions,
        baseHandlers,
        bundle,
      });
      totalSearches += result.cycleSearches;
      totalFetches += result.cycleFetches;
      committedEvidenceIds.push(...result.evidenceIds);
      run = updateResearchScoutRun(run.id, {
        ledger: { version: 2, questionId: question.id, queries: [] },
        decision: {
          decision: 'continue',
          criterionId: criterion.id,
          status: result.status,
          evaluatedAt: new Date().toISOString(),
        },
        searchCount: run.searchCount + result.cycleSearches,
        fetchCount: run.fetchCount + result.cycleFetches,
        committedEvidenceIds: [...new Set([
          ...(run.committedEvidenceIds || []),
          ...result.evidenceIds,
        ])],
      });
      updateResearchQuestion(question.id, { coverage: structuredClone(coverage) });
    }

    for (const criterion of coverage.criteria || []) {
      if (!TERMINAL_COVERAGE.has(criterion.status)) {
        criterion.status = 'blocked';
        criterion.reason = criterion.reason || 'Scout pass safety limit reached.';
      }
    }

    const allCovered = (coverage.criteria || []).every((item) => item.status === 'covered');
    const anyEvidence = (coverage.criteria || []).some((item) => (item.evidenceIds || []).length);
    const status = allCovered ? 'done' : (anyEvidence ? 'partial' : 'blocked');
    const evidence = listResearchEvidence(session.id);
    const handoff = buildScoutHandoff(question, coverage, evidence);

    run = updateResearchScoutRun(run.id, {
      status,
      ledger: { version: 2, questionId: question.id, queries: [] },
      decision: { decision: status, coverage: compactProgress(coverage) },
      handoffMarkdown: handoff,
      searchCount: Math.max(run.searchCount, totalSearches),
      fetchCount: Math.max(run.fetchCount, totalFetches),
      committedEvidenceIds: [...new Set(committedEvidenceIds)],
    });
    updateResearchQuestion(question.id, {
      status: status === 'done' ? 'done' : status,
      coverage: structuredClone(coverage),
      criteriaMet: (coverage.criteria || [])
        .filter((item) => item.status === 'covered')
        .map((item) => item.id),
      gaps: (coverage.criteria || [])
        .filter((item) => item.status !== 'covered')
        .map((item) => item.reason || item.text),
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
      coverage: compactProgress(coverage),
    });
    return run;
  } catch (error) {
    const aborted = signal?.aborted || error?.name === 'AbortError';
    const errorMessage = error instanceof Error ? error.message : String(error);
    run = updateResearchScoutRun(run.id, {
      status: aborted ? 'aborted' : 'failed',
      ledger: { version: 2, questionId: question.id, queries: [] },
      error: errorMessage,
    });
    updateResearchQuestion(question.id, {
      status: aborted ? 'open' : 'blocked',
      coverage: structuredClone(coverage),
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
      coverage: compactProgress(coverage),
    });
    throw error;
  } finally {
    await bundle.dispose?.();
  }
}

/** @deprecated Alias for older imports / tests. */
const runScoutWithCheckpoints = runScoutForQuestion;

function deterministicResearchReadiness(detail) {
  const acceptedByQuestion = new Map();
  const acceptedById = new Set();
  for (const evidence of detail.evidence || []) {
    if (evidence.status !== 'accepted') continue;
    acceptedById.add(evidence.id);
    acceptedByQuestion.set(
      evidence.questionId,
      (acceptedByQuestion.get(evidence.questionId) || 0) + 1,
    );
  }
  const latestByQuestion = new Map();
  if (detail.id) {
    for (const run of listResearchScoutRuns({ sessionId: detail.id })) {
      if (TERMINAL_SCOUT.has(run.status) || run.status === 'failed') {
        latestByQuestion.set(run.questionId, run);
      }
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
    const coverage = resolveQuestionCoverage(question, run);
    for (const criterion of coverage.criteria || []) {
      const evidenceIds = Array.isArray(criterion.evidenceIds) ? criterion.evidenceIds : [];
      const hasAcceptedEvidence = evidenceIds.some((id) => acceptedById.has(id));
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
          attempts: 1,
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

function finalizeInvestigationRound(session, scoutRuns = []) {
  const detail = (session?.id ? getResearchSessionDetail(session.id) : null) || session || {};
  const readiness = deterministicResearchReadiness(detail);
  const partitioned = partitionWaveTargetsAndLimitations({
    targets: [],
    limitations: readiness.limitations,
    unresolved: [...readiness.targets, ...readiness.eligibleTargets],
  });
  const readyForReport = readiness.ready || readiness.acceptedEvidenceCount > 0;
  const reasonCode = readyForReport
    ? (readiness.ready ? 'ready_full' : 'ready_partial')
    : 'incomplete_no_evidence';
  return {
    decision: readyForReport ? 'ready_for_report' : 'incomplete',
    reasonCode,
    reason: readyForReport
      ? (readiness.ready
        ? 'Single investigation round complete; ready for report.'
        : 'Single investigation round complete with partial evidence; remaining gaps recorded as limitations.')
      : 'Single investigation round finished without enough accepted evidence for a report.',
    targets: [],
    limitations: partitioned.limitations,
    readiness,
    scoutStatuses: (scoutRuns || []).map((run) => ({
      questionId: run.questionId,
      status: run.status,
      evidenceCount: run.committedEvidenceIds?.length || 0,
    })),
  };
}

/** @deprecated Multi-wave evaluator removed; single-round finalize only. */
async function evaluateWave({ session, scoutRuns }) {
  return finalizeInvestigationRound(session, scoutRuns);
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
  const waves = listResearchWaves(sessionId);
  const completedWaves = waves.filter((wave) => wave.status === 'completed');
  if (completedWaves.length) {
    const previousEvaluation = completedWaves.at(-1).evaluation || {};
    const ready = previousEvaluation.decision === 'ready_for_report'
      || deterministicResearchReadiness(detail).acceptedEvidenceCount > 0;
    updateResearchSession(sessionId, { phase: ready ? 'ready_for_report' : 'incomplete' });
    return {
      ok: ready,
      readyForReport: ready,
      evaluation: previousEvaluation.decision
        ? previousEvaluation
        : finalizeInvestigationRound(detail),
    };
  }

  const existing = waves.find((wave) =>
    wave.wave === 1 && ['running', 'evaluating', 'aborted', 'failed'].includes(wave.status));
  const targets = existing?.targets?.length
    ? existing.targets
    : selectWaveTargets(detail, null);
  if (!targets.length) {
    const readiness = deterministicResearchReadiness(detail);
    updateResearchSession(sessionId, { phase: readiness.ready ? 'ready_for_report' : 'incomplete' });
    return {
      ok: readiness.ready,
      readyForReport: readiness.ready,
      evaluation: {
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
          reason: 'Investigation safety budget exhausted.',
          targets,
        },
      };
    }
  }
  const wave = existing || createResearchWave(sessionId, { wave: 1, targets });
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
    // Evidence is committed per criterion during Scout; no Lead Reviewer pass.
    const evaluation = finalizeInvestigationRound(detail, scoutRuns);
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
    const ready = evaluation.decision === 'ready_for_report';
    updateResearchSession(sessionId, { phase: ready ? 'ready_for_report' : 'incomplete' });
    return { ok: ready, readyForReport: ready, evaluation };
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

function validateConclusionsPayload(value, detail) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Conclusions output must be an object');
  }
  const raw = Array.isArray(value.conclusions) ? value.conclusions : [];
  const acceptedIds = new Set(
    (detail.evidence || [])
      .filter((item) => item.status === 'accepted')
      .map((item) => String(item.id)),
  );
  const questionIds = new Set((detail.questions || []).map((item) => String(item.id)));
  const normalized = normalizeResearchConclusions(raw)
    .filter((item) => questionIds.has(item.questionId))
    .map((item) => ({
      ...item,
      evidenceIds: (item.evidenceIds || []).filter((id) => acceptedIds.has(id)),
    }));
  if (!normalized.length && (detail.questions || []).length) {
    throw new Error('Conclusions output missing per-question entries');
  }
  return { conclusions: normalized };
}

function buildConclusionCoverageInput(detail) {
  return (detail.questions || []).map((question) => {
    const coverage = resolveQuestionCoverage(question);
    return {
      questionId: question.id,
      text: question.text,
      status: question.status,
      gaps: question.gaps || [],
      criteria: (coverage.criteria || []).map((criterion) => ({
        id: criterion.id,
        text: criterion.text,
        status: criterion.status,
        reason: criterion.reason || '',
        evidenceIds: criterion.evidenceIds || [],
      })),
    };
  });
}

function buildConclusionLimitationsInput(detail) {
  const items = [];
  for (const question of detail.questions || []) {
    const coverage = resolveQuestionCoverage(question);
    for (const criterion of coverage.criteria || []) {
      if (criterion.status === 'covered') continue;
      items.push({
        questionId: question.id,
        criterionId: criterion.id,
        gap: criterion.reason || criterion.text,
        status: criterion.status,
      });
    }
  }
  for (const wave of detail.waves || []) {
    for (const item of wave.evaluation?.limitations || []) {
      items.push(item);
    }
  }
  return items;
}

/**
 * Once after investigation: write per-question research conclusions for the writing pack.
 * No tools. Facts from accepted evidence only; coverage for completeness/gaps.
 */
export async function generateResearchConclusions({
  sessionId,
  config,
  model,
  signal,
  emit,
  force = false,
} = {}) {
  const detail = getResearchSessionDetail(sessionId);
  if (!detail) throw new Error('research session not found');
  if (!force && Array.isArray(detail.conclusions) && detail.conclusions.length) {
    return { ok: true, conclusions: detail.conclusions, reused: true };
  }

  const fallback = buildDeterministicResearchConclusions(detail);
  try {
    const reviewed = await callJsonModel({
      config,
      model: model || config.model?.name,
      fallbackModel: resolveSubAgentModel(config, model),
      reasoningEffort: 'medium',
      signal,
      systemPrompt: [
        'You write concise research conclusions for each sub-question.',
        'Use only accepted evidence. Coverage marks gaps and completeness.',
        'Return strict JSON only: {"conclusions":[{"questionId":"","completeness":"complete|partial|insufficient","summary":"","limitations":"","evidenceIds":[]}]}',
      ].join('\n'),
      userPrompt: [
        `Main question: ${detail.question}`,
        `Coverage:\n${JSON.stringify(buildConclusionCoverageInput(detail))}`,
        `Limitations:\n${JSON.stringify(buildConclusionLimitationsInput(detail))}`,
        `Accepted evidence:\n${JSON.stringify((detail.evidence || []).filter((item) => item.status === 'accepted'))}`,
      ].join('\n\n'),
      validate: (value) => validateConclusionsPayload(value, detail),
    });
    const conclusions = reviewed.data.conclusions;
    updateResearchSession(sessionId, { conclusions });
    emit?.({ type: 'conclusions', count: conclusions.length, fallback: false });
    appendResearchTimeline(sessionId, { type: 'conclusions', count: conclusions.length });
    return { ok: true, conclusions, reused: false, fallback: false };
  } catch (error) {
    updateResearchSession(sessionId, { conclusions: fallback });
    emit?.({
      type: 'conclusions',
      count: fallback.length,
      fallback: true,
      error: error instanceof Error ? error.message : String(error),
    });
    appendResearchTimeline(sessionId, {
      type: 'conclusions',
      count: fallback.length,
      fallback: true,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: true,
      conclusions: fallback,
      reused: false,
      fallback: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export {
  appendToolBudgetNote,
  buildScoutHandoff,
  createEmptyCoverage,
  createInitialLedger,
  createResearchSearchDefinition,
  createSubmitCandidatesDefinition,
  deterministicResearchReadiness,
  finalizeInvestigationRound,
  gateCandidatesByUrl,
  indexFetchResult,
  indexSearchResult,
  normalizeSubmittedCandidates,
  normalizeUrl,
  partitionWaveTargetsAndLimitations,
  resolveQuestionCoverage,
  resolveToolsCap,
  runScoutForQuestion,
  verifyCandidateSupport,
  RESEARCH_SCOUT_TOOLS_PER_CRITERION,
};
