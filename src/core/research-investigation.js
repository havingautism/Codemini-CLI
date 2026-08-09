import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseModelJsonObject } from './model-json.js';

import { runResearchAgentLoop } from './research-agent-loop.js';
import { createChatCompletionStream } from './provider/index.js';
import { resolveSubAgentModel } from './chat-runtime.js';
import {
  RESEARCH_SCOUT_DISPLAY_LABELS,
  RESEARCH_WEB_FETCH,
  RESEARCH_WEB_SEARCH,
  createResearchSearchDefinition,
  createResearchWebFetchDefinition,
  createResearchWebSearchDefinition,
  executeResearchWebFetch,
  executeResearchWebSearch,
} from './research-tools.js';
import {
  cleanupResearchCriterionArtifacts,
  researchArtifactDirForScope,
} from './research-artifacts.js';
import {
  appendResearchTimeline,
  applyResearchCommit,
  clearResearchResumeCheckpoint,
  createResearchScoutRun,
  createResearchWave,
  getResearchSessionDetail,
  listResearchEvidence,
  listResearchScoutRuns,
  listResearchWaves,
  reserveResearchBudget,
  setResearchResumeCheckpoint,
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
/** Cap supporting sources per claim — enough for attribution, bounds evaluator prompt size. */
const MAX_SOURCES_PER_CLAIM = 3;
/** @deprecated Use MAX_SOURCES_PER_CLAIM. */
const MAX_URLS_PER_CLAIM = MAX_SOURCES_PER_CLAIM;
/** Cap claims per criterion submit — bounds evaluator prompt size. */
const MAX_CANDIDATES_PER_CRITERION = 3;
const MAX_ARTIFACT_READ_CHARS = 4000;
const MAX_FETCH_ARTIFACT_PREVIEW_CHARS = 2500;
const MAX_EVALUATOR_ARTIFACT_READS = 3;

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

/** Attach the stable artifact id so Scout/Evaluator can call read_artifact correctly. */
function attachFetchArtifactMeta(result, artifact = null) {
  const artifactId = artifact?.artifactId ? String(artifact.artifactId) : '';
  const meta = artifactId
    ? {
      artifactId,
      artifactPersisted: true,
      artifactNote: 'Use this exact artifactId with read_artifact. Do not invent ids.',
    }
    : {
      artifactId: null,
      artifactPersisted: false,
      artifactNote: 'No artifact persisted for this fetch (empty body). read_artifact is unavailable for this URL.',
    };
  // Put meta first (and re-apply last) so tool-result truncation keeps artifactId.
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...meta, ...result, ...meta };
  }
  return { ...meta, fetchResult: result };
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

function artifactDirForScope({ sessionId, scoutRunId, criterionId, rootDir = '' }) {
  return researchArtifactDirForScope({ sessionId, scoutRunId, criterionId, rootDir });
}

function createResearchArtifactStore({ sessionId, scoutRunId, criterionId, rootDir = '' }) {
  const byArtifactId = new Map();
  const byUrl = new Map();
  const targetDir = artifactDirForScope({ sessionId, scoutRunId, criterionId, rootDir });
  let ready = false;

  async function ensureDir() {
    if (ready) return;
    await fs.mkdir(targetDir, { recursive: true });
    ready = true;
  }

  function record(meta) {
    if (!meta?.artifactId || !meta?.filePath) return null;
    const normalized = {
      artifactId: String(meta.artifactId),
      url: normalizeUrl(meta.url),
      filePath: String(meta.filePath),
      title: text(meta.title, 240),
      text: text(meta.text, MAX_URL_TEXT_CHARS),
      createdAt: String(meta.createdAt || new Date().toISOString()),
    };
    byArtifactId.set(normalized.artifactId, normalized);
    if (normalized.url) byUrl.set(normalized.url, normalized);
    return normalized;
  }

  async function persistFetch(url, result) {
    const finalUrl = normalizeUrl(result?.final_url || result?.finalUrl || result?.url || url);
    const body = text(result?.text || result?.content || result?.markdown || result?.body || '', 200000);
    if (!finalUrl || !body) return null;
    const existing = byUrl.get(finalUrl);
    if (existing) {
      record({
        ...existing,
        title: text(result?.title || existing.title, 240),
        text: body,
      });
      return byUrl.get(finalUrl);
    }
    await ensureDir();
    const artifactId = `art_${randomUUID()}`;
    const filePath = path.join(targetDir, `${artifactId}.txt`);
    await fs.writeFile(filePath, body, 'utf8');
    return record({
      artifactId,
      url: finalUrl,
      filePath,
      title: result?.title,
      text: body,
    });
  }

  async function readArtifact({ artifactId, offset = 0, maxChars = MAX_ARTIFACT_READ_CHARS } = {}) {
    const meta = byArtifactId.get(String(artifactId || ''));
    if (!meta?.filePath) throw new Error('Artifact not found for this Scout run');
    const fullText = await fs.readFile(meta.filePath, 'utf8');
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const safeMaxChars = Math.max(1, Math.min(MAX_ARTIFACT_READ_CHARS, Math.floor(Number(maxChars) || MAX_ARTIFACT_READ_CHARS)));
    const chunk = fullText.slice(safeOffset, safeOffset + safeMaxChars);
    return {
      artifactId: meta.artifactId,
      url: meta.url,
      title: meta.title,
      offset: safeOffset,
      maxChars: safeMaxChars,
      totalChars: fullText.length,
      truncated: safeOffset + safeMaxChars < fullText.length,
      text: chunk,
    };
  }

  function artifactForUrl(url) {
    return byUrl.get(normalizeUrl(url)) || null;
  }

  function toManifest() {
    return [...byArtifactId.values()].map((item) => ({
      artifactId: item.artifactId,
      url: item.url,
      filePath: item.filePath,
      title: item.title,
      text: item.text,
      createdAt: item.createdAt,
    }));
  }

  function listArtifactIds() {
    return [...byArtifactId.keys()];
  }

  function loadManifest(items = []) {
    for (const item of Array.isArray(items) ? items : []) record(item);
  }

  async function cleanup() {
    await cleanupResearchCriterionArtifacts({
      sessionId,
      scoutRunId,
      criterionId,
      rootDir,
    });
  }

  return {
    artifactForUrl,
    cleanup,
    listArtifactIds,
    loadManifest,
    persistFetch,
    readArtifact,
    targetDir,
    toManifest,
  };
}

function buildFetchArtifactPreview(result = {}, previewText = '') {
  const lines = [];
  const title = text(result?.title, 240);
  const finalUrl = normalizeUrl(result?.final_url || result?.finalUrl || result?.url);
  const status = result?.metadata?.status ?? result?.status;
  const fetchedAt = text(result?.metadata?.fetched_at || result?.metadata?.fetchedAt, 80);
  const fetchMode = text(result?.metadata?.fetch_mode || result?.metadata?.fetchMode, 40);
  const contentType = text(result?.metadata?.content_type || result?.metadata?.contentType, 120);
  if (title) lines.push(`Title: ${title}`);
  if (finalUrl) lines.push(`URL: ${finalUrl}`);
  if (status != null && String(status).trim()) lines.push(`Status: ${status}`);
  if (fetchMode) lines.push(`Mode: ${fetchMode}`);
  if (contentType) lines.push(`Content-Type: ${contentType}`);
  if (fetchedAt) lines.push(`Fetched At: ${fetchedAt}`);
  if (previewText) lines.push('', previewText);
  return lines.join('\n').trim();
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
    summary: '',
    gap: '',
    warning: '',
    verification: '',
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
        summary: text(item.summary, 1200),
        gap: text(item.gap, 1200),
        warning: text(item.warning, 1200),
        verification: text(item.verification, 40),
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
      summary: criterion.summary || '',
      gap: criterion.gap || '',
      warning: criterion.warning || '',
      verification: criterion.verification || '',
    })),
  };
}

function createScoutToolDefinitions() {
  return [
    createResearchWebSearchDefinition(),
    createResearchWebFetchDefinition(),
    createReadArtifactDefinition(),
    createSubmitCandidatesDefinition(),
  ];
}

function createSubmitCandidatesDefinition() {
  return {
    type: 'function',
    function: {
      name: 'submit_criterion_candidates',
      description: [
        'End search/fetch for the current criterion and deliver candidate findings.',
        'Include a concise summary of what you found and a gap note for what remains unresolved.',
        `Submit at most ${MAX_CANDIDATES_PER_CRITERION} strongest claims for this criterion (extras are dropped).`,
        `For each claim, include at most ${MAX_SOURCES_PER_CLAIM} strongest sources (extras are dropped).`,
        'Each source must bind its own url, a short support note/snippet, and artifactId when fetched.',
        'Call this when you have enough attributable evidence, or with an empty candidates array if blocked.',
        'This tool does not count toward the search/fetch fuse.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            maxItems: MAX_CANDIDATES_PER_CRITERION,
            description: `Up to ${MAX_CANDIDATES_PER_CRITERION} strongest claims for this criterion, strongest first.`,
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                sources: {
                  type: 'array',
                  maxItems: MAX_SOURCES_PER_CLAIM,
                  description: `Up to ${MAX_SOURCES_PER_CLAIM} strongest sources for this claim, strongest first.`,
                  items: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' },
                      snippet: {
                        type: 'string',
                        description: 'Short support note for display or review help. Need not be a verbatim source substring.',
                      },
                      artifactId: {
                        type: 'string',
                        description: 'Artifact id from research_web_fetch for this source, when available.',
                      },
                    },
                    required: ['url', 'snippet'],
                  },
                },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                riskFlags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional risk hints such as numeric, causal, legal, medical, financial, or mismatch.',
                },
              },
              required: ['claim', 'sources'],
            },
          },
          summary: {
            type: 'string',
            description: 'Concise summary of findings for this criterion, grounded in the sources you fetched.',
          },
          gap: {
            type: 'string',
            description: 'What remains unresolved or weakly supported for this criterion. Empty if covered.',
          },
          note: { type: 'string' },
        },
        required: ['candidates', 'summary', 'gap'],
      },
    },
  };
}

function createReadArtifactDefinition() {
  return {
    type: 'function',
    function: {
      name: 'read_artifact',
      description: [
        'Read more context from a source artifact previously fetched by this Scout run.',
        'Pass the exact artifactId field returned by research_web_fetch in this criterion — never invent ids.',
        'Successful reads count toward the same per-criterion tool budget as search and fetch.',
        'Missing/invalid artifactId does not consume budget.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          artifactId: {
            type: 'string',
            description: 'Exact artifactId from a prior research_web_fetch result in this criterion (art_…).',
          },
          offset: {
            type: 'number',
            description: 'Character offset into the artifact text. Defaults to 0.',
          },
          maxChars: {
            type: 'number',
            description: `Maximum chars to read, up to ${MAX_ARTIFACT_READ_CHARS}.`,
          },
        },
        required: ['artifactId'],
      },
    },
  };
}

function createSubmitCriterionReviewDefinition() {
  return {
    type: 'function',
    function: {
      name: 'submit_criterion_review',
      description: [
        'Finish evaluator review for the current criterion.',
        'Default to lightweight review of scout output.',
        `Use read_artifact only for high-risk or doubtful claims, up to ${MAX_EVALUATOR_ARTIFACT_READS} times total for this criterion.`,
        'Return plain-prose summary and gap for this criterion only; never write accepted/rejected counts.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            enum: ['PASS', 'WARNING', 'FAIL'],
            description: 'PASS = criterion adequately supported, WARNING = usable but materially caveated, FAIL = insufficient or unreliable.',
          },
          warnings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short plain-prose caveats for the synthesizer and UI.',
          },
          verdicts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                candidateId: { type: 'string' },
                supported: { type: 'boolean' },
                relevantToCriterion: { type: 'boolean' },
                reason: { type: 'string' },
                sources: {
                  type: 'array',
                  description: 'Optional source notes for display/review help when supported=true. Not a hard gate.',
                  items: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' },
                      snippet: { type: 'string' },
                    },
                    required: ['url', 'snippet'],
                  },
                },
              },
              required: ['candidateId', 'supported', 'relevantToCriterion'],
            },
          },
          summary: {
            type: 'string',
            description: 'Clean criterion summary after review.',
          },
          gap: {
            type: 'string',
            description: 'What remains unresolved after review. Empty when genuinely covered.',
          },
        },
        required: ['decision', 'verdicts', 'summary', 'gap'],
      },
    },
  };
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
      const parsed = parseModelJsonObject(result?.text);
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

function indexFetchResult(urlIndex, args, result, artifact = null) {
  const requested = normalizeUrl(args?.url);
  const finalUrl = normalizeUrl(result?.final_url || result?.finalUrl || result?.url || requested);
  const body = text(
    result?.text || result?.content || result?.markdown || result?.body || '',
    MAX_URL_TEXT_CHARS,
  );
  const preview = buildFetchArtifactPreview(
    {
      ...result,
      final_url: finalUrl || result?.final_url || result?.finalUrl || result?.url,
      url: finalUrl || requested,
    },
    text(result?.text || result?.content || result?.markdown || result?.body || '', MAX_FETCH_ARTIFACT_PREVIEW_CHARS),
  );
  if (finalUrl && preview) {
    urlIndex.set(finalUrl, {
      source: 'fetch',
      text: preview,
      artifactId: artifact?.artifactId || '',
      artifactPath: artifact?.filePath || '',
      artifactTitle: artifact?.title || '',
    });
  }
  if (requested && requested !== finalUrl && preview) {
    const existing = urlIndex.get(requested);
    if (!existing || existing.source !== 'fetch') {
      urlIndex.set(requested, {
        source: 'fetch',
        text: preview,
        artifactId: artifact?.artifactId || '',
        artifactPath: artifact?.filePath || '',
        artifactTitle: artifact?.title || '',
      });
    }
  }
}

function normalizeCandidateSources(item = {}) {
  const legacySnippet = text(item?.snippet || item?.excerpt, 1200);
  const legacyArtifactRefs = [...new Set(
    (Array.isArray(item?.artifactRefs) ? item.artifactRefs : [item?.artifactId])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
  const rawSources = Array.isArray(item?.sources)
    ? item.sources
    : (Array.isArray(item?.urls) ? item.urls : (item?.url ? [item.url] : []))
      .map((url, index) => ({
        url,
        snippet: legacySnippet,
        artifactId: legacyArtifactRefs[index] || '',
      }));
  const seen = new Set();
  const sources = [];
  for (const source of rawSources) {
    const url = normalizeUrl(source?.url || source);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      url,
      snippet: text(source?.snippet || source?.excerpt || legacySnippet, 1200),
      artifactId: text(source?.artifactId || '', 120),
    });
    if (sources.length >= MAX_SOURCES_PER_CLAIM) break;
  }
  return sources;
}

function normalizeSubmittedCandidates(rawCandidates, criterionId) {
  const list = Array.isArray(rawCandidates) ? rawCandidates : [];
  const out = [];
  for (const item of list) {
    const claim = text(item?.claim, 1000);
    const sources = normalizeCandidateSources(item);
    if (!claim || !sources.length) continue;
    out.push({
      id: `cand_${randomUUID()}`,
      criterionIds: [String(criterionId)],
      claim,
      sources,
      // Compatibility mirrors for older callers/tests until evidence packing is redesigned.
      urls: sources.map((source) => source.url),
      confidence: ['high', 'medium', 'low'].includes(String(item?.confidence))
        ? String(item.confidence)
        : 'medium',
      riskFlags: [...new Set(
        (Array.isArray(item?.riskFlags) ? item.riskFlags : [])
          .map((value) => text(value, 80))
          .filter(Boolean),
      )].slice(0, 8),
    });
  }
  return out.slice(0, MAX_CANDIDATES_PER_CRITERION);
}

function normalizeSubmitNarrative(args = {}) {
  return {
    summary: text(args?.summary, 1200),
    gap: text(args?.gap, 1200),
    note: text(args?.note, 600),
  };
}

function parseCandidatesFromText(raw, criterionId) {
  const parsed = parseModelJsonObject(raw);
  if (!parsed) {
    return { candidates: [], summary: '', gap: '', note: '' };
  }
  const list = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const narrative = normalizeSubmitNarrative(parsed);
  return {
    candidates: normalizeSubmittedCandidates(list, criterionId),
    summary: narrative.summary,
    gap: narrative.gap,
    note: narrative.note,
  };
}

function gateCandidatesByUrl(candidates, urlIndex) {
  const accepted = [];
  const rejected = [];
  for (const candidate of candidates) {
    const rawSources = Array.isArray(candidate.sources) && candidate.sources.length
      ? candidate.sources
      : (candidate.urls || []).map((url) => ({ url, snippet: '', artifactId: '' }));
    const kept = [];
    const missing = [];
    for (const source of rawSources) {
      const url = normalizeUrl(source?.url);
      if (!url) continue;
      const indexed = urlIndex.get(url);
      if (!indexed) {
        missing.push(url);
        continue;
      }
      kept.push({
        url,
        snippet: text(source?.snippet, 1200),
        artifactId: text(source?.artifactId || indexed.artifactId, 120),
        toolText: text(indexed.text, MAX_URL_TEXT_FOR_VERIFY),
      });
    }
    if (!kept.length) {
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
      sources: kept,
      urls: kept.map((source) => source.url),
      // Compatibility alias used by older resume/tests; prefer sources[].
      slices: kept,
    });
  }
  return { accepted, rejected };
}

function validateSupportVerdicts(value, gatedCandidates, _observedArtifactTexts = new Map()) {
  if (!value || typeof value !== 'object') throw new Error('Support check must return an object');
  const candidateIds = gatedCandidates.map((item) => item.id);
  const sourcesByCandidate = new Map(
    gatedCandidates.map((item) => [
      item.id,
      Array.isArray(item.sources) && item.sources.length
        ? item.sources
        : (item.slices || []),
    ]),
  );
  const raw = Array.isArray(value.verdicts) ? value.verdicts : [];
  const byId = new Map();
  for (const item of raw) {
    const id = String(item?.candidateId || item?.id || '');
    if (!id) continue;
    const candidateSources = sourcesByCandidate.get(id) || [];
    const sourceByUrl = new Map(candidateSources.map((source) => [normalizeUrl(source.url), source]));
    const rawSupportSources = Array.isArray(item?.sources) && item.sources.length
      ? item.sources
      : (item?.snippet || item?.quote
        ? [{ url: candidateSources[0]?.url || '', snippet: item?.snippet || item?.quote }]
        : []);
    // Snippets are display/helper only — no exact-substring hard gate against corpus.
    const attachedSources = [];
    for (const support of rawSupportSources) {
      const url = normalizeUrl(support?.url || candidateSources[0]?.url);
      const snippet = text(support?.snippet || support?.quote, 1200);
      const source = sourceByUrl.get(url);
      if (!url || !source) continue;
      attachedSources.push({
        url,
        snippet,
        artifactId: text(source.artifactId, 120),
      });
    }
    const supported = Boolean(item?.supported ?? item?.accept ?? item?.ok);
    const relevantToCriterion = item?.relevantToCriterion == null
      ? item?.relevant == null
        ? false
        : Boolean(item.relevant)
      : Boolean(item.relevantToCriterion);
    byId.set(id, {
      candidateId: id,
      supported,
      relevantToCriterion,
      reason: text(item?.reason, 400),
      sources: attachedSources,
      // Compatibility for evidence adapter until writing pack redesign.
      snippet: attachedSources[0]?.snippet || text(item?.snippet || item?.quote, 1200),
    });
  }
  return candidateIds.map((id) => byId.get(id) || {
    candidateId: id,
    supported: false,
    relevantToCriterion: false,
    reason: 'Missing verdict',
    sources: [],
    snippet: '',
  });
}

function isAcceptedClaimVerdict(verdict) {
  return Boolean(verdict?.supported && verdict?.relevantToCriterion);
}

function validateNarrativeField(value, fallback = '') {
  const raw = value && typeof value === 'object' ? value : {};
  const rewritten = text(raw.text, 1200);
  const ok = raw.ok !== false;
  if (ok && rewritten) return { ok: true, text: rewritten, reason: text(raw.reason, 400) };
  if (rewritten) return { ok: false, text: rewritten, reason: text(raw.reason, 400) };
  return {
    ok: false,
    text: text(fallback, 1200),
    reason: text(raw.reason, 400) || 'Missing narrative',
  };
}

function normalizeEvaluatorDecision(value, fallback = 'WARNING') {
  const raw = String(value || fallback).trim().toUpperCase();
  return ['PASS', 'WARNING', 'FAIL'].includes(raw) ? raw : fallback;
}

function normalizeEvaluatorWarnings(value) {
  return [...new Set(
    (Array.isArray(value) ? value : [value])
      .map((item) => text(item, 240))
      .filter(Boolean),
  )].slice(0, 4);
}

async function verifyCandidateSupport({
  config,
  model,
  question,
  criterion,
  gatedCandidates,
  scoutSummary = '',
  scoutGap = '',
  artifactStore,
  signal,
  emit,
}) {
  const store = artifactStore || createResearchArtifactStore({
    sessionId: 'session',
    scoutRunId: 'scout',
    criterionId: criterion.id,
  });
  let artifactReads = 0;
  let submittedReview = null;
  const observedArtifactTexts = new Map();

  const evaluatorCandidates = (gatedCandidates || []).map((item) => ({
    candidateId: item.id,
    claim: item.claim,
    confidence: item.confidence || 'medium',
    riskFlags: item.riskFlags || [],
    sources: (Array.isArray(item.sources) && item.sources.length
      ? item.sources
      : (item.slices || [])
    ).map((source) => ({
      url: source.url,
      snippet: text(source.snippet, 1200),
      artifactId: text(source.artifactId, 120),
      toolText: text(source.toolText, MAX_URL_TEXT_FOR_VERIFY),
    })),
  }));

  const handlers = {
    read_artifact: async (args = {}) => {
      if (artifactReads >= MAX_EVALUATOR_ARTIFACT_READS) {
        return `Artifact read budget reached (${MAX_EVALUATOR_ARTIFACT_READS}/${MAX_EVALUATOR_ARTIFACT_READS}). Submit your review now.`;
      }
      const artifactId = String(args?.artifactId || '').trim();
      if (!artifactId) {
        return [
          'Artifact read rejected: artifactId is required.',
          'Use the artifactId field from each candidate source in the prompt.',
          `Known artifacts: ${(store.listArtifactIds?.() || []).join(', ') || '(none)'}`,
        ].join(' ');
      }
      let result;
      try {
        result = await store.readArtifact({
          artifactId,
          offset: args?.offset,
          maxChars: args?.maxChars,
        });
      } catch (error) {
        return [
          error?.message || 'Artifact not found for this Scout run',
          'Use an exact artifactId from the candidate sources.',
          `Known artifacts: ${(store.listArtifactIds?.() || []).join(', ') || '(none)'}`,
          'This failed read did not consume the artifact-read budget.',
        ].join(' ');
      }
      artifactReads += 1;
      emit?.({
        type: 'criterion:verify_budget',
        criterionId: criterion.id,
        artifactReads,
        artifactReadsCap: MAX_EVALUATOR_ARTIFACT_READS,
      });
      observedArtifactTexts.set(artifactId, `${observedArtifactTexts.get(artifactId) || ''}\n${result.text || ''}`.trim());
      return result;
    },
    submit_criterion_review: async (args = {}) => {
      submittedReview = {
        decision: normalizeEvaluatorDecision(args?.decision, 'WARNING'),
        warnings: normalizeEvaluatorWarnings(args?.warnings),
        verdicts: validateSupportVerdicts(args, gatedCandidates || [], observedArtifactTexts),
        summary: validateNarrativeField({ text: args?.summary, ok: true }, scoutSummary),
        gap: validateNarrativeField({ text: args?.gap, ok: true }, scoutGap),
      };
      return {
        ok: true,
        artifactReads,
        message: 'Criterion review recorded.',
      };
    },
  };

  const systemPrompt = [
    'You are the Evaluator for one research criterion.',
    'Default mode is lightweight review: inspect the Scout structured output first.',
    `Use read_artifact only when needed, and never more than ${MAX_EVALUATOR_ARTIFACT_READS} times for this criterion.`,
    'Use the exact artifactId from each candidate source. Failed/missing reads do not consume the artifact-read budget.',
    'Escalate to read_artifact only for high-risk or doubtful cases: numeric/quantitative claims, causal claims, absolute claims, legal/medical/financial/safety claims, low-confidence claims, snippet mismatch, or when toolText appears too weak or ambiguous.',
    'For each candidate, judge two things:',
    '1) supported: does one or more sources substantively support the claim? Judge semantically from toolText / read_artifact; do not require verbatim quote matching.',
    '2) relevantToCriterion: does the claim directly address this criterion?',
    'A candidate becomes accepted evidence only when both are true.',
    'When supported=true, return sources:[{url, snippet}] as optional display/helper notes. Snippets need not be exact substrings of the source text.',
    'Review scout summary and gap too. Rewrite if overstated, off-topic, or vague.',
    'summary and gap must be clean prose about this criterion only. Never mention accepted/rejected counts, tool budgets, or workflow statistics.',
    'Finish by calling submit_criterion_review.',
  ].join('\n');

  let loopResult = await runResearchAgentLoop({
    systemPrompt,
    userPrompt: [
      `Sub-question: ${question.text}`,
      `Criterion (${criterion.id}): ${criterion.text}`,
      `Scout summary: ${scoutSummary || '(empty)'}`,
      `Scout gap: ${scoutGap || '(empty)'}`,
      `Artifact read budget: ${artifactReads}/${MAX_EVALUATOR_ARTIFACT_READS}`,
      `Candidates:\n${JSON.stringify(evaluatorCandidates, null, 2)}`,
    ].join('\n\n'),
    model: resolveSubAgentModel(config, model),
    toolDefinitions: [createReadArtifactDefinition(), createSubmitCriterionReviewDefinition()],
    toolHandlers: handlers,
    deferredDefinitions: {},
    toolFormatters: {},
    toolDisplayLabels: {},
    executionMode: 'normal',
    approvalMode: 'auto',
    alwaysAllowTools: ['read_artifact', 'submit_criterion_review'],
    projectIsGit: false,
    toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
    config,
    signal,
    skipAnalysisNudge: true,
    requestCompletion: makeStreamingCompletion(config, emit, 'low'),
    onEvent: emit,
    shouldCheckpoint: () => Boolean(submittedReview),
  });

  if (!submittedReview && !signal?.aborted) {
    const priorMessages = Array.isArray(loopResult?.messages)
      ? loopResult.messages.filter((message) => message?.role !== 'system')
      : [];
    loopResult = await runResearchAgentLoop({
      systemPrompt,
      userPrompt: 'Call submit_criterion_review now. If evidence is weak, use WARNING or FAIL and explain the gap plainly.',
      initialMessages: priorMessages,
      model: resolveSubAgentModel(config, model),
      toolDefinitions: [createReadArtifactDefinition(), createSubmitCriterionReviewDefinition()],
      toolHandlers: handlers,
      deferredDefinitions: {},
      toolFormatters: {},
      toolDisplayLabels: {},
      executionMode: 'normal',
      approvalMode: 'auto',
      alwaysAllowTools: ['read_artifact', 'submit_criterion_review'],
      projectIsGit: false,
      toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
      config,
      signal,
      skipAnalysisNudge: true,
      requestCompletion: makeStreamingCompletion(config, emit, 'low'),
      onEvent: emit,
      shouldCheckpoint: () => true,
    });
  }

  if (!submittedReview) {
    const parsed = parseModelJsonObject(loopResult?.text) || {};
    submittedReview = {
      decision: normalizeEvaluatorDecision(parsed.decision, 'WARNING'),
      warnings: normalizeEvaluatorWarnings(parsed.warnings),
      verdicts: validateSupportVerdicts(parsed, gatedCandidates || [], observedArtifactTexts),
      summary: validateNarrativeField({ text: parsed.summary, ok: true }, scoutSummary),
      gap: validateNarrativeField({ text: parsed.gap, ok: true }, scoutGap),
    };
  }

  return { ...submittedReview, artifactReads };
}

function criterionGapText(criterion = {}) {
  return text(criterion.gap, 1200);
}

function deriveQuestionGaps(coverage) {
  return (coverage?.criteria || [])
    .filter((item) => item.status !== 'covered')
    .map((item) => criterionGapText(item))
    .filter(Boolean);
}

function serializePendingVerifyCandidate(item) {
  const sources = (Array.isArray(item.sources) && item.sources.length
    ? item.sources
    : (item.slices || [])
  ).map((source) => ({
    url: source.url,
    snippet: text(source.snippet, 1200),
    artifactId: text(source.artifactId, 120),
    toolText: text(source.toolText, MAX_URL_TEXT_FOR_VERIFY),
  }));
  return {
    id: item.id,
    claim: item.claim,
    sources,
    urls: sources.map((source) => source.url),
    confidence: item.confidence || 'medium',
    riskFlags: Array.isArray(item.riskFlags) ? item.riskFlags.map(String).filter(Boolean) : [],
    criterionIds: item.criterionIds || [],
    // Compatibility alias for older resume payloads.
    slices: sources,
  };
}

function candidateToEvidence(candidate, questionId, verdict = null) {
  const sources = (Array.isArray(verdict?.sources) && verdict.sources.length
    ? verdict.sources
    : []
  ).map((source) => ({
    url: text(source.url, 2000),
    snippet: text(source.snippet, 1200),
    artifactId: text(source.artifactId, 120),
  })).filter((source) => source.url || source.snippet);
  return {
    candidateId: candidate.id,
    questionId,
    claim: candidate.claim,
    sources,
    // Compatibility mirrors until older readers are retired.
    snippet: sources[0]?.snippet || '',
    url: sources[0]?.url || '',
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
    const sources = Array.isArray(item.sources) && item.sources.length
      ? item.sources
      : (item.url ? [{ url: item.url, snippet: item.snippet || '' }] : []);
    for (const source of sources) {
      if (source.url) lines.push(`  URL: ${source.url}`);
      if (source.snippet) lines.push(`  snippet: ${source.snippet}`);
    }
    if (item.criterionIds?.length) lines.push(`  Criteria: ${item.criterionIds.join(', ')}`);
  }
  lines.push('', 'Coverage:');
  for (const criterion of coverage.criteria || []) {
    lines.push(`- [${criterion.id}] ${criterion.status}`);
    if (criterion.verification) lines.push(`  verification: ${criterion.verification}`);
    if (criterion.summary) lines.push(`  summary: ${criterion.summary}`);
    if (criterion.gap) lines.push(`  gap: ${criterion.gap}`);
    if (criterion.warning) lines.push(`  warning: ${criterion.warning}`);
  }
  return lines.join('\n');
}

const MAX_DEP_CLAIMS_PER_UPSTREAM = 8;
const MAX_DEP_CONTEXT_CHARS = 4000;

/**
 * Compact, deterministic summary of one upstream question for downstream Scout prompts.
 * Safe to reuse across many dependents — same upstream yields the same summary from current store state.
 */
function buildUpstreamDependencySummary({
  question,
  coverage = null,
  evidence = [],
  maxClaims = MAX_DEP_CLAIMS_PER_UPSTREAM,
} = {}) {
  if (!question?.id) return '';
  const resolved = coverage && Array.isArray(coverage.criteria)
    ? coverage
    : resolveQuestionCoverage(question, null);
  const accepted = (Array.isArray(evidence) ? evidence : [])
    .filter((item) => item.questionId === question.id && item.status === 'accepted');
  const lines = [
    `### Upstream: ${text(question.text || question.id, 240)}`,
    `Id: ${question.id}`,
    `Status: ${question.status || 'unknown'}`,
    'Confirmed claims:',
  ];
  if (!accepted.length) {
    lines.push('- (none yet)');
  } else {
    for (const item of accepted.slice(0, maxClaims)) {
      lines.push(`- ${text(item.claim, 240)}`);
    }
    if (accepted.length > maxClaims) {
      lines.push(`- … +${accepted.length - maxClaims} more`);
    }
  }
  const notes = [];
  for (const criterion of resolved.criteria || []) {
    if (criterion.summary) notes.push(`- [${criterion.id}] summary: ${text(criterion.summary, 200)}`);
    if (criterion.gap) notes.push(`- [${criterion.id}] gap: ${text(criterion.gap, 200)}`);
    if (criterion.warning) notes.push(`- [${criterion.id}] warning: ${text(criterion.warning, 160)}`);
  }
  if (notes.length) {
    lines.push('Criterion notes:');
    lines.push(...notes.slice(0, 12));
  }
  return lines.join('\n');
}

/**
 * Gather dependency summaries for question.dependsOn (DAG: many→one and one→many).
 * Reads fresh session detail/evidence so each downstream Scout sees the same upstream snapshot.
 */
function collectDependencyContextForQuestion(sessionId, question, {
  maxChars = MAX_DEP_CONTEXT_CHARS,
} = {}) {
  const depIds = [...new Set(
    (Array.isArray(question?.dependsOn) ? question.dependsOn : []).map(String).filter(Boolean),
  )];
  if (!depIds.length) {
    return { text: '', upstreams: [] };
  }
  const detail = getResearchSessionDetail(sessionId);
  const evidence = listResearchEvidence(sessionId, { status: 'accepted' });
  const questionById = new Map((detail?.questions || []).map((item) => [item.id, item]));
  const sections = [];
  const upstreams = [];
  for (const depId of depIds) {
    const upstream = questionById.get(depId);
    if (!upstream) {
      sections.push(`### Upstream: ${depId}\nStatus: missing`);
      upstreams.push({
        questionId: depId,
        text: '',
        status: 'missing',
        claimCount: 0,
        summary: `### Upstream: ${depId}\nStatus: missing`,
      });
      continue;
    }
    const coverage = resolveQuestionCoverage(upstream, null);
    const summary = buildUpstreamDependencySummary({
      question: upstream,
      coverage,
      evidence,
    });
    const claimCount = evidence.filter((item) => item.questionId === depId).length;
    upstreams.push({
      questionId: depId,
      text: upstream.text || '',
      status: upstream.status || 'unknown',
      claimCount,
      summary,
    });
    sections.push(summary);
  }
  let body = [
    'Upstream dependency context (clues only — not verified evidence for this sub-question).',
    'Use it to avoid duplicate discovery searches and to focus follow-up investigation.',
    'Re-verify before treating any upstream claim as established for YOUR criterion.',
    '',
    ...sections,
  ].join('\n\n');
  if (body.length > maxChars) body = `${body.slice(0, Math.max(0, maxChars - 1))}…`;
  return { text: body, upstreams };
}

function buildScoutCriterionPrompt({
  session,
  question,
  criterion,
  toolsCap,
  toolsUsed = 0,
  dependencyContext = '',
}) {
  const cap = resolveToolsCap(toolsCap);
  const remaining = Math.max(0, cap - toolsUsed);
  return [
    'Investigate exactly ONE target criterion for this research sub-question.',
    'Use research_web_search and research_web_fetch freely and continuously.',
    'research_web_fetch returns an artifactId field when the body is persisted — use that exact id with read_artifact; never invent ids.',
    'Use read_artifact sparingly: only to confirm source context, resolve ambiguity, or validate a key claim from an already fetched source.',
    'There is no URL allowlist — fetch any relevant URL.',
    `Hard fuse: at most ${cap} tool calls combined for this criterion across research_web_search, research_web_fetch, and successful read_artifact.`,
    'Failed read_artifact calls (missing/invalid artifactId) do not consume the fuse.',
    'submit_criterion_candidates does NOT count toward the fuse.',
    'Every research_web_search call must include the supplied criterionId.',
    'When finished searching, you MUST call submit_criterion_candidates with candidates, summary, and gap.',
    'summary/gap are relative to this criterion only; never write Accepted N claim(s) or tool-count statistics.',
    `Submit at most ${MAX_CANDIDATES_PER_CRITERION} strongest claims for this criterion (strongest first); extras are dropped.`,
    `Each claim may list at most ${MAX_SOURCES_PER_CLAIM} strongest sources (strongest first); extras are dropped.`,
    'Each source must include url, a short support note/snippet for display, and artifactId when the source was fetched.',
    'Do not stop with only prose — always submit candidates (empty array if blocked).',
    'Prefer primary and authoritative sources.',
    `Main question: ${session.question}`,
    session.preferences?.goal ? `Goal: ${session.preferences.goal}` : '',
    `Sub-question: ${question.text}`,
    dependencyContext
      ? [
        'Dependency context from upstream sub-question(s) follows.',
        'Treat it as shared discovery context — the same upstream summary may also be injected into other dependent Scouts.',
        dependencyContext,
      ].join('\n\n')
      : '',
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
  dependencyContext = '',
}) {
  const urlIndex = new Map();
  const artifactStore = createResearchArtifactStore({
    sessionId: session.id,
    scoutRunId: run.id,
    criterionId: criterion.id,
  });
  const knownQueries = new Set();
  let toolsUsed = 0;
  let cycleSearches = 0;
  let cycleFetches = 0;
  let findingsSubmitted = false;
  let submittedCandidates = [];
  let submittedSummary = '';
  let submittedGap = '';
  let submitNote = '';
  let fuseRejectCount = 0;
  let forceAfterFuseMiss = false;
  let budgetExhausted = false;

  const emitScout = (event) => {
    const stamped = {
      ...event,
      scope: 'scout',
      agent: event.agent || 'scout',
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
  const emitEvaluator = (event) => emitScout({ ...event, agent: 'evaluator' });

  const handlers = {
    [RESEARCH_WEB_SEARCH]: async (args = {}) => {
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
      const result = await executeResearchWebSearch(config, {
        query,
        max_results: args?.max_results,
      });
      indexSearchResult(urlIndex, result);
      return appendToolBudgetNote(result, toolsUsed, toolsCap);
    },
    [RESEARCH_WEB_FETCH]: async (args = {}) => {
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
      const result = await executeResearchWebFetch(args);
      const artifact = await artifactStore.persistFetch(url, result);
      indexFetchResult(urlIndex, args, result, artifact);
      return appendToolBudgetNote(attachFetchArtifactMeta(result, artifact), toolsUsed, toolsCap);
    },
    read_artifact: async (args = {}) => {
      if (toolsUsed >= toolsCap) {
        fuseRejectCount += 1;
        if (fuseRejectCount >= 2) forceAfterFuseMiss = true;
        return `Tool fuse reached (${toolsCap}/${toolsCap}). Call submit_criterion_candidates with your candidates now.`;
      }
      const artifactId = String(args?.artifactId || '').trim();
      if (!artifactId) {
        return [
          'Artifact read rejected: artifactId is required.',
          'Pass the exact artifactId field from a prior research_web_fetch result in this criterion.',
          `Known artifacts: ${artifactStore.listArtifactIds().join(', ') || '(none)'}`,
          'This failed read did not consume the tool budget.',
        ].join(' ');
      }
      let result;
      try {
        result = await artifactStore.readArtifact({
          artifactId,
          offset: args?.offset,
          maxChars: args?.maxChars,
        });
      } catch (error) {
        return [
          error?.message || 'Artifact not found for this Scout run',
          'Pass the exact artifactId from research_web_fetch (field artifactId). Do not invent ids.',
          `Known artifacts: ${artifactStore.listArtifactIds().join(', ') || '(none)'}`,
          'This failed read did not consume the tool budget.',
        ].join(' ');
      }
      toolsUsed += 1;
      emitScout({
        type: 'budget',
        delta: { artifactReads: 1 },
        scoutUsed: {
          searches: run.searchCount + cycleSearches,
          fetches: run.fetchCount + cycleFetches,
          tools: toolsUsed,
          toolsCap,
        },
      });
      return appendToolBudgetNote(result, toolsUsed, toolsCap);
    },
    submit_criterion_candidates: async (args = {}) => {
      submittedCandidates = normalizeSubmittedCandidates(args?.candidates, criterion.id);
      const narrative = normalizeSubmitNarrative(args);
      submittedSummary = narrative.summary;
      submittedGap = narrative.gap;
      submitNote = narrative.note;
      findingsSubmitted = true;
      emitScout({
        type: 'finding',
        candidateCount: submittedCandidates.length,
        summary: submittedSummary,
        gap: submittedGap,
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
    criterionId: criterion.id,
    criterionText: criterion.text,
    targetGap: { criterionId: criterion.id, reason: criterion.text },
    toolsCap,
  });
  // Compatibility alias for older UI listeners.
  emitScout({
    type: 'scout:checkpoint_start',
    cycle: Number(coverage.criteria?.findIndex((item) => item.id === criterion.id) || 0) + 1,
    criterionId: criterion.id,
    criterionText: criterion.text,
    targetGap: { criterionId: criterion.id, reason: criterion.text },
    toolsCap,
  });

  const systemPrompt = [
    'You are a focused, read-only research Scout.',
    'Investigate only the target criterion in the user prompt.',
    'Search and fetch freely. research_web_fetch returns artifactId — use that exact id with read_artifact; never invent ids. Use read_artifact only when you need extra source context to validate or clarify a key claim.',
    'If upstream dependency context is provided, use it as discovery clues only — re-verify before submitting claims.',
    'When done, call submit_criterion_candidates with candidates, summary, and gap.',
    'Do not invent quote fields. Do not write a final report.',
  ].join('\n');

  const toolDisplayLabels = { ...RESEARCH_SCOUT_DISPLAY_LABELS };

  let loopResult = await runResearchAgentLoop({
    systemPrompt,
    userPrompt: buildScoutCriterionPrompt({
      session,
      question,
      criterion,
      toolsCap,
      toolsUsed: 0,
      dependencyContext,
    }),
    model: resolveSubAgentModel(config, model),
    toolDefinitions: baseDefinitions,
    toolHandlers: handlers,
    toolDisplayLabels,
    toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
    signal,
    requestCompletion: makeStreamingCompletion(config, emitScout, 'low'),
    onEvent: emitScout,
    shouldCheckpoint: () => findingsSubmitted || forceAfterFuseMiss || budgetExhausted,
  });

  if (!findingsSubmitted && !signal?.aborted) {
    const priorMessages = Array.isArray(loopResult?.messages)
      ? loopResult.messages.filter((message) => message?.role !== 'system')
      : [];
    loopResult = await runResearchAgentLoop({
      systemPrompt,
      userPrompt: [
        'You have not called submit_criterion_candidates yet.',
        'Call submit_criterion_candidates now with candidates, summary, and gap.',
        'If you cannot produce attributable candidates, submit an empty array with an honest summary/gap.',
        'Alternatively reply with JSON only: {"candidates":[{"claim":"","sources":[{"url":"","snippet":""}]}],"summary":"","gap":""}',
      ].join(' '),
      initialMessages: priorMessages,
      model: resolveSubAgentModel(config, model),
      toolDefinitions: baseDefinitions,
      toolHandlers: handlers,
      toolDisplayLabels,
      toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
      signal,
      requestCompletion: makeStreamingCompletion(config, emitScout, 'low'),
      onEvent: emitScout,
      shouldCheckpoint: () => findingsSubmitted || true,
    });
  }

  if (!findingsSubmitted) {
    const parsed = parseCandidatesFromText(loopResult?.text, criterion.id);
    submittedCandidates = parsed.candidates;
    submittedSummary = parsed.summary;
    submittedGap = parsed.gap;
    submitNote = parsed.note;
    findingsSubmitted = true;
  }

  const { accepted: gated, rejected: urlRejected } = gateCandidatesByUrl(submittedCandidates, urlIndex);
  return finalizeCriterionVerification({
    session,
    wave,
    question,
    criterion,
    run,
    coverage,
    config,
    model,
    signal,
    emit: emitEvaluator,
    toolsUsed,
    toolsCap,
    cycleSearches,
    cycleFetches,
    submittedCandidates,
    submittedSummary,
    submittedGap,
    submitNote,
    artifactStore,
    gatedCandidates: gated,
    urlRejected,
  });
}

async function finalizeCriterionVerification({
  session,
  wave,
  question,
  criterion,
  run,
  coverage,
  config,
  model,
  signal,
  emit,
  toolsUsed,
  toolsCap,
  cycleSearches,
  cycleFetches,
  submittedCandidates = [],
  submittedSummary = '',
  submittedGap = '',
  submitNote = '',
  artifactStore,
  gatedCandidates = [],
  urlRejected = [],
}) {
  const gated = Array.isArray(gatedCandidates) ? gatedCandidates : [];
  const rejected = Array.isArray(urlRejected) ? urlRejected : [];
  const pendingVerify = {
    questionId: question.id,
    criterionId: criterion.id,
    scoutRunId: run.id,
    toolsUsed,
    toolsCap,
    cycleSearches,
    cycleFetches,
    submittedSummary,
    submittedGap,
    submitNote,
    artifacts: artifactStore?.toManifest?.() || [],
    gatedCandidates: gated.map(serializePendingVerifyCandidate),
    urlRejected: rejected.map((item) => ({
      id: item.id,
      claim: item.claim,
      urls: item.urls || [],
      reason: item.reason || '',
    })),
  };

  updateResearchScoutRun(run.id, {
    ledger: {
      version: 2,
      questionId: question.id,
      queries: [],
      pendingVerify,
    },
  });

  emit({
    type: 'criterion:verify_start',
    criterionId: criterion.id,
    criterionText: criterion.text,
    candidateCount: gated.length,
    summary: submittedSummary,
    gap: submittedGap,
  });

  let review;
  try {
    review = await verifyCandidateSupport({
      config,
      model,
      question,
      criterion,
      gatedCandidates: gated,
      scoutSummary: submittedSummary,
      scoutGap: submittedGap,
      artifactStore,
      signal,
      emit,
    });
  } catch (error) {
    updateResearchScoutRun(run.id, {
      ledger: {
        version: 2,
        questionId: question.id,
        queries: [],
        pendingVerify,
      },
    });
    setResearchResumeCheckpoint(session.id, {
      step: 'verify',
      questionId: question.id,
      criterionId: criterion.id,
      scoutRunId: run.id,
      error: error instanceof Error ? error.message : String(error),
    });
    const wrapped = error instanceof Error ? error : new Error(String(error));
    wrapped.resumeStep = 'verify';
    throw wrapped;
  }

  clearResearchResumeCheckpoint(session.id);
  updateResearchScoutRun(run.id, {
    ledger: { version: 2, questionId: question.id, queries: [] },
  });

  const verdicts = Array.isArray(review?.verdicts) ? review.verdicts : [];
  const verdictById = new Map(verdicts.map((item) => [item.candidateId, item]));
  const accepted = gated.filter((item) => isAcceptedClaimVerdict(verdictById.get(item.id)));
  const rejectedByReview = gated.filter((item) => !isAcceptedClaimVerdict(verdictById.get(item.id)));

  const acceptEvidence = accepted.map((candidate) =>
    candidateToEvidence(candidate, question.id, verdictById.get(candidate.id)));
  const commitResult = acceptEvidence.length
    ? applyResearchCommit(session.id, { acceptEvidence })
    : { insertedEvidenceIds: [], reusedEvidenceIds: [] };
  const evidenceIds = [
    ...(commitResult.insertedEvidenceIds || []),
    ...(commitResult.reusedEvidenceIds || []),
  ];

  const finalSummary = text(review?.summary?.text || submittedSummary, 1200);
  const finalGap = text(review?.gap?.text || submittedGap, 1200);
  const verification = normalizeEvaluatorDecision(review?.decision, 'WARNING');
  const warning = (review?.warnings || []).join('; ');

  let status = 'blocked';
  let reason = submitNote || warning || finalGap || 'No attributable candidates were verified.';
  if (verification === 'PASS') {
    status = accepted.length ? 'covered' : 'blocked';
    reason = warning || finalSummary || 'Criterion passed review.';
  } else if (verification === 'WARNING') {
    status = accepted.length ? 'partial' : 'blocked';
    reason = warning
      || finalGap
      || rejected[0]?.reason
      || rejectedByReview.map((item) => verdictById.get(item.id)?.reason).filter(Boolean)[0]
      || 'Criterion is usable but materially caveated.';
  } else if (submittedCandidates.length || gated.length) {
    status = 'blocked';
    reason = warning
      || rejected[0]?.reason
      || rejectedByReview.map((item) => verdictById.get(item.id)?.reason).filter(Boolean)[0]
      || finalGap
      || 'Criterion failed verification.';
  } else if (accepted.length) {
    status = 'partial';
    reason = warning || finalGap || finalSummary || 'Evidence exists but criterion remains incomplete.';
  } else if (submittedCandidates.length || gated.length) {
    status = 'blocked';
    reason = rejected[0]?.reason
      || rejectedByReview.map((item) => verdictById.get(item.id)?.reason).filter(Boolean)[0]
      || 'Candidates failed URL, support, or criterion-relevance checks.';
  } else if (toolsUsed <= 0) {
    reason = 'Scout ended without searching or submitting candidates.';
  }

  const coverageCriterion = (coverage.criteria || []).find((item) => item.id === criterion.id);
  if (coverageCriterion) {
    coverageCriterion.status = status;
    coverageCriterion.toolCount = toolsUsed;
    coverageCriterion.reason = reason;
    coverageCriterion.evidenceIds = evidenceIds;
    coverageCriterion.summary = finalSummary;
    coverageCriterion.gap = status === 'covered' ? (finalGap || '') : finalGap;
    coverageCriterion.warning = warning;
    coverageCriterion.verification = verification;
  }

  for (const evidenceId of commitResult.insertedEvidenceIds || []) {
    emit({ type: 'evidence:accepted', evidenceId, criterionId: criterion.id });
  }

  emit({
    type: 'criterion:coverage',
    criterionId: criterion.id,
    status,
    reason,
    summary: finalSummary,
    gap: coverageCriterion?.gap || finalGap,
    warning,
    verification,
    toolCount: toolsUsed,
    evidenceIds,
    coverage: compactProgress(coverage),
  });
  // Compatibility alias.
  emit({
    type: 'scout:checkpoint',
    cycle: (coverage.criteria || []).filter((item) => TERMINAL_COVERAGE.has(item.status)).length,
    decision: 'continue',
    coverage: coverage.criteria,
    nextGap: null,
    candidateCount: accepted.length,
    searchCount: run.searchCount + cycleSearches,
    fetchCount: run.fetchCount + cycleFetches,
    toolsUsed,
    toolsCap,
  });

  // Criterion verify succeeded — Scout/Evaluator no longer need on-disk bodies.
  // Writing pack only uses DB claims/snippets, so this is safe for report generation.
  await artifactStore?.cleanup?.().catch(() => {});

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
      criterion.summary = '';
      criterion.gap = '';
      criterion.warning = '';
      criterion.verification = '';
    }
  }

  let run = existingRun || createResearchScoutRun({
    sessionId: session.id,
    waveId: wave.id,
    questionId: question.id,
    name: `Investigator ${question.ordinal + 1}`,
    ledger: { version: 2, questionId: question.id, queries: [] },
  });

  const baseDefinitions = createScoutToolDefinitions();
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
    dependsOn: Array.isArray(question.dependsOn) ? question.dependsOn : [],
  });

  const dependency = collectDependencyContextForQuestion(session.id, question);
  if (dependency.text) {
    emit({
      type: 'scout:dependency_context',
      scope: 'scout',
      wave: wave.wave,
      waveId: wave.id,
      scoutRunId: run.id,
      questionId: question.id,
      scoutName: run.name,
      dependsOn: Array.isArray(question.dependsOn) ? question.dependsOn : [],
      upstreams: dependency.upstreams.map((item) => ({
        questionId: item.questionId,
        text: item.text,
        status: item.status,
        claimCount: item.claimCount,
      })),
      summary: dependency.text,
    });
  }

  try {
    let totalSearches = 0;
    let totalFetches = 0;
    const committedEvidenceIds = [];

    const pendingVerify = run.ledger?.pendingVerify;
    if (pendingVerify?.criterionId && pendingVerify.scoutRunId === run.id) {
      const criterion = (coverage.criteria || []).find((item) => item.id === pendingVerify.criterionId);
      if (criterion && !TERMINAL_COVERAGE.has(criterion.status)) {
        const artifactStore = createResearchArtifactStore({
          sessionId: session.id,
          scoutRunId: run.id,
          criterionId: criterion.id,
        });
        artifactStore.loadManifest(pendingVerify.artifacts);
        const emitScout = (event) => emit({
          ...event,
          scope: 'scout',
          agent: event.agent || 'scout',
          wave: wave.wave,
          waveId: wave.id,
          scoutRunId: run.id,
          questionId: question.id,
          scoutName: run.name,
          criterionId: criterion.id,
        });
        const emitEvaluator = (event) => emitScout({ ...event, agent: 'evaluator' });
        const result = await finalizeCriterionVerification({
          session,
          wave,
          question,
          criterion,
          run,
          coverage,
          config,
          model,
          signal,
          emit: emitEvaluator,
          toolsUsed: Number(pendingVerify.toolsUsed) || 0,
          toolsCap: Number(pendingVerify.toolsCap) || toolsCap,
          cycleSearches: Number(pendingVerify.cycleSearches) || 0,
          cycleFetches: Number(pendingVerify.cycleFetches) || 0,
          submittedCandidates: [],
          submittedSummary: pendingVerify.submittedSummary || '',
          submittedGap: pendingVerify.submittedGap || '',
          submitNote: pendingVerify.submitNote || '',
          artifactStore,
          gatedCandidates: Array.isArray(pendingVerify.gatedCandidates)
            ? pendingVerify.gatedCandidates
            : [],
          urlRejected: Array.isArray(pendingVerify.urlRejected) ? pendingVerify.urlRejected : [],
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
    }

    const pending = (coverage.criteria || []).filter((item) => !TERMINAL_COVERAGE.has(item.status));

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
        dependencyContext: dependency.text,
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
        if (!criterion.gap) criterion.gap = criterionGapText(criterion) || criterion.reason;
      }
    }

    const allCovered = (coverage.criteria || []).every((item) => item.status === 'covered');
    const anyEvidence = (coverage.criteria || []).some((item) => (item.evidenceIds || []).length);
    const status = allCovered ? 'done' : (anyEvidence ? 'partial' : 'blocked');
    const evidence = listResearchEvidence(session.id);
    const handoff = buildScoutHandoff(question, coverage, evidence);
    const gaps = deriveQuestionGaps(coverage);

    clearResearchResumeCheckpoint(session.id);
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
      gaps,
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
    const keepPendingVerify = error?.resumeStep === 'verify';
    run = updateResearchScoutRun(run.id, {
      status: aborted ? 'aborted' : 'failed',
      ...(keepPendingVerify ? {} : {
        ledger: { version: 2, questionId: question.id, queries: [] },
      }),
      error: errorMessage,
    });
    if (!aborted && !keepPendingVerify) {
      setResearchResumeCheckpoint(session.id, {
        step: 'scout',
        questionId: question.id,
        criterionId: '',
        scoutRunId: run.id,
        error: errorMessage,
      });
    }
    updateResearchQuestion(question.id, {
      status: aborted ? 'open' : 'blocked',
      coverage: structuredClone(coverage),
      gaps: keepPendingVerify
        ? deriveQuestionGaps(coverage)
        : [aborted ? 'Investigation stopped by user' : errorMessage],
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
  }
}

/** @deprecated Alias for older imports / tests. */
const runScoutWithCheckpoints = runScoutForQuestion;

/**
 * Pick the next scout batch for a wave.
 * Dependents wait until every dependsOn id is completed (or settled outside this wave).
 * Never expands to "all pending" when some questions are still blocked on deps.
 */
function selectReadyWaveBatch({
  pendingIds,
  completedIds,
  questionById,
  maxParallel = 3,
} = {}) {
  const pending = new Set(
    (Array.isArray(pendingIds) ? pendingIds : []).map(String).filter(Boolean),
  );
  const completed = new Set(
    (Array.isArray(completedIds) ? completedIds : []).map(String).filter(Boolean),
  );
  const cap = Math.max(1, Math.floor(Number(maxParallel) || 1));
  const byId = questionById instanceof Map
    ? questionById
    : new Map(Object.entries(questionById || {}));

  const isDepSatisfied = (depId) => {
    const dep = String(depId || '');
    if (!dep) return true;
    if (completed.has(dep)) return true;
    if (pending.has(dep)) return false;
    const upstream = byId.get(dep);
    if (!upstream) return false;
    const status = String(upstream.status || '').toLowerCase();
    return ['done', 'partial', 'blocked'].includes(status);
  };

  const ready = [...pending].filter((questionId) => {
    const question = byId.get(questionId);
    const deps = Array.isArray(question?.dependsOn) ? question.dependsOn : [];
    return deps.every((dep) => isDepSatisfied(dep));
  });

  // Prefer ready. If none (e.g. cycle), take a single pending item to avoid deadlock —
  // but never dump the entire pending set.
  const batchIds = (ready.length ? ready : [...pending].slice(0, 1)).slice(0, cap);
  const waiting = [...pending]
    .filter((questionId) => !batchIds.includes(questionId))
    .map((questionId) => {
      const question = byId.get(questionId);
      const waitingOn = (Array.isArray(question?.dependsOn) ? question.dependsOn : [])
        .map(String)
        .filter((dep) => dep && !isDepSatisfied(dep));
      return {
        questionId,
        questionText: question?.text || '',
        dependsOn: Array.isArray(question?.dependsOn) ? question.dependsOn.map(String) : [],
        waitingOn,
      };
    });

  return { batchIds, waiting, readyIds: ready };
}

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
        gap: text(criterion.gap || 'Criterion remains unresolved', 600),
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
    const { batchIds, waiting } = selectReadyWaveBatch({
      pendingIds: [...pending],
      completedIds: [...completed],
      questionById,
      maxParallel,
    });
    emit({
      type: 'batch:start',
      scope: 'lead',
      wave: wave.wave,
      waveId: wave.id,
      questionIds: batchIds,
      waiting,
      maxParallel,
    });
    for (const item of waiting) {
      if (!item.waitingOn.length) continue;
      emit({
        type: 'scout:waiting_deps',
        scope: 'lead',
        wave: wave.wave,
        waveId: wave.id,
        questionId: item.questionId,
        questionText: item.questionText,
        dependsOn: item.dependsOn,
        waitingOn: item.waitingOn,
      });
    }
    const settled = await Promise.allSettled(batchIds.map(async (questionId) => {
      const question = questionById.get(questionId);
      const reusable = existingRuns.find((run) => {
        if (run.questionId !== questionId) return false;
        if (run.status === 'running') return true;
        if (run.status === 'failed' && run.ledger?.pendingVerify) return true;
        if (run.status === 'failed' || run.status === 'aborted') {
          const coverage = resolveQuestionCoverage(question, run);
          return (coverage.criteria || []).some((item) => !TERMINAL_COVERAGE.has(item.status));
        }
        return false;
      });
      let existingRun = reusable || null;
      if (existingRun && ['failed', 'aborted'].includes(existingRun.status)) {
        existingRun = updateResearchScoutRun(existingRun.id, {
          status: 'running',
          error: '',
        });
      }
      return runScoutWithCheckpoints({
        session,
        wave,
        question,
        config,
        model,
        workspaceRoot,
        signal,
        emit,
        existingRun,
      });
    }));
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const verifyFailure = settled.find((result) => (
      result.status === 'rejected'
      && result.reason?.resumeStep === 'verify'
    ));
    if (verifyFailure) throw verifyFailure.reason;

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
        verification: criterion.verification || '',
        summary: criterion.summary || '',
        gap: criterion.gap || '',
        warning: criterion.warning || '',
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
        gap: criterion.gap || criterion.warning || criterion.text,
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
  attachFetchArtifactMeta,
  buildFetchArtifactPreview,
  buildScoutHandoff,
  buildUpstreamDependencySummary,
  collectDependencyContextForQuestion,
  createEmptyCoverage,
  selectReadyWaveBatch,
  createInitialLedger,
  createReadArtifactDefinition,
  createResearchArtifactStore,
  createResearchSearchDefinition,
  createSubmitCandidatesDefinition,
  createSubmitCriterionReviewDefinition,
  candidateToEvidence,
  deriveQuestionGaps,
  deterministicResearchReadiness,
  finalizeInvestigationRound,
  gateCandidatesByUrl,
  indexFetchResult,
  indexSearchResult,
  normalizeSubmittedCandidates,
  normalizeSubmitNarrative,
  normalizeUrl,
  partitionWaveTargetsAndLimitations,
  resolveQuestionCoverage,
  resolveToolsCap,
  runScoutForQuestion,
  validateSupportVerdicts,
  verifyCandidateSupport,
  MAX_CANDIDATES_PER_CRITERION,
  MAX_SOURCES_PER_CLAIM,
  MAX_URLS_PER_CLAIM,
  RESEARCH_SCOUT_TOOLS_PER_CRITERION,
};

export {
  cleanupResearchCriterionArtifacts,
  cleanupResearchSessionArtifacts,
  getResearchArtifactsRoot,
  researchArtifactDirForScope,
  researchSessionArtifactsDir,
} from './research-artifacts.js';
