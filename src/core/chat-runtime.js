import {
  formatLocalDate,
  loadCommandsAndSkills,
  loadIndexedSkills,
  buildSkillIndexPromptBlock,
  isSkillIndexEligible,
  isSkillModelInvocationDisabled,
  isUserInvocableSkill,
  renderCommandPrompt,
  appendSkillSandboxMountHint,
} from './command-loader.js';
import { skillIsEligible } from './skill-contexts.js';
import {
  createSkillHooksSession,
  armSkillHooks,
  disarmSkillHooks,
  PROJECT_HOOKS_SKILL_NAME,
} from './skill-hooks-session.js';
import {
  armSkillFromCommand,
  fireSkillHookEvent,
  formatHookContextLines,
  reconcileSessionStartAfterActivationChange,
} from './skill-hooks-runtime.js';
import {
  loadGlobalHooks,
  loadProjectHooks,
  mergeWorkspaceHookLayers,
  workspaceHooksArmEntry,
} from './project-hooks.js';
import {
  hookProfileIsActive,
  isPackageHooksArmName,
  listCustomHookProfiles,
  mergeHookProfileHooks,
  packageProfileArmEntry,
} from './hook-profiles.js';
import { runAgentLoop } from './agent-loop.js';
import { createToolResultStore } from './tool-result-store.js';
import { parseModelJsonObject } from './model-json.js';
import { trimInline, normalizePath } from './string-utils.js';
import { normalizeAssumptionItems } from './tool-args-helpers.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createChatCompletion,
  createChatCompletionStream
} from './provider/index.js';
import { isDangerousCommand, runShellCommand } from './shell.js';
import { getBuiltinTools } from './tools.js';
import { canonicalShellToolName, shellToolName, toolNameAllowed } from './shell-tool-name.js';
import { createToolRuntime } from './tool-runtime.js';
import {
  createContinuationSession,
  deriveSessionTitle,
  loadSession,
  listSessions,
  pruneSessions,
  resolveLatestTitleExchange,
  resolveTitleUserText,
  saveSession
} from './session-store.js';
import {
  buildSessionTitleMessages,
  normalizeGeneratedSessionTitle,
  retrySessionTitleRequest,
  shouldReplaceSessionTitle
} from './session-title.js';
import { loadConfig, saveConfig, setConfigValue } from './config-store.js';
import { evaluateCommandPolicy } from './command-policy.js';
import { loadInputHistory } from './input-history-store.js';
import {
  compactMessagesLocally,
  estimateMessagesTokens,
  microCompactMessages,
  parseCompactArgs,
  buildTranscriptForLLM,
  COMPACT_SUMMARY_PROMPT
} from './context-compact.js';
import { getReplyLanguage, getReplyLanguageName, stripReplyLanguageDirective, buildSystemPromptWithReplyLanguage, appendStructuredOutputLanguageRule } from './reply-language.js';
import { composeSystemPrompt } from './system-prompt-composer.js';
import { buildTurnContextPrefix, buildTurnUserPrompt } from './turn-context.js';
import { buildSubAgentShellRulesPrompt, buildSubAgentRuntimeNote, resolveShellContext } from './shell-profile.js';
import { getBaseConfigDir, getProjectIndexDir, getProjectPlansDir, getProjectSpecsDir, getProjectWorkspaceDir, getSessionsDir, getSkillsDir } from './paths.js';
import { composeMemorySnapshot } from './memory-prompt.js';
import { buildProjectContextSnippet, initializeProjectIndex } from './project-index.js';
import { queryProjectKnowledgeGraph } from './project-knowledge-graph.js';
import { captureToInbox, listInbox } from './memory-store.js';
import {
  classifyMemoryRoute,
  isSensitiveMemoryContent,
  shouldAutoCaptureUserPrompt as shouldAutoCaptureUserPromptShared,
  buildMemoryRouteHintBlock
} from './memory-policy.js';
import {
  buildCodingRouteDecisionBlock,
  evaluateCodingRouteGraph,
  isCodingRouteToolAllowed,
} from './coding-route-graph.js';
import {
  buildCleanContextHandoff
} from './workflow-gates.js';
import {
  createSubAgentDependencyCoordinator,
  formatSubAgentUpstreamContext,
} from './subagent-orchestrator.js';
import {
  buildSubAgentHandoffCatalog,
  listSubAgentHandoffs,
  saveSubAgentHandoff,
} from './subagent-handoff-store.js';
import { runDreamConsolidation } from './dream-consolidate.js';
import {
  scheduleMemoryReviewBacklog,
  scheduleSessionMemoryReview
} from './memory-session-review.js';
import { normalizePlanState } from './plan-state.js';
import { normalizeSpecState } from './spec-state.js';
import { normalizeTodos } from './todo-state.js';
import {
  attachTimingToUsage,
  createStreamTimingTracker,
  mergeTiming
} from './usage-timing.js';
import { isGeneralWorkspaceProjectDir, normalizeProjectDirKey } from './webui-sidebar-config.js';
import {
  attachReflectTargets,
  buildReflectSkillDraft,
  normalizeReflectDraft,
  writeReflectSkillDraft
} from './reflect-skill.js';
import {
  beginGitOplogCapture,
  captureGitOplogChanges,
  createGitOplogChangeTracker,
  listGitOplogChanges,
  readGitOplogPatch,
  undoGitOplogChange,
  undoGitOplogChanges
} from './git-oplog-change-tracker.js';
import { createNonGitBackupManager } from './non-git-backup.js';
import {
  detectWorkspaceIsGit,
  resolveApprovalProjectIsGit
} from './approval-policy.js';
import {
  resolveApprovalUiEnabled,
  resolveSandboxPolicy,
} from './sandbox-policy.js';
import {
  normalizeToolPolicy,
} from './provider/search-tool-registry.js';
import { normalizeReasoningEffort, resolveConfiguredReasoningEffort } from './provider/reasoning-effort.js';
import { getActiveSoulName, listSouls, normalizeSoulCategory, soulContextFromExecutionMode, soulNameEquals } from './soul.js';
import { appendAttachmentContext, composeSelectedSkills, normalizeChatSubmission } from './chat-message.js';
import { CHAT_ACTIONS, validateChatAction } from './chat-action-dispatcher.js';

const STREAM_SAVE_DEBOUNCE_MS = 120;

export function takePendingApproval(state, requestId) {
  const request = state?.current;
  if (!request || String(request.id || '') !== String(requestId || '')) {
    const error = new Error('No matching approval request is pending');
    error.code = request ? 'STALE_ACTION' : 'NO_PENDING_APPROVAL';
    throw error;
  }
  state.current = null;
  return request;
}

export function peekPendingApproval(state, requestId = null) {
  const request = state?.current || null;
  if (!request) return null;
  if (requestId != null && String(request.id || '') !== String(requestId || '')) return null;
  return request;
}

export function resolvePendingApproval(state, requestId, decision = {}) {
  const request = takePendingApproval(state, requestId);
  request.resolve({
    approved: decision?.approved === true,
    ...(decision?.approved === true ? {} : { reason: String(decision?.reason || '') })
  });
  return {
    type: 'approval',
    approved: decision?.approved === true,
    requestId
  };
}
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REQUIREMENTS_TEMPLATE = path.resolve(MODULE_DIR, '..', '..', 'templates', 'project-requirements', 'report-shell.html');
const PROJECT_REQUIREMENTS_MD_TEMPLATE = path.resolve(MODULE_DIR, '..', '..', 'templates', 'project-requirements', 'report-template.md');
const PROJECT_REQUIREMENTS_MD_INSTRUCTIONS = path.resolve(MODULE_DIR, '..', '..', 'templates', 'project-requirements', 'markdown-instructions.md');
const PROJECT_REQUIREMENTS_SECTION_NAMES = [
  'summary',
  'architecture',
  'interfaces',
  'requirements',
  'flows',
  'domain',
  'security',
  'errors',
  'nonfunctional',
  'questions',
  'evidence'
];

export function isModelVisibleMessage(message) {
  return message?.model_visible !== false && message?.local_only !== true;
}

function modelContentForMessage(message, index, { currentTurnUserIndex = -1 } = {}) {
  const modelContent = typeof message?.model_content === 'string' && message.model_content
    ? message.model_content
    : '';
  const baseContent = modelContent || message?.content;
  const images = index === currentTurnUserIndex && Array.isArray(message?.model_images)
    ? message.model_images
    : [];
  if (images.length) {
    return [
      { type: 'text', text: String(baseContent || '') },
      ...images.map((image) => ({
        type: 'image_url',
        image_url: {
          url: `data:${image.mime || 'image/jpeg'};base64,${image.data}`
        }
      }))
    ];
  }
  if (!modelContent) return message?.content;
  if (message?.model_content_scope === 'current_turn' && index !== currentTurnUserIndex) {
    return message?.content;
  }
  return modelContent;
}

export function modelVisibleMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).filter(isModelVisibleMessage);
}

function findCurrentTurnUserIndex(messages = [], text = '', modelText = '') {
  if (!modelText || modelText === text) return -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    if (message.content === text) return index;
  }
  return -1;
}

export function mergeCurrentTurnModelText(primary = '', extra = '', label = 'Additional current-turn context') {
  const base = String(primary || '').trim();
  const addition = String(extra || '').trim();
  if (!base) return addition;
  if (!addition) return base;
  if (base.includes(addition)) return base;
  return [base, `<${label}>`, addition, `</${label}>`].join('\n\n');
}

export function toOpenAIMessages(sessionMessages, options = {}) {
  const mapped = [];
  for (let index = 0; index < (sessionMessages || []).length; index += 1) {
    const msg = sessionMessages[index];
    if (!isModelVisibleMessage(msg)) continue;
    if (msg.role === 'tool') {
      mapped.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.tool_call_id,
        ...(msg.tool_status ? { tool_status: msg.tool_status } : {})
      });
      continue;
    }
    mapped.push({
      role: msg.role,
      content: modelContentForMessage(msg, index, options),
      ...(typeof msg.reasoning_content === 'string' && msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
      ...(Array.isArray(msg.reasoning_details) && msg.reasoning_details.length > 0 ? { reasoning_details: msg.reasoning_details } : {}),
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {})
    });
  }
  return mapped;
}

function translateCompactBoundaryToOriginal(sourceIsCompacted, compactMeta, compactBoundaryIndex) {
  const boundary = Number(compactBoundaryIndex);
  if (!Number.isFinite(boundary)) return undefined;
  if (!sourceIsCompacted) return Math.max(0, boundary);
  const previousBoundary = Number(compactMeta?.boundaryIndex);
  if (!Number.isFinite(previousBoundary)) return Math.max(0, boundary);
  return Math.max(0, previousBoundary + Math.max(0, boundary - 1));
}

function slugify(input) {
  const base = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'untitled';
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function numberFromPath(obj, pathParts) {
  let current = obj;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return null;
    current = current[part];
  }
  const value = Number(current);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function firstFiniteNumber(obj, paths) {
  for (const pathParts of paths) {
    const value = numberFromPath(obj, pathParts);
    if (value != null) return value;
  }
  return null;
}

function sumFiniteNumbers(obj, paths) {
  let sum = 0;
  let found = false;
  for (const pathParts of paths) {
    const value = numberFromPath(obj, pathParts);
    if (value != null) {
      sum += value;
      found = true;
    }
  }
  return found ? sum : null;
}

function collectRawUsage(usage) {
  if (!usage || typeof usage !== 'object') return [];
  if (Array.isArray(usage.raw)) {
    return usage.raw
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ ...item }));
  }
  return [{ ...usage }];
}

export function normalizeModelUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const promptCacheHitTokens = firstFiniteNumber(usage, [
    ['prompt_cache_hit_tokens'],
    ['promptCacheHitTokens'],
    ['cache_hit_tokens'],
    ['cacheHitTokens']
  ]);
  const promptCacheMissTokens = firstFiniteNumber(usage, [
    ['prompt_cache_miss_tokens'],
    ['promptCacheMissTokens'],
    ['cache_miss_tokens'],
    ['cacheMissTokens']
  ]);
  const explicitInputTokens = firstFiniteNumber(usage, [
    ['prompt_tokens'],
    ['input_tokens'],
    ['inputTokens'],
    ['promptTokens'],
    ['prompt_token_count'],
    ['promptTokenCount'],
    ['input_token_count'],
    ['inputTokenCount'],
    ['input_total_tokens'],
    ['total_input_tokens'],
    ['usage', 'prompt_tokens'],
    ['usage', 'input_tokens'],
    ['usage_metadata', 'prompt_token_count'],
    ['usage_metadata', 'input_token_count'],
    ['usageMetadata', 'promptTokenCount'],
    ['usageMetadata', 'inputTokenCount'],
    ['token_usage', 'prompt_tokens'],
    ['token_usage', 'input_tokens'],
    ['tokenUsage', 'promptTokens'],
    ['tokenUsage', 'inputTokens'],
    ['tokens', 'input_tokens'],
    ['tokens', 'inputTokens'],
    ['tokens', 'prompt_tokens'],
    ['tokens', 'promptTokens'],
    ['billed_units', 'input_tokens'],
    ['billedUnits', 'inputTokens']
  ]);
  const cacheReadInputTokens = firstFiniteNumber(usage, [
    ['cache_read_input_tokens'],
    ['cacheReadInputTokens'],
    ['cache_read_tokens'],
    ['cacheReadTokens']
  ]);
  const outputTokens = firstFiniteNumber(usage, [
    ['completion_tokens'],
    ['output_tokens'],
    ['outputTokens'],
    ['completionTokens'],
    ['completion_token_count'],
    ['completionTokenCount'],
    ['output_token_count'],
    ['outputTokenCount'],
    ['candidates_token_count'],
    ['candidatesTokenCount'],
    ['usage', 'completion_tokens'],
    ['usage', 'output_tokens'],
    ['usage_metadata', 'candidates_token_count'],
    ['usage_metadata', 'output_token_count'],
    ['usageMetadata', 'candidatesTokenCount'],
    ['usageMetadata', 'outputTokenCount'],
    ['token_usage', 'completion_tokens'],
    ['token_usage', 'output_tokens'],
    ['tokenUsage', 'completionTokens'],
    ['tokenUsage', 'outputTokens'],
    ['tokens', 'output_tokens'],
    ['tokens', 'outputTokens'],
    ['tokens', 'completion_tokens'],
    ['tokens', 'completionTokens'],
    ['billed_units', 'output_tokens'],
    ['billedUnits', 'outputTokens']
  ]);
  const explicitTotal = firstFiniteNumber(usage, [
    ['total_tokens'],
    ['totalTokens'],
    ['total_token_count'],
    ['totalTokenCount'],
    ['usage', 'total_tokens'],
    ['usage_metadata', 'total_token_count'],
    ['usageMetadata', 'totalTokenCount'],
    ['token_usage', 'total_tokens'],
    ['tokenUsage', 'totalTokens'],
    ['tokens', 'total_tokens'],
    ['tokens', 'totalTokens']
  ]);
  const cachedInputTokens = firstFiniteNumber(usage, [
    ['prompt_tokens_details', 'cached_tokens'],
    ['input_tokens_details', 'cached_tokens'],
    ['promptTokensDetails', 'cachedTokens'],
    ['inputTokensDetails', 'cachedTokens'],
    ['cache_read_input_tokens'],
    ['cacheReadInputTokens'],
    ['cache_read_tokens'],
    ['cacheReadTokens'],
    ['cached_tokens'],
    ['cachedTokens'],
    ['cached_input_tokens'],
    ['cachedInputTokens'],
    ['cached_content_token_count'],
    ['cachedContentTokenCount'],
    ['usage', 'prompt_tokens_details', 'cached_tokens'],
    ['usage', 'input_tokens_details', 'cached_tokens'],
    ['usage_metadata', 'cached_content_token_count'],
    ['usageMetadata', 'cachedContentTokenCount'],
    ['token_usage', 'prompt_tokens_details', 'cached_tokens'],
    ['tokenUsage', 'promptTokensDetails', 'cachedTokens'],
    ['tokens', 'cached_tokens'],
    ['tokens', 'cachedTokens'],
    ['prompt_cache_hit_tokens'],
    ['promptCacheHitTokens'],
    ['cache_hit_tokens'],
    ['cacheHitTokens']
  ]);
  const explicitCacheMissInputTokens = firstFiniteNumber(usage, [
    ['prompt_cache_miss_tokens'],
    ['promptCacheMissTokens'],
    ['cache_miss_tokens'],
    ['cacheMissTokens']
  ]);
  const cacheWriteInputTokens = firstFiniteNumber(usage, [
    ['cache_creation_input_tokens'],
    ['cacheCreationInputTokens'],
    ['cache_write_input_tokens'],
    ['cacheWriteInputTokens'],
    ['cache_creation_tokens'],
    ['cacheCreationTokens'],
    ['usage', 'cache_creation_input_tokens'],
    ['usage', 'cache_write_input_tokens'],
    ['token_usage', 'cache_creation_input_tokens'],
    ['tokenUsage', 'cacheCreationInputTokens']
  ]) ?? sumFiniteNumbers(usage, [
    ['cache_creation', 'ephemeral_5m_input_tokens'],
    ['cache_creation', 'ephemeral_1h_input_tokens'],
    ['cacheCreation', 'ephemeral5mInputTokens'],
    ['cacheCreation', 'ephemeral1hInputTokens'],
    ['usage', 'cache_creation', 'ephemeral_5m_input_tokens'],
    ['usage', 'cache_creation', 'ephemeral_1h_input_tokens']
  ]);
  const hasAnthropicSplitCacheInput = explicitInputTokens != null
    && (cacheReadInputTokens != null || cacheWriteInputTokens != null)
    && promptCacheHitTokens == null;
  const cacheMissInputTokens = explicitCacheMissInputTokens ?? (
    hasAnthropicSplitCacheInput
      ? Number(explicitInputTokens || 0) + Number(cacheWriteInputTokens || 0)
      : null
  );
  const inputTokens = explicitInputTokens != null
    ? Number(explicitInputTokens || 0)
      + (hasAnthropicSplitCacheInput ? Number(cacheReadInputTokens || 0) + Number(cacheWriteInputTokens || 0) : 0)
    : (
      promptCacheHitTokens != null || promptCacheMissTokens != null
        ? Number(promptCacheHitTokens || 0) + Number(promptCacheMissTokens || 0)
        : null
    );
  const reasoningOutputTokens = firstFiniteNumber(usage, [
    ['completion_tokens_details', 'reasoning_tokens'],
    ['output_tokens_details', 'reasoning_tokens'],
    ['completionTokensDetails', 'reasoningTokens'],
    ['outputTokensDetails', 'reasoningTokens'],
    ['reasoning_tokens'],
    ['reasoningTokens'],
    ['thoughts_token_count'],
    ['thoughtsTokenCount'],
    ['usage', 'completion_tokens_details', 'reasoning_tokens'],
    ['usage_metadata', 'thoughts_token_count'],
    ['usageMetadata', 'thoughtsTokenCount']
  ]);
  const totalTokens = explicitTotal ?? (
    inputTokens != null || outputTokens != null
      ? Number(inputTokens || 0) + Number(outputTokens || 0)
      : null
  );
  if (
    inputTokens == null &&
    outputTokens == null &&
    totalTokens == null &&
    cachedInputTokens == null &&
    cacheWriteInputTokens == null
  ) {
    return null;
  }
  return withTiming({
    inputTokens: Math.round(inputTokens || 0),
    outputTokens: Math.round(outputTokens || 0),
    totalTokens: Math.round(totalTokens || 0),
    cachedInputTokens: Math.round(cachedInputTokens || 0),
    cacheMissInputTokens: Math.round(cacheMissInputTokens || 0),
    cacheWriteInputTokens: Math.round(cacheWriteInputTokens || 0),
    reasoningOutputTokens: Math.round(reasoningOutputTokens || 0),
    requests: 1,
    raw: collectRawUsage(usage)
  }, usage);
}

function withTiming(base, ...sources) {
  const timing = sources.reduce((acc, source) => mergeTiming(acc, source?.timing), null);
  if (timing) base.timing = timing;
  return base;
}

function cloneModelUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return withTiming({
    inputTokens: Math.max(0, Math.round(Number(usage.inputTokens || 0))),
    outputTokens: Math.max(0, Math.round(Number(usage.outputTokens || 0))),
    totalTokens: Math.max(0, Math.round(Number(usage.totalTokens || 0))),
    cachedInputTokens: Math.max(0, Math.round(Number(usage.cachedInputTokens || 0))),
    cacheMissInputTokens: Math.max(0, Math.round(Number(usage.cacheMissInputTokens || 0))),
    cacheWriteInputTokens: Math.max(0, Math.round(Number(usage.cacheWriteInputTokens || 0))),
    reasoningOutputTokens: Math.max(0, Math.round(Number(usage.reasoningOutputTokens || 0))),
    requests: Math.max(0, Math.round(Number(usage.requests || 0))),
    raw: Array.isArray(usage.raw) ? usage.raw.map((item) => ({ ...item })) : []
  }, usage);
}

function mergeModelUsage(left, right) {
  const a = cloneModelUsage(left);
  const b = cloneModelUsage(right);
  if (!a) return b;
  if (!b) return a;
  return withTiming({
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheMissInputTokens: a.cacheMissInputTokens + b.cacheMissInputTokens,
    cacheWriteInputTokens: a.cacheWriteInputTokens + b.cacheWriteInputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
    requests: a.requests + b.requests,
    raw: [...a.raw, ...b.raw]
  }, a, b);
}

export function createTurnUsageAccumulator() {
  let delegatedUsage = null;

  return {
    addDelegated(usage) {
      delegatedUsage = mergeModelUsage(delegatedUsage, usage);
      return cloneModelUsage(delegatedUsage);
    },
    consumeInto(ownUsage) {
      const total = mergeModelUsage(ownUsage, delegatedUsage);
      delegatedUsage = null;
      return total;
    },
    takePending() {
      const pending = cloneModelUsage(delegatedUsage);
      delegatedUsage = null;
      return pending;
    },
    peekPending() {
      return cloneModelUsage(delegatedUsage);
    }
  };
}

function collectAssistantUsage(messages = []) {
  let usage = null;
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (msg?.role === 'assistant' && msg.usage) {
      usage = mergeModelUsage(usage, msg.usage);
    }
  }
  return usage;
}

function prioritizeByPreferredOrder(items, preferredOrder) {
  const source = Array.isArray(items) ? items : [];
  const priorities = new Map((Array.isArray(preferredOrder) ? preferredOrder : []).map((value, index) => [value, index]));
  return [...source].sort((left, right) => {
    const leftRank = priorities.has(left) ? priorities.get(left) : Number.MAX_SAFE_INTEGER;
    const rightRank = priorities.has(right) ? priorities.get(right) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return source.indexOf(left) - source.indexOf(right);
  });
}

function normalizeUiLocale(value) {
  return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
}

function formatLocalDateTimeSlug(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  const second = String(value.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hour}-${minute}-${second}`;
}


const SUB_AGENT_ROLES = ['planner', 'explorer', 'architect', 'advisor', 'coder', 'refactorer', 'reviewer', 'tester', 'debugger', 'writer', 'summarizer', 'codewiki'];
const EXECUTOR_AGENT_ROLES = SUB_AGENT_ROLES.filter((role) => !['planner', 'codewiki'].includes(role));
const CODEWIKI_ROLE_TOOLS = ['read', 'search_code', 'grep', 'list', 'glob', 'query_project_index', 'query_project_graph', 'read_plan', 'add_code_comment', 'update_code_comment'];
export const CODEWIKI_GENERATE_TOOLS = ['read', 'search_code', 'grep', 'list', 'glob', 'query_project_index', 'query_project_graph', 'read_plan', 'skill', 'edit', 'write', 'begin_write', 'write_chunk', 'commit_write', 'abort_write', 'apply_patch'];
export const EXECUTION_MODE_TOOL_POLICY = {
  plan: [
    'read', 'search_code', 'grep', 'ast_grep', 'list', 'glob', 'ast_query', 'read_ast_node',
    'query_project_index', 'query_project_graph', 'tool_search', 'skill', 'web_fetch', 'web_search',
    'save_memory',
    'tasks',
    'edit', 'write', 'begin_write', 'write_chunk', 'commit_write', 'abort_write', 'apply_patch', 'delete', 'run',
    'run_subagent', 'fork_task', 'request_user_input'
  ]
};

export function normalizeExecutionMode(mode) {
  const normalized = String(mode || 'normal').toLowerCase();
  if (['spec', 'plan', 'code', 'coding'].includes(normalized)) return 'plan';
  if (['normal', 'daily'].includes(normalized)) return 'normal';
  return 'normal';
}

function isExecutionModeInput(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['normal', 'daily', 'plan', 'code', 'coding', 'spec'].includes(normalized);
}

function displayExecutionMode(mode) {
  return normalizeExecutionMode(mode) === 'plan' ? 'code' : 'normal';
}

function resolveExecutionModeAllowedTools(executionMode, callerAllowedTools, config, commandPlatform = process.platform) {
  const mode = normalizeExecutionMode(executionMode);
  const modePolicy = adaptToolNamesForPlatform(
    normalizeToolPolicy(EXECUTION_MODE_TOOL_POLICY[mode] || [], config).map(canonicalShellToolName),
    commandPlatform,
  );
  if (!modePolicy.length) return callerAllowedTools;
  if (Array.isArray(callerAllowedTools)) {
    return adaptToolNamesForPlatform(
      normalizeToolPolicy(callerAllowedTools, config).map(canonicalShellToolName).filter((name) => modePolicy.includes(name)),
      commandPlatform,
    );
  }
  return modePolicy;
}

export function buildExecutionModePromptBlock(executionMode, platform = process.platform, shell = '') {
  const commandToolName = shellToolName({ platform, shell });
  if (normalizeExecutionMode(executionMode) === 'plan') {
    const unixCrud = platform !== 'win32';
    return [
      'Execution Mode: coding',
      'Implement only when requested. Preserve public contracts, project conventions, unrelated user changes, and platform compatibility.',
      '',
      'Workflow: inspect relevant source and callers → clarify only material choices → make the smallest complete change → run focused verification → inspect the diff.',
      'The injected <coding_harness> route is authoritative for memory capability, and directive for tasks, skills, clarification, and bounded delegation.',
      'For bugs, establish a failing signal and fix the shared root cause. Never claim completion without fresh evidence.',
      '',
      'Subagent tool (run_subagent):',
      '- Prefer delegation for non-trivial coding work only when a bounded, independently verifiable chunk benefits from clean context or parallel read-only evidence.',
      '- The parent agent owns decomposition, integration, and the final answer. Workers use the configured Lite/Fast model.',
      `- Pass a one- or two-sentence summary plus concrete task, success criteria, and scope. Give read-only workers explicit tools; include ${commandToolName} only for execution they own.`,
      '- Do not copy the parent transcript into the worker. Pass a task envelope: goal, file paths, constraints, and known facts.',
      '- Workers return a short conclusion and a handoff path under .codemini/handoffs/. Read that file only when details are required; do not copy the raw dump forward.',
      '',
      'Fork tool (fork_task):',
      '- Prefer fork_task over run_subagent when branches share the full state and prompt prefix (same identity/model): parallel investigation, option comparison, or bounded same-identity chunks. Issue several fork_task calls in one response to run branches concurrently.',
      '- Branches inherit the whole conversation prefix, so pass only the branch task and a short name; do not restate history. Branches share one worktree: prefer read-only investigation or disjoint file ownership.',
      '- For a clean context, a different role/model, or role-specific tools, use run_subagent. Branches cannot fork or ask the user questions.',
      '',
      'User input workflow:',
      '- Inspect first. Use request_user_input when preference, scope, target, or constraints materially change the work.',
      '- Prefer a structured form for 1-3 choices when it would substantially improve the usefulness or fit; continue with safe reversible defaults for incidental details.',
      '',
      'Design documents:',
      '- Create a design document only when implementation is blocked by a material product/architecture decision, multiple viable approaches have meaningfully different tradeoffs, or the change affects public contracts, data migration, security, cost, or broad scope.',
      '- Do not create a design document for routine fixes. Record only material decisions and wait for confirmation before implementing those material choices.',
      '',
      'Tool discipline:',
      unixCrud
        ? '- Read before editing; use edit old_string/new_string for existing files and write for new files.'
        : '- Use edit for precise changes, apply_patch for coherent multi-file work, and begin_write/write_chunk/commit_write only for long whole-file output.',
      `- Use ${commandToolName} for focused tests, builds, generators, and git inspection—not ordinary source reading.`
    ].join('\n');
  }
  return [
    'Execution Mode: normal',
    'Handle everyday questions and lightweight tasks conversationally. Answer without changing state unless the user asks for an action.',
      '',
    'User input workflow:',
    '- Keep request_user_input available. Use a short structured form when 1-3 preference, scope, format, or outcome choices would materially improve the answer.',
    '- Make safe reversible assumptions for incidental details. Preserve user data and avoid external side effects without clear authorization.',
      '',
    'Web research workflow:',
    '- Search for current, changeable, unfamiliar, high-stakes, recommendation, or explicitly verified information. Use targeted queries, cite material claims, and distinguish inference from sourced facts.',
    `- Use ${commandToolName} or workspace tools only when they directly support the request.`
  ].join('\n');
}

// Subagent capability tiers, composed per role below to avoid repeating the
// same tool lists. An explicit parent `tools` list overrides these defaults.
// planner/summarizer intentionally omit search_code: they must not browse code.
const SUBAGENT_READ_TOOLS = ['read', 'search_code', 'tool_search', 'skill'];
const SUBAGENT_EDIT_TOOLS = [
  'edit', 'write', 'begin_write', 'write_chunk', 'commit_write',
  'abort_write', 'apply_patch', 'delete',
];

export const ROLE_TOOL_POLICY = {
  planner: ['read', 'read_plan', 'tool_search', 'skill', 'update_plan'],
  explorer: [...SUBAGENT_READ_TOOLS, 'web_fetch', 'web_search'],
  architect: [...SUBAGENT_READ_TOOLS, 'web_search'],
  advisor: [...SUBAGENT_READ_TOOLS],
  coder: [...SUBAGENT_READ_TOOLS, ...SUBAGENT_EDIT_TOOLS, 'run', 'web_fetch', 'web_search'],
  refactorer: [...SUBAGENT_READ_TOOLS, ...SUBAGENT_EDIT_TOOLS, 'run'],
  reviewer: [...SUBAGENT_READ_TOOLS],
  tester: [...SUBAGENT_READ_TOOLS, 'run'],
  debugger: [...SUBAGENT_READ_TOOLS, 'run', 'web_search'],
  writer: [...SUBAGENT_READ_TOOLS, 'web_fetch', 'web_search'],
  summarizer: ['read', 'tool_search', 'skill'],
  codewiki: CODEWIKI_ROLE_TOOLS
};

/** Subagents must never spawn nested agents / workflow orchestrators. */
export const SUBAGENT_FORBIDDEN_TOOLS = ['run_subagent', 'fork_task', 'create_plan', 'create_spec'];

/**
 * Fork branches keep the parent's full tool schemas for prefix-cache reuse,
 * but execution of these tools is denied. Branches must never fork/subdelegate
 * further, pause the whole turn for user input, or mutate parent-owned plan
 * state while sibling branches are running.
 */
export const FORK_FORBIDDEN_TOOLS = [
  'fork_task', 'run_subagent', 'request_user_input', 'update_plan', 'create_plan', 'create_spec'
];

const WINDOWS_STAGED_WRITE_TOOLS = [
  'begin_write',
  'write_chunk',
  'commit_write',
  'abort_write',
  'apply_patch',
];

const SUBAGENT_MUTATING_TOOLS = new Set([
  'edit', 'write', 'begin_write', 'write_chunk', 'commit_write', 'apply_patch', 'delete'
]);

/**
 * Align allow-lists with the platform CRUD surface: drop Windows staged write /
 * apply_patch on unix, and ensure filesystem inspection tools on every platform.
 */
export function adaptToolNamesForPlatform(
  toolNames = [],
  platform = process.platform,
  { promoteInspection = true } = {},
) {
  const source = Array.isArray(toolNames) ? toolNames : [];
  const drop = platform === 'win32' ? new Set() : new Set(WINDOWS_STAGED_WRITE_TOOLS);
  const out = [];
  const seen = new Set();
  for (const name of source) {
    const normalized = String(name || '').trim();
    if (!normalized || drop.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  if (promoteInspection && (out.includes('search_code') || out.includes('read'))) {
    const extras = ['list', 'glob', 'grep'].filter((name) => !seen.has(name));
    if (extras.length) {
      const anchor = out.indexOf('search_code');
      const at = anchor >= 0 ? anchor + 1 : out.length;
      out.splice(at, 0, ...extras);
    }
  }
  return out;
}

export function normalizeSubAgentPersonaName(value, fallback = 'Alex') {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  if (!text) return fallback;
  // Preserve kebab/snake suffixes so parallel workers like "Reader-A" and
  // "Reader-B" stay distinct, but still take only the first whitespace word to
  // keep the badge short.
  const first = text.split(' ')[0] || text;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * Resolve a subagent's identity into a persona name, pipeline policy key, and
 * prompt role. Only the explicit `role` field selects a pipeline policy; a
 * persona `name` never maps onto a role, so a name like "Writer" stays a
 * coder-baseline persona instead of silently becoming a read-only role.
 */
export function resolveSubAgentRolePolicy(name = '', role = '') {
  const roleKey = String(role || '').trim().toLowerCase();
  const persona = normalizeSubAgentPersonaName(String(name || role || '').trim(), 'Alex');
  const policyKey = ROLE_TOOL_POLICY[roleKey] ? roleKey : 'coder';
  const taskRole = ROLE_TOOL_POLICY[roleKey] ? roleKey : persona;
  return { persona, policyKey, taskRole };
}

export function getSubAgentPersonaPrompt(name = 'Alex') {
  const persona = normalizeSubAgentPersonaName(name);
  return [
    `You are ${persona}, a focused coding subagent helping the parent agent.`,
    'Stay lightly in character — competent, direct, and a bit personable — but never theatrical or wasteful.',
    'Do only the assigned task. Do not invent extra scope. Do not spawn other agents.',
    'Use tools as needed, then return a concise handoff to the parent agent and stop.',
    'Choose the clearest format for the work instead of following a fixed template. Headings, bullets, or short prose are all acceptable.',
    'Include the information the parent needs to continue: the result, material evidence or changes, relevant artifact paths, and any open or unverified items. Add a next step only when one is useful.',
    'Omit empty sections and irrelevant ceremony. No greeting, full-goal recap, or closing flourish.'
  ].join('\n');
}

export function compactSubAgentResultForParent({
  text = '',
  summary = '',
  handoffPath = '',
  artifactPaths = [],
  maxChars = SUB_AGENT_PARENT_RESULT_MAX_CHARS,
} = {}) {
  const artifacts = [...new Set(
    (Array.isArray(artifactPaths) ? artifactPaths : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )];
  const body = String(text || '').trim();
  const pathLine = String(handoffPath || '').trim();
  const previewBudget = pathLine ? Math.min(maxChars, 1500) : maxChars;
  const clipped = body.length <= previewBudget
    ? body
    : `${body.slice(0, previewBudget).trimEnd()}\n\n[truncated]`;
  return [
    'Subagent finished. Use this conclusion; read the handoff file only if you need details.',
    String(summary || '').trim() ? `Summary: ${String(summary).trim()}` : '',
    clipped || '(empty)',
    pathLine ? `Handoff: ${pathLine}` : '',
    artifacts.length ? `Artifacts:\n${artifacts.map((item) => `- ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

const FORK_RESULT_MAX_CHARS = 4000;

export function compactForkResultForParent({
  name = 'Fork',
  text = '',
  summary = '',
  status = 'done',
  fileChanges = [],
  maxChars = FORK_RESULT_MAX_CHARS,
} = {}) {
  const body = String(text || '').trim();
  const clipped = body.length <= maxChars
    ? body
    : `${body.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
  const changedPaths = [...new Set(
    (Array.isArray(fileChanges) ? fileChanges : [])
      .map((change) => String(change?.path || '').trim())
      .filter(Boolean),
  )];
  return [
    `Fork branch "${name}" finished with status ${status}. Use this conclusion; branch tool details stay in the branch.`,
    String(summary || '').trim() ? `Summary: ${String(summary).trim()}` : '',
    clipped || '(empty)',
    changedPaths.length
      ? `Changed files:\n${changedPaths.map((path) => `- ${path}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n');
}

/**
 * Subagent tool allow-list. Unknown persona names (e.g. "David") use the coder
 * tool baseline. When the parent passes an explicit `tools` list, it OVERRIDES
 * the role baseline (minus always-forbidden spawn tools and platform-incompatible
 * names), so a read-only role can still be handed `run`/`Bash` explicitly.
 * On Linux/mac, allow-lists follow the DSH-aligned CRUD surface (no staged
 * write / apply_patch).
 */
export function resolveSubAgentToolAllowList({
  role = 'coder',
  tools = null,
  config,
  platform = process.platform,
} = {}) {
  const key = String(role || '').trim().toLowerCase();
  const basePolicy = ROLE_TOOL_POLICY[key] || ROLE_TOOL_POLICY.coder;
  const roleTools = adaptToolNamesForPlatform(
    normalizeToolPolicy(basePolicy, config).map(canonicalShellToolName).filter(
      (name) => !SUBAGENT_FORBIDDEN_TOOLS.includes(name)
    ),
    platform,
  );
  if (!roleTools.includes('tasks')) roleTools.push('tasks');
  if (!Array.isArray(tools)) return roleTools;
  const requested = adaptToolNamesForPlatform(
    normalizeToolPolicy(tools, config).map(canonicalShellToolName).filter(
      (name) => !SUBAGENT_FORBIDDEN_TOOLS.includes(name)
    ),
    platform,
    { promoteInspection: false },
  );
  const granted = [...requested];
  if (
    granted.some((name) => ['list', 'glob', 'grep'].includes(name))
    && !granted.includes('tool_search')
  ) {
    granted.push('tool_search');
  }
  if (!granted.includes('tasks')) granted.push('tasks');
  return granted;
}

export function subAgentAllowListMayMutate(tools = []) {
  return (Array.isArray(tools) ? tools : []).some((name) =>
    SUBAGENT_MUTATING_TOOLS.has(String(name || '').trim())
  );
}

export function subAgentRunFailed(output = {}, signal = null) {
  return Boolean(
    signal?.aborted ||
    output?.hasErrorLine ||
    !String(output?.text || '').trim()
  );
}

/** Approval options for plan pipeline sub-agents (inherit role tool allow-list + workspace git). */
export function resolvePlanSubAgentApprovalOptions({
  role,
  config,
  projectIsGit = false,
  changeTrackerEnabled = false,
  workspaceHasGit = false,
  tools = null
} = {}) {
  const roleAllowedTools = resolveSubAgentToolAllowList({ role, tools, config });
  return {
    projectIsGit: resolveApprovalProjectIsGit({
      projectIsGit,
      changeTrackerEnabled,
      workspaceHasGit
    }),
    alwaysAllowTools: roleAllowedTools,
    allowedTools: roleAllowedTools
  };
}

const SUB_AGENT_CONTEXT_MAX_MESSAGES = 4;
const SUB_AGENT_CONTEXT_MAX_CHARS = 1200;
const SUB_AGENT_EVIDENCE_MAX_ITEMS = 3;
const SUB_AGENT_HANDOFF_MAX_ITEMS = 6;
const SUB_AGENT_PARENT_RESULT_MAX_CHARS = 4000;
const SUBAGENT_STABLE_SKILLS_PROMPT = [
  'You are a Codemini subagent.',
  'Do only the assigned task. Do not invent extra scope. Do not spawn other agents.',
  'Use tools as needed, then return a concise handoff to the parent agent and stop.'
].join('\n');
const PROJECT_REQUIREMENTS_SECTION_MARKERS = [
  { key: 'summary', marker: 'REQUIREMENTS_SUMMARY', labels: ['1', 'summary', 'overview', 'project overview', 'executive summary', '项目概述', '项目总览', '概述'] },
  { key: 'architecture', marker: 'REQUIREMENTS_ARCHITECTURE', labels: ['2', 'architecture', 'system architecture', 'system map', '架构', '系统架构图', '系统架构', '架构图'] },
  { key: 'interfaces', marker: 'REQUIREMENTS_INTERFACE_INVENTORY', labels: ['3', 'interface inventory', 'interfaces', 'api inventory', '接口清单', '接口', 'api清单'] },
  { key: 'requirements', marker: 'REQUIREMENTS_API_CARDS', labels: ['4', 'requirement cards', 'api cards', 'interface requirements', '接口需求卡片', '需求卡片'] },
  { key: 'flows', marker: 'REQUIREMENTS_FLOWS', labels: ['5', 'flows', 'user flows', 'core flows', '核心用户流程', '用户流程', '流程'] },
  { key: 'domain', marker: 'REQUIREMENTS_DOMAIN_MODEL', labels: ['6', 'domain model', 'data ownership', 'domain', '领域模型', '数据归属', '领域模型与数据归属'] },
  { key: 'security', marker: 'REQUIREMENTS_SECURITY', labels: ['7', 'security', 'permissions', 'compliance', '权限', '安全', '合规', '权限、安全与合规'] },
  { key: 'errors', marker: 'REQUIREMENTS_ERROR_HANDLING', labels: ['8', 'errors', 'edge cases', 'error handling', '异常处理', '边界情况', '异常处理与边界情况'] },
  { key: 'nonfunctional', marker: 'REQUIREMENTS_NONFUNCTIONAL', labels: ['9', 'non-functional', 'nonfunctional', 'nfr', '非功能性需求', '非功能'] },
  { key: 'questions', marker: 'REQUIREMENTS_OPEN_QUESTIONS', labels: ['10', 'open questions', 'unknowns', '待确认问题', '待确认', '问题'] },
  { key: 'evidence', marker: 'REQUIREMENTS_EVIDENCE_INDEX', labels: ['11', 'evidence', 'source evidence', 'source evidence index', '源码证据索引', '证据索引', '源码证据'] }
];
const PROJECT_REQUIREMENTS_SHELL_COPY = {
  en: {
    html_lang: 'en',
    title: 'Project Requirements Report',
    meta_workspace: 'Workspace',
    meta_date: 'Date',
    meta_generated: 'Generated',
    nav_label: 'Report sections',
    nav_summary: 'Summary',
    nav_architecture: 'Architecture',
    nav_interfaces: 'Interfaces',
    nav_requirements: 'Requirements',
    nav_flows: 'Flows',
    nav_domain: 'Domain Model',
    nav_security: 'Security',
    nav_errors: 'Errors',
    nav_nonfunctional: 'Non-functional',
    nav_questions: 'Open Questions',
    nav_evidence: 'Evidence',
    search_placeholder: 'Search APIs, modules, evidence...',
    expand_all: 'Expand all',
    collapse_all: 'Collapse all',
    questions_only: 'Questions only',
    show_all_sections: 'Show all sections',
    no_results: 'No matching content found.',
    heading_summary: 'Executive Summary',
    heading_architecture: 'System Architecture',
    heading_interfaces: 'Interface Inventory',
    heading_requirements: 'Requirement Cards',
    heading_flows: 'Core Flows',
    heading_domain: 'Domain Model And Data Ownership',
    heading_security: 'Permissions, Security, And Compliance',
    heading_errors: 'Error Handling And Edge Cases',
    heading_nonfunctional: 'Non-functional Requirements',
    heading_questions: 'Open Questions',
    heading_evidence: 'Source Evidence Index',
    pending_summary: 'Pending summary.',
    pending_architecture: 'Pending architecture map.',
    pending_interfaces: 'Pending interface inventory.',
    pending_requirements: 'Pending requirement cards.',
    pending_flows: 'Pending flow diagrams.',
    pending_domain: 'Pending domain model and data ownership.',
    pending_security: 'Pending permissions, security, and compliance notes.',
    pending_errors: 'Pending error handling and edge cases.',
    pending_nonfunctional: 'Pending non-functional requirements.',
    pending_questions: 'Pending open questions.',
    pending_evidence: 'Pending evidence index.',
    back_to_top: 'Back to top'
  },
  zh: {
    html_lang: 'zh-CN',
    title: '项目需求报告',
    meta_workspace: '工作区',
    meta_date: '日期',
    meta_generated: '生成时间',
    nav_label: '报告章节',
    nav_summary: '摘要',
    nav_architecture: '系统架构',
    nav_interfaces: '接口清单',
    nav_requirements: '需求卡片',
    nav_flows: '核心流程',
    nav_domain: '领域模型',
    nav_security: '权限与安全',
    nav_errors: '异常与边界',
    nav_nonfunctional: '非功能需求',
    nav_questions: '开放问题',
    nav_evidence: '证据索引',
    search_placeholder: '搜索 API、模块、证据...',
    expand_all: '全部展开',
    collapse_all: '全部收起',
    questions_only: '仅看问题',
    show_all_sections: '显示全部章节',
    no_results: '未找到匹配内容。',
    heading_summary: '执行摘要',
    heading_architecture: '系统架构',
    heading_interfaces: '接口清单',
    heading_requirements: '需求卡片',
    heading_flows: '核心流程',
    heading_domain: '领域模型与数据归属',
    heading_security: '权限、安全与合规',
    heading_errors: '异常处理与边界情况',
    heading_nonfunctional: '非功能需求',
    heading_questions: '开放问题',
    heading_evidence: '源码证据索引',
    pending_summary: '等待填写摘要。',
    pending_architecture: '等待填写架构图。',
    pending_interfaces: '等待填写接口清单。',
    pending_requirements: '等待填写需求卡片。',
    pending_flows: '等待填写流程图。',
    pending_domain: '等待填写领域模型与数据归属。',
    pending_security: '等待填写权限、安全与合规说明。',
    pending_errors: '等待填写异常处理与边界情况。',
    pending_nonfunctional: '等待填写非功能需求。',
    pending_questions: '等待填写开放问题。',
    pending_evidence: '等待填写证据索引。',
    back_to_top: '返回顶部'
  }
};
const PLAN_MEMORY_MARKERS = {
  findings: ['<!-- plan-findings-start -->', '<!-- plan-findings-end -->'],
  progress: ['<!-- plan-progress-start -->', '<!-- plan-progress-end -->']
};
export function getSubAgentRolePrompt(role) {
  if (role === 'planner') {
    return [
      'You are the planner in a multi-step agent pipeline.',
      'Your job: coordinate task allocation and delegate work to other roles. You do NOT inspect code or implement changes yourself.',
      'Read the plan file to understand the current state, then decide which role should execute the next task and what specific instruction to give them.',
      'Do not write implementation code, inspect code, or produce findings. Delegate those to the appropriate executor role.',
      'Output format — keep it short and direct:',
      'Delegation:',
      '- <delegate to which role with what instruction>',
      'Blockers:',
      '- <dependencies or issues preventing progress or "none">',
      'Status:',
      '- <current pipeline state summary>',
      'Do not summarize your own work or add closing remarks — just deliver the structured delegation and stop.'
    ].join('\n');
  }
  if (role === 'explorer') {
    return [
      'You are the explorer in a multi-step agent pipeline.',
      'Your job: inspect the codebase to gather context, map the target area, and identify constraints and dependencies for downstream steps.',
      'The high-level plan is already defined — your role is to ground it with real codebase evidence.',
      'You are read-only in this harness: use read/search tools only. Do not edit, write, apply_patch, delete, or run commands, and do not write implementation code even if the step title sounds like implementation.',
      'Output format — keep it short and direct:',
      'Findings:',
      '- <important constraint, dependency, file layout, or "none">',
      'Actions Taken:',
      '- <what you inspected, files read, searches performed>',
      'Map:',
      '- <key files, entry points, dependency graph or "none">',
      'Open Issues:',
      '- <blocking uncertainty or "none">',
      'Handoff:',
      '- <evidence, paths, and constraints downstream steps should use>',
      'Do not summarize your own work or add closing remarks — just deliver the structured handoff and stop.',
      'IMPORTANT: Stop as soon as you have enough context. Do NOT keep exploring — deliver it immediately.'
    ].join('\n');
  }
  if (role === 'architect') {
    return [
      'You are the architect in a multi-step agent pipeline.',
      'Your job: make high-level design decisions about system structure, component boundaries, patterns, and tradeoffs.',
      'Decide on architecture, not implementation details. Do not write code, edit files, or inspect implementation beyond what is necessary to understand structure.',
      'Output format — keep it short and direct:',
      'Design Decision:',
      '- <chosen architecture, pattern, or approach>',
      'Alternatives Considered:',
      '- <rejected approaches and why>',
      'Component Map:',
      '- <new or changed components, their responsibilities>',
      'Risks:',
      '- <architectural risks, migration path concerns or "none">',
      'Constraints:',
      '- <non-negotiable limits or "none">',
      'Handoff:',
      '- <design decision and constraints downstream steps should follow>',
      'Do not summarize your own work or add closing remarks — just deliver the design decision and stop.'
    ].join('\n');
  }
  if (role === 'refactorer') {
    return [
      'You are the refactorer in a multi-step agent pipeline.',
      'Your job: restructure existing code to improve clarity, maintainability, or performance WITHOUT changing external behavior.',
      'You may touch many files, but every change must preserve existing behavior. Do not add features or fix bugs unless explicitly asked.',
      'Before starting, verify you understand the current behavior so you can prove nothing changed.',
      'Output format — keep it short and direct:',
      'Under Actions Taken, the first bullet MUST be a one-sentence overview suitable for collapsed handoff preview; follow with concrete file/action bullets.',
      'Actions Taken:',
      '- <one-sentence overview of the refactor completed>',
      '- <files restructured, patterns applied>',
      'Findings:',
      '- <important structural issue addressed or "none">',
      'Verified:',
      '- <how you confirmed behavior is preserved>',
      'Open Issues:',
      '- <remaining structural debt or "none">',
      'Artifacts:',
      '- <changed file paths>',
      'Handoff:',
      '- <what the next step should use from this work>',
      'Do not summarize your own work or add closing remarks — just deliver the structured handoff and stop.'
    ].join('\n');
  }
  if (role === 'writer') {
    return [
      'You are the writer in a multi-step agent pipeline.',
      'Your job: generate documentation, README files, API docs, changelogs, or code comments.',
      'Do not modify implementation code. Only write documentation files and comments.',
      'Output format — keep it short and direct:',
      'Under Actions Taken, the first bullet MUST be a one-sentence overview suitable for collapsed handoff preview; follow with concrete file/action bullets.',
      'Actions Taken:',
      '- <one-sentence overview of the documentation change>',
      '- <what documentation was written or updated>',
      'Artifacts:',
      '- <created or changed file paths>',
      'Handoff:',
      '- <what downstream steps should use from this documentation work>',
      'Coverage:',
      '- <what is documented and what gaps remain>',
      'Do not add a closing summary — the pipeline handles what comes next.'
    ].join('\n');
  }
  if (role === 'reviewer') {
    return [
      'You are the reviewer in a multi-step agent pipeline.',
      'Focus on bugs, regressions, edge cases, and missing tests in the files handed to you.',
      'Do not roam unrelated parts of the repo unless the handed-off evidence is insufficient.',
      'Output format — keep it short and direct:',
      'Findings:',
      '- <bug, regression, risk, or "none">',
      'Verified:',
      '- <what you checked>',
      'Not Verified:',
      '- <what remains uncertain>',
      'Handoff:',
      '- <findings and files the next step should act on>',
      'Do not add a closing summary or "Next Action" — the pipeline handles what comes next.'
    ].join('\n');
  }
  if (role === 'advisor') {
    return [
      'You are the advisor in a multi-step agent pipeline.',
      'Your job: analyze the handed-off context and produce recommendations, tradeoffs, and evidence.',
      'Do not edit files, write code, delete files, or run commands.',
      'Output format — keep it short and direct:',
      'Findings:',
      '- <important observation, constraint, or "none">',
      'Recommendations:',
      '- <prioritized recommendation or "none">',
      'Tradeoffs:',
      '- <important tradeoff or "none">',
      'Evidence:',
      '- <files, docs, or observations checked>',
      'Open Questions:',
      '- <blocking uncertainty or "none">',
      'Handoff:',
      '- <recommendation, evidence, and constraints downstream steps should use>',
      'Do not summarize your own work or add closing remarks — just deliver the structured advisory handoff and stop.'
    ].join('\n');
  }
  if (role === 'tester') {
    return [
      'You are the tester in a multi-step agent pipeline.',
      'Run concrete verification commands. Prefer real execution over suggestions.',
      'Verify the handed-off files first before scanning wider.',
      'Output format — keep it short and direct:',
      'Verified:',
      '- <commands run and evidence>',
      'Not Verified:',
      '- <what could not be validated>',
      'Failures:',
      '- <failed command or "none">',
      'Handoff:',
      '- <verification evidence, failures, and unverified items for the summarizer>',
      'Do not add a closing summary or "Next Action" — the pipeline handles what comes next.'
    ].join('\n');
  }
  if (role === 'debugger') {
    return [
      'You are the debugger in a multi-step agent pipeline.',
      'Your job: investigate reported bugs, errors, or unexpected behavior. Reproduce the issue, trace root causes, and narrow down the culprit code.',
      'Do not implement fixes. You may suggest a fix approach as a recommendation, but leave the implementation to the coder.',
      'Prefer concrete evidence over speculation. Run reproduction commands where possible.',
      'Output format — keep it short and direct:',
      'Findings:',
      '- <root cause hypothesis or confirmed cause>',
      'Evidence:',
      '- <logs, stack traces, reproduction steps, file evidence>',
      'Narrowed Scope:',
      '- <likely culprit files, functions, or code sections>',
      'Recommendations:',
      '- <suggested fix approach, risk level, or "none">',
      'Open Questions:',
      '- <remaining uncertainty or "none">',
      'Handoff:',
      '- <root cause evidence, narrowed scope, and recommended fix path>',
      'Do not add a closing summary or "Next Action" — the pipeline handles what comes next.'
    ].join('\n');
  }
  if (role === 'summarizer') {
    return [
      'You are the summarizer in a multi-step agent pipeline.',
      'Your job is to synthesize the results of all prior steps into a concise, actionable final summary.',
      'Primary input: the accumulated plan file context and handoff packets already included in your task.',
      'Do NOT browse the codebase. Your only tools are read, tool_search, and skill.',
      'Do NOT call list, grep, run, edit, write, apply_patch, delete, or any other tool — they are unavailable and will fail.',
      'Use read ONLY when you have a specific artifact path from handoff/context that is not already covered in the plan file.',
      'If the plan file and handoff evidence are sufficient, produce the summary without any tool calls.',
      'Output format — keep it short and direct:',
      'Summary:',
      '- <overall result in 2-4 sentences>',
      'Step Recap:',
      '- [<role>] <step title>: <1 short sentence covering the agent action and outcome>',
      'Key Findings:',
      '- <most important findings from all steps>',
      'Actions Taken:',
      '- <what was implemented/changed/verified>',
      'Remaining Issues:',
      '- <unresolved items or "none">',
      'Recommended Next Steps:',
      '- <concrete follow-up actions if any>',
      'Do not add greetings, filler, or restate the goal. Deliver the summary and stop.'
    ].join('\n');
  }
  const key = String(role || '').trim().toLowerCase();
  if (!ROLE_TOOL_POLICY[key]) {
    return getSubAgentPersonaPrompt(role);
  }
  return [
    'You are the coder in a multi-step agent pipeline.',
    'Produce practical code changes with minimal explanation.',
    'Your step owns implementation only. Do NOT run tests, builds, installs, or dev servers to verify your work — the tester step or user handles verification unless this step task explicitly requires a command to complete the edit.',
    'When code edits are done, finish immediately with the handoff below. Do not loop on blocked or declined run commands.',
    'Output format — keep it short and direct:',
    'Under Actions Taken, the first bullet MUST be a one-sentence overview suitable for collapsed handoff preview; follow with concrete file/action bullets.',
    'Actions Taken:',
    '- <one-sentence overview of what was changed>',
    '- <file changes, commands, or "none">',
    'Findings:',
    '- <important implementation note, regression risk, or "none">',
    'Verified:',
    '- none (verification deferred to tester/user)',
    'Open Issues:',
    '- <remaining gap or "none">',
    'Artifacts:',
    '- <changed file path or "none">',
    'Handoff:',
    '- <what the next step should use from this implementation>',
    'Next Action:',
    '- hand off to tester or user for verification',
    'Do not summarize the goal, recap the plan, or add closing remarks.'
  ].join('\n');
}

function buildPipelineStepGuidance({ role, stepIndex, totalSteps, isFirst, isLast, priorSteps, isRetry = false, previousError = '' }) {
  const lines = [];
  lines.push(`Pipeline position: step ${stepIndex + 1} of ${totalSteps}.`);
  if (isRetry) {
    lines.push('RETRY ATTEMPT: The previous attempt at this step failed. Review the failure reason below and adjust your approach.');
    if (previousError) {
      lines.push(`Previous failure: ${previousError}`);
    }
    lines.push('Focus narrowly on fixing the specific issue that caused the failure. Do not start over from scratch.');
    if (role === 'coder' || role === 'refactorer' || role === 'writer') {
      lines.push('Your final message MUST use this exact handoff format. Under Actions Taken, the first bullet MUST be a one-sentence overview suitable for collapsed handoff preview; follow with concrete file/action bullets:');
      lines.push('Actions Taken:');
      lines.push('- <one-sentence overview of what changed>');
      lines.push('- <concrete edits, commands, or file operations performed>');
      lines.push('Artifacts:');
      lines.push('- <each created or changed file path>');
      lines.push('Handoff:');
      lines.push('- <what the next step should use from this work>');
      lines.push('End with this structured handoff even if work is already done; do not finish with todos-only updates or a prose summary.');
    }
  }
  if (isFirst && !isRetry) {
    if (role === 'explorer') {
      lines.push('You are the first step. Map the codebase area quickly and report findings so downstream steps have solid context.');
    } else if (role === 'architect') {
      lines.push('You are the first step. Make concrete design decisions to shape the rest of the pipeline.');
    } else {
      lines.push('You are the first step. Your output sets direction for the rest of the pipeline.');
    }
  } else if (isLast) {
    lines.push('You are the final step. After you, the pipeline will present a combined result to the user.');
  } else if (!isRetry) {
    lines.push('You are in the middle of the pipeline. Your output feeds into the next step.');
  }
  if (priorSteps.length > 0) {
    const prev = priorSteps[priorSteps.length - 1];
    if (prev.failed) {
      lines.push(`Previous step [${prev.role}]: ${prev.title} FAILED with: ${prev.failureReason || 'unknown error'}. Continue with best-effort context.`);
    } else {
      lines.push(`Previous step was [${prev.role}]: ${prev.title}. Use its output as your starting point.`);
    }
  }
  lines.push('Style rules:');
  lines.push('- Be direct and action-oriented. No greetings, no summaries, no "In conclusion" or "To summarize".');
  lines.push('- Treat the Findings Ledger and Progress Ledger in the plan file context as the shared working memory for this pipeline.');
  lines.push('- If you discover something new, record it under the requested headings instead of burying it in prose.');
  lines.push('- Continue the established direction unless you have concrete contradictory evidence.');
  lines.push('- Output only what the next step needs to know. Skip obvious observations.');
  if (role !== 'summarizer') {
    lines.push('- Do not produce a final overall summary; the final summarizer step owns synthesis.');
  }
  if (role === 'coder' || role === 'refactorer' || role === 'writer') {
    lines.push('- Do not treat missing runtime verification as unfinished implementation. Finish once edits are done and defer checks to tester/user.');
  }
  if (isLast && role === 'summarizer') {
    lines.push('- Since you are the final step, give a concise overall verdict the user can act on.');
    lines.push('- Include a Step Recap section with one short bullet per completed sub-agent step so future normal chat has compact plan context.');
  }
  return lines.join('\n');
}

function extractTaskKeywords(task) {
  const text = String(task || '').toLowerCase();
  const tokens = text.match(/[a-z0-9_./:-]{3,}|[\u4e00-\u9fa5]{2,}/g) || [];
  const stop = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'task',
    'please', 'update', 'change', 'fix', 'implement', 'review', 'test'
  ]);
  return [...new Set(tokens.filter((token) => !stop.has(token)))].slice(0, 24);
}

function scoreMessageForTask(message, keywords) {
  if (!keywords.length) return 0;
  const text = String(message?.content || '').toLowerCase();
  if (!text) return 0;
  let score = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) score += keyword.includes('/') || keyword.includes('.') ? 3 : 1;
  }
  return score;
}

function buildSubAgentContextPacket(session, task = '') {
  const source = Array.isArray(session?.messages) ? session.messages : [];
  const candidates = source
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
    .map((msg, index) => ({ msg, index }));
  if (candidates.length === 0) return '';
  const keywords = extractTaskKeywords(task);
  const recentStart = Math.max(0, candidates.length - SUB_AGENT_CONTEXT_MAX_MESSAGES);
  const ranked = candidates
    .map((item, order) => ({
      ...item,
      score: scoreMessageForTask(item.msg, keywords),
      recentScore: order >= recentStart ? 1 : 0
    }))
    .sort((a, b) => {
      const scoreDelta = (b.score + b.recentScore) - (a.score + a.recentScore);
      if (scoreDelta !== 0) return scoreDelta;
      return b.index - a.index;
    })
    .slice(0, SUB_AGENT_CONTEXT_MAX_MESSAGES)
    .sort((a, b) => a.index - b.index);

  const lines = [];
  let usedChars = 0;
  for (const { msg } of ranked) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const text = trimInline(msg.content, 260);
    if (!text) continue;
    const line = `- ${role}: ${text}`;
    if (usedChars + line.length > SUB_AGENT_CONTEXT_MAX_CHARS) break;
    lines.push(line);
    usedChars += line.length;
  }
  if (lines.length === 0) return '';
  return [
    'Scoped parent context (task-relevant snippets, not full history):',
    ...lines,
    'Use this context only if it helps the current task.'
  ].join('\n');
}

function maybePushEvidence(out, seen, filePath, summary) {
  const pathText = trimInline(filePath, 160);
  const summaryText = trimInline(summary, 200);
  if (!pathText || seen.has(pathText)) return;
  seen.add(pathText);
  out.push(`- ${pathText}${summaryText ? ` :: ${summaryText}` : ''}`);
}

function extractEvidenceFromToolMessage(rawContent, out, seen) {
  if (!rawContent) return;
  let parsed = null;
  try {
    parsed = JSON.parse(String(rawContent));
  } catch {}

  if (parsed && typeof parsed === 'object') {
    if (parsed.path) {
      const summary = parsed.content || parsed.diff_preview || parsed.stdout || parsed.next || '';
      maybePushEvidence(out, seen, parsed.path, summary);
    }
    const stdout = typeof parsed.stdout === 'string' ? parsed.stdout : '';
    const stderr = typeof parsed.stderr === 'string' ? parsed.stderr : '';
    const merged = `${stdout}\n${stderr}`.trim();
    const matches = merged.matchAll(/(?:^|\s)([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_]+):\d+(?::\d+)?/g);
    for (const match of matches) {
      if (out.length >= SUB_AGENT_EVIDENCE_MAX_ITEMS) break;
      maybePushEvidence(out, seen, match[1], merged);
    }
    return;
  }

  const text = String(rawContent || '');
  const matches = text.matchAll(/(?:^|\s)([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_]+):\d+(?::\d+)?/g);
  for (const match of matches) {
    if (out.length >= SUB_AGENT_EVIDENCE_MAX_ITEMS) break;
    maybePushEvidence(out, seen, match[1], text);
  }
}

function buildSubAgentEvidencePacket(session) {
  const source = Array.isArray(session?.messages) ? session.messages : [];
  const toolMessages = source.filter((msg) => msg && msg.role === 'tool').slice(-6).reverse();
  const lines = [];
  const seen = new Set();
  for (const msg of toolMessages) {
    extractEvidenceFromToolMessage(msg.content, lines, seen);
    if (lines.length >= SUB_AGENT_EVIDENCE_MAX_ITEMS) break;
  }
  if (lines.length === 0) return '';
  return ['Scoped file evidence (recent tool outputs only):', ...lines].join('\n');
}

function registerSubAgentArtifactPath(pathValue, out, seen) {
  const value = String(pathValue || '').trim().replace(/\\/g, '/');
  if (!value || seen.has(value)) return;
  seen.add(value);
  out.push(value);
}

function extractPathFromToolArguments(toolName, args = {}) {
  const name = String(toolName || '').toLowerCase();
  if (!['edit', 'create', 'write', 'commit_write', 'apply_patch', 'delete'].includes(name)) return '';
  return String(
    args.path ||
    args.file_path ||
    ''
  ).trim();
}

function normalizeArtifactFileChanges(changes) {
  if (!changes) return [];
  return (Array.isArray(changes) ? changes : [changes]).filter((item) => item && typeof item === 'object');
}

function collectSubAgentArtifactsFromEvent(evt, out, seen) {
  const type = String(evt?.type || '');
  if (type === 'tool:end') {
    registerSubAgentArtifactPath(evt?.fileChange?.path, out, seen);
    for (const change of normalizeArtifactFileChanges(evt?.fileChanges)) {
      registerSubAgentArtifactPath(change?.path, out, seen);
    }
    return;
  }
  if (type !== 'tool:result' || evt?.error || evt?.blocked) return;

  const content = String(evt.content || '');
  if (!content) return;

  try {
    const parsed = JSON.parse(content);
    registerSubAgentArtifactPath(parsed?.path, out, seen);
    if (typeof parsed?.stdout === 'string') {
      extractLikelyPathsFromText(parsed.stdout, out, seen);
    }
  } catch {
    extractLikelyPathsFromText(content, out, seen);
  }

  registerSubAgentArtifactPath(
    extractPathFromToolArguments(evt?.name, evt?.arguments),
    out,
    seen
  );
}

function collectSubAgentArtifactsFromMessages(messages, out, seen) {
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (msg?.role !== 'tool') continue;
    if (msg.tool_status === 'error' || msg.tool_status === 'blocked') continue;
    registerSubAgentArtifactPath(msg?.tool_file_change?.path, out, seen);
    for (const change of normalizeArtifactFileChanges(msg?.tool_file_changes)) {
      registerSubAgentArtifactPath(change?.path, out, seen);
    }
    extractLikelyPathsFromText(msg?.content, out, seen);
  }
}

function extractLikelyPathsFromText(rawText, out, seen) {
  const text = String(rawText || '');
  if (!text) return;
  const matches = text.matchAll(
    /(?:^|[\s("'`])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+|[A-Za-z0-9_.-]+\.[A-Za-z0-9_]+)(?=$|[\s)"'`:,`])/g
  );
  for (const match of matches) {
    const value = String(match[1] || '').replace(/\/+$/, '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= SUB_AGENT_HANDOFF_MAX_ITEMS) break;
  }
}

function summarizeStepOutput(step) {
  const text = trimInline(step?.output || step?.task || '', 800);
  return text || 'No concise output captured.';
}

function collectStepArtifacts(runItems, role) {
  if (!Array.isArray(runItems) || runItems.length === 0) return '';

  const relevantSteps =
    role === 'reviewer' || role === 'tester'
      ? runItems.filter((step) => step && !step.failed && step.role !== 'reviewer' && step.role !== 'tester')
      : runItems.filter((step) => step && !step.failed);
  if (relevantSteps.length === 0) return '';

  const focusPaths = [];
  const seenPaths = new Set();
  const summaries = [];

  for (const step of relevantSteps.slice(-4)) {
    if (Array.isArray(step.artifactPaths)) {
      for (const artifactPath of step.artifactPaths) {
        if (!artifactPath || seenPaths.has(artifactPath)) continue;
        seenPaths.add(artifactPath);
        focusPaths.push(artifactPath);
        if (focusPaths.length >= SUB_AGENT_HANDOFF_MAX_ITEMS) break;
      }
    }
    extractLikelyPathsFromText(step.output, focusPaths, seenPaths);
    const summary = summarizeStepOutput(step);
    summaries.push(`- [${step.role}] ${step.title}: ${summary}`);
    if (focusPaths.length >= SUB_AGENT_HANDOFF_MAX_ITEMS && summaries.length >= 3) break;
  }

  return { focusPaths, summaries };
}

function buildStepArtifactPacket(runItems, role) {
  if (role === 'reviewer' || role === 'tester') {
    return buildCleanContextHandoff(runItems, role);
  }
  const collected = collectStepArtifacts(runItems, role);
  if (!collected) return '';
  const { focusPaths, summaries } = collected;

  if (focusPaths.length === 0 && summaries.length === 0) return '';

  const lines = ['Implementation handoff from earlier plan steps:'];
  if (focusPaths.length > 0) {
    lines.push('Focus paths first:');
    for (const value of focusPaths.slice(0, SUB_AGENT_HANDOFF_MAX_ITEMS)) {
      lines.push(`- ${value}`);
    }
  }
  if (summaries.length > 0) {
    lines.push('Prior step summaries:');
    lines.push(...summaries.slice(-3));
  }
  return lines.join('\n');
}

function buildFocusedTaskNote(role, focusPaths) {
  if (!Array.isArray(focusPaths) || focusPaths.length === 0) return '';
  const head = focusPaths.slice(0, 4).join(', ');
  if (role === 'reviewer') {
    return `Focus review on these artifacts first: ${head}. Only inspect unrelated repo areas if these artifacts do not provide enough evidence.`;
  }
  if (role === 'tester') {
    return `Focus verification on these artifacts first: ${head}. Prefer commands and reads that directly validate these paths before wider repo exploration.`;
  }
  return '';
}

function normalizeGoalClauseText(value) {
  return String(value || '')
    .replace(/^[\s\-*0-9.)、，,:;]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceCaseRequirement(value) {
  const text = normalizeGoalClauseText(value);
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function deriveGoalRequirements(goal) {
  const rawGoal = String(goal || '').trim();
  if (!rawGoal) return [];

  const normalized = rawGoal
    .replace(/\r\n?/g, '\n')
    .replace(/[；。]/g, ',')
    .replace(/\band then\b/gi, ',')
    .replace(/\bthen\b/gi, ',')
    .replace(/\bplus\b/gi, ',')
    .replace(/\s+(?:and|并且|而且|以及)\s+/gi, ', ')
    .replace(/\n+/g, ', ');

  const roughParts = normalized
    .split(/\s*,\s*/)
    .map((part) => normalizeGoalClauseText(part))
    .filter(Boolean);

  const requirements = [];
  const seen = new Set();

  for (const part of roughParts) {
    const lowered = part.toLowerCase();
    if (/\btrim\b/.test(lowered) && !/\bwhitespace\b/.test(lowered)) {
      const label = 'Trim whitespace in the returned greeting';
      if (!seen.has(label)) {
        seen.add(label);
        requirements.push(label);
      }
      continue;
    }
    if (/\btrim\b/.test(lowered) && /\bwhitespace\b/.test(lowered)) {
      const label = 'Trim whitespace in the returned greeting';
      if (!seen.has(label)) {
        seen.add(label);
        requirements.push(label);
      }
      continue;
    }
    if (/(exclamation mark|感叹号|!)/i.test(part)) {
      const label = 'Preserve the exclamation mark';
      if (!seen.has(label)) {
        seen.add(label);
        requirements.push(label);
      }
      continue;
    }
    const label = sentenceCaseRequirement(part);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    requirements.push(label);
  }

  if (requirements.length === 0) {
    return [sentenceCaseRequirement(rawGoal)].filter(Boolean);
  }
  return requirements.slice(0, 6);
}

function isLightweightAutoPlanGoal(goal, requirements = []) {
  const text = String(goal || '').trim();
  if (!text) return false;
  if (requirements.length !== 1) return false;
  if (text.length > 140) return false;
  if (/\b(plan|spec|design|architecture|roadmap|strategy|migration|refactor)\b/i.test(text)) return false;
  if (/\b(ensure|verify|review|test|validate|make sure|confirm)\b/i.test(text)) return false;
  if (/[；。]/.test(text)) return false;
  return /\b(add|update|fix|rename|trim|export|create|remove|change|implement)\b/i.test(text);
}

export function classifyPlanTaskClass(goal = '') {
  const text = String(goal || '').trim();
  const lowerGoal = text.toLowerCase();
  const advisory =
    /\b(analyze|analysis|review|audit|inspect|assess|recommend|recommendation|optimization|optimize|improve|suggest|brainstorm|plan|feedback|understand|explain)\b/i.test(lowerGoal) ||
    /(分析|审查|审计|检查|评估|建议|优化|改进|规划|方案|看一下|看看|有哪些问题|有什么问题|了解下|解释)/.test(text);
  const implementation =
    /\b(add|build|create|implement|support|introduce|refactor|rewrite|rework|migrate|change|update|fix)\b/i.test(lowerGoal) ||
    /(新增|增加|实现|支持|重构|重写|改造|迁移|修改|更新|修复)/.test(text);
  const explicitFixIntent =
    /\b(start\s+(?:fixing|repairing)|fix(?:\s+it|\s+them|\s+this|\s+these)?|repair|resolve|address)\b/i.test(lowerGoal) ||
    /(开始修复|修复|修一下|改一下|改掉|处理掉|解决)/.test(text);
  const verificationHeavy =
    /\b(test|verify|validation|validate|prove|confirm|reproduce|check coverage)\b/i.test(lowerGoal) ||
    /(测试|验证|校验|确认|复现|覆盖率)/.test(text);
  const debugging =
    /\b(debug|diagnose|troubleshoot|investigate|trace|bisect|find.*cause|root.*cause|why.*error|why.*bug|why.*fail|crash|exception|stack trace|logs?.*error)\b/i.test(lowerGoal) ||
    /(调试|排查|诊断|追踪|调查|找.*原因|怎么.*错|怎么.*崩|报错|异常|日志)/.test(text);

  if (debugging && verificationHeavy) return 'verification-heavy';
  if (debugging) return 'debugging';
  if (verificationHeavy) return 'verification-heavy';
  if (advisory && implementation) {
    const explicitHybrid =
      /\b(analyze\s+and|review\s+and|audit\s+and|assess\s+and|investigate\s+and\s+(fix|implement)|fix\s+after\s+(analysis|review))\b/i.test(lowerGoal) ||
      /(先分析.*再|分析.*并.*(实现|修复|改)|审查.*并.*(改|修|实现)|评估.*后.*(实现|改))/.test(text);
    if (explicitHybrid || explicitFixIntent) return 'implementation-advisory';
    return 'implementation-advisory';
  }
  if (implementation) return verificationHeavy ? 'implementation-verification' : 'implementation';
  if (advisory) return 'advisory';
  return 'implementation';
}

function buildGoalRequirementPacket(goal, role) {
  const rawGoal = trimInline(goal, 800);
  if (!rawGoal) return '';
  const requirements = deriveGoalRequirements(goal);
  const lines = ['Original goal:', rawGoal];
  if (requirements.length > 0) {
    lines.push('Acceptance checklist:');
    for (const requirement of requirements) {
      lines.push(`- ${requirement}`);
    }
  }
  if (role === 'reviewer') {
    lines.push('Review against the original goal, not just local code quality.');
    lines.push('Check each acceptance item explicitly before deciding there are no findings.');
    lines.push('If any requested behavior is missing, incorrect, or only partially implemented, report it in Findings.');
  } else if (role === 'tester') {
    lines.push('Verify the implementation against the original goal, not just syntax or smoke checks.');
    lines.push('Check each acceptance item explicitly before calling the work verified.');
    lines.push('If any requested behavior is unverified or contradicted by evidence, list it under Not Verified or Failures.');
  } else if (role === 'advisor') {
    lines.push('Advise against the acceptance checklist and original goal, not generic best practices.');
    lines.push('Prioritize concrete recommendations, evidence, and tradeoffs. Do not implement changes.');
  } else if (role === 'coder') {
    lines.push('Implement against the acceptance checklist, not only the broad wording of the goal.');
  }
  return lines.join('\n');
}

function buildAutoPlanPlannerGuidance() {
  return [
    'Design a short execution plan for a small model.',
    'Auto-plan planning rules:',
    '- Start with an explorer (codebase inspection) or architect (design) step when the target area is not yet clear.',
    '- Before defining execution steps, map the files/modules likely to be touched and what each step is responsible for.',
    '- Before writing steps, classify task_size (trivial|small|medium|large), task_type (advisory|implementation|debugging|verification|refactor|documentation|hybrid), and target_confidence (known|likely|unknown).',
    '- If the goal still leaves room for multiple approaches, choose one practical direction before planning execution.',
    '- Prefer the smallest local approach that satisfies the goal.',
    '- Do not output multiple alternative branches in the final plan.',
    '- Do not assume implementation should begin before the plan is coherent.',
    '- Make steps concrete enough to execute without guessing: include target files, expected behavior, and verification intent when known.',
    '- Each step must satisfy this contract: target files/modules when known, inputs it consumes, outputs it produces, expected outcome, out-of-scope boundaries, success criteria, verification intent, and handoff artifact.',
    '- Prefer filling structured fields consumes, produces, target_files, success_criteria, verification, and handoff when returning JSON.',
    '- Fold setup, fixtures, test updates, and documentation into the task whose deliverable needs them unless they are independently reviewable deliverables.',
    '- Do not create standalone "write tests", "update docs", or "setup fixtures" steps when they only support another implementation task.',
    '- Do not create placeholder steps such as "add validation", "handle edge cases", "write tests", or "finish implementation" unless they name the exact behavior or command.',
    '- Decompose work into independently understandable tasks; each task should have a clear responsibility and produce testable progress.',
    '- Each task should be small enough that a reviewer can accept or reject it independently.',
    '- Prefer small, focused file boundaries when the plan creates or reorganizes code, while respecting existing project patterns.',
    '- If a step changes behavior, include how that behavior should be tested or manually verified.',
    '- Keep type names, function names, command names, and file paths consistent across all steps.',
    '- Before returning the plan, self-review it for requirement coverage, placeholders, contradictions, untestable tasks, missing consumes/produces handoffs, and inconsistent API/type names.',
    '- If the plan has critical gaps or unclear requirements, create an explorer/advisor step to resolve them before implementation.',
    '- If target_confidence is known, do not add explorer unless code context is genuinely missing.',
    '- If task_size is trivial or small and target_confidence is known, prefer a single coder step plus summarizer, or direct implementation without create_plan when possible.',
    '- Add reviewer only when there is meaningful regression or edge-case risk.',
    '- Add tester only when there is a concrete command or user-visible behavior to verify.',
    '- Never add roles just to fill a template.',
    '- Available sub-agent roles: explorer, architect, advisor, coder, refactorer, reviewer, tester, debugger, writer, and summarizer. Use only the roles the task actually needs.',
    '- Always include a summarizer as the final step. The summarizer reads accumulated step results and synthesizes the final summary. It does NOT re-analyze or run tools.',
    '- Do not ask executor steps (explorer, architect, advisor, coder, refactorer, reviewer, tester, debugger, writer) to produce the final summary. They write detailed step results for the summarizer.',
    '- Role quick-guide:',
    '  • explorer = inspect codebase, map files, gather context before implementation. Never assign explorer to edit files, implement features, or write production code.',
    '  • architect = make design decisions, choose patterns, define component boundaries. Never assign architect to implement code.',
    '  • advisor = analyze and recommend (read-only). Never assign advisor to implement code.',
    '  • coder = implement scoped code changes.',
    '  • refactorer = restructure code without changing behavior (broader scope than coder).',
    '  • reviewer = check for bugs, regressions, edge cases.',
    '  • tester = run verification commands.',
    '  • debugger = investigate bugs, trace root causes, recommend fixes.',
    '  • writer = generate documentation, README, comments.',
    '- For debugging tasks: explorer -> debugger -> coder -> tester -> summarizer.',
    '- For architecture/design tasks: explorer -> architect -> summarizer.',
    '- For refactoring tasks: explorer -> refactorer -> tester -> summarizer.',
    '- For implementation: explorer -> coder -> reviewer -> tester -> summarizer.',
    '- For documentation: explorer -> writer -> summarizer.',
    '- For advisory: explorer -> advisor -> summarizer.',
    '- Prefer 3-5 steps total unless the task needs more.',
    '- Keep the plan ordered, task-oriented, and easy for small sub-agents to follow.',
    '- Step task text should be a complete sub-agent work order: Inputs from prior steps, Scope, Out of scope, Success evidence, Verification intent, Produced outputs, and Handoff to next step.'
  ].join('\n');
}

function buildAutoPlanExecutionGuidance(role) {
  const common = [
    'Auto-plan execution rules:',
    '- Review the approved step before acting. If it is contradictory, impossible, or missing critical context, stop and report the blocker instead of guessing.',
    '- Work in the smallest useful step.',
    '- Read the target code before editing.',
    '- Prefer local changes over broad refactors.',
    '- Follow the approved direction unless concrete evidence shows it is wrong.',
    '- Prefer narrow verification with concrete evidence before claiming success.',
    '- If verification fails repeatedly, stop with the failing command and observed output instead of forcing through more changes.'
  ];

  if (role === 'explorer') {
    common.push('- Map the target area quickly and stop. Do not go down rabbit holes.');
    common.push('- Report what IS there, not what SHOULD be there. Let the architect or advisor interpret.');
  } else if (role === 'architect') {
    common.push('- Make decisive, concrete design choices. Do not present options without choosing.');
    common.push('- Ground decisions in the explorer findings. If the explorer map is insufficient, say so.');
  } else if (role === 'coder') {
    common.push('- Keep edits tightly scoped to the chosen plan direction.');
    common.push('- Avoid speculative cleanup or unrelated improvements.');
    common.push('- Do not run tests, builds, or dev servers to finish your step. Verification belongs to the tester step or the user.');
    common.push('- If a run command is blocked or declined, treat implementation as complete and note verification was deferred.');
  } else if (role === 'refactorer') {
    common.push('- Preserve external behavior exactly. Prefer static reasoning and targeted reads over broad test runs.');
    common.push('- Prefer safe transformations: extract function, rename, move, simplify conditionals.');
    common.push('- Do not add features or fix bugs unless the goal explicitly asks for it.');
  } else if (role === 'advisor') {
    common.push('- Produce advisory findings and recommendations only; do not modify files or run commands.');
    common.push('- Ground every recommendation in inspected evidence or mark it as an assumption.');
  } else if (role === 'reviewer') {
    common.push('- Review against the chosen plan direction and the acceptance checklist.');
    common.push('- Call out missing requested behavior, regression risk, and unverified claims.');
  } else if (role === 'tester') {
    common.push('- Prefer running the narrowest real verification command that matches the changed area.');
    common.push('- Distinguish clearly between verified behavior and assumptions.');
  } else if (role === 'debugger') {
    common.push('- Prioritize reproduction over speculation. Run the failing command or test first.');
    common.push('- Narrow down to specific files, functions, and conditions before suggesting a fix.');
    common.push('- Do not implement fixes. Leave implementation to the coder step that follows.');
  } else if (role === 'writer') {
    common.push('- Write clear, useful documentation. Prefer concrete examples over abstract descriptions.');
    common.push('- Do not modify code. Only write documentation files (.md, comments, docstrings).');
  }

  return common.join('\n');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(targetPath) {
  try {
    return JSON.parse(await fs.readFile(targetPath, 'utf8'));
  } catch {
    return null;
  }
}

function extractManagedPlanSection(content = '', key = 'findings') {
  const markers = PLAN_MEMORY_MARKERS[key];
  if (!markers) return '';
  const [startMarker, endMarker] = markers;
  const start = String(content || '').indexOf(startMarker);
  const end = String(content || '').indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) return '';
  return String(content || '')
    .slice(start + startMarker.length, end)
    .trim();
}

function replaceManagedPlanSection(content = '', key = 'findings', nextSection = '') {
  const markers = PLAN_MEMORY_MARKERS[key];
  if (!markers) return String(content || '');
  const [startMarker, endMarker] = markers;
  const sectionBody = `${startMarker}\n${String(nextSection || '').trim()}\n${endMarker}`;
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  if (pattern.test(String(content || ''))) {
    return String(content || '').replace(pattern, sectionBody);
  }
  return `${String(content || '').trimEnd()}\n\n${sectionBody}\n`;
}

function buildPlanReviewApprovalText(action, { feedback = '', via = 'coding mode' } = {}) {
  const stamp = new Date().toISOString();
  switch (action) {
    case 'approved':
      return `Execution ready at ${stamp} via ${via}.`;
    case 'executing':
      return `Execution started at ${stamp} via ${via}.`;
    case 'executed':
      return `Execution completed at ${stamp} via ${via}.`;
    case 'aborted':
      return `Execution aborted at ${stamp} via ${via}.`;
    case 'rejected':
      return `Rejected at ${stamp} via ${via}.`;
    case 'revised':
      return feedback
        ? `Revision requested at ${stamp} via ${via}: ${feedback}\nStatus: ready.`
        : `Revision requested at ${stamp} via ${via}.\nStatus: ready.`;
    case 'edited':
      return `Manually edited at ${stamp} via ${via}.\nStatus: ready.`;
    default:
      return `Review updated at ${stamp}.`;
  }
}

function buildPlanReviewProgressLine(action, { feedback = '' } = {}) {
  switch (action) {
    case 'approved':
      return '- Plan marked ready for execution.';
    case 'executing':
      return '- Plan execution started.';
    case 'executed':
      return '- Plan execution completed.';
    case 'aborted':
      return '- Plan execution aborted before completion.';
    case 'rejected':
      return '- Plan discarded.';
    case 'revised':
      return feedback
        ? `- User requested plan revisions: ${feedback}`
        : '- User requested plan revisions.';
    case 'edited':
      return '- User manually edited the plan.';
    default:
      return '';
  }
}

function replacePlanApprovalSection(content = '', approvalText = '') {
  const text = String(content || '');
  const header = '## Approval';
  const start = text.indexOf(header);
  if (start === -1) {
    return `${text.trimEnd()}\n\n${header}\n${String(approvalText || '').trim()}\n`;
  }
  const afterHeader = start + header.length;
  const rest = text.slice(afterHeader);
  const nextHeading = rest.search(/\n## /);
  const end = nextHeading === -1 ? text.length : afterHeader + nextHeading;
  return `${text.slice(0, afterHeader)}\n${String(approvalText || '').trim()}\n${text.slice(end)}`.replace(/\n{3,}/g, '\n\n');
}

async function readPlanApprovalSection(planFilePath) {
  const filePath = String(planFilePath || '').trim();
  if (!filePath) return '';
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const start = content.indexOf('## Approval');
    if (start === -1) return '';
    const rest = content.slice(start);
    const nextHeading = rest.search(/\n## /);
    return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  } catch {
    return '';
  }
}

async function writePlanReviewStatusToFile(planFilePath, action, { feedback = '', via = 'coding mode' } = {}) {
  const filePath = String(planFilePath || '').trim();
  if (!filePath || !action) return;
  try {
    let content = await fs.readFile(filePath, 'utf8');
    content = replacePlanApprovalSection(content, buildPlanReviewApprovalText(action, { feedback, via }));
    const progressLine = buildPlanReviewProgressLine(action, { feedback });
    if (progressLine) {
      const progressBlock = [
        ...extractManagedPlanSection(content, 'progress')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        progressLine
      ];
      content = replaceManagedPlanSection(
        content,
        'progress',
        normalizeLedgerItems(trimLedger(progressBlock, 12)).join('\n')
      );
    }
    await fs.writeFile(filePath, `${content.trimEnd()}\n`, 'utf8');
  } catch {
    // Non-fatal: plan file review status is best-effort
  }
}

async function recordPlanReviewStatus(planState, action, options = {}) {
  await writePlanReviewStatusToFile(planState?.filePath, action, options);
}

async function finalizeApprovedPlanFile(planState, result = {}) {
  const action = result?.aborted ? 'aborted' : 'executed';
  await writePlanReviewStatusToFile(planState?.filePath, action, { via: 'coding mode' });
}

function normalizeLedgerItems(items = [], fallback = '- None recorded yet.') {
  const cleaned = [...new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))];
  return cleaned.length > 0 ? cleaned : [fallback];
}

function trimLedger(items = [], maxItems = 10) {
  const cleaned = normalizeLedgerItems(items, '').filter(Boolean);
  return cleaned.slice(Math.max(0, cleaned.length - maxItems));
}

export function extractStepWorkingMemory(output = '', artifactPaths = []) {
  const findings = extractSectionBullets(output, 'Findings')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const actionsTaken = extractSectionBullets(output, 'Actions Taken')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const verified = extractSectionBullets(output, 'Verified')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const notVerified = extractSectionBullets(output, 'Not Verified')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const failures = extractSectionBullets(output, 'Failures')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const openIssues = extractSectionBullets(output, 'Open Issues')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const nextAction = extractSectionBullets(output, 'Next Action')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const artifactLines = [
    ...extractSectionBullets(output, 'Artifacts')
      .filter((item) => !/^none\b/i.test(item))
      .map((item) => `- ${item}`),
    ...(Array.isArray(artifactPaths) ? artifactPaths : []).filter(Boolean).map((item) => `- ${item}`)
  ];

  return {
    findings: trimLedger(findings, 8),
    actionsTaken: trimLedger(actionsTaken, 8),
    verified: trimLedger(verified, 6),
    notVerified: trimLedger(notVerified, 6),
    failures: trimLedger(failures, 6),
    openIssues: trimLedger(openIssues, 6),
    nextAction: trimLedger(nextAction, 3),
    artifacts: trimLedger(artifactLines, 6)
  };
}

function buildProgressLedgerEntry(stepIndex, stepTitle, role, memory) {
  const status = memory.failures.length > 0 || memory.openIssues.length > 0 || memory.notVerified.length > 0 ? 'attention-needed' : 'completed';
  const highlights = [
    memory.actionsTaken[0],
    memory.verified[0],
    memory.nextAction[0],
    memory.openIssues[0],
    memory.notVerified[0],
    memory.failures[0]
  ]
    .filter(Boolean)
    .map((item) => item.replace(/^- /, ''))
    .slice(0, 2);
  const suffix = highlights.length > 0 ? ` :: ${highlights.join(' | ')}` : '';
  return `- Step ${stepIndex + 1} [${role}] ${stepTitle} -> ${status}${suffix}`;
}

function buildRecentStepResults(content = '', maxEntries = 2) {
  const value = String(content || '');
  const matches = [...value.matchAll(/^## Step \d+ Result: .*$/gm)];
  if (matches.length === 0) return '';
  const starts = matches.map((match) => match.index || 0);
  const chunks = starts.map((start, index) => value.slice(start, starts[index + 1] || value.length).trim());
  return chunks.slice(-maxEntries).join('\n\n---\n\n');
}

export function buildPlanWorkingMemoryContext(content = '', maxChars = 6000, options = {}) {
  const value = String(content || '').trim();
  if (!value) return '';
  const ledgerOnly = options?.ledgerOnly === true;

  const findings = extractManagedPlanSection(value, 'findings');
  const progress = extractManagedPlanSection(value, 'progress');
  if (!findings && !progress) {
    if (ledgerOnly) return '';
    if (value.length <= maxChars) return value;
    const headSize = Math.floor(maxChars * 0.3);
    const tailSize = maxChars - headSize - 50;
    return `${value.slice(0, headSize)}\n\n... [plan file truncated, showing most recent step results] ...\n\n${value.slice(-tailSize)}`;
  }

  const headLimit = Math.max(600, Math.floor(maxChars * 0.35));
  const head = value.slice(0, headLimit).trimEnd();
  const recentResults = ledgerOnly ? '' : buildRecentStepResults(value, 2);
  const sections = [
    ledgerOnly ? '' : head,
    '## Working Memory Snapshot',
    '### Findings Ledger',
    findings || '- None recorded yet.',
    '### Progress Ledger',
    progress || '- No progress recorded yet.'
  ];
  if (recentResults) {
    sections.push('## Recent Step Results');
    sections.push(recentResults);
  }
  const summary = sections.filter(Boolean).join('\n\n').trim();
  return summary.length <= maxChars ? summary : `${summary.slice(0, maxChars - 42).trimEnd()}\n... [working memory truncated]`;
}

async function appendStepResultToPlanFile(planFilePath, stepIndex, stepTitle, role, output, artifactPaths = []) {
  if (!planFilePath) return;
  try {
    const separator = '\n\n---\n\n';
    const timestamp = new Date().toISOString();
    const content = await fs.readFile(planFilePath, 'utf8');
    const memory = extractStepWorkingMemory(output, artifactPaths);
    const findingsBlock = [
      ...extractManagedPlanSection(content, 'findings')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      ...memory.findings,
      ...memory.openIssues,
      ...memory.notVerified,
      ...memory.failures
    ];
    const progressBlock = [
      ...extractManagedPlanSection(content, 'progress')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      buildProgressLedgerEntry(stepIndex, stepTitle, role, memory)
    ];
    const entry = [
      `## Step ${stepIndex + 1} Result: ${stepTitle}`,
      `Role: ${role}`,
      `Completed: ${timestamp}`,
      '',
      output || '(no output)',
      ''
    ].join('\n');
    const nextContent = [
      replaceManagedPlanSection(content, 'findings', normalizeLedgerItems(trimLedger(findingsBlock, 12)).join('\n')),
      ''
    ].join('\n');
    const nextWithProgress = replaceManagedPlanSection(
      nextContent,
      'progress',
      normalizeLedgerItems(trimLedger(progressBlock, 12), '- No progress recorded yet.').join('\n')
    );
    await fs.writeFile(planFilePath, `${nextWithProgress.trimEnd()}${separator}${entry}\n`, 'utf8');
  } catch {
    // Non-fatal: plan file handoff is best-effort
  }
}

async function readPlanFileAsContext(planFilePath, maxChars = 6000, options = {}) {
  if (!planFilePath) return '';
  try {
    const content = await fs.readFile(planFilePath, 'utf8');
    return buildPlanWorkingMemoryContext(content, maxChars, options);
  } catch {
    return '';
  }
}

async function buildTesterVerificationPacket(focusPaths = [], workspaceRoot = process.cwd()) {
  const cwd = path.resolve(workspaceRoot);
  const primary = [];
  const secondary = [];
  const fallback = [];
  const packageJsonPath = path.join(cwd, 'package.json');
  const pyprojectPath = path.join(cwd, 'pyproject.toml');
  const cargoPath = path.join(cwd, 'Cargo.toml');
  const goModPath = path.join(cwd, 'go.mod');
  const focusTargets = Array.isArray(focusPaths) ? focusPaths.filter(Boolean).slice(0, 4) : [];

  if (await pathExists(packageJsonPath)) {
    const pkg = await readJsonSafe(packageJsonPath);
    const scripts = pkg?.scripts || {};
    if (typeof scripts.test === 'string' && scripts.test.trim()) {
      primary.push(`- npm test :: package.json script = ${trimInline(scripts.test, 140)}`);
    }
    if (typeof scripts.build === 'string' && scripts.build.trim()) {
      secondary.push(`- npm run build :: package.json script = ${trimInline(scripts.build, 140)}`);
    }
    if (typeof scripts.lint === 'string' && scripts.lint.trim()) {
      secondary.push(`- npm run lint :: package.json script = ${trimInline(scripts.lint, 140)}`);
    }
    fallback.push('- If test/build scripts are not usable, inspect package.json scripts and run the narrowest relevant check.');
  }

  if (await pathExists(pyprojectPath)) {
    primary.push('- pytest');
  }
  if (await pathExists(cargoPath)) {
    primary.push('- cargo test');
  }
  if (await pathExists(goModPath)) {
    primary.push('- go test ./...');
  }

  if (primary.length === 0 && secondary.length === 0) {
    return [
      'Verification guidance:',
      '- No obvious project-level test command was detected automatically.',
      '- Prefer running at least one concrete verification command when possible.',
      '- Fall back to the lightest real check you can justify for the files involved.',
      '- If no runnable checks exist, explicitly say what you tried and what remains unverified.'
    ].join('\n');
  }

  const lines = [
    'Verification guidance:',
    'Prefer executing real verification commands before concluding the work is done.',
    'Use the strongest available evidence first, then fall back in order.',
    'Start with artifact-scoped checks for the handed-off files/directories before broad repo discovery.',
    'Read package.json scripts before inventing commands. If a test or build script exists, prefer that exact script name first.',
    'Priority order:'
  ];

  if (focusTargets.length > 0) {
    lines.push('Artifact focus:');
    for (const target of focusTargets) {
      lines.push(`- ${target}`);
    }
  }

  if (primary.length > 0) {
    lines.push('1. Primary verification commands:');
    lines.push(...primary);
  }
  if (secondary.length > 0) {
    lines.push(`${primary.length > 0 ? '2' : '1'}. Secondary verification commands:`);
    lines.push(...secondary);
  }
  lines.push(`${primary.length > 0 || secondary.length > 0 ? '3' : '2'}. Fallback rules:`);
  lines.push('- If the top command fails because the repo is not set up for it, report that clearly and try the next best command.');
  lines.push('- Prefer narrow checks that mention the handed-off path (for example the target directory or file) before scanning the full repository.');
  lines.push('- Do not use unrelated directories as a starting point if focused artifacts were handed to you.');
  lines.push('- Do not treat ls/find/grep directory discovery as verification evidence by itself.');
  lines.push('- Prefer concrete execution evidence over narrative claims.');
  lines.push('- End with two explicit sections: "Verified" and "Not Verified".');
  lines.push(...fallback);

  return lines.join('\n');
}

function isSkillEnabled(config, name, command = null, executionMode = config?.execution?.mode) {
  return skillIsEligible(config?.skills, name, executionMode, command);
}

function selectAutoSkillNames(text = '') {
  const input = String(text || '').toLowerCase();
  const selected = [];

  const explicitGrillMe =
    /\bgr+ill\s+me\b|\bpressure[- ]?test\b|\bstress[- ]?test\b|\bchallenge\s+(?:this|my|me)\b|\btear\s+(?:this|my)\s+.*apart\b/i.test(
      input
    ) || /(拷问|质询|压力测试|挑战一下|挑刺|狠狠审|喷一下|怼一下)/i.test(input);
  const explicitBrainstorm =
    /(brainstorm|头脑风暴|方案|思路|设计一下|设计方案|怎么做|如何做|approach|options?)/i.test(input);
  const ambiguitySignals =
    /(not sure|unsure|unclear|help me think|let'?s think|should we|which (?:approach|option|way)|best way|trade-?off|vs\b|versus|or should|maybe|roughly|just something simple|要不要|不确定|不明确|先别写|先不要写|先讨论|先想一下|哪个方案|怎么设计|如何设计|取舍|还是|大概|先做个|做一个简单的|先来个)/i.test(
      input
    );
  const featureRequest =
    /\b(add|build|create|generate|make|implement|support|introduce|design|refactor|change|update)\b/i.test(input) ||
    /(新增|增加|实现|支持|设计|重构|改造|调整|生成|做一个|做个|创建)/i.test(input);
  const greenfieldBuildRequest =
    (/\b(build|create|generate|make)\b/i.test(input) || /(生成|做一个|做个|创建)/i.test(input)) &&
    /(\b(project|app|site|website|page|dashboard|tool|component|landing page|html page)\b|项目|应用|网页|页面|网站|工具|组件|看板)/i.test(
      input
    );

  if (explicitBrainstorm || (ambiguitySignals && featureRequest) || greenfieldBuildRequest) {
    selected.push('discussion');
  }
  if (explicitGrillMe && !selected.includes('discussion')) selected.push('discussion');
  return selected;
}

const EMPTY_TASK_DIMENSIONS = Object.freeze({
  complexity: 'simple',
  discussion: false,
  ambiguous: false,
  implementation: false,
  localized: false,
  multiFile: false,
  verification: false,
  architecture: false,
  explicitPlan: false,
  multiAction: false,
});

export function classifyTaskDimensions(text = '') {
  const input = String(text || '').trim();
  if (!input) return { ...EMPTY_TASK_DIMENSIONS };

  const lower = input.toLowerCase();
  const explicitPlan =
    /(plan first|make a plan|implementation plan|先做计划|先出方案|先规划|先计划)/i.test(lower);
  const trivial =
    /(typo|readme|console\.log|log this|rename\s+\w+|one line|small tweak|tiny fix|格式化|拼写|注释|文案|小改|微调)/i.test(
      lower
    );
  const discussion =
    /(brainstorm|头脑风暴|方案|思路|怎么做|如何做|先别写|先不要写|先讨论|先想一下)/i.test(lower);
  const ambiguous =
    /(not sure|unsure|unclear|help me think|let'?s think|should we|which (?:approach|option|way)|best way|trade-?off|whether it should|要不要|不确定|不明确|哪个方案|怎么设计|如何设计|取舍)/i.test(
      lower
    );
  const implementation =
    /\b(add|build|create|implement|support|introduce|design|refactor|rework|migrate|change|update|rewrite|restructure)\b/i.test(
      lower
    ) ||
    /(新增|增加|实现|支持|设计|重构|改造|迁移|调整|重写|重做)/i.test(lower);
  const broadSignals = lower.match(
    /\b(auth|authentication|workflow|flow|system|architecture|api|endpoint|state management|session state|cache|caching|database|migration|service|integration|error handling|error recovery|shared helper|helper module)\b/gi
  ) || [];
  const multiAction = /\b(and|plus|also|while|along with)\b/i.test(lower) || /[，、；;].+/.test(input);
  const singleFileScoped =
    /\b(?:in|inside|within|only in)\s+[-_/.\w]+\.(?:[cm]?[jt]sx?|py|go|rb|java|rs|php|md)\b/i.test(lower) ||
    /\b(?:src|app|lib|tests?)\/[-_/.\w]+\.(?:[cm]?[jt]sx?|py|go|rb|java|rs|php|md)\b/i.test(lower);
  const fileMentions = (lower.match(/[-_/.\w]+\.(?:[cm]?[jt]sx?|py|go|rb|java|rs|php|md)\b/g) || []).length;
  const multiFile =
    fileMentions >= 2 ||
    /\b(across|multiple files?|cross-file|cross file)\b/i.test(lower) ||
    /跨文件|多文件/.test(input);
  const verification =
    /\b(with tests?|and tests?|verify|validation|error handling|error recovery)\b/i.test(lower)
    || /测试|验证|校验|错误处理|错误恢复/.test(input);
  const architecture =
    broadSignals.length >= 3 ||
    /\b(architecture|workflow|migration|state management|session state|integration)\b/i.test(lower) ||
    /架构|流程|迁移|状态/.test(input);
  const localized = singleFileScoped && !multiAction && !verification;

  let complexity = 'simple';
  if (explicitPlan) complexity = 'complex';
  else if (trivial) complexity = 'simple';
  else if (!implementation) complexity = 'simple';
  else if (localized) complexity = 'simple';
  else if (architecture && (multiFile || multiAction || verification)) complexity = 'complex';
  else if (multiFile || verification || multiAction) complexity = 'medium';

  return {
    complexity,
    discussion,
    ambiguous,
    implementation,
    localized,
    multiFile,
    verification,
    architecture,
    explicitPlan,
    multiAction,
  };
}

export function classifyAutoRoute(text = '') {
  const selectedSkills = selectAutoSkillNames(text);
  const dimensions = classifyTaskDimensions(text);
  const hasBrainstorm = selectedSkills.includes('discussion');
  if (hasBrainstorm) {
    return {
      mode: 'brainstorm',
      autoPlan: false,
      selectedSkills,
      complexity: 'discussion',
      dimensions: { ...dimensions, discussion: true },
    };
  }

  const complexity = dimensions.complexity;
  if (complexity === 'complex') {
    return {
      mode: 'direct_complex',
      autoPlan: false,
      selectedSkills: [],
      complexity,
      dimensions,
    };
  }

  return {
    mode: complexity === 'medium' ? 'direct_medium' : 'direct',
    autoPlan: false,
    selectedSkills,
    complexity,
    dimensions,
  };
}

function getAlwaysSkillCommands(commands, config, dismissedSkills = null, activeMode = config?.execution?.mode) {
  return Array.from(commands.values())
    .filter((command) =>
      command?.metadata?.type === 'skill' &&
      command.metadata?.mode === 'always' &&
      isSkillEnabled(config, command.name, command, activeMode) &&
      (!dismissedSkills || !dismissedSkills.has(command.name))
    )
    .sort((a, b) => {
      const left = Number(a.metadata?.priority || 0);
      const right = Number(b.metadata?.priority || 0);
      return right - left || a.name.localeCompare(b.name);
    });
}

export function buildAlwaysSkillPromptBlock(commands, config, dismissedSkills = null, activeMode = config?.execution?.mode, cwd = process.cwd()) {
  const selected = getAlwaysSkillCommands(commands, config, dismissedSkills, activeMode);
  if (selected.length === 0) return '';
  return selected.map((skill) => (
    `[Always skill: ${skill.name}]\n${appendSkillSandboxMountHint(skill, skill.content, { config, cwd })}`
  )).join('\n\n');
}

function buildSelectedSkillPromptBlock(commands, names = [], config = {}, executionMode = 'code', cwd = process.cwd()) {
  const selected = [];
  for (const name of names) {
    const skill = commands?.get?.(name);
    if (
      !skill
      || !isSkillIndexEligible(skill)
      || isSkillModelInvocationDisabled(skill)
      || !isSkillEnabled(config, name, skill, executionMode)
    ) continue;
    selected.push(
      `[Lite-selected skill: ${skill.name}]\n${appendSkillSandboxMountHint(skill, skill.content, { config, cwd })}`,
    );
  }
  return selected.join('\n\n');
}

export function shouldInjectAlwaysSkills(executionMode) {
  return ['normal', 'plan'].includes(normalizeExecutionMode(executionMode));
}

function normalizePlanStepRoles(steps = []) {
  return (Array.isArray(steps) ? steps : []).map((step) => {
    const titleTask = `${step?.title || ''} ${step?.task || ''}`.toLowerCase();
    const role = String(step?.role || '').trim().toLowerCase();
    if (role === 'summarizer') return step;
    if (/\b(summarize|summary|synthesis|final status|汇总|总结|归纳)\b/i.test(titleTask)) {
      return { ...step, role: 'summarizer' };
    }
    if (role === 'tester') return step;
    if (/\b(test|verify|verification|validate|validation|验收|验证|测试)\b/i.test(titleTask) && role === 'coder') {
      return { ...step, role: 'tester' };
    }
    if (role === 'reviewer') return step;
    if (/\b(review|audit|regression|审查|复核|回归)\b/i.test(titleTask) && role === 'coder') {
      return { ...step, role: 'reviewer' };
    }
    if (role === 'explorer' || role === 'architect' || role === 'advisor' || role === 'debugger') return step;
    if (/\b(explore|inspect|map|discover|调研|探索|梳理|摸清)\b/i.test(titleTask) && role === 'coder') {
      return { ...step, role: 'explorer' };
    }
    return step;
  });
}

function normalizeStepStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function normalizePlannerChoice(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizePlannerMetadata(parsed = {}, goal = '') {
  const taskClass = classifyPlanTaskClass(goal);
  const taskType = normalizePlannerChoice(
    parsed?.task_type || parsed?.taskType || parsed?.classification?.task_type || parsed?.classification?.taskType,
    ['advisory', 'implementation', 'debugging', 'verification', 'refactor', 'documentation', 'hybrid'],
    taskClass === 'implementation-verification'
      ? 'implementation'
      : taskClass === 'implementation-advisory'
        ? 'hybrid'
        : taskClass
  );
  return {
    task_size: normalizePlannerChoice(
      parsed?.task_size || parsed?.taskSize || parsed?.classification?.task_size || parsed?.classification?.taskSize,
      ['trivial', 'small', 'medium', 'large'],
      ''
    ),
    task_type: taskType,
    target_confidence: normalizePlannerChoice(
      parsed?.target_confidence || parsed?.targetConfidence || parsed?.classification?.target_confidence || parsed?.classification?.targetConfidence,
      ['known', 'likely', 'unknown'],
      ''
    ),
    rationale: String(parsed?.rationale || parsed?.classification?.rationale || '').trim()
  };
}

function normalizeStructuredPlanSteps(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .map((step) => ({
      title: String(step?.title || '').trim(),
      role: String(step?.role || '').trim().toLowerCase(),
      task: String(step?.task || '').trim(),
      consumes: String(step?.consumes || step?.inputs || '').trim(),
      produces: String(step?.produces || step?.outputs || '').trim(),
      target_files: normalizeStepStringArray(step?.target_files || step?.targets || step?.files),
      success_criteria: String(step?.success_criteria || step?.success || '').trim(),
      verification: String(step?.verification || step?.verify || '').trim(),
      handoff: String(step?.handoff || step?.handoff_artifact || '').trim()
    }))
    .filter((step) => step.title && step.task && EXECUTOR_AGENT_ROLES.includes(step.role));
}

function buildStepContractTask(step) {
  const lines = [String(step?.task || '').trim()];
  if (step?.consumes) lines.push(`Consumes: ${step.consumes}`);
  if (step?.produces) lines.push(`Produces: ${step.produces}`);
  if (Array.isArray(step?.target_files) && step.target_files.length > 0) {
    lines.push(`Targets: ${step.target_files.join(', ')}`);
  }
  if (step?.success_criteria) lines.push(`Success criteria: ${step.success_criteria}`);
  if (step?.verification) lines.push(`Verification intent: ${step.verification}`);
  if (step?.handoff) lines.push(`Handoff artifact: ${step.handoff}`);
  return lines.filter(Boolean).join('\n');
}

function withStepContractTasks(steps = []) {
  return (Array.isArray(steps) ? steps : []).map((step) => ({
    title: step.title,
    role: step.role,
    task: step.task,
    ...(step.consumes ? { consumes: step.consumes } : {}),
    ...(step.produces ? { produces: step.produces } : {}),
    ...(Array.isArray(step.target_files) && step.target_files.length > 0 ? { target_files: step.target_files } : {}),
    ...(step.success_criteria ? { success_criteria: step.success_criteria } : {}),
    ...(step.verification ? { verification: step.verification } : {}),
    ...(step.handoff ? { handoff: step.handoff } : {})
  }));
}

function renderStepContractBlock(step = {}) {
  const lines = ['Step Contract:'];
  if (step.consumes) lines.push(`- Consumes: ${step.consumes}`);
  if (step.produces) lines.push(`- Produces: ${step.produces}`);
  if (Array.isArray(step.target_files) && step.target_files.length > 0) lines.push(`- Targets: ${step.target_files.join(', ')}`);
  if (step.success_criteria) lines.push(`- Success criteria: ${step.success_criteria}`);
  if (step.verification) lines.push(`- Verification intent: ${step.verification}`);
  if (step.handoff) lines.push(`- Handoff artifact: ${step.handoff}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

export function normalizeAutoPlan(parsed, goal) {
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const cleaned = withStepContractTasks(normalizePlanStepRoles(normalizeStructuredPlanSteps(steps)));
  const planner = normalizePlannerMetadata(parsed, goal);

  const basePlan =
    cleaned.length === 0
      ? {
          summary: `Auto plan for: ${goal}`,
          planner,
          steps: [
            {
              title: 'Initial exploration',
              role: 'explorer',
              task: `Inspect the codebase and map the target area for: ${goal}`
            }
          ]
        }
      : {
          summary: String(parsed?.summary || `Auto plan for: ${goal}`).trim(),
          planner,
          steps: cleaned
        };

  return enforceAutoPlanGuardrailSteps(basePlan, goal);
}

function summarizeGoalForStepTitle(goal, fallback = 'requested change') {
  const text = String(goal || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  const compact = text.length > 72 ? `${text.slice(0, 69).trimEnd()}...` : text;
  return compact;
}

function buildFallbackAutoPlan(goal) {
  const requirements = deriveGoalRequirements(goal);
  const lightweightGoal = isLightweightAutoPlanGoal(goal, requirements);
  const taskClass = classifyPlanTaskClass(goal);
  const focus = summarizeGoalForStepTitle(goal);
  const summary =
    requirements.length > 0
      ? `Auto fallback plan for: ${requirements.join('; ')}`
      : `Auto fallback plan for: ${goal}`;

  if (taskClass === 'advisory') {
    return {
      summary,
      steps: [
        {
          title: 'Inspect the target area',
          role: 'explorer',
          task: `Inspect the relevant project context for: ${goal}. Identify constraints, evidence, and likely high-value advisory areas.`
        },
        {
          title: `Advise on ${focus}`,
          role: 'advisor',
          task: `Analyze the findings for: ${goal}. Produce prioritized recommendations, tradeoffs, evidence, and open questions without implementing changes.`
        },
        buildDefaultSummarizerStep(goal)
      ]
    };
  }

  if (taskClass === 'debugging') {
    return {
      summary,
      steps: [
        {
          title: 'Inspect the failing area',
          role: 'explorer',
          task: `Inspect the relevant code paths, error logs, test failures, and affected files for: ${goal}. Identify likely culprit areas and gather reproduction context.`
        },
        {
          title: `Investigate root cause of ${focus}`,
          role: 'debugger',
          task: `Investigate: ${goal}. Reproduce the issue, trace the root cause through code and logs, narrow down to specific files and functions, and recommend a fix approach without implementing it.`
        },
        {
          title: `Fix ${focus}`,
          role: 'coder',
          task: `Fix the root cause identified by the debugger for: ${goal}. Keep the fix narrowly scoped and preserve existing behavior except where the goal requires changes.`
        },
        {
          title: 'Verify the fix',
          role: 'tester',
          task: `Verify the fix for: ${goal}. Run the previously failing command or test, confirm the issue is resolved, and check for regressions.`
        },
        buildDefaultSummarizerStep(goal)
      ]
    };
  }

  if (taskClass === 'implementation-advisory') {
    return {
      summary,
      steps: [
        {
          title: 'Inspect and analyze',
          role: 'explorer',
          task: `Inspect the relevant project context for: ${goal}. Identify constraints, dependencies, existing behavior, and high-value intervention points.`
        },
        {
          title: `Advise on approach for ${focus}`,
          role: 'advisor',
          task: `Analyze findings for: ${goal}. Recommend the best implementation approach with tradeoffs, risks, and concrete steps. Do not implement.`
        },
        {
          title: `Implement ${focus}`,
          role: 'coder',
          task: `Implement the recommended approach for: ${goal}. Follow the acceptance checklist and keep changes tightly scoped.`
        },
        buildDefaultSummarizerStep(goal)
      ]
    };
  }

  if (lightweightGoal) {
    const summarizerStep = buildDefaultSummarizerStep(goal);
    return {
      summary,
      steps: [
        {
          title: `Implement ${focus}`,
          role: 'coder',
          task: `Implement the requested change for: ${goal}. Follow the acceptance checklist and keep the change narrowly scoped.`
        },
        {
          title: 'Verify the change',
          role: 'tester',
          task: `Verify the completed change for: ${goal}. Run the most relevant focused checks available and report concrete evidence plus anything still unverified.`
        },
        summarizerStep
      ]
    };
  }

  return {
    summary,
    steps: [
      {
        title: 'Inspect the target area',
        role: 'explorer',
        task: `Inspect the existing code paths, affected files, and current behavior for: ${goal}. Identify constraints, dependencies, and any compatibility risks before implementation.`
      },
      {
        title: `Implement ${focus}`,
        role: 'coder',
        task: `Implement the requested changes for: ${goal}. Keep the behavior aligned with the acceptance checklist and preserve existing external behavior unless the goal explicitly changes it.`
      },
      {
        title: 'Add focused test coverage',
        role: 'coder',
        task: `Add or update focused tests or test fixtures for: ${goal}. Do not run broad verification here; hand the relevant commands to the tester step.`
      },
      {
        title: 'Review for regressions and gaps',
        role: 'reviewer',
        task: `Review the completed work for: ${goal}. Start with the changed files, then check regressions, risky assumptions, backward compatibility, and missing edge cases.`
      },
      {
        title: 'Verify the changed flows',
        role: 'tester',
        task: `Verify the completed work for: ${goal}. Run the most relevant checks available, report concrete evidence, and call out anything still not verified.`
      },
      {
        title: 'Synthesize final implementation status',
        role: 'summarizer',
        task: `Synthesize the completed work for: ${goal}. Read the accumulated findings, verification evidence, and open issues from earlier steps, then produce a concise final status with remaining risks and the single best next action.`
      }
    ]
  };
}

function buildDefaultSummarizerStep(goal, source = []) {
  const existing = (Array.isArray(source) ? source : []).find((step) => step.role === 'summarizer');
  if (existing?.title && existing?.task) return existing;
  const taskClass = classifyPlanTaskClass(goal);
  if (taskClass === 'advisory') {
    return {
      title: 'Synthesize final findings',
      role: 'summarizer',
      task: `Synthesize the advisory findings for: ${goal}. Read the accumulated observations, recommendations, tradeoffs, evidence, and open questions from earlier steps, then produce a concise final summary with the single best next action.`
    };
  }
  if (taskClass === 'debugging') {
    return {
      title: 'Synthesize investigation results',
      role: 'summarizer',
      task: `Synthesize the debugging results for: ${goal}. Read the accumulated findings, root cause evidence, fix implementation, and verification from earlier steps, then produce a concise final summary with the root cause, fix status, and any remaining risks.`
    };
  }
  return {
    title: 'Synthesize final implementation status',
    role: 'summarizer',
    task: `Synthesize the completed work for: ${goal}. Read the accumulated findings, verification evidence, and open issues from earlier steps, then produce a concise final status with remaining risks and the single best next action.`
  };
}

function buildDefaultTesterStep(goal) {
  return {
    title: 'Test and verify',
    role: 'tester',
    task: `Test and verify the completed work for: ${goal}. Run the most relevant checks available, report concrete evidence, and call out anything still unverified.`
  };
}

function buildDefaultReviewerStep(goal) {
  return {
    title: 'Review implementation',
    role: 'reviewer',
    task: `Review the completed work for: ${goal}. Check bugs, regressions, risky assumptions, edge cases, and missing tests in the changed areas.`
  };
}

function buildDefaultExplorerStep(goal) {
  return {
    title: 'Inspect the target area',
    role: 'explorer',
    task: `Inspect the relevant code paths, affected files, and current behavior for: ${goal}. Identify constraints, dependencies, and risks before implementation.`
  };
}

function testerStepHasConcreteVerification(step = {}) {
  const text = [
    step.title,
    step.task,
    step.verification,
    step.success_criteria
  ].filter(Boolean).join('\n').toLowerCase();
  if (!text) return false;
  if (/\b(npm|pnpm|yarn|node --test|vitest|jest|playwright|pytest|cargo test|go test|mvn|gradle|npm run|npm test)\b/.test(text)) {
    return true;
  }
  if (/\b(manual|browser|smoke|screenshot|api|endpoint)\b/.test(text) && /\b(verify|validate|test|check|confirm)\b/.test(text)) {
    return true;
  }
  return false;
}

function finalizePlanWithTerminalRoles(steps, goal, {
  includeTester = true,
  includeReviewer = false,
  includeSummarizer = true
} = {}) {
  const source = Array.isArray(steps) ? steps : [];
  const body = [];
  const seen = new Set();
  let hasTester = false;
  let hasReviewer = false;
  for (const step of source) {
    if (!step?.title || !step?.task) continue;
    if (step.role === 'summarizer') continue;
    if (step.role === 'tester') hasTester = true;
    if (step.role === 'reviewer') hasReviewer = true;
    const key = `${step.role}|${step.title}|${step.task}`;
    if (seen.has(key)) continue;
    seen.add(key);
    body.push(step);
  }
  if (includeReviewer && !hasReviewer) body.push(buildDefaultReviewerStep(goal));
  if (includeTester && !hasTester) body.push(buildDefaultTesterStep(goal));
  if (includeSummarizer) body.push(buildDefaultSummarizerStep(goal, source));
  return body;
}

function enforceAutoPlanGuardrailSteps(plan, goal) {
  const source = Array.isArray(plan?.steps) ? plan.steps : [];
  const requirements = deriveGoalRequirements(goal);
  const lightweightGoal = isLightweightAutoPlanGoal(goal, requirements);
  const taskClass = classifyPlanTaskClass(goal);
  const planner = plan?.planner && typeof plan.planner === 'object' ? plan.planner : {};
  const taskSize = String(planner.task_size || '').toLowerCase();
  const taskType = String(planner.task_type || '').toLowerCase();
  const targetConfidence = String(planner.target_confidence || '').toLowerCase();
  const plannerSaysSmall = taskSize === 'trivial' || taskSize === 'small';
  const plannerSaysKnownTarget = targetConfidence === 'known';
  const plannerSaysAdvisory = taskType === 'advisory';
  const plannerSaysVerification = taskType === 'verification';
  const summary = String(plan?.summary || `Auto plan for: ${goal}`).trim();
  const implementationSteps = source.filter((step) => ['coder', 'refactorer', 'writer'].includes(step.role));
  const primaryImplementationStep =
    implementationSteps.find((step) => step.role === 'coder') ||
    implementationSteps[0] || {
      title: 'Implement requested change',
      role: 'coder',
      task: `Implement the requested change for: ${goal}`
    };
  const debuggerStep = source.find((step) => step.role === 'debugger') || {
    title: 'Investigate the issue',
    role: 'debugger',
    task: `Investigate the reported issue: ${goal}. Reproduce the problem, trace root causes, narrow down culprit code, and recommend a fix approach without implementing it.`
  };
  const hasDebugger = source.some((step) => step.role === 'debugger');

  if (taskClass === 'advisory') {
    const allowedAdvisoryRoles =
      plannerSaysSmall || plannerSaysKnownTarget || plannerSaysAdvisory
        ? new Set(['advisor', 'architect'])
        : new Set(['explorer', 'advisor', 'architect']);
    const advisorySteps = source
      .filter((step) => allowedAdvisoryRoles.has(step.role))
      .map((step) =>
        step.role === 'coder'
          ? {
              ...step,
              role: 'advisor',
              title: /^implement\b/i.test(String(step.title || '')) ? 'Advise on requested goal' : step.title
            }
          : step
      );
    const hasAdvisor = advisorySteps.some((step) => step.role === 'advisor');
    const baseSteps =
      advisorySteps.length > 0
        ? advisorySteps.slice(0, 6)
        : [
            {
              title: 'Advise on requested goal',
              role: 'advisor',
              task: `Analyze the goal and recommend the highest-value next steps for: ${goal}`
            }
          ];
    const finalSteps = hasAdvisor
      ? baseSteps
      : [
          ...baseSteps,
          {
            title: 'Advise on requested goal',
            role: 'advisor',
            task: `Analyze the goal and recommend the highest-value next steps for: ${goal}`
          }
        ];
    return {
      summary,
      steps: finalizePlanWithTerminalRoles(finalSteps, goal, {
        includeTester: false,
        includeReviewer: false,
        includeSummarizer: true
      })
    };
  }

  if (taskClass === 'debugging') {
    const nonDebugRoles = implementationSteps.filter((step) => step.role !== 'debugger');
    const coderStep = nonDebugRoles.find((step) => step.role === 'coder') || {
      title: 'Fix the identified cause',
      role: 'coder',
      task: `Fix the root cause identified by the debugger for: ${goal}. Keep the fix narrowly scoped and preserve existing behavior except where intentionally changed.`
    };
    const steps = [
      ...(nonDebugRoles.some((step) => step.role === 'explorer') ? [] : [buildDefaultExplorerStep(goal)]),
      ...nonDebugRoles.slice(0, 3),
      ...(hasDebugger ? [] : [debuggerStep]),
      coderStep
    ];
    return {
      summary,
      steps: finalizePlanWithTerminalRoles(steps, goal, {
        includeTester: true,
        includeReviewer: false,
        includeSummarizer: true
      })
    };
  }

  if (taskClass === 'implementation-advisory') {
    const explorerStep =
      source.find((step) => step.role === 'explorer' || step.role === 'architect') || buildDefaultExplorerStep(goal);
    const advisoryStep = source.find((step) => step.role === 'advisor') || {
      title: 'Analyze requirements and constraints',
      role: 'advisor',
      task: `Analyze: ${goal}. Identify constraints, dependencies, risks, tradeoffs, and recommend the best implementation approach before coding.`
    };
    const coderSteps = source.filter((step) => ['coder', 'refactorer', 'writer'].includes(step.role));
    const executionSteps = coderSteps.length > 0 ? coderSteps.slice(0, 4) : [primaryImplementationStep];
    return {
      summary,
      steps: finalizePlanWithTerminalRoles([explorerStep, advisoryStep, ...executionSteps], goal, {
        includeTester: true,
        includeReviewer: false,
        includeSummarizer: true
      })
    };
  }

  if (taskClass === 'implementation-verification') {
    const executionSteps = [
      ...(source.some((step) => step.role === 'explorer') ? [] : [buildDefaultExplorerStep(goal)]),
      ...implementationSteps.slice(0, 5)
    ];
    return {
      summary,
      steps: finalizePlanWithTerminalRoles(executionSteps, goal, {
        includeTester: true,
        includeReviewer: true,
        includeSummarizer: true
      })
    };
  }

  if (lightweightGoal) {
    return {
      summary,
      steps: finalizePlanWithTerminalRoles([primaryImplementationStep], goal, {
        includeTester: true,
        includeReviewer: false,
        includeSummarizer: true
      })
    };
  }

  if (plannerSaysSmall && plannerSaysKnownTarget && implementationSteps.length > 0) {
    return {
      summary,
      steps: finalizePlanWithTerminalRoles([primaryImplementationStep], goal, {
        includeTester: true,
        includeReviewer: false,
        includeSummarizer: true
      })
    };
  }

  const executionSteps = [
    ...(source.some((step) => step.role === 'explorer' || step.role === 'architect') ? [] : [buildDefaultExplorerStep(goal)]),
    ...implementationSteps.slice(0, 6)
  ];
  return {
    summary,
    steps: finalizePlanWithTerminalRoles(executionSteps, goal, {
      includeTester: true,
      includeReviewer: source.some((step) => step.role === 'reviewer'),
      includeSummarizer: true
    })
  };
}

function looksLikeSuccessfulStepOutput(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  const failureBullet = extractSectionFirstBullet(value, 'Failures');
  const errorBullet = extractSectionFirstBullet(value, 'Error');
  const nextActionBullet = extractSectionFirstBullet(value, 'Next Action');
  const acceptanceFailures = extractAcceptanceStatusItems(value).filter((item) => item.status !== 'met');
  if (errorBullet && !/^none\b/i.test(errorBullet)) return false;
  if (failureBullet && !/^none\b/i.test(failureBullet)) return false;
  if (acceptanceFailures.length > 0) return false;
  if (nextActionBullet && /^retry\b/i.test(nextActionBullet)) return false;
  return true;
}

async function capturePlanFailureLesson({
  goal = '',
  step = {},
  stepIndex = 0,
  totalSteps = 0,
  config = {}
} = {}) {
  if (config?.memory?.enabled === false || config?.memory?.auto_capture === false) return null;
  const role = String(step?.role || 'step').trim() || 'step';
  const title = String(step?.title || 'plan step').trim() || 'plan step';
  const reason = String(step?.failureReason || step?.output || 'plan step failed').trim().slice(0, 400);
  const summary = `[plan:${role}] ${title}`.slice(0, 120);
  const details = [
    `Goal: ${String(goal || '').trim().slice(0, 300)}`,
    `Step: ${stepIndex + 1}/${Math.max(totalSteps, stepIndex + 1)} [${role}] ${title}`,
    `Failure: ${reason}`,
    'Promote only if this is a reusable lesson; discard one-off environment noise during Dream.'
  ].join('\n');
  try {
    return await captureToInbox({
      scope: 'project',
      type: 'lesson',
      summary,
      details,
      tags: ['plan-failure', role],
      source: 'plan-failure'
    });
  } catch {
    return null;
  }
}

const IMPLEMENTATION_EVIDENCE_ROLES = new Set(['coder', 'refactorer', 'writer']);

function implementationRoleHasToolEvidence(role, artifactPaths = []) {
  return IMPLEMENTATION_EVIDENCE_ROLES.has(role) && Array.isArray(artifactPaths) && artifactPaths.some(Boolean);
}

function roleOutputLacksImplementationEvidence(role, actionsTaken = '', artifacts = '', artifactPaths = []) {
  if (implementationRoleHasToolEvidence(role, artifactPaths)) return false;
  return coderOutputLacksImplementationEvidence(actionsTaken, artifacts);
}

function stepOutputHasFailureSignals(role, text = '', options = {}) {
  const artifactPaths = Array.isArray(options.artifactPaths) ? options.artifactPaths : [];
  const value = String(text || '').trim();
  if (!value) return !implementationRoleHasToolEvidence(role, artifactPaths);
  const errorBullet = extractSectionFirstBullet(value, 'Error');
  const failureBullet = extractSectionFirstBullet(value, 'Failures');
  const findingsBullet = extractSectionFirstBullet(value, 'Findings');
  const nextActionBullet = extractSectionFirstBullet(value, 'Next Action');
  const notVerifiedBullet = extractSectionFirstBullet(value, 'Not Verified');
  const remainingIssuesBullet = extractSectionFirstBullet(value, 'Remaining Issues');
  const actionsTakenBullet = extractSectionFirstBullet(value, 'Actions Taken');
  const artifactsBullet = extractSectionFirstBullet(value, 'Artifacts');
  const mapBullet = extractSectionFirstBullet(value, 'Map');
  const designBullet = extractSectionFirstBullet(value, 'Design Decision');
  const narrowedScopeBullet = extractSectionFirstBullet(value, 'Narrowed Scope');
  const evidenceBullet = extractSectionFirstBullet(value, 'Evidence');
  const acceptanceFailures = extractAcceptanceStatusItems(value).filter((item) => item.status !== 'met');
  if (errorBullet && !/^none\b/i.test(errorBullet)) return true;
  if (failureBullet && !/^none\b/i.test(failureBullet)) return true;
  if (acceptanceFailures.length > 0) return true;
  if (role === 'explorer') {
    const hasFindings = sectionHasValue(value, 'Findings');
    const hasMap = sectionHasValue(value, 'Map');
    const hasActions = sectionHasValue(value, 'Actions Taken');
    if (explorerOutputLacksContext(
      hasFindings ? 'ok' : '',
      hasMap ? 'ok' : '',
      hasActions ? 'ok' : ''
    ) && !explorerOutputHasContent(value)) {
      return true;
    }
  }
  if (role === 'architect' && architectOutputLacksDecision(designBullet)) return true;
  if (role === 'coder' && roleOutputLacksImplementationEvidence(role, actionsTakenBullet, artifactsBullet, artifactPaths)) return true;
  if (role === 'refactorer' && roleOutputLacksImplementationEvidence(role, actionsTakenBullet, artifactsBullet, artifactPaths)) return true;
  if (role === 'reviewer' && reviewerFindingNeedsAction(findingsBullet)) return true;
  if (role === 'writer' && roleOutputLacksImplementationEvidence(role, actionsTakenBullet, artifactsBullet, artifactPaths)) return true;
  if (role === 'tester' && notVerifiedBullet && !/^none\b/i.test(notVerifiedBullet)) return true;
  if (role === 'debugger' && debuggerOutputLacksTracedCause(findingsBullet, narrowedScopeBullet, evidenceBullet)) return true;
  if (nextActionBullet && /^(fix|retry|correct|repair)\b/i.test(nextActionBullet)) return true;
  return false;
}

function explorerOutputLacksContext(findings = '', map = '', actions = '') {
  const noFindings = !String(findings || '').trim() || /^none\b/i.test(String(findings || '').trim());
  const noMap = !String(map || '').trim() || /^none\b/i.test(String(map || '').trim());
  const noActions = !String(actions || '').trim() || /^none\b/i.test(String(actions || '').trim());
  return noFindings && noMap && noActions;
}

function explorerOutputHasContent(outputText = '') {
  const raw = String(outputText || '').trim();
  if (!raw) return false;
  if (/^(error|no\s|i\s*cannot|i\s*don't|unable)/i.test(raw)) return false;
  if (raw.length < 80) return false;
  return true;
}

function architectOutputLacksDecision(design = '') {
  const value = String(design || '').trim();
  return !value || /^none\b/i.test(value);
}

function refactorerOutputLacksEvidence(actionsTaken = '', artifacts = '') {
  return coderOutputLacksImplementationEvidence(actionsTaken, artifacts);
}

function writerOutputLacksEvidence(actionsTaken = '', artifacts = '') {
  return coderOutputLacksImplementationEvidence(actionsTaken, artifacts);
}

function debuggerOutputLacksTracedCause(findings = '', narrowedScope = '', evidence = '') {
  const noFindings = !String(findings || '').trim() || /^none\b/i.test(String(findings || '').trim());
  const noScope = !String(narrowedScope || '').trim() || /^none\b/i.test(String(narrowedScope || '').trim());
  const noEvidence = !String(evidence || '').trim() || /^none\b/i.test(String(evidence || '').trim());
  return noFindings && noScope && noEvidence;
}

function coderOutputLacksImplementationEvidence(actionsTaken = '', artifacts = '') {
  const noActions = !String(actionsTaken || '').trim() || /^none\b/i.test(String(actionsTaken || '').trim());
  const noArtifacts = !String(artifacts || '').trim() || /^none\b/i.test(String(artifacts || '').trim());
  return noActions && noArtifacts;
}

function reviewerFindingNeedsAction(text = '') {
  const value = String(text || '').trim();
  if (!value || /^none\b/i.test(value)) return false;
  const lower = value.toLowerCase();
  if (
    /\b(bug|regression|risk|risky|missing|missing test|unsafe|blocker|blocked|incorrect|broken|failure|failing|unverified|mismatch|incomplete|gap|can regress|still regress)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (/\b(not covered|not handled|not verified|does not|doesn't|cannot|can't|lacks?)\b/i.test(lower)) {
    return true;
  }
  return false;
}

function buildExitCriteriaFailureReason(role, text = '', options = {}) {
  const artifactPaths = Array.isArray(options.artifactPaths) ? options.artifactPaths : [];
  const value = String(text || '').trim();
  if (!value) {
    if (implementationRoleHasToolEvidence(role, artifactPaths)) return 'step output did not satisfy exit criteria';
    return 'no structured step output was produced';
  }
  const errorBullet = extractSectionFirstBullet(value, 'Error');
  if (errorBullet && !/^none\b/i.test(errorBullet)) return `error: ${errorBullet}`;
  const failureBullet = extractSectionFirstBullet(value, 'Failures');
  if (failureBullet && !/^none\b/i.test(failureBullet)) return `failures: ${failureBullet}`;
  const findingsBullet = extractSectionFirstBullet(value, 'Findings');
  const actionsTakenBullet = extractSectionFirstBullet(value, 'Actions Taken');
  const artifactsBullet = extractSectionFirstBullet(value, 'Artifacts');
  const mapBullet = extractSectionFirstBullet(value, 'Map');
  const designBullet = extractSectionFirstBullet(value, 'Design Decision');
  if (role === 'explorer') {
    const hasFindings = sectionHasValue(value, 'Findings');
    const hasMap = sectionHasValue(value, 'Map');
    const hasActions = sectionHasValue(value, 'Actions Taken');
    if (explorerOutputLacksContext(
      hasFindings ? 'ok' : '',
      hasMap ? 'ok' : '',
      hasActions ? 'ok' : ''
    ) && !explorerOutputHasContent(value)) {
      return 'explorer output did not include findings, map, or actions';
    }
  }
  if (role === 'architect' && architectOutputLacksDecision(designBullet)) {
    return 'architect output did not include a design decision';
  }
  if (role === 'coder' && roleOutputLacksImplementationEvidence(role, actionsTakenBullet, artifactsBullet, artifactPaths)) {
    return 'coder output did not include implementation evidence';
  }
  if (role === 'refactorer' && roleOutputLacksImplementationEvidence(role, actionsTakenBullet, artifactsBullet, artifactPaths)) {
    return 'refactorer output did not include refactoring evidence';
  }
  if (role === 'writer' && roleOutputLacksImplementationEvidence(role, actionsTakenBullet, artifactsBullet, artifactPaths)) {
    return 'writer output did not include documentation evidence';
  }
  if (role === 'reviewer' && reviewerFindingNeedsAction(findingsBullet)) return `review findings: ${findingsBullet}`;
  if (role === 'debugger') {
    const narrowedScopeBullet = extractSectionFirstBullet(value, 'Narrowed Scope');
    const evidenceBullet = extractSectionFirstBullet(value, 'Evidence');
    if (debuggerOutputLacksTracedCause(findingsBullet, narrowedScopeBullet, evidenceBullet)) {
      return 'debugger output did not include traced cause, narrowed scope, or evidence';
    }
  }
  const nextActionBullet = extractSectionFirstBullet(value, 'Next Action');
  if (nextActionBullet && /^(fix|retry|correct|repair)\b/i.test(nextActionBullet)) return `next action requires rework: ${nextActionBullet}`;
  const acceptanceFailure = extractAcceptanceStatusItems(value).find((item) => item.status !== 'met');
  if (acceptanceFailure) return `acceptance ${acceptanceFailure.status}: ${acceptanceFailure.label}`;
  const notVerifiedBullet = extractSectionFirstBullet(value, 'Not Verified');
  if (role === 'tester' && notVerifiedBullet && !/^none\b/i.test(notVerifiedBullet)) {
    return `not verified: ${notVerifiedBullet}`;
  }
  return 'step output did not satisfy exit criteria';
}

function stripMarkdownHeadingChars(text = '') {
  return String(text || '').replace(/(^|\n)(\s*)(?:\*{1,3}|#{1,4})\s*/g, '$1$2');
}

function extractSectionFirstBullet(text = '', heading = '') {
  const clean = stripMarkdownHeadingChars(String(text || ''));
  const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(clean || '').match(new RegExp(String.raw`(^|\n)\s*${escaped}\s*:\s*(?:\n|\r\n?)+\s*-\s*([^\n\r]+)`, 'i'));
  return String(match?.[2] || '').trim();
}

function sectionHasValue(text = '', heading = '') {
  const bullet = extractSectionFirstBullet(text, heading);
  if (bullet && !/^none\b/i.test(bullet)) return true;
  const clean = stripMarkdownHeadingChars(String(text || ''));
  const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inline = String(clean || '').match(new RegExp(String.raw`(^|\n)\s*${escaped}\s*:\s*([^\n\r]+)`, 'i'));
  const inlineText = String(inline?.[2] || '').trim();
  return inlineText && !/^none\b/i.test(inlineText);
}

function extractSectionBullets(text = '', heading = '') {
  const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = String(text || '');
  const headingMatch = value.match(new RegExp(String.raw`(^|\n)\s*${escaped}\s*:\s*(?:\n|\r\n?)`, 'i'));
  if (!headingMatch || headingMatch.index == null) return [];
  const start = headingMatch.index + headingMatch[0].length;
  const after = value.slice(start);
  const nextHeading = after.search(/\n\s*[A-Za-z][A-Za-z ]+\s*:\s*(?:\n|\r\n?)/);
  const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
  return section
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s*(.+)$/)?.[1]?.trim() || '')
    .filter(Boolean);
}

function extractAcceptanceStatusItems(text = '') {
  return extractSectionBullets(text, 'Acceptance Status')
    .map((item) => {
      const match = String(item).match(/^(met|unmet|unverified)\s*::\s*(.+)$/i);
      if (!match) return null;
      return {
        status: String(match[1] || '').toLowerCase(),
        label: String(match[2] || '').trim()
      };
    })
    .filter(Boolean);
}

function buildAutoPlanSystemSummary(auto) {
  const baseStatusTitle =
    auto.failedCount > 0 ? 'Auto plan finished with failures' : auto.warningCount > 0 ? 'Auto plan finished with warnings' : 'Auto plan finished';
  const lines = [
    baseStatusTitle,
    `Plan File: ${auto.filePath}`,
    `Plan Summary: ${auto.summary || '-'}`,
    `Final Summary: ${auto.finalSummary || auto.summary || '-'}`,
    `Execution: ${auto.executionPolicy || 'automatic'}`
  ];
  lines.push(`Steps: ${auto.steps.length} total`);
  lines.push(`Completed: ${auto.completedCount}`);
  lines.push(`Warnings: ${auto.warningCount}`);
  lines.push(`Failed: ${auto.failedCount}`);
  if (auto.warningTitles?.length) {
    lines.push(`Warning steps: ${auto.warningTitles.slice(0, 5).join(', ')}`);
  }
  if (auto.failedTitles?.length) {
    lines.push(`Failed steps: ${auto.failedTitles.slice(0, 5).join(', ')}`);
  }
  // Always include plan steps for TUI rendering
  if (Array.isArray(auto.steps) && auto.steps.length > 0) {
    lines.push('Plan Steps:');
    auto.steps.forEach((s, idx) => {
      lines.push(`  ${idx + 1}. [${s.role}] ${s.title}`);
      if (String(s?.task || '').trim()) {
        lines.push(`     - task: ${String(s.task).trim()}`);
      }
    });
  }
  return lines.join('\n');
}

function buildAutoPlanFinalSummaryUserPrompt({ goal, autoPlan, runItems, planningError }) {
  const lines = [];
  lines.push('Create a final execution summary for an auto-generated implementation/test plan.');
  lines.push('Keep it concise, high-signal, and outcome-focused.');
  lines.push('Include: overall result, what was verified, what is still pending, and the best next action.');
  lines.push('Use plain text only. Do not use markdown fences.');
  lines.push('');
  lines.push(`Goal: ${goal}`);
  lines.push(`Plan Summary: ${autoPlan?.summary || `Auto plan for: ${goal}`}`);
  if (planningError) {
    lines.push(`Planning Error: ${planningError}`);
  }
  lines.push('');
  lines.push('Executed Steps:');
  runItems.forEach((item, idx) => {
    lines.push(`${idx + 1}. [${item.role}] ${item.title}`);
    if (item.failed) {
      lines.push(`Status: failed`);
    } else if (item.warning) {
      lines.push(`Status: warning`);
    } else {
      lines.push(`Status: completed`);
    }
    if (item.error) {
      lines.push(`Error: ${item.error}`);
    }
    if (item.warning) {
      lines.push(`Warning: ${item.warning}`);
    }
    lines.push(`Output: ${trimInline(item.output || '(empty)', 500)}`);
    if (Array.isArray(item.artifactPaths) && item.artifactPaths.length > 0) {
      lines.push(`Artifacts: ${item.artifactPaths.slice(0, 5).join(', ')}`);
    }
    lines.push('');
  });
  return lines.join('\n').trim();
}

async function buildAutoPlanFinalSummary({
  goal,
  autoPlan,
  runItems,
  planningError,
  config,
  model,
  systemPrompt
}) {
  const fallbackParts = [];
  if (runItems.some((item) => item.failed || item.error)) {
    fallbackParts.push('Execution finished with failed steps.');
  } else if (runItems.some((item) => item.warning)) {
    fallbackParts.push('Execution finished with warnings.');
  } else {
    fallbackParts.push('Execution finished successfully.');
  }
  const verifiedTitles = runItems.filter((item) => !item.failed).map((item) => item.title);
  const pendingTitles = runItems.filter((item) => item.failed || item.warning).map((item) => item.title);
  if (verifiedTitles.length > 0) {
    fallbackParts.push(`Completed: ${verifiedTitles.slice(0, 4).join(', ')}.`);
  }
  if (pendingTitles.length > 0) {
    fallbackParts.push(`Needs follow-up: ${pendingTitles.slice(0, 4).join(', ')}.`);
  }
  const fallbackSummary = fallbackParts.join(' ');

  if (runItems.some((item) => item.failed || item.error)) {
    return fallbackSummary;
  }

  try {
    const summarySystemPrompt = await composeSystemPrompt({
      shellRulesPrompt: systemPrompt,
      config,
      skillsPrompt: 'You are writing the final execution summary for a completed auto plan. Focus on closure, verification status, and the next action.',
      includeSoul: false,
      includeMemory: false
    });
    const result = await createChatCompletion({
      sdkProvider: config.sdk?.provider,
      baseUrl: config.gateway.base_url,
      apiKey: config.gateway.api_key,
      model: model || config.model.name,
      messages: [
        {
          role: 'system',
          content: summarySystemPrompt
        },
        {
          role: 'user',
          content: buildAutoPlanFinalSummaryUserPrompt({ goal, autoPlan, runItems, planningError })
        }
      ],
      timeoutMs: config.gateway.timeout_ms || 1800000,
      maxRetries: config.gateway.max_retries ?? 2
    });
    return trimInline(result.text || '', 600) || fallbackSummary;
  } catch {
    return fallbackSummary;
  }
}

async function writeMarkdownInProjectDir(subDir, title, body, fallbackName, sessionId, workspaceRoot = process.cwd()) {
  const dir =
    subDir === 'specs'
      ? getProjectSpecsDir(workspaceRoot, sessionId)
      : subDir === 'plans'
        ? getProjectPlansDir(workspaceRoot, sessionId)
        : path.join(getProjectWorkspaceDir(workspaceRoot), subDir, ...(sessionId ? [String(sessionId)] : []));
  await fs.mkdir(dir, { recursive: true });
  const slug = slugify(title).slice(0, 64);
  const fileName = `${nowStamp()}-${slug || fallbackName}.md`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, `${body.trim()}\n`, 'utf8');
  return filePath;
}

function buildSpecTemplate(topic) {
  return `
# ${topic} Design

## Summary
- Problem statement
- Desired outcome
- Why this is worth doing

## Goals
- Primary goal
- Secondary goals

## Non-Goals
- Out-of-scope behavior
- Explicitly rejected approaches

## User Experience / Command Behavior
- User-facing commands or flows
- Review or approval behavior
- Expected outputs

## Architecture
- Main modules and responsibilities
- Data flow
- Integration points

## Data / State Model
- New or changed state
- Persistence locations
- Lifecycle and cleanup behavior

## Safety Rules
- Guardrails
- Permission or approval requirements
- Failure behavior

## Requirements
- Functional requirements
- Non-functional requirements
- Win10 compatibility requirements

## Risks and Mitigations
- Risk
- Mitigation

## Testing / Validation
- Test strategy
- Acceptance checklist
`;
}

const SPEC_SECTION_DEFINITIONS = [
  ['summary', 'Summary'],
  ['goals', 'Goals'],
  ['non_goals', 'Non-Goals'],
  ['user_experience', 'User Experience / Command Behavior'],
  ['architecture', 'Architecture'],
  ['data_state_model', 'Data / State Model'],
  ['safety_rules', 'Safety Rules'],
  ['requirements', 'Requirements'],
  ['risks_mitigations', 'Risks and Mitigations'],
  ['testing_validation', 'Testing / Validation']
];
const REQUIRED_SPEC_HEADINGS = SPEC_SECTION_DEFINITIONS.map(([, heading]) => heading);

function normalizeHeadingText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function analyzeSpecCompleteness(specText = '') {
  const text = String(specText || '');
  const found = new Set();
  for (const match of text.matchAll(/^##\s+(.+?)\s*#*\s*$/gm)) {
    found.add(normalizeHeadingText(match[1]));
  }
  const missingHeadings = REQUIRED_SPEC_HEADINGS.filter((heading) => !found.has(normalizeHeadingText(heading)));
  return {
    complete: /^#\s+\S.+$/m.test(text) && missingHeadings.length === 0,
    missingHeadings
  };
}

export function normalizeGeneratedSpecText(specText = '', topic = 'spec') {
  const raw = String(specText || '').trim();
  const firstHeading = raw.search(/^#\s+\S.+$/m);
  const candidate = firstHeading >= 0 ? raw.slice(firstHeading).trim() : raw;
  return analyzeSpecCompleteness(candidate).complete
    ? candidate
    : buildFallbackStructuredSpec(topic);
}

function normalizeSpecList(value, fallback = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out = [];
    const goal = String(value.goal || '').trim();
    const summary = String(value.summary || '').trim();
    const requirements = normalizeSpecList(value.requirements);
    const acceptance = normalizeSpecList(value.acceptance_criteria || value.acceptanceCriteria || value.acceptance);
    const notes = normalizeSpecList(value.notes || value.details || value.considerations);
    if (goal) out.push(`目标：${goal}`);
    if (summary) out.push(`概述：${summary}`);
    if (requirements.length > 0) out.push(['需求：', ...requirements.map((item) => `  - ${item}`)].join('\n'));
    if (acceptance.length > 0) out.push(['验收：', ...acceptance.map((item) => `  - ${item}`)].join('\n'));
    if (notes.length > 0) out.push(['备注：', ...notes.map((item) => `  - ${item}`)].join('\n'));
    return out;
  }
  const source = Array.isArray(value)
    ? value
    : String(value || fallback)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim());
  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeSpecTitle(value, topic) {
  const raw = extractSpecTopicTitle(value || topic || 'Spec');
  const withoutHash = raw.replace(/^#\s+/, '').trim();
  return /design$/i.test(withoutHash) ? withoutHash : `${withoutHash} Design`;
}

function extractSpecTopicTitle(topic = 'spec') {
  return String(topic || 'spec')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || 'spec';
}

function extractSpecTopicContext(topic = '') {
  const text = String(topic || '');
  const context = text.match(/Exploration context:\s*([\s\S]*?)(?:\n\nAssumptions:|\nAssumptions:|$)/i)?.[1]?.trim() || '';
  const assumptionsText = text.match(/Assumptions:\s*([\s\S]*)$/i)?.[1] || '';
  const assumptions = assumptionsText
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean);
  return { context, assumptions };
}

function buildFallbackStructuredSpec(topic = 'spec') {
  const title = extractSpecTopicTitle(topic);
  const { context, assumptions } = extractSpecTopicContext(topic);
  return renderStructuredSpec({
    title,
    summary: [
      context,
      ...assumptions.map((item) => `假设：${item}`)
    ].filter(Boolean)
  }, title);
}

export function renderStructuredSpec(spec = {}, topic = 'spec') {
  const title = normalizeSpecTitle(spec.title, extractSpecTopicTitle(topic));
  const lines = [`# ${title}`, ''];
  for (const [key, heading] of SPEC_SECTION_DEFINITIONS) {
    const items = normalizeSpecList(spec[key]);
    lines.push(`## ${heading}`);
    for (const item of items.length > 0 ? items : ['无']) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function structuredSpecFromToolCalls(toolCalls = []) {
  const call = (Array.isArray(toolCalls) ? toolCalls : []).find((tc) => tc?.name === 'render_spec');
  return call ? parseModelJsonObject(call.arguments) : null;
}

function hasStructuredSpecSections(sections = {}) {
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return false;
  return SPEC_SECTION_DEFINITIONS.some(([key]) => normalizeSpecList(sections[key]).length > 0);
}

function extractSpecTitle(specText, fallback = 'spec') {
  const raw = String(specText || '');
  const heading = raw.match(/^#\s+Spec:\s+(.+)$/m) || raw.match(/^#\s+(.+)$/m);
  return String(heading?.[1] || fallback).trim();
}

/**
 * Prefer the Goals section goal statement over the document title/topic.
 * Used for the review "目标" field so it matches ## Goals, not # Title.
 */
export function extractSpecDisplayGoal(specText = '', { sections = null, fallback = '' } = {}) {
  const fromSectionObject = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const goal = String(value.goal || '').trim();
    if (goal) return goal;
    const summary = String(value.summary || '').trim();
    if (summary) return summary;
    return '';
  };

  const fromSections = fromSectionObject(sections?.goals);
  if (fromSections) return fromSections;

  const text = String(specText || '');
  const goalsBody = text.match(/^##\s+Goals\s*#*\s*\r?\n([\s\S]*?)(?=^##\s+|\s*$)/im)?.[1] || '';
  if (goalsBody.trim()) {
    const labeled = goalsBody.match(/(?:^|\n)\s*[-*]?\s*目标\s*[：:]\s*(.+)/);
    if (labeled?.[1]) return labeled[1].trim();
    const overview = goalsBody.match(/(?:^|\n)\s*[-*]?\s*概述\s*[：:]\s*(.+)/);
    if (overview?.[1]) return overview[1].trim();
    for (const line of goalsBody.split(/\r?\n/)) {
      const bullet = line.replace(/^\s*[-*]\s+/, '').trim();
      if (!bullet || bullet === '无') continue;
      if (/^(需求|验收|备注)\s*[：:]/.test(bullet)) continue;
      return bullet;
    }
  }

  const fb = extractSpecTopicTitle(fallback);
  return fb.replace(/\s+Design$/i, '').trim() || fb;
}

async function buildSpecWithModel({
  topic,
  config,
  model,
  systemPrompt
}) {
  const sectionSchema = (heading) => ({
    type: 'object',
    properties: {
      goal: { type: 'string', description: `One-sentence goal for the "${heading}" section` },
      summary: { type: 'string', description: `Concrete summary for the "${heading}" section` },
      requirements: { type: 'array', items: { type: 'string' }, description: `Implementation-ready requirements for "${heading}"` },
      acceptance_criteria: { type: 'array', items: { type: 'string' }, description: `Acceptance checks for "${heading}"` },
      notes: { type: 'array', items: { type: 'string' }, description: `Optional notes, constraints, file names, or evidence for "${heading}"` }
    },
    required: []
  });
  const sectionProperties = Object.fromEntries(
    SPEC_SECTION_DEFINITIONS.map(([key, heading]) => [
      key,
      sectionSchema(heading)
    ])
  );
  const renderSpecTool = {
    type: 'function',
    function: {
      name: 'render_spec',
      description: 'Submit structured engineering spec fields for local Markdown rendering.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short feature title without a leading markdown heading marker' },
          ...sectionProperties
        },
        required: ['title']
      }
    }
  };
  const prompt = [
    'Create a practical engineering spec, like an implementation-ready design document.',
    'You must call the render_spec tool exactly once with structured fields. Do not write markdown prose directly.',
    'Incorporate explicit assumptions provided by the caller.',
    'Each section may be an object with goal, summary, requirements, acceptance_criteria, and optional notes.',
    'Fill only sections that are supported by the provided context. Omit empty or unknown sections; the local renderer will display "无".',
    'Avoid placeholders like TBD, TODO, Problem statement, Desired outcome, implement later, or made-up filler.',
    'Make it concrete, scoped, and suitable for turning into a sub-agent implementation plan.',
    'Use concise engineering language. Include exact files/modules when known from the provided context.'
  ].join('\n');
  const specSystemPrompt = await composeSystemPrompt({
    shellRulesPrompt: systemPrompt,
    config,
    skillsPrompt: prompt,
    includeSoul: false,
    includeMemory: false
  });

  const result = await createChatCompletion({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: model || config.model.name,
    messages: [
      { role: 'system', content: specSystemPrompt },
      { role: 'user', content: `Topic: ${topic}` }
    ],
    tools: [renderSpecTool],
    toolChoice: { type: 'function', function: { name: 'render_spec' } },
    timeoutMs: config.gateway.timeout_ms || 1800000,
    maxRetries: config.gateway.max_retries ?? 2
  });
  const structured = structuredSpecFromToolCalls(result.toolCalls) || parseModelJsonObject(result.text);
  if (structured) {
    return renderStructuredSpec(structured, topic);
  }
  return buildFallbackStructuredSpec(topic);
}

function buildPlanTemplate(goal) {
  return `
# Plan: ${goal}

## Phase 1: Discovery
1. Confirm constraints and environment assumptions
2. Inspect related modules and dependencies
3. Define verification approach

## Phase 2: Implementation
1. Implement core flow
2. Integrate with existing command/runtime paths
3. Add guards for Win10-specific behavior

## Phase 3: Verification
1. Run automated tests
2. Run manual TUI validation
3. Document usage and rollback steps

## Task Breakdown
- [ ] Task A
- [ ] Task B
- [ ] Task C
`;
}

async function buildPlanFromSpecWithModel({
  specText,
  specPath,
  config,
  model,
  systemPrompt,
  workspaceRoot = process.cwd()
}) {
  const projectConstraints = await inferProjectImplementationConstraints(workspaceRoot);
  const prompt = [
    buildAutoPlanPlannerGuidance(),
    'Convert the provided engineering spec into an implementation plan.',
    `Return strict JSON only with shape {"summary":"...","task_size":"trivial|small|medium|large","task_type":"advisory|implementation|debugging|verification|refactor|documentation|hybrid","target_confidence":"known|likely|unknown","rationale":"...","steps":[{"title":"...","role":"${EXECUTOR_AGENT_ROLES.join('|')}","task":"...","consumes":"...","produces":"...","target_files":["..."],"success_criteria":"...","verification":"...","handoff":"..."}]}. No markdown.`,
    'Make the plan concrete and ordered for a coding agent.',
    'Before defining tasks, map the files/modules likely to be touched and what each is responsible for.',
    'Each task should name exact files where known, expected behavior, and verification commands or evidence.',
    'Do not use placeholders such as TBD, TODO, "handle edge cases", "write tests", or "implement later" without concrete details.',
    'Break work into independently understandable tasks with clear responsibility and testable progress.',
    'Prefer small, focused file boundaries where the plan creates or reorganizes code, while respecting existing project patterns.',
    'Keep type names, function names, command names, and file paths consistent across all phases.',
    'Always include a summarizer as the final step.'
  ].join('\n');
  const planSystemPrompt = await composeSystemPrompt({
    shellRulesPrompt: systemPrompt,
    config,
    skillsPrompt: prompt,
    includeSoul: false,
    includeMemory: false
  });

  const result = await createChatCompletion({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: model || config.model.name,
    messages: [
      { role: 'system', content: planSystemPrompt },
      {
        role: 'user',
        content: `Spec path: ${specPath || '(inline)'}\n\nProject implementation constraints:\n${projectConstraints}\n\n${specText}`
      }
    ],
    timeoutMs: config.gateway.timeout_ms || 1800000,
    maxRetries: config.gateway.max_retries ?? 2
  });
  const parsed = parseModelJsonObject(result.text || '');
  const goal = `approved spec ${specPath || '(inline)'}`;
  const autoPlan = normalizeAutoPlan(parsed, goal);
  return renderAutoPlanMarkdown({
    goal,
    autoPlan,
    finalSummary: 'Plan generated from approved spec.',
    approvalText: buildPlanReviewApprovalText('created'),
    progressLine: buildPlanReviewProgressLine('created')
  });
}

async function collectLikelyImplementationFiles(cwd) {
  const candidates = [];
  const roots = ['src', 'app', 'lib'];
  const preferredExts = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

  async function visit(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.codemini') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(abs);
        continue;
      }
      if (!preferredExts.has(path.extname(entry.name).toLowerCase())) continue;
      candidates.push(normalizePath(path.relative(cwd, abs)));
      if (candidates.length >= 8) return;
    }
  }

  for (const root of roots) {
    const absRoot = path.join(cwd, root);
    if (!(await pathExists(absRoot))) continue;
    await visit(absRoot);
    if (candidates.length >= 8) break;
  }
  return candidates.slice(0, 8);
}

async function inferProjectImplementationConstraints(cwd) {
  const hints = [];
  const packageJsonPath = path.join(cwd, 'package.json');
  const pyprojectPath = path.join(cwd, 'pyproject.toml');
  const cargoPath = path.join(cwd, 'Cargo.toml');
  const goModPath = path.join(cwd, 'go.mod');

  if (await pathExists(packageJsonPath)) {
    hints.push('- Detected package.json in the workspace.');
    hints.push('- Prefer JavaScript/TypeScript style paths and file names that fit the existing repo.');
    hints.push('- Reuse existing src/*.js, src/*.ts, or neighboring modules before inventing new utility modules.');
  }
  if (await pathExists(pyprojectPath)) {
    hints.push('- Detected pyproject.toml in the workspace.');
    hints.push('- Prefer Python modules and package layout that already exist in this repo.');
  }
  if (await pathExists(cargoPath)) {
    hints.push('- Detected Cargo.toml in the workspace.');
    hints.push('- Prefer Rust crate/module layout that matches the current workspace.');
  }
  if (await pathExists(goModPath)) {
    hints.push('- Detected go.mod in the workspace.');
    hints.push('- Prefer Go package paths and file names already present in the repo.');
  }

  if (hints.length === 0) {
    hints.push('- No strong language marker was detected automatically.');
    hints.push('- Infer the implementation language from the referenced files in the spec and preserve that language family.');
  }

  const likelyFiles = await collectLikelyImplementationFiles(cwd);
  if (likelyFiles.length > 0) {
    hints.push('- Likely existing implementation files to reuse first:');
    for (const file of likelyFiles) {
      hints.push(`  - ${file}`);
    }
    hints.push('- Prefer updating one of the listed files when the feature naturally fits there before inventing new modules.');
  }

  hints.push('- Do not invent files in another language family unless the spec explicitly requires it.');
  hints.push('- If the spec references existing files, keep the plan anchored to those exact files or their immediate neighbors.');
  return hints.join('\n');
}

function clampRange(start, end, max) {
  const s = Math.max(1, Math.min(start, max));
  const e = Math.max(s, Math.min(end, max));
  return { s, e };
}

function effectiveMaxContextTokens(config) {
  const modelCap = Number(config.model?.max_context_tokens);
  if (Number.isFinite(modelCap) && modelCap > 0) return modelCap;
  const legacy = Number(config.context?.max_tokens);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return 32000;
}

function estimateTextTokens(role, content) {
  const text = String(content || '');
  if (!text) return 0;
  return estimateMessagesTokens([{ role, content: text }]);
}

function makePromptBudgetComponent(name, role, content) {
  const text = String(content || '');
  return {
    name,
    chars: text.length,
    estimated_tokens: estimateTextTokens(role, text)
  };
}

function buildPromptBudgetAudit({
  systemPrompt = '',
  projectContextPrompt = '',
  messages = [],
  toolDefinitions = [],
  config = {}
}) {
  const toolSchemaText = JSON.stringify(toolDefinitions || []);
  const messageTexts = (Array.isArray(messages) ? messages : []).map((message) => ({
    role: message?.role || 'user',
    content: message?.content || ''
  }));
  const components = [
    makePromptBudgetComponent('system_prompt', 'system', systemPrompt),
    makePromptBudgetComponent('project_context', 'user', projectContextPrompt),
    {
      name: 'message_history',
      chars: messageTexts.reduce((total, message) => total + String(message.content || '').length, 0),
      estimated_tokens: estimateMessagesTokens(messageTexts)
    },
    makePromptBudgetComponent('tool_schemas', 'system', toolSchemaText)
  ];
  const totalChars = components.reduce((total, component) => total + component.chars, 0);
  const totalTokens = components.reduce((total, component) => total + component.estimated_tokens, 0);
  const maxContextTokens = effectiveMaxContextTokens(config);
  const contextUsagePct =
    maxContextTokens > 0 ? Math.min(100, Math.max(0, (totalTokens / maxContextTokens) * 100)) : 0;
  return {
    components,
    total: {
      chars: totalChars,
      estimated_tokens: totalTokens
    },
    max_context_tokens: maxContextTokens,
    context_usage_pct: contextUsagePct
  };
}

export function buildProjectContextUserPrompt({
  projectContextSnippet = '',
  projectContextGuidance = '',
  userText = '',
  turnContextPrefix = ''
} = {}) {
  return buildTurnUserPrompt({
    turnContextPrefix,
    projectContextSnippet,
    projectContextGuidance,
    userText
  });
}

export function injectProjectContextIntoLastUserMessage(messages = [], projectContextPrompt = '') {
  const contextPrompt = String(projectContextPrompt || '').trim();
  const source = Array.isArray(messages) ? messages : [];
  if (!contextPrompt) return source;
  const next = source.map((message) => ({ ...message }));
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index]?.role !== 'user') continue;
    const content = next[index].content;
    next[index] = {
      ...next[index],
      content: Array.isArray(content)
        ? [
            { type: 'text', text: contextPrompt },
            ...content.filter((block) => block?.type !== 'text')
          ]
        : contextPrompt
    };
    return next;
  }
  return [...next, { role: 'user', content: contextPrompt }];
}

export function attachCurrentTurnModelContent(message, modelContent = '') {
  const content = String(modelContent || '');
  if (message?.role !== 'user' || !content || content === message.content) return message;
  return {
    ...message,
    model_content: content,
    model_content_scope: 'current_turn',
  };
}

function summarizePromptBudgetAudit(audit) {
  const totalTokens = audit?.total?.estimated_tokens || 0;
  const maxContextTokens = audit?.max_context_tokens || 0;
  const pct = Number(audit?.context_usage_pct || 0).toFixed(1);
  const components = (audit?.components || [])
    .filter((component) => component.estimated_tokens > 0)
    .map((component) => `${component.name}=${component.estimated_tokens}`)
    .join(', ');
  return `prompt budget: ${totalTokens}/${maxContextTokens} est tokens (${pct}%)${components ? `; ${components}` : ''}`;
}

function estimateBaselinePromptOverhead(config, executionMode) {
  // System prompt overhead: default prompt + soul + reply language directive
  let overhead = 2800;
  // Plan mode uses richer tool definitions and plan-specific prompts
  if (executionMode === 'plan') overhead += 1500;
  // Project context snippet (file index, AST map)
  if (config.context?.project_context_enabled !== false) overhead += 1200;
  // Always-installed skills add prompt content
  const alwaysCount = Array.isArray(config.skills?.always) ? config.skills.always.length : 0;
  if (alwaysCount > 0) overhead += alwaysCount * 200;
  return overhead;
}

export function resolveLatestContextMeasurement(messages = [], fallbackOverhead = 0) {
  const visibleMessages = modelVisibleMessages(Array.isArray(messages) ? messages : []);
  for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
    const message = visibleMessages[index];
    if (message?.role !== 'assistant') continue;
    const usage = normalizeModelUsage(message.usage);
    if (usage?.inputTokens > 0) {
      return { tokens: usage.inputTokens, source: 'actual' };
    }
    return {
      tokens: estimateMessagesTokens(visibleMessages.slice(0, index)) + fallbackOverhead,
      source: 'estimated'
    };
  }
  return { tokens: 0, source: 'estimated' };
}

export function buildRuntimeStateSnapshot({ currentSession, config, model, executionMode, extraSession, workspaceRoot, alwaysSkillNames = [] }) {
  const activeMessages = extraSession
    ? extraSession.messages || []
    : Array.isArray(currentSession?.compact?.view) && currentSession.compact.view.length > 0
      ? currentSession.compact.view
      : currentSession?.messages || [];
  const baselineOverhead = activeMessages.length > 0
    ? estimateBaselinePromptOverhead(config, executionMode)
    : 0;
  const contextMeasurement = resolveLatestContextMeasurement(activeMessages, baselineOverhead);
  const currentContextTokens = contextMeasurement.tokens;
  const contextUsageSource = contextMeasurement.source;
  const maxContextTokens = effectiveMaxContextTokens(config);
  const contextUsagePct = maxContextTokens > 0 ? Math.min(100, Math.max(0, (currentContextTokens / maxContextTokens) * 100)) : 0;
  const planState = currentSession?.planState;
  const specState = getPendingSpecState(currentSession);
  const resolvedMode = resolveRuntimeExecutionMode(executionMode, config, currentSession);
  const soulCategory = soulContextFromExecutionMode(resolvedMode);
  const visibleAlwaysSkillNames = shouldInjectAlwaysSkills(resolvedMode)
    ? (Array.isArray(alwaysSkillNames) ? alwaysSkillNames : []).map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  const snapshot = {
    workspaceRoot,
    projectIsGit: Boolean(config?.runtime?.project_is_git),
    sessionId: currentSession?.id || '',
    sessionTitle: currentSession?.title || '',
    messageCount: Array.isArray(currentSession?.messages) ? currentSession.messages.length : 0,
    mode: resolvedMode,
    approvalMode: config.execution?.approval_mode || 'auto',
    sandboxMode: config.sandbox?.mode || 'workspace-write',
    shell: config.shell?.default || 'bash',
    sandboxUiEnabled: true,
    approvalUiEnabled: resolveApprovalUiEnabled({
      config,
      cwd: workspaceRoot,
      platform: process.platform,
    }),
    sdkProvider: config.sdk?.provider || 'openai-compatible',
    agentRole: 'general',
    model: model || config.model?.name || '',
    mainModel: config.model?.name || '',
    fastModel: config.model?.fast_name || config.model?.name || '',
    maxContextTokens,
    alwaysSkillNames: visibleAlwaysSkillNames,
    reasoningEnabled: config.model?.reasoning_enabled !== false,
    reasoningEffort: normalizeReasoningEffort(config.model?.reasoning_effort),
    activeSoul: getActiveSoulName(config, soulCategory),
    soulCategory,
    pendingPlanApproval: null,
    pendingSpecApproval: specState
      ? buildPendingSpecSnapshot(specState)
      : null,
    pendingReflectSkill: planState?.status === 'pending_reflect_skill'
      ? buildPendingReflectSkillSnapshot(planState)
      : null
  };
  Object.defineProperties(snapshot, {
    currentContextTokens: {
      value: currentContextTokens,
      enumerable: false,
      writable: false
    },
    contextUsagePct: {
      value: contextUsagePct,
      enumerable: false,
      writable: false
    },
    contextUsageSource: {
      value: contextUsageSource,
      enumerable: false,
      writable: false
    },
    replyLanguage: {
      value: getReplyLanguage(config),
      enumerable: false,
      writable: false
    },
    toJSON: {
      value: () => ({
        ...snapshot,
        currentContextTokens,
        contextUsagePct,
        contextUsageSource,
        replyLanguage: getReplyLanguage(config)
      }),
      enumerable: false,
      writable: false
    }
  });
  return snapshot;
}

export function buildChatActionValidationState(runtimeState = {}, activeApproval = null) {
  const { resolve: _resolve, ...pendingApproval } = activeApproval || {};
  return {
    ...runtimeState,
    pendingReflectApproval: runtimeState.pendingReflectSkill || null,
    pendingApproval: activeApproval ? pendingApproval : null
  };
}

function resolveDefaultModel(config) {
  return String(config?.model?.name || '').trim();
}

function resolveFastModel(config) {
  return String(config?.model?.fast_name || config?.model?.lite_name || config?.model?.name || '').trim();
}

const CODING_ROUTE_JUDGE_TIMEOUT_MS = 3000;

async function judgeCodingRouteNodes({ request, config, model, signal }) {
  const routeModel = resolveFastModel(config) || model || config?.model?.name;
  if (!routeModel) return null;
  const result = await createChatCompletion({
    sdkProvider: config?.sdk?.provider,
    baseUrl: config?.gateway?.base_url,
    apiKey: config?.gateway?.api_key,
    model: routeModel,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ],
    tools: [],
    temperature: 0,
    reasoningEffort: 'off',
    maxTokens: 480,
    payloadExtras: { max_tokens: 480 },
    timeoutMs: Math.min(Number(config?.gateway?.timeout_ms || CODING_ROUTE_JUDGE_TIMEOUT_MS), CODING_ROUTE_JUDGE_TIMEOUT_MS),
    maxRetries: 0,
    signal,
  });
  return result?.text || '';
}

const ROUTE_TRACE_EDIT_TOOLS = new Set(['edit', 'write', 'begin_write', 'write_chunk', 'commit_write', 'apply_patch', 'delete']);

/**
 * Extract only the previous completed user turn. Older work must not make an
 * unrelated request look like a continuation.
 */
export function buildPreviousTurnToolTrace(session, { maxTools = 8 } = {}) {
  const recentTools = [];
  let editCount = 0;
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role === 'user') break;
    if (msg?.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue;
    for (const call of msg.tool_calls) {
      if (recentTools.length >= maxTools) break;
      const name = String(call?.function?.name || call?.name || '').trim();
      if (!name) continue;
      recentTools.push(name);
      if (ROUTE_TRACE_EDIT_TOOLS.has(name)) editCount += 1;
    }
  }
  return { recentTools: recentTools.reverse(), editCount };
}

export function resolveSubAgentModel(config, fallbackModel = '') {
  return String(
    config?.model?.fast_name
      || config?.model?.lite_name
      || fallbackModel
      || config?.model?.name
      || ''
  ).trim();
}

async function generateSessionTitle({ userText, assistantText = '', config, signal }) {
  // Some reasoning-capable Anthropic-compatible models consume ~100 output
  // tokens before emitting the short final label. A 64-token cap can therefore
  // produce an empty assistant response and silently fall back to raw user text.
  const TITLE_MAX_OUTPUT_TOKENS = 256;
  const fallback = normalizeGeneratedSessionTitle(deriveSessionTitle([{ role: 'user', content: userText }]));
  const latestConfig = await loadConfig().catch(() => config);
  const effectiveConfig = latestConfig || config;
  const fastModel = resolveFastModel(effectiveConfig);
  if (!fastModel) return fallback;
  try {
    const result = await retrySessionTitleRequest(() => createChatCompletion({
      sdkProvider: effectiveConfig.sdk?.provider,
      baseUrl: effectiveConfig.gateway.base_url,
      apiKey: effectiveConfig.gateway.api_key,
      model: fastModel,
      messages: buildSessionTitleMessages({ userText, assistantText }, effectiveConfig),
      tools: [],
      temperature: 0.1,
      // Keep this completion in "label generation" mode across providers:
      // reasoning or a large output budget makes short prompts prone to get a
      // normal assistant acknowledgement instead of a topic label.
      reasoningEffort: 'off',
      maxTokens: TITLE_MAX_OUTPUT_TOKENS,
      payloadExtras: { max_tokens: TITLE_MAX_OUTPUT_TOKENS },
      timeoutMs: Math.min(Number(effectiveConfig.gateway?.timeout_ms || 30000), 30000),
      maxRetries: 0,
      signal
    }), { retries: 1, signal });
    return normalizeGeneratedSessionTitle(result?.text, fallback) || fallback;
  } catch (error) {
    console.warn(
      `[session-title] generation failed; using fallback: ${String(error?.message || error || 'unknown error')}`
    );
    return fallback;
  }
}

export function createSessionTitleTaskCoordinator({
  generateTitle = generateSessionTitle,
  save = saveSession
} = {}) {
  const controller = new AbortController();
  const pending = new Set();
  const revisions = new Map();
  let onTitleUpdate = null;
  let onTitleStatus = null;
  let disposed = false;
  let disposePromise = null;

  const emit = (sessionId, title, metadata = {}) => {
    const id = String(sessionId || '').trim();
    const nextTitle = String(title || '').trim();
    if (disposed || !id || !nextTitle) return;
    onTitleUpdate?.(id, nextTitle, metadata);
  };

  const emitStatus = (sessionId, generating) => {
    const id = String(sessionId || '').trim();
    if (disposed || !id) return;
    onTitleStatus?.(id, Boolean(generating));
  };

  const schedule = ({
    session,
    userText,
    assistantText = '',
    config,
    preserveUpdatedAt = ''
  } = {}) => {
    if (disposed || controller.signal.aborted || !session?.id) return null;
    const sessionId = String(session.id);
    const revision = (revisions.get(sessionId) || 0) + 1;
    revisions.set(sessionId, revision);
    emitStatus(sessionId, true);
    let tracked;
    tracked = (async () => {
      const generatedTitle = await generateTitle({
        userText,
        assistantText,
        config,
        signal: controller.signal
      });
      if (
        disposed ||
        controller.signal.aborted ||
        revisions.get(sessionId) !== revision
      ) return null;
      if (!generatedTitle || generatedTitle === session.title) return generatedTitle || null;
      session.title = generatedTitle;
      await save(session, { preserveUpdatedAt });
      if (!disposed && !controller.signal.aborted) {
        emit(session.id, generatedTitle, { preserveUpdatedAt: Boolean(preserveUpdatedAt) });
      }
      return generatedTitle;
    })()
      .catch(() => null)
      .finally(() => {
        pending.delete(tracked);
        if (revisions.get(sessionId) === revision) emitStatus(sessionId, false);
      });
    pending.add(tracked);
    return tracked;
  };

  return {
    emit,
    schedule,
    setOnTitleUpdate(callback) {
      onTitleUpdate = typeof callback === 'function' ? callback : null;
    },
    setOnTitleStatus(callback) {
      onTitleStatus = typeof callback === 'function' ? callback : null;
    },
    dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      onTitleUpdate = null;
      onTitleStatus = null;
      controller.abort();
      disposePromise = Promise.allSettled([...pending]).then(() => {
        pending.clear();
        revisions.clear();
      });
      return disposePromise;
    }
  };
}

function createCompactSummaryGenerator(config, signal) {
  return async (olderMessages) => {
    const latestConfig = await loadConfig().catch(() => config);
    const effectiveConfig = latestConfig || config;
    const fastModel = resolveFastModel(effectiveConfig);
    if (!fastModel) throw new Error('No fast model');
    const transcript = buildTranscriptForLLM(olderMessages);
    const result = await createChatCompletion({
      sdkProvider: effectiveConfig.sdk?.provider,
      baseUrl: effectiveConfig.gateway.base_url,
      apiKey: effectiveConfig.gateway.api_key,
      model: fastModel,
      messages: [
        {
          role: 'system',
          content: appendStructuredOutputLanguageRule(COMPACT_SUMMARY_PROMPT, effectiveConfig, {
            fields: 'the entire summary'
          })
        },
        { role: 'user', content: transcript.slice(0, 12000) }
      ],
      tools: [],
      timeoutMs: Math.min(Number(effectiveConfig.gateway?.timeout_ms || 30000), 60000),
      maxRetries: 0,
      signal
    });
    const text = result?.text?.trim();
    if (!text) throw new Error('Empty summary');
    return text;
  };
}

function estimatePromptTokensForRequest(sessionMessages, userText = '') {
  const tokenMsgs = [
    ...modelVisibleMessages(sessionMessages),
    { role: 'user', content: String(userText || '') }
  ];
  return estimateMessagesTokens(tokenMsgs);
}

function stampedMessage(role, content, extra = {}) {
  return {
    role,
    content,
    at: new Date().toISOString(),
    ...extra
  };
}

function abortContinuesInPlace(signal) {
  const reason = signal?.reason;
  return Boolean(reason) && typeof reason === 'object' && reason.continueInPlace === true;
}

function getPendingSpecState(session) {
  const specState = normalizeSpecState(session?.specState);
  if (specState?.status === 'pending_approval') return specState;
  const legacyPlanState = session?.planState;
  if (legacyPlanState?.status === 'pending_spec_approval') {
    return normalizeSpecState(legacyPlanState);
  }
  return null;
}

function hasPendingSpecApproval(session) {
  return Boolean(getPendingSpecState(session));
}

function hasPendingReflectSkill(session) {
  return session?.planState?.status === 'pending_reflect_skill';
}

export function isEngineeringWorkflowPending(session) {
  return hasPendingSpecApproval(session);
}

export function resolveRuntimeExecutionMode(executionMode, config, session) {
  if (isEngineeringWorkflowPending(session)) return 'plan';
  return normalizeExecutionMode(executionMode || config?.execution?.mode || 'normal');
}

function buildPendingReflectSkillMessage(reflectState) {
  const candidates = Array.isArray(reflectState?.candidates) ? reflectState.candidates : [];
  if (candidates.length === 0) {
    return 'Reflect found no reusable skill candidate.';
  }
  const lines = [
    'Reflect skill draft pending.',
  ];
  for (const candidate of candidates) {
    lines.push('');
    lines.push(`[${candidate.id || 1}] ${candidate.name}`);
    lines.push(`Confidence: ${Number(candidate.confidence ?? 0.75).toFixed(2)}`);
    lines.push(`Target: ${candidate.targetPath || '-'}`);
    lines.push('');
    lines.push(String(candidate.content || '').trim());
  }
  lines.push('');
  lines.push('Choose Write, Revise, or Discard in the review controls.');
  return lines.join('\n');
}

function buildPendingReflectSkillSnapshot(reflectState) {
  const candidates = Array.isArray(reflectState?.candidates) ? reflectState.candidates : [];
  const candidate = candidates[0] || null;
  if (!candidate) return null;
  return {
    scope: 'global',
    context: candidate.context || reflectState?.targetContext || 'global',
    request: reflectState?.request || '',
    name: candidate.name || '',
    description: candidate.description || '',
    confidence: Number(candidate.confidence ?? 0.75),
    targetPath: candidate.targetPath || '',
    content: candidate.content || ''
  };
}

function buildPendingSpecSnapshot(specState) {
  const normalized = normalizeSpecState(specState);
  if (!normalized || normalized.status !== 'pending_approval') return null;
  const completeness = analyzeSpecCompleteness(normalized.specText || '');
  const extractedGoal = extractSpecDisplayGoal(normalized.specText, {
    fallback: ''
  });
  const storedGoal = normalized.goal || '';
  const title = extractSpecTitle(normalized.specText, normalized.summary || '');
  const stripDesign = (value) => String(value || '').replace(/\s+Design$/i, '').trim().toLowerCase();
  // Legacy create_spec stored the document title as goal; prefer Goals extraction then.
  const storedLooksLikeTitle = Boolean(
    storedGoal
    && title
    && (
      stripDesign(storedGoal) === stripDesign(title)
      || (normalized.summary && stripDesign(storedGoal) === stripDesign(normalized.summary))
    )
  );
  const displayGoal = storedLooksLikeTitle || !storedGoal
    ? (extractedGoal || storedGoal)
    : storedGoal;
  return {
    goal: displayGoal || '',
    summary: normalized.summary || '',
    specText: normalized.specText || '',
    filePath: normalized.specPath || '',
    complete: completeness.complete,
    missingHeadings: completeness.missingHeadings
  };
}

function updatePendingReflectState(session, patch = {}, workspaceRoot = process.cwd()) {
  if (!hasPendingReflectSkill(session)) return null;
  const scope = 'global';
  const draft = normalizeReflectDraft({
    ...(Array.isArray(session.planState.candidates) ? session.planState.candidates[0] : {}),
    ...patch
  });
  const candidates = attachReflectTargets({ candidates: [draft], scope, workspaceRoot });
  session.planState = {
    ...session.planState,
    targetContext: draft.context || 'global',
    candidates
  };
  return buildPendingReflectSkillSnapshot(session.planState);
}

function updatePendingSpecState(session, patch = {}) {
  if (!hasPendingSpecApproval(session)) return null;
  const current = getPendingSpecState(session);
  session.specState = {
    ...current,
    goal: String(patch.goal ?? current.goal ?? '').trim(),
    summary: String(patch.summary ?? current.summary ?? '').trim(),
    specText: String(patch.specText ?? current.specText ?? '').trim()
  };
  if (session.planState?.status === 'pending_spec_approval') session.planState = null;
  return buildPendingSpecSnapshot(session.specState);
}

function buildApprovedPlanExecutionPrompt(planState, approvalText = '') {
  const requirementPacket = buildGoalRequirementPacket(planState?.goal || '', 'coder');
  const planSteps = Array.isArray(planState?.steps) ? planState.steps : [];
  const renderedSteps = planSteps.map((step, index) => `${index + 1}. [${step.role}] ${step.title} :: ${step.task}`);
  const stepLines = renderedSteps.length <= 16
    ? renderedSteps
    : [
        ...renderedSteps.slice(0, 12),
        `... ${renderedSteps.length - 16} middle step(s) omitted from this overview; executePlanWithSubAgents still receives the complete planState.steps list.`,
        ...renderedSteps.slice(-4)
      ];
  const lines = [
    'Implementation plan:',
    `Original goal: ${planState?.goal || '-'}`,
    `Plan file: ${planState?.filePath || '-'}`,
    `Plan summary: ${planState?.summary || '-'}`,
    `Final planning summary: ${planState?.finalSummary || planState?.summary || '-'}`,
    `Execution trigger: ${String(approvalText || '').trim() || 'automatic coding-mode plan execution'}`,
    requirementPacket,
    planSteps.length > 0 ? `Planned steps (${planSteps.length} total):` : '',
    ...stepLines,
    'Proceed with implementation now.',
    'Follow the plan direction unless a blocking contradiction appears.',
    'Before changing files, critically review the plan. If it has critical gaps, impossible steps, or unclear requirements, stop and ask for clarification.',
    'During execution, complete steps in order, keep scope tight, and leave runtime verification to tester steps or the user when the environment is not ready.',
    'If a step is blocked by missing dependencies, unclear instructions, repeated verification failures, or the user declining run commands, stop and report the blocker rather than guessing or retrying the same command.',
    'Output rules for this implementation phase:',
    '- Be concise and practical.',
    '- Do not celebrate, praise, or use emojis.',
    '- Do not restate the full plan back to the user.',
    '- If the work is already done, say so briefly and cite any available evidence.',
    '- If verification could not run or the user declined a run command, say verification was deferred instead of treating implementation as incomplete.',
    '- After implementation or verification, prefer a short result summary in 3-6 lines.',
    '- If the work is complete, use this exact structure:',
    'Status: <done|partial|blocked>',
    'Verified: <tests, checks, or evidence>',
    'Next: <none or the single next action>'
  ];
  return lines.join('\n');
}

async function resolveSpecPath(rawArg = '', sessionId = '', workspaceRoot = process.cwd()) {
  const input = String(rawArg || '').trim();
  const roots = [
    getProjectSpecsDir(workspaceRoot, String(sessionId || '')),
    getProjectSpecsDir(workspaceRoot)
  ];

  if (input) {
    const direct = path.resolve(workspaceRoot, input);
    try {
      await fs.access(direct);
      return direct;
    } catch {}

    for (const root of roots) {
      try {
        const entries = await fs.readdir(root);
        const match = entries.find((name) => name.endsWith('.md') && name.includes(input));
        if (match) return path.join(root, match);
      } catch {
        continue;
      }
    }
  }

  for (const root of roots) {
    try {
      const latest = (await fs.readdir(root))
        .filter((name) => name.endsWith('.md'))
        .sort()
        .reverse()[0];
      if (latest) return path.join(root, latest);
    } catch {
      continue;
    }
  }
  return '';
}

async function expandFileMentions(rawText, workspaceRoot = process.cwd()) {
  const text = String(rawText || '');
  const mentionRegex = /@([A-Za-z0-9_./\\-]+)(?::(\d+)-(\d+))?/g;
  const matches = Array.from(text.matchAll(mentionRegex));
  if (matches.length === 0) return text;

  let out = text;
  for (const m of matches) {
    const full = m[0];
    const relPath = m[1];
    const a = m[2] ? Number(m[2]) : null;
    const b = m[3] ? Number(m[3]) : null;
    const abs = path.resolve(workspaceRoot, relPath);
    if (!abs.startsWith(path.resolve(workspaceRoot))) continue;
    try {
      const content = await fs.readFile(abs, 'utf8');
      let snippet = content;
      if (a && b) {
        const lines = content.split('\n');
        const { s, e } = clampRange(a, b, lines.length);
        snippet = lines.slice(s - 1, e).join('\n');
      }
      const replacement = `\n[FILE:${relPath}${a && b ? `:${a}-${b}` : ''}]\n${snippet}\n[/FILE]\n`;
      out = out.replace(full, replacement);
    } catch {
      continue;
    }
  }
  return out;
}

async function askModel({
  text,
  modelText,
  modelImages = [],
  session,
  config,
  model,
  systemPrompt,
  turnRoutingContext = '',
  onAgentEvent,
  requestToolApproval,
  persistSession = true,
  executionMode,
  alwaysAllowTools,
  signal,
  allowedTools,
  requestUserInput,
  skipAnalysisNudge = false,
  compactedForModel: compactedInput = null,
  onCompactedUpdate = null,
  changeTracker = null,
  backupManager = null,
  titleCoordinator = null,
  projectIsGit = Boolean(config?.runtime?.project_is_git),
  onExecutionModeSync = null,
  onContinuationSession = null,
  workspaceRoot = process.cwd(),
  selectedSkillNames = [],
  memoryInject = null,
  retrievedText = '',
  skillHooksSession = null,
  onSkillLoaded = null,
  initialMessagesOverride = null,
  skipExecutionModeInsert = false,
  skipSystemPromptInsert = false,
  toolDefinitionsOverride = null,
  forbiddenTools = [],
}) {
  let compacted = compactedInput;
  const modelInputText = typeof modelText === 'string' && modelText ? modelText : text;
  const expectedModelText = typeof modelText === 'string' && modelText && modelText !== text ? modelText : '';
  const maxContextTokens = effectiveMaxContextTokens(config);
  const triggerPct = Number(config.context?.preflight_trigger_pct || 60);
  const hardPct = Number(config.context?.hard_limit_pct || 98);
  // The visible message list and its token estimate are computed once per turn
  // and reused by every preflight/compact measurement below.
  const turnVisible = modelVisibleMessages(compacted ?? session.messages);
  const turnTokens = estimateMessagesTokens(turnVisible);
  const preflightTokens = turnTokens + estimateMessagesTokens([{ role: 'user', content: String(modelInputText || '') }]);
  const preflightPct = (preflightTokens / maxContextTokens) * 100;
  const selectedSkillNamesForUi = [...new Set(
    (Array.isArray(selectedSkillNames) ? selectedSkillNames : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  )];

  if (persistSession && preflightPct >= triggerPct) {
    // `compacted` is still the original input here, so this equals turnVisible.
    const compactSource = turnVisible;
    // Phase 0: try micro-compact first (in-place tool result clearing)
    const microEnabled = config.context?.microcompact_enabled !== false;
    const microKeep = Number(config.context?.microcompact_keep_recent || 5);
    let needsMacro = true;
    if (microEnabled) {
      const micro = microCompactMessages(compactSource, { keepRecent: microKeep, enabled: true });
      if (micro.changed) {
        compacted = micro.messages.map((m) => ({ ...m, at: new Date().toISOString() }));
        if (onCompactedUpdate) onCompactedUpdate(compacted);
        const afterMicroTokens = estimateMessagesTokens(compacted);
        const afterMicroPct = (afterMicroTokens / maxContextTokens) * 100;
        if (onAgentEvent) {
          onAgentEvent({
            type: 'compact:auto',
            mode: 'micro',
            threshold: Math.round(preflightPct),
            tokensSaved: micro.tokensSaved
          });
        }
        if (afterMicroPct < triggerPct) {
          needsMacro = false;
        }
      }
    }
    if (needsMacro) {
      const sourceIsCompacted = Boolean(compacted);
      // After micro-compaction `compacted` may be a new array; only recompute
      // the visible filter in that case, otherwise reuse the per-turn base.
      const macroSource = compacted ? modelVisibleMessages(compacted) : turnVisible;
      const auto = await compactMessagesLocally(macroSource, {
        mode: preflightPct >= hardPct ? 'aggressive' : 'conservative',
        force: true,
        generateSummary: createCompactSummaryGenerator(config, signal)
      });
      if (auto.changed) {
        compacted = auto.compacted.map((m) => ({ ...m, at: new Date().toISOString() }));
        if (onCompactedUpdate) {
          onCompactedUpdate(compacted, {
            boundaryIndex: translateCompactBoundaryToOriginal(sourceIsCompacted, session.compact, auto.boundaryIndex),
            mode: preflightPct >= hardPct ? 'aggressive' : 'conservative'
          });
        }
        if (onAgentEvent) {
          onAgentEvent({
            type: 'compact:auto',
            mode: preflightPct >= hardPct ? 'aggressive' : 'conservative',
            threshold: Math.round(preflightPct)
          });
        }
      }
    }
  }

  let saveTimer = null;
  let saveResolver = null;
  let savePromise = null;
  const scheduleSessionSave = () => {
    if (!persistSession) return;
    if (saveTimer) return;
    savePromise = new Promise((resolve) => {
      saveResolver = resolve;
    });
    saveTimer = setTimeout(async () => {
      const done = saveResolver;
      saveTimer = null;
      saveResolver = null;
      try {
        await saveSession(session);
      } finally {
        if (done) done();
        savePromise = null;
      }
    }, STREAM_SAVE_DEBOUNCE_MS);
  };
  const flushScheduledSave = async () => {
    if (!persistSession) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      const done = saveResolver;
      saveTimer = null;
      saveResolver = null;
      savePromise = null;
      await saveSession(session);
      if (done) done();
      return;
    }
    if (savePromise) await savePromise;
  };
  if (persistSession && signal) {
    const flushOnAbort = () => {
      void flushScheduledSave().catch(() => {});
    };
    if (signal.aborted) {
      flushOnAbort();
    } else {
      signal.addEventListener('abort', flushOnAbort, { once: true });
    }
  }

  const shouldGenerateTitle = text
    ? !session.messages.some((msg) => msg?.role === 'user')
    : false;
  const projectContextPromise = (config.context?.project_context_enabled !== false)
    ? buildProjectContextSnippet(workspaceRoot, modelInputText).catch(() => '')
    : Promise.resolve('');
  // Snapshot lengths before this turn appends anything. Compacted is often
  // shorter than session.messages, so abort cleanup must not reuse the session
  // index as a compacted index.
  const turnStartMessageCount = session.messages.length;
  const turnStartCompactedCount = compacted ? compacted.length : 0;
  if (text) {
    const hasFileMentions = typeof modelText === 'string' && modelText && modelText !== text;
    const retrievedPart = typeof retrievedText === 'string' && retrievedText.trim() ? retrievedText.trim() : '';
    let userContent = text;
    let modelExtra = {};
    if (hasFileMentions) {
      // File mentions keep raw content (so findCurrentTurnUserIndex still
      // matches) and fold retrieved memory into model_content.
      modelExtra = {
        model_content: retrievedPart ? `${retrievedPart}\n\n${modelText}` : modelText,
        model_content_scope: 'current_turn',
      };
    } else if (retrievedPart) {
      // No file mentions: prepend retrieved memory to the user content so the
      // stored history stays byte-stable (cache-friendly) across turns.
      userContent = `${retrievedPart}\n\n${text}`;
    }
    const imageExtra = Array.isArray(modelImages) && modelImages.length
      ? { model_images: modelImages }
      : {};
    const selectedSkillExtra = selectedSkillNamesForUi.length
      ? {
          selected_skill_names: selectedSkillNamesForUi,
          skill_badges: selectedSkillNamesForUi.map((name) => ({ name, status: 'selected' }))
        }
      : {};
    const memoryExtra = memoryInject && typeof memoryInject === 'object' ? { memoryInject } : {};
    const userMessage = stampedMessage('user', userContent, { ...modelExtra, ...imageExtra, ...selectedSkillExtra, ...memoryExtra });
    session.messages.push(userMessage);
    if (compacted) {
      compacted.push({ ...userMessage });
      if (onCompactedUpdate) onCompactedUpdate(compacted);
    }
    let derivedTitle = false;
    if (shouldReplaceSessionTitle(session.title)) {
      session.title = deriveSessionTitle(session.messages);
      derivedTitle = true;
    }
    session.model = model || config.model.name;
    session.mode = executionMode || config.execution?.mode || 'normal';
    if (persistSession) {
      await saveSession(session);
      if (derivedTitle) titleCoordinator?.emit(session.id, session.title);
    }
  }

  const projectContextGuidance =
    'Use this project context as lightweight guidance and verify important details with fresh reads when needed.';
  const normalizedExecutionMode = normalizeExecutionMode(executionMode || config.execution?.mode || 'normal');
  const executionShellContext = resolveShellContext(config, {
    cwd: workspaceRoot,
    platform: process.platform,
  });
  const executionModePrompt = buildExecutionModePromptBlock(
    normalizedExecutionMode,
    executionShellContext.commandPlatform,
    executionShellContext.shell,
  );
  const projectContextSnippet = await projectContextPromise;
  // Compose effectiveSystemPrompt without redundant composeSystemPrompt wrapping:
  // systemPrompt already went through composeSystemPrompt in buildActiveSystemPrompt.
  // Insert the execution-mode block immediately BEFORE the reply-language
  // directive. The directive sits above the volatile tail (<relevant_memory>),
  // so the stable prefix stays cacheable and memory remains the last block.
  const systemPromptText = String(systemPrompt || '');
  // Fork branches pass the parent's already-composed effectiveSystemPrompt and
  // must keep it byte-identical for prefix-cache reuse, so skip re-inserting
  // the execution-mode block (the parent's prompt already contains it).
  const effectiveSystemPrompt = skipExecutionModeInsert
    ? systemPromptText
    : (() => {
        const directiveIndex = systemPromptText.lastIndexOf('[Reply language]');
        return directiveIndex >= 0
          ? [
              systemPromptText.slice(0, directiveIndex).trimEnd(),
              executionModePrompt,
              systemPromptText.slice(directiveIndex),
            ].filter(Boolean).join('\n\n')
          : buildSystemPromptWithReplyLanguage(
              [systemPromptText.trim(), executionModePrompt].filter(Boolean).join('\n\n'),
              config,
            );
      })();
  const projectContextPrompt = buildTurnUserPrompt({
    turnContextPrefix: buildTurnContextPrefix(config),
    projectContextSnippet,
    projectContextGuidance,
    turnRoutingContext,
    userText: modelInputText
  });

  const toolConfig = {
    ...config,
    runtime: {
      ...(config.runtime || {}),
      codewiki_comment_tools: Array.isArray(allowedTools) && (
        allowedTools.includes('add_code_comment') ||
        allowedTools.includes('update_code_comment')
      )
    },
    workspaceRoot,
    policy: {
      ...(config.policy || {}),
      allowed_paths: [
        ...(Array.isArray(config.policy?.allowed_paths) ? config.policy.allowed_paths : []),
        path.join(getSessionsDir(), String(session.id)),
        getSkillsDir()
      ]
    }
  };
  const toolResultStore = createToolResultStore({
    resultDir: path.join(getSessionsDir(), String(session.id))
  });

  const subAgentDependencies = createSubAgentDependencyCoordinator();
  const { definitions, handlers, formatters, deferredDefinitions, displayLabels, dispose: disposeTools } = getBuiltinTools({
    workspaceRoot,
    config: toolConfig,
    sessionId: session.id,
    onSystemEvent: onAgentEvent,
    requestUserInput,
    toolResultStore,
    getTodos: () => normalizeTodos(session.todos),
    onTodosUpdate: (todos) => {
      session.todos = normalizeTodos(todos);
      scheduleSessionSave();
    },
    getPlanState: () => normalizePlanState(session.planState),
    onPlanStateUpdate: (planState) => {
      session.planState = normalizePlanState(planState);
      scheduleSessionSave();
    },
    onRunSubAgent: normalizedExecutionMode === 'plan'
      ? async ({
          prompt,
          tasks = [],
          summary = '',
          name = '',
          role = '',
          context = '',
          goal = '',
          toolCallId = '',
          orchestrationId = '',
          taskId = '',
          dependsOn = [],
          tools = null
        } = {}) => {
          const { persona, policyKey, taskRole } = resolveSubAgentRolePolicy(name, role);
          const taskPrompt = String(prompt || '').trim();
          const assignedTasks = normalizeTodos(tasks);
          if (!taskPrompt && assignedTasks.length === 0) {
            return { ok: false, error: 'prompt or tasks is required' };
          }
          const effectivePrompt = taskPrompt || 'Complete the assigned tasks.';
          const handoff = String(context || '').trim();
          const declaredGoal = String(goal || '').trim();
          const title = trimInline(assignedTasks[0]?.content || effectivePrompt, 72) || persona;
          const callId = String(toolCallId || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).trim();
          const emit = (evt) => {
            if (onAgentEvent) onAgentEvent({ ...evt, toolCallId: callId });
          };
          const dependencyTaskId = String(taskId || '').trim();
          const dependencyRegistration = subAgentDependencies.register({
            groupId: orchestrationId || callId,
            taskId: dependencyTaskId,
            dependsOn,
            name: persona,
            prompt: effectivePrompt
          });
          if (!dependencyRegistration.ok) {
            emit({
              type: 'plan:step_done',
              toolCallId: callId,
              step: 1,
              total: 1,
              role: persona,
              title,
              goal: taskPrompt,
              status: 'failed',
              taskId: dependencyTaskId,
              dependsOn: Array.isArray(dependsOn) ? dependsOn : [],
              summary: dependencyRegistration.error
            });
            return {
              ok: false,
              error: dependencyRegistration.error,
              text: ''
            };
          }
          const toolAllowList = Array.isArray(tools) ? tools : null;
          const resolvedTools = resolveSubAgentToolAllowList({
            role: policyKey,
            tools: toolAllowList,
            config
          });
          const stepModel = resolveSubAgentModel(config, model);
          const stepSdkProvider = config.sdk?.provider || '';
          emit({
            type: 'plan:step_start',
            toolCallId: callId,
            step: 1,
            total: 1,
            role: persona,
            title,
            goal: effectivePrompt,
            status: dependencyRegistration.dependencies.length ? 'waiting' : 'running',
            taskId: dependencyTaskId,
            dependsOn: dependencyRegistration.dependencies,
            sdkProvider: stepSdkProvider,
            model: stepModel
          });
          const dependencyResult = await dependencyRegistration.wait();
          if (!dependencyResult.ok) {
            const blockedBy = dependencyResult.blockedBy;
            const blockedMessage = `Blocked because upstream task${blockedBy.length === 1 ? '' : 's'} ${blockedBy.join(', ')} did not complete successfully.`;
            emit({
              type: 'plan:step_done',
              toolCallId: callId,
              step: 1,
              total: 1,
              role: persona,
              title,
              status: 'blocked',
              taskId: dependencyTaskId,
              dependsOn: dependencyRegistration.dependencies,
              blockedBy,
              summary: blockedMessage
            });
            const blockedResult = {
              ok: false,
              blocked: true,
              error: blockedMessage,
              text: ''
            };
            dependencyRegistration.settle(blockedResult);
            return blockedResult;
          }
          emit({
            type: 'plan:progress',
            toolCallId: callId,
            step: 1,
            total: 1,
            role: persona,
            title,
            status: 'running',
            taskId: dependencyTaskId,
            dependsOn: dependencyRegistration.dependencies,
            sdkProvider: stepSdkProvider,
            model: stepModel
          });
          const upstreamContext = formatSubAgentUpstreamContext(dependencyResult.upstream);
          const contextSections = [
            handoff ? `Handoff context from parent agent:\n${handoff}` : '',
            upstreamContext
          ].filter(Boolean);
          const scopedTask = contextSections.length
            ? `${contextSections.join('\n\n')}\n\nTask:\n${effectivePrompt}`
            : effectivePrompt;
              let childUsage = null;
          try {
            const output = await runSubAgentTask({
              role: taskRole,
              task: scopedTask,
              initialTasks: assignedTasks,
              goal: declaredGoal,
              priorSteps: [],
              parentSession: session,
              config,
              model: stepModel,
              systemPrompt,
              onAgentEvent,
              requestToolApproval,
              signal,
              changeTracker,
              backupManager,
              parentToolCallId: callId,
              tools: toolAllowList,
              onUsage: (usage) => {
                childUsage = mergeModelUsage(childUsage, usage);
              },
              projectIsGit: resolveApprovalProjectIsGit({
                projectIsGit,
                changeTrackerEnabled: changeTracker?.mode === 'git-oplog',
                workspaceHasGit: Boolean(config?.runtime?.project_is_git)
              }),
              workspaceRoot
            });
            const failed = subAgentRunFailed(output, signal);
            const savedHandoff = failed
              ? null
              : await saveSubAgentHandoff({
                  workspaceRoot,
                  sessionId: session.id,
                  handoffId: callId,
                  name: persona,
                  task: taskPrompt,
                  summary,
                  text: output.text,
                  artifactPaths: output.artifactPaths,
                }).catch(() => null);
            emit({
              type: 'plan:step_done',
              toolCallId: callId,
              step: 1,
              total: 1,
              role: persona,
              title,
              status: failed ? 'failed' : 'done',
              taskId: dependencyTaskId,
              dependsOn: dependencyRegistration.dependencies,
              summary: trimInline(output.text || '', 160),
              output: formatPlanStepOutputForDisplay(output.text || ''),
              sdkProvider: stepSdkProvider,
              model: stepModel,
              ...(savedHandoff ? { handoffPath: savedHandoff.path } : {}),
              ...(childUsage ? { usage: childUsage, usageScope: 'subagent' } : {})
            });
            const fileChanges = subAgentAllowListMayMutate(resolvedTools)
              ? collectPlanImplementationFileChanges([
                  { role: policyKey, messages: output.messages || [] }
                ])
              : [];
            const result = {
              ok: !failed,
              workflowComplete: false,
              name: persona,
              role: persona,
              tools: resolvedTools,
              text: output.text || '',
              ...(childUsage ? { usage: childUsage } : {}),
              artifactPaths: output.artifactPaths || [],
              ...(savedHandoff ? { handoffPath: savedHandoff.path } : {}),
              ...(fileChanges.length ? { fileChanges } : {}),
              message: compactSubAgentResultForParent({
                text: output.text,
                summary,
                handoffPath: savedHandoff?.path,
                artifactPaths: output.artifactPaths,
              }),
            };
            dependencyRegistration.settle(result);
            return result;
          } catch (err) {
            emit({
              type: 'plan:step_done',
              toolCallId: callId,
              step: 1,
              total: 1,
              role: persona,
              title,
              status: 'failed',
              taskId: dependencyTaskId,
              dependsOn: dependencyRegistration.dependencies,
              summary: String(err?.message || err),
              sdkProvider: stepSdkProvider,
              model: stepModel,
              ...(childUsage ? { usage: childUsage, usageScope: 'subagent' } : {})
            });
            const result = {
              ok: false,
              error: String(err?.message || err),
              text: '',
              ...(childUsage ? { usage: childUsage } : {})
            };
            dependencyRegistration.settle(result);
            return result;
          }
        }
      : undefined,
    onForkTask: normalizedExecutionMode === 'plan'
      ? async ({
          prompt,
          tasks = [],
          summary = '',
          name = '',
          toolCallId = '',
          forkPoint = null
        } = {}) => {
          const taskPrompt = String(prompt || '').trim();
          const assignedTasks = normalizeTodos(tasks);
          if (!taskPrompt && assignedTasks.length === 0) {
            return { ok: false, error: 'prompt or tasks is required' };
          }
          if (!forkPoint || !Array.isArray(forkPoint.messages) || forkPoint.messages.length === 0) {
            return { ok: false, error: 'fork_task requires a live agent loop; fork point unavailable.' };
          }
          const effectivePrompt = taskPrompt || 'Complete the assigned tasks.';
          const branchName = normalizeSubAgentPersonaName(name, 'Fork');
          const callId = String(
            toolCallId || `fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ).trim();
          const emit = (evt) => {
            if (onAgentEvent) onAgentEvent({ ...evt, toolCallId: callId });
          };
          const title = trimInline(assignedTasks[0]?.content || effectivePrompt, 72) || branchName;
          const stepSdkProvider = config.sdk?.provider || '';
          emit({
            type: 'plan:step_start',
            toolCallId: callId,
            step: 1,
            total: 1,
            role: branchName,
            title,
            goal: effectivePrompt,
            status: 'running',
            sdkProvider: stepSdkProvider,
            model
          });
          let childUsage = null;
          try {
            const output = await runForkTask({
              task: taskPrompt,
              tasks: assignedTasks,
              parentNote: String(forkPoint.parentNote || '').trim(),
              forkPointMessages: forkPoint.messages,
              toolDefinitions: forkPoint.toolDefinitions,
              systemPrompt: effectiveSystemPrompt,
              config,
              model,
              onAgentEvent,
              requestToolApproval,
              requestUserInput,
              signal,
              changeTracker,
              backupManager,
              onUsage: (usage) => {
                childUsage = mergeModelUsage(childUsage, usage);
              },
              projectIsGit: resolveApprovalProjectIsGit({
                projectIsGit,
                changeTrackerEnabled: changeTracker?.mode === 'git-oplog',
                workspaceHasGit: Boolean(config?.runtime?.project_is_git)
              }),
              workspaceRoot,
              parentToolCallId: callId,
              alwaysAllowTools: effectiveAlwaysAllowTools,
              executionMode: normalizedExecutionMode
            });
            const failed = subAgentRunFailed(output, signal);
            emit({
              type: 'plan:step_done',
              toolCallId: callId,
              step: 1,
              total: 1,
              role: branchName,
              title,
              status: failed ? 'failed' : 'done',
              summary: trimInline(output.text || '', 160),
              output: formatPlanStepOutputForDisplay(output.text || ''),
              sdkProvider: stepSdkProvider,
              model,
              ...(childUsage ? { usage: childUsage, usageScope: 'fork' } : {})
            });
            const fileChanges = collectPlanImplementationFileChanges([
              { role: 'fork', messages: output.messages || [] }
            ]);
            return {
              ok: !failed,
              workflowComplete: false,
              name: branchName,
              text: output.text || '',
              ...(childUsage ? { usage: childUsage } : {}),
              ...(fileChanges.length ? { fileChanges } : {}),
              message: compactForkResultForParent({
                name: branchName,
                text: output.text,
                summary,
                status: failed ? 'failed' : 'done',
                fileChanges,
              }),
            };
          } catch (err) {
            emit({
              type: 'plan:step_done',
              toolCallId: callId,
              step: 1,
              total: 1,
              role: branchName,
              title,
              status: 'failed',
              summary: String(err?.message || err),
              sdkProvider: stepSdkProvider,
              model,
              ...(childUsage ? { usage: childUsage, usageScope: 'fork' } : {})
            });
            return {
              ok: false,
              error: String(err?.message || err),
              text: '',
              ...(childUsage ? { usage: childUsage } : {})
            };
          }
        }
      : undefined,
    backupManager
  });

  const currentPlanStateForTools = normalizePlanState(session?.planState);
  const exposeUpdatePlan = normalizedExecutionMode === 'plan' || Boolean(currentPlanStateForTools);
  const baseDefinitions = exposeUpdatePlan
    ? definitions
    : definitions.filter((t) => (t.function?.name || t.name) !== 'update_plan');
  const baseHandlers = exposeUpdatePlan
    ? handlers
    : Object.fromEntries(Object.entries(handlers).filter(([name]) => name !== 'update_plan'));
  const baseDeferredDefinitions = exposeUpdatePlan
    ? deferredDefinitions
    : Object.fromEntries(Object.entries(deferredDefinitions).filter(([name]) => name !== 'update_plan'));
  const modeAllowedTools = resolveExecutionModeAllowedTools(
    normalizedExecutionMode,
    allowedTools,
    config,
    executionShellContext.commandPlatform,
  );
  const frozenDefinitions = Array.isArray(toolDefinitionsOverride)
    ? toolDefinitionsOverride
    : null;
  const filteredDefinitions = frozenDefinitions
    ? frozenDefinitions
    : Array.isArray(modeAllowedTools)
      ? baseDefinitions.filter((t) => toolNameAllowed(modeAllowedTools, t.function?.name || t.name))
      : baseDefinitions;
  const filteredHandlers = Array.isArray(modeAllowedTools)
    ? Object.fromEntries(Object.entries(baseHandlers).filter(([name]) => toolNameAllowed(modeAllowedTools, name)))
    : baseHandlers;
  const filteredDeferred = Array.isArray(modeAllowedTools)
    ? Object.fromEntries(Object.entries(baseDeferredDefinitions).filter(([name]) => modeAllowedTools.includes(name)))
    : baseDeferredDefinitions;
  const activeDefinitionNames = new Set(
    filteredDefinitions.map((tool) => String(tool?.function?.name || tool?.name || '').trim()),
  );
  const nonDuplicateFilteredDeferred = Object.fromEntries(
    Object.entries(filteredDeferred).filter(([name]) => !activeDefinitionNames.has(name)),
  );
  const modePolicyTools = EXECUTION_MODE_TOOL_POLICY[normalizedExecutionMode];
  const effectiveAlwaysAllowTools = Array.isArray(modePolicyTools)
    ? [
        ...modePolicyTools,
        ...(typeof requestUserInput === 'function' ? ['request_user_input'] : [])
      ]
    : [
        ...(alwaysAllowTools || config.execution?.always_allow_tools || ['run', 'read']),
        ...(typeof requestUserInput === 'function' ? ['request_user_input'] : [])
      ];

  const modelSourceMessages = compacted ?? session.messages;
  const currentTurnUserIndex = initialMessagesOverride
    ? -1
    : findCurrentTurnUserIndex(modelSourceMessages, text, expectedModelText);
  const baseInitialMessages = toOpenAIMessages(modelSourceMessages, { currentTurnUserIndex });
  // Fork branches inject the parent's OpenAI-shaped message prefix verbatim so
  // the branch request reuses the parent's prompt prefix byte-for-byte.
  const initialMessagesForModel = initialMessagesOverride
    ? initialMessagesOverride
    : persistSession
      ? injectProjectContextIntoLastUserMessage(baseInitialMessages, projectContextPrompt)
      : baseInitialMessages;
  if (persistSession && text) {
    const userMessage = session.messages[turnStartMessageCount];
    const nextUserMessage = attachCurrentTurnModelContent(userMessage, projectContextPrompt);
    if (nextUserMessage !== userMessage) {
      session.messages[turnStartMessageCount] = nextUserMessage;
      if (compacted) {
        compacted[turnStartCompactedCount] = attachCurrentTurnModelContent(
          compacted[turnStartCompactedCount],
          projectContextPrompt,
        );
        onCompactedUpdate?.(compacted);
      }
      await saveSession(session);
    }
  }
  const loopUserPrompt = persistSession
    ? ''
    : projectContextPrompt;

  if (config.context?.prompt_budget_audit === true && onAgentEvent) {
    const auditId = `prompt-budget-${Date.now()}`;
    const audit = buildPromptBudgetAudit({
      systemPrompt: effectiveSystemPrompt,
      projectContextPrompt: projectContextSnippet || buildTurnContextPrefix(config)
        ? projectContextPrompt
        : '',
      messages: [
        ...initialMessagesForModel.filter((m) => m.role !== 'system'),
        ...(loopUserPrompt ? [{ role: 'user', content: loopUserPrompt }] : [])
      ],
      toolDefinitions: filteredDefinitions,
      config
    });
    onAgentEvent({
      type: 'system_tool:start',
      id: auditId,
      name: 'prompt_budget',
      summary: 'calculating prompt budget'
    });
    onAgentEvent({
      type: 'system_tool:end',
      id: auditId,
      name: 'prompt_budget',
      summary: summarizePromptBudgetAudit(audit),
      details: audit
    });
  }

  let activeAssistantIndex = -1;
  const pendingToolMeta = new Map();
  const normalizeFileChange = (change) => {
    if (!change || typeof change !== 'object') return null;
    const path = String(change.path || '').trim();
    if (!path) return null;
    const action = String(change.action || '').trim();
    return {
      path,
      action: action === 'create' || action === 'delete' ? action : 'edit',
      linesAdded: Number(change.linesAdded || 0),
      linesRemoved: Number(change.linesRemoved || 0),
      changedLine: Number(change.changedLine || 0),
      diffPreview: String(change.diffPreview || ''),
      changeSetId: String(change.changeSetId || ''),
      patchRef: String(change.patchRef || '')
    };
  };
  const fileChangeFingerprint = (change) => JSON.stringify({
    path: change.path,
    action: change.action,
    linesAdded: Number(change.linesAdded || 0),
    linesRemoved: Number(change.linesRemoved || 0),
    changedLine: Number(change.changedLine || 0),
    diffPreview: String(change.diffPreview || ''),
    changeSetId: String(change.changeSetId || ''),
    patchRef: String(change.patchRef || '')
  });
  const normalizeFileChanges = (changes) => (Array.isArray(changes) ? changes : [changes])
    .map(normalizeFileChange)
    .filter(Boolean);
  const appendUniqueFileChange = (message, fileChange) => {
    const existing = Array.isArray(message.file_changes) ? message.file_changes : [];
    const nextKey = fileChangeFingerprint(fileChange);
    if (existing.some((change) => fileChangeFingerprint(normalizeFileChange(change) || {}) === nextKey)) {
      message.file_changes = existing;
      return;
    }
    message.file_changes = [...existing, fileChange];
  };
  const attachToolMetaToSessionCall = (toolId, meta = {}) => {
    if (!toolId) return false;
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const msg = session.messages[i];
      if (msg?.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue;
      const call = msg.tool_calls.find((tc) => String(tc?.id || '') === String(toolId));
      if (!call) continue;
      if (Number.isFinite(Number(meta.durationMs))) call.durationMs = Number(meta.durationMs);
      if (typeof meta.summary === 'string' && meta.summary.trim()) call.summary = meta.summary.trim();
      if (typeof meta.status === 'string' && meta.status.trim()) call.status = meta.status.trim();
      if (meta.resultMeta && typeof meta.resultMeta === 'object') call.resultMeta = meta.resultMeta;
      const fileChange = normalizeFileChange(meta.fileChange);
      if (fileChange) {
        call.fileChange = fileChange;
      }
      const fileChanges = normalizeFileChanges(meta.fileChanges && meta.fileChanges.length ? meta.fileChanges : fileChange);
      if (fileChanges.length) call.fileChanges = fileChanges;
      for (const change of fileChanges) appendUniqueFileChange(msg, change);
      msg.at = new Date().toISOString();
      return true;
    }
    return false;
  };
  const wrappedAgentEvent = (event) => {
    // Always accumulate messages in session (for token tracking), only save when persisting
    if (event?.type === 'assistant:start') {
      session.messages.push(stampedMessage('assistant', '', {
        ...(event.sdkProvider ? { sdk_provider: event.sdkProvider } : {}),
        ...(event.model ? { model: event.model } : {})
      }));
      activeAssistantIndex = session.messages.length - 1;
      if (persistSession) scheduleSessionSave();
    } else if (event?.type === 'assistant:delta') {
      if (activeAssistantIndex >= 0 && session.messages[activeAssistantIndex]) {
        const current = session.messages[activeAssistantIndex];
        const now = new Date();
        if (current.reasoning_started_at && !current.reasoning_ended_at) {
          current.reasoning_ended_at = now.toISOString();
          current.reasoning_duration_ms = Math.max(
            Number(current.reasoning_duration_ms || 0),
            Date.parse(current.reasoning_ended_at) - Date.parse(current.reasoning_started_at)
          );
        }
        current.content = `${current.content || ''}${event.text || ''}`;
        current.at = now.toISOString();
        if (persistSession) scheduleSessionSave();
      }
    } else if (event?.type === 'assistant:reasoning_delta') {
      if (activeAssistantIndex >= 0 && session.messages[activeAssistantIndex]) {
        const current = session.messages[activeAssistantIndex];
        const now = new Date();
        if (!current.reasoning_started_at) current.reasoning_started_at = now.toISOString();
        current.reasoning_content = `${current.reasoning_content || ''}${event.text || ''}`;
        current.reasoning_duration_ms = Math.max(
          0,
          now.getTime() - Date.parse(current.reasoning_started_at)
        );
        current.at = now.toISOString();
        if (persistSession) scheduleSessionSave();
      }
    } else if (event?.type === 'assistant:response') {
      // Keep parent usage own-only. Subagent tokens stay on plan:step_done (usageScope: subagent).
      const eventUsage = normalizeModelUsage(event.usage || event.assistantMessage?.usage);
      if (eventUsage) event.usage = eventUsage;
      if (activeAssistantIndex >= 0 && session.messages[activeAssistantIndex]) {
        const current = session.messages[activeAssistantIndex];
        const now = new Date();
        current.content = event.assistantMessage?.content ?? event.text ?? current.content;
        if (typeof event.assistantMessage?.reasoning_content === 'string' && event.assistantMessage.reasoning_content) {
          current.reasoning_content = event.assistantMessage.reasoning_content;
        }
        if (Array.isArray(event.assistantMessage?.reasoning_details) && event.assistantMessage.reasoning_details.length > 0) {
          current.reasoning_details = event.assistantMessage.reasoning_details;
        }
        if (Array.isArray(event.assistantMessage?.tool_calls) && event.assistantMessage.tool_calls.length > 0) {
          current.tool_calls = event.assistantMessage.tool_calls;
        }
        if (eventUsage) {
          current.usage = mergeModelUsage(current.usage, eventUsage);
        }
        if ((current.reasoning_content || current.reasoning_details) && current.reasoning_started_at) {
          current.reasoning_ended_at = current.reasoning_ended_at || now.toISOString();
          current.reasoning_duration_ms = Math.max(
            Number(current.reasoning_duration_ms || 0),
            Date.parse(current.reasoning_ended_at) - Date.parse(current.reasoning_started_at)
          );
        }
        current.at = now.toISOString();
        if (persistSession) scheduleSessionSave();
      } else {
        const assistantMessage = event.assistantMessage && typeof event.assistantMessage === 'object'
          ? event.assistantMessage
          : { content: event.text || '' };
        session.messages.push(stampedMessage('assistant', assistantMessage.content || event.text || '', {
          ...(typeof assistantMessage.reasoning_content === 'string' && assistantMessage.reasoning_content
            ? { reasoning_content: assistantMessage.reasoning_content }
            : {}),
          ...(Array.isArray(assistantMessage.reasoning_details) && assistantMessage.reasoning_details.length > 0
            ? { reasoning_details: assistantMessage.reasoning_details }
            : {}),
          ...(Array.isArray(assistantMessage.tool_calls) && assistantMessage.tool_calls.length > 0
            ? { tool_calls: assistantMessage.tool_calls }
            : {}),
          ...(eventUsage ? { usage: eventUsage } : {})
        }));
        if (persistSession) scheduleSessionSave();
      }
      activeAssistantIndex = -1;
    } else if (event?.type === 'tool:start') {
      if (activeAssistantIndex >= 0 && session.messages[activeAssistantIndex]) {
        const current = session.messages[activeAssistantIndex];
        const now = new Date();
        if (current.reasoning_started_at && !current.reasoning_ended_at) {
          current.reasoning_ended_at = now.toISOString();
          current.reasoning_duration_ms = Math.max(
            Number(current.reasoning_duration_ms || 0),
            Date.parse(current.reasoning_ended_at) - Date.parse(current.reasoning_started_at)
          );
          current.at = now.toISOString();
          if (persistSession) scheduleSessionSave();
        }
      }
    } else if (event?.type === 'tool:end' || event?.type === 'tool:error' || event?.type === 'tool:blocked') {
      const toolId = String(event.id || '');
      if (toolId) {
        const meta = {
          durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : undefined,
          summary: typeof event.summary === 'string' ? event.summary : '',
          resultMeta: event.resultMeta && typeof event.resultMeta === 'object' ? event.resultMeta : null,
          fileChange: normalizeFileChange(event.fileChange),
          fileChanges: normalizeFileChanges(event.fileChanges),
          status:
            event.type === 'tool:error'
              ? 'error'
              : event.type === 'tool:blocked'
                ? 'blocked'
                : 'done'
        };
        pendingToolMeta.set(toolId, meta);
        if (attachToolMetaToSessionCall(toolId, meta) && persistSession) scheduleSessionSave();
      }
    } else if (event?.type === 'tool:result') {
      const toolId = String(event.id || '');
      const meta = pendingToolMeta.get(toolId) || {};
      session.messages.push(
        stampedMessage('tool', event.content || '', {
          tool_call_id: toolId,
          ...(Number.isFinite(Number(meta.durationMs)) ? { tool_duration_ms: Number(meta.durationMs) } : {}),
          ...(meta.summary ? { tool_summary: meta.summary } : {}),
          ...(meta.status ? { tool_status: meta.status } : {}),
          ...(meta.resultMeta ? { tool_result_meta: meta.resultMeta } : {}),
          ...(meta.fileChange ? { tool_file_change: meta.fileChange } : {}),
          ...(Array.isArray(meta.fileChanges) && meta.fileChanges.length ? { tool_file_changes: meta.fileChanges } : {})
        })
      );
      pendingToolMeta.delete(toolId);
      if (persistSession) scheduleSessionSave();
    }

    if (onAgentEvent) onAgentEvent(event);
  };

  // Freeze the aborted turn on the current session, then fork a continuation
  // session that only keeps completed history. Send-now / continue-in-place
  // skips the fork so the next prompt appends below the stopped turn.
  const discardAbortedTurnMessages = async () => {
    const addedCount = session.messages.length - turnStartMessageCount;
    if (addedCount <= 0) return false;
    if (session.messages[turnStartMessageCount]?.role === 'user') {
      session.messages[turnStartMessageCount] = {
        ...session.messages[turnStartMessageCount],
        local_only: true,
        model_visible: false
      };
      session.messages.splice(turnStartMessageCount + 1);
    } else {
      session.messages.splice(turnStartMessageCount);
    }
    if (compacted) {
      const compactedAdded = compacted.length - turnStartCompactedCount;
      if (compactedAdded > 0) {
        if (compacted[turnStartCompactedCount]?.role === 'user') {
          compacted[turnStartCompactedCount] = {
            ...compacted[turnStartCompactedCount],
            local_only: true,
            model_visible: false
          };
          compacted.splice(turnStartCompactedCount + 1);
        } else {
          compacted.splice(turnStartCompactedCount);
        }
        if (onCompactedUpdate) onCompactedUpdate(compacted);
      }
    }
    if (persistSession) {
      session.model = model || config.model.name;
      session.mode = executionMode || config.execution?.mode || 'normal';
      await saveSession(session).catch(() => {});
    }
    return true;
  };

  const forkContinuationAfterAbort = async () => {
    const discarded = await discardAbortedTurnMessages();
    if (!persistSession || !discarded) return null;
    const continuation = await createContinuationSession(session, {
      messages: (session.messages || []).slice(0, turnStartMessageCount),
      compactView: compacted ? compacted.slice(0, turnStartCompactedCount) : null
    });
    if (typeof onContinuationSession === 'function') {
      await onContinuationSession(continuation);
    }
    if (onAgentEvent) {
      onAgentEvent({
        type: 'session:forked',
        sessionId: continuation.id,
        previousSessionId: session.id
      });
    }
    return continuation;
  };

  const settleAbortedTurnInPlace = async () => {
    const turnMessages = session.messages.slice(turnStartMessageCount);
    const resultIds = new Set(
      turnMessages
        .filter((message) => message?.role === 'tool' && message.tool_call_id)
        .map((message) => String(message.tool_call_id)),
    );
    for (const message of turnMessages) {
      if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
      for (const call of message.tool_calls) {
        const id = String(call?.id || '');
        if (!id || resultIds.has(id)) continue;
        session.messages.push(stampedMessage('tool', 'Aborted by user.', {
          tool_call_id: id,
          tool_status: 'aborted'
        }));
        resultIds.add(id);
        if (call && typeof call === 'object') call.status = 'aborted';
      }
    }
    if (persistSession) {
      session.model = model || config.model.name;
      session.mode = executionMode || config.execution?.mode || 'normal';
      await saveSession(session).catch(() => {});
    }
  };

  const handleAbortAftermath = async () => {
    if (abortContinuesInPlace(signal)) await settleAbortedTurnInPlace();
    else await forkContinuationAfterAbort();
  };

  const sessionLenBeforeLoop = session.messages.length;
  const toolRuntime = createToolRuntime({
    definitions: filteredDefinitions,
    handlers: filteredHandlers,
    formatters,
    deferredDefinitions: nonDuplicateFilteredDeferred,
    displayLabels: displayLabels || {},
    maxParallelCalls: toolConfig.tools?.max_parallel_calls
  });
  let loopResult;
  try {
    loopResult = await runAgentLoop({
      systemPrompt: skipSystemPromptInsert ? '' : effectiveSystemPrompt,
      userPrompt: loopUserPrompt,
      model: model || config.model.name,
      toolRuntime,
      initialMessages: initialMessagesForModel,
      onEvent: wrappedAgentEvent,
      executionMode: normalizedExecutionMode,
      approvalMode: (() => {
        const sandbox = resolveSandboxPolicy({
          config,
          cwd: workspaceRoot,
          platform: process.platform,
        });
        // Read-only OS sandbox already blocks writes — skip soft approval prompts.
        if (sandbox.enabled && sandbox.mode === 'read-only') return 'full_access';
        return config.execution?.approval_mode || 'auto';
      })(),
      projectIsGit: resolveApprovalProjectIsGit({
        projectIsGit,
        changeTrackerEnabled: changeTracker?.mode === 'git-oplog',
        workspaceHasGit: Boolean(config?.runtime?.project_is_git)
      }),
      alwaysAllowTools: effectiveAlwaysAllowTools,
      forbiddenTools,
      toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
      toolResultStore,
      getTasks: () => normalizeTodos(session.todos),
      requestToolApproval,
      signal,
      skipAnalysisNudge,
      config: toolConfig,
      skillHooksSession,
      onSkillLoaded,
      workspaceRoot,
      changeTracker: changeTracker?.enabled
        ? {
            begin: (meta) => beginGitOplogCapture(changeTracker, meta),
            capture: (scope, meta) => captureGitOplogChanges(changeTracker, scope, meta)
          }
        : null,
      requestCompletion: async ({ messages, tools, model: selectedModel }) => {
        let started = false;
        const startAssistantStream = () => {
          if (!started) {
            started = true;
            wrappedAgentEvent({
              type: 'assistant:start',
              sdkProvider: config.sdk?.provider === 'anthropic'
                ? 'anthropic'
                : 'openai-compatible',
              model: selectedModel
            });
          }
        };
        const tracker = createStreamTimingTracker();
        const applyTiming = (result) => {
          const timing = tracker.finish();
          if (!timing) return result;
          if (result && typeof result === 'object') {
            return {
              ...result,
              usage: attachTimingToUsage(result.usage, timing)
            };
          }
          if (activeAssistantIndex >= 0 && session.messages[activeAssistantIndex]) {
            const current = session.messages[activeAssistantIndex];
            current.usage = attachTimingToUsage(current.usage, timing);
          }
          return result;
        };

        try {
          const result = await createChatCompletionStream({
            sdkProvider: config.sdk?.provider,
            baseUrl: config.gateway.base_url,
            apiKey: config.gateway.api_key,
            model: selectedModel,
            messages,
            tools,
            reasoningEffort: resolveConfiguredReasoningEffort({
              enabled: config.model?.reasoning_enabled,
              effort: config.model?.reasoning_effort
            }),
            timeoutMs: config.gateway.timeout_ms || 1800000,
            maxRetries: config.gateway.max_retries ?? 2,
            maxTokens: (() => {
              const configured = Number(config.model?.max_output_tokens);
              if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
              return config.sdk?.provider === 'anthropic' ? 16384 : undefined;
            })(),
            signal,
            onTextDelta: (delta) => {
              tracker.noteTextDelta(delta);
              startAssistantStream();
              wrappedAgentEvent({ type: 'assistant:delta', text: delta });
            },
            onReasoningDelta: (delta) => {
              tracker.noteReasoningDelta(delta);
              startAssistantStream();
              wrappedAgentEvent({ type: 'assistant:reasoning_delta', text: delta });
            },
            onToolCallDelta: (toolCall) => {
              tracker.noteToolCallDelta();
              startAssistantStream();
              wrappedAgentEvent({ type: 'assistant:tool_call_delta', toolCall });
            }
          });

          if (!started && !result?.incomplete && (result?.text || result?.toolCalls?.length)) {
            startAssistantStream();
          }

          return applyTiming(result);
        } catch (error) {
          applyTiming(null);
          throw error;
        }
      }
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      await handleAbortAftermath();
    }
    throw error;
  }
  if (signal?.aborted || loopResult?.aborted) {
    await handleAbortAftermath();
    return { text: '', aborted: true };
  }

  if (persistSession) {
    // Sync new messages to compacted view
    if (compacted) {
      const newMsgs = session.messages.slice(sessionLenBeforeLoop);
      for (const msg of newMsgs) {
        compacted.push({ ...msg });
      }
      if (onCompactedUpdate) onCompactedUpdate(compacted);
    }
    session.model = model || config.model.name;
    session.mode = executionMode || config.execution?.mode || 'normal';
    await flushScheduledSave();
    await saveSession(session);
    // Generate a better title asynchronously after saving.
    // Do not tie this to the turn AbortSignal — a later abort/new submit
    // must not cancel title generation for a completed exchange.
    if (shouldGenerateTitle) {
      const titleUserText = resolveTitleUserText({
        content: text,
        model_content: expectedModelText || undefined
      });
      titleCoordinator?.schedule({
        session,
        userText: titleUserText,
        assistantText: loopResult.text || '',
        config
      });
    }
    void pruneSessions(config.sessions || {}).catch(() => {
      // keep chat usable even if pruning fails
    });
  }
  return { text: loopResult.text, aborted: !!loopResult.aborted };
}

export async function runSubAgentTask({
  role,
  task,
  initialTasks = [],
  goal = '',
  priorSteps = [],
  parentSession,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  requestToolApproval,
  extraRolePrompt = '',
  signal,
  onSessionActive,
  planFileContext = '',
  changeTracker = null,
  backupManager = null,
  parentToolCallId = '',
  tools = null,
  onUsage = null,
  projectIsGit = Boolean(config?.runtime?.project_is_git),
  workspaceRoot = process.cwd(),
  inheritParentContext = false,
}) {
  const assignedTasks = normalizeTodos(initialTasks);
  const subSession = {
    id: `sub-${Date.now()}`,
    messages: [],
    todos: assignedTasks,
  };
  const subAgentModel = resolveSubAgentModel(config, model);
  const rolePrompt = getSubAgentRolePrompt(role);
  const cleanContextRole = role === 'reviewer' || role === 'tester';
  const copyParent = inheritParentContext === true && !cleanContextRole;
  const contextPacket = copyParent ? buildSubAgentContextPacket(parentSession, task || goal) : '';
  const evidencePacket = copyParent ? buildSubAgentEvidencePacket(parentSession) : '';
  const handoffPacket = buildStepArtifactPacket(priorSteps, role);
  const handoffFocusPaths = collectStepArtifacts(priorSteps, role)?.focusPaths || [];
  const focusedTaskNote = buildFocusedTaskNote(role, handoffFocusPaths);
  const goalRequirementPacket = buildGoalRequirementPacket(goal, role);
  const verificationPacket = role === 'tester'
    ? await buildTesterVerificationPacket(handoffFocusPaths, workspaceRoot)
    : '';
  const planFileSection = planFileContext
    ? cleanContextRole
      ? `Accumulated plan ledger (clean-context; no executor transcripts):\n${planFileContext}`
      : `Accumulated plan file context (results from prior steps):\n${planFileContext}`
    : '';
  const roleAllowedTools = resolveSubAgentToolAllowList({ role, tools, config });
  const runtimeNote = buildSubAgentRuntimeNote(roleAllowedTools, {
    shell: config?.shell?.default,
    workspaceRoot,
    role,
    config,
  });
  const handoffCatalogPrompt = buildSubAgentHandoffCatalog(
    await listSubAgentHandoffs({
      workspaceRoot,
      sessionId: parentSession?.id,
    }).catch(() => []),
  );
  const scopedTask = [
    'Role:',
    rolePrompt,
    extraRolePrompt,
    runtimeNote,
    handoffCatalogPrompt,
    contextPacket,
    goalRequirementPacket,
    evidencePacket,
    handoffPacket,
    planFileSection,
    verificationPacket,
    focusedTaskNote,
    assignedTasks.length
      ? [
          'Assigned tasks (use the tasks tool to keep this checklist current):',
          ...assignedTasks.map((item) => `- [${item.status}] ${item.content}`),
        ].join('\n')
      : '',
    'Task:',
    task
  ]
    .filter(Boolean)
    .join('\n\n');
  let blockedCount = 0;
  let toolErrorCount = 0;
  const artifactPaths = [];
  const seenArtifactPaths = new Set();
  const wrappedOnAgentEvent = (evt) => {
    if (evt?.type === 'tool:blocked') blockedCount += 1;
    if (evt?.type === 'tool:error') toolErrorCount += 1;
    if (evt?.type === 'assistant:response' && typeof onUsage === 'function') {
      const usage = normalizeModelUsage(evt.usage || evt.assistantMessage?.usage);
      if (usage) onUsage(usage);
    }
    collectSubAgentArtifactsFromEvent(evt, artifactPaths, seenArtifactPaths);
    if (
      role !== 'summarizer' &&
      ['assistant:start', 'assistant:delta', 'assistant:reasoning_delta', 'assistant:response', 'assistant:tool_call_delta'].includes(String(evt?.type || ''))
    ) {
      return;
    }
    if (onAgentEvent) {
      onAgentEvent(
        parentToolCallId
          ? { ...evt, parentToolCallId }
          : evt
      );
    }
  };
  const workspaceHasGit = Boolean(config?.runtime?.project_is_git) || changeTracker?.mode === 'git-oplog';
  const approvalOptions = resolvePlanSubAgentApprovalOptions({
    role,
    config,
    projectIsGit,
    changeTrackerEnabled: changeTracker?.mode === 'git-oplog',
    workspaceHasGit,
    tools
  });
  const subShellRulesPrompt = buildSubAgentShellRulesPrompt(roleAllowedTools, {
    shell: config?.shell?.default,
    workspaceRoot,
    config
  });
  if (onSessionActive) onSessionActive(subSession);
  const subSystemPrompt = await composeSystemPrompt({
    shellRulesPrompt: subShellRulesPrompt,
    config,
    skillsPrompt: SUBAGENT_STABLE_SKILLS_PROMPT,
    includeSoul: false,
    includeMemory: false
  });
  const subResult = await askModel({
    text: scopedTask,
    session: subSession,
    config: withCandidateMemoryWrites(config),
    model: subAgentModel,
    systemPrompt: subSystemPrompt,
    onAgentEvent: wrappedOnAgentEvent,
    requestToolApproval,
    persistSession: false,
    executionMode: 'normal',
    allowedTools: approvalOptions.allowedTools,
    alwaysAllowTools: approvalOptions.alwaysAllowTools,
    skipAnalysisNudge: true,
    signal,
    changeTracker,
    backupManager,
    workspaceRoot,
    projectIsGit: approvalOptions.projectIsGit
  });
  collectSubAgentArtifactsFromMessages(subSession.messages, artifactPaths, seenArtifactPaths);
  const text = subResult.text || '';
  const hasErrorLine = /(^|\n)\s*error\s*:/i.test(text);
  return {
    text,
    blockedCount,
    toolErrorCount,
    hasErrorLine,
    artifactPaths: artifactPaths.slice(0, SUB_AGENT_HANDOFF_MAX_ITEMS),
    messages: Array.isArray(subSession.messages) ? structuredClone(subSession.messages) : []
  };
}

function buildForkTaskInstruction(task, parentNote = '', tasks = []) {
  const framing = [
    'You are a parallel branch of the main agent. You inherit its full conversation, identity, system prompt, and tools, and you work independently on the task below.',
    'Investigate with the same discipline as the main agent, then stop and return a structured result: findings with file/line evidence, any changes you made, and open questions.',
    'Do not call fork_task, run_subagent, or request_user_input. Do not update the plan. Treat your observations as a snapshot — the parent may be changing files concurrently.'
  ].join(' ');
  return [
    parentNote ? `Parent agent note: ${parentNote}` : '',
    framing,
    String(task || '').trim()
      ? `Branch task:\n${String(task).trim()}`
      : '',
    Array.isArray(tasks) && tasks.length > 0
      ? `Assigned checklist:\n${tasks
          .map((item, index) => `${index + 1}. ${String(item?.content || '').trim()}`)
          .join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');
}

function withCandidateMemoryWrites(config = {}) {
  return {
    ...config,
    memory: { ...(config.memory || {}), candidate_writes: true }
  };
}

/**
 * Runs one fork branch of the current agent turn.
 *
 * The branch reuses the parent's system prompt verbatim and replays the
 * parent's exact OpenAI-shaped message prefix (captured at dispatch in
 * agent-loop), then appends its own user turn. Everything the branch does —
 * tool calls, results, file changes — stays in the branch's local messages;
 * only the structured result (text + file changes + usage) returns to the
 * parent loop. This is what makes fork branches cheap on prefix-cached
 * providers / vLLM: system + prefix are byte-identical across branches.
 */
export async function runForkTask({
  task,
  tasks = [],
  parentNote = '',
  forkPointMessages = [],
  toolDefinitions = [],
  systemPrompt,
  config,
  model,
  onAgentEvent,
  requestToolApproval,
  requestUserInput,
  signal,
  changeTracker,
  backupManager,
  onUsage,
  projectIsGit,
  workspaceRoot,
  parentToolCallId = '',
  alwaysAllowTools = [],
  executionMode = 'plan',
}) {
  const branchSession = {
    id: `fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    messages: [],
    todos: normalizeTodos(tasks),
  };
  // Deep-clone the prefix per branch: the branch loop splices/prunes its own
  // array and may mutate assistant message objects, so branches must never
  // share the parent's live messages.
  const prefix = (Array.isArray(forkPointMessages) ? forkPointMessages : [])
    .map((message) => structuredClone(message));
  // Keep the parent's frozen schemas byte-identical for prompt-cache reuse.
  // Forbidden branch operations are rejected by the execution policy instead
  // of removing their schemas from the provider request.
  const branchToolNames = (Array.isArray(toolDefinitions) ? toolDefinitions : [])
    .map((def) => String(def?.function?.name || '').trim())
    .filter(Boolean);
  const branchAlwaysAllow = (Array.isArray(alwaysAllowTools) ? alwaysAllowTools : [])
    .filter((name) => !FORK_FORBIDDEN_TOOLS.includes(String(name || '').trim()));
  const taskInstruction = buildForkTaskInstruction(task, parentNote, branchSession.todos);
  const wrappedOnAgentEvent = (evt) => {
    if (evt?.type === 'assistant:response' && typeof onUsage === 'function') {
      const usage = normalizeModelUsage(evt.usage || evt.assistantMessage?.usage);
      if (usage) onUsage(usage);
    }
    if (
      ['assistant:start', 'assistant:delta', 'assistant:reasoning_delta', 'assistant:response', 'assistant:tool_call_delta'].includes(String(evt?.type || ''))
    ) {
      return;
    }
    if (onAgentEvent) {
      onAgentEvent(parentToolCallId ? { ...evt, parentToolCallId } : evt);
    }
  };
  const result = await askModel({
    text: taskInstruction,
    session: branchSession,
    config: withCandidateMemoryWrites(config),
    model,
    systemPrompt,
    onAgentEvent: wrappedOnAgentEvent,
    requestToolApproval,
    requestUserInput,
    persistSession: false,
    executionMode,
    allowedTools: branchToolNames,
    alwaysAllowTools: branchAlwaysAllow,
    skipAnalysisNudge: true,
    signal,
    changeTracker,
    backupManager,
    workspaceRoot,
    projectIsGit,
    initialMessagesOverride: prefix,
    skipExecutionModeInsert: true,
    skipSystemPromptInsert: true,
    toolDefinitionsOverride: toolDefinitions,
    forbiddenTools: FORK_FORBIDDEN_TOOLS,
  });
  const text = result.text || '';
  const hasErrorLine = /(^|\n)\s*error\s*:/i.test(text);
  return {
    text,
    hasErrorLine,
    messages: Array.isArray(branchSession.messages)
      ? structuredClone(branchSession.messages)
      : [],
  };
}

export function collectPlanImplementationFileChanges(priorSteps = []) {
  const changes = [];
  const seen = new Set();
  for (const step of Array.isArray(priorSteps) ? priorSteps : []) {
    if (!['coder', 'refactorer', 'writer', 'fork'].includes(String(step?.role || ''))) continue;
    for (const msg of Array.isArray(step?.messages) ? step.messages : []) {
      const items = [msg?.tool_file_change, ...(Array.isArray(msg?.tool_file_changes) ? msg.tool_file_changes : [])].filter(Boolean);
      for (const item of items) {
        const change = normalizeStepDiffChange(item);
        if (!change) continue;
        const key = `${change.path}:${change.action}:${change.changedLine}:${change.linesAdded}:${change.linesRemoved}:${change.changeSetId || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        changes.push(change);
      }
    }
  }
  return changes;
}

export function buildPlanStepTranscript({ stepRecord, stepIndex, totalSteps, messages, extraFileChanges = [] }) {
  const toolCardsById = new Map();
  const toolCards = [];
  const source = Array.isArray(messages) ? messages : [];

  for (const msg of source) {
    if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const id = String(tc?.id || `tool-${toolCards.length + 1}`);
        if (toolCardsById.has(id)) continue;
        const card = {
          id,
          name: tc?.function?.name || tc?.name || 'tool',
          arguments: tc?.function?.arguments || tc?.arguments || {},
          status: tc?.status || 'done',
          durationMs: Number.isFinite(Number(tc?.durationMs)) ? Number(tc.durationMs) : null,
          summary: tc?.summary || '',
          result: ''
        };
        toolCardsById.set(id, card);
        toolCards.push(card);
      }
    } else if (msg?.role === 'tool') {
      const id = String(msg.tool_call_id || '');
      const card = toolCardsById.get(id);
      if (!card) continue;
      card.result = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      if (typeof msg.tool_summary === 'string' && msg.tool_summary.trim()) card.summary = msg.tool_summary.trim();
      if (Number.isFinite(Number(msg.tool_duration_ms))) card.durationMs = Number(msg.tool_duration_ms);
      if (typeof msg.tool_status === 'string' && msg.tool_status.trim()) card.status = msg.tool_status.trim();
    }
  }

  const segments = [];
  if (toolCards.length > 0) {
    segments.push({ type: 'tools', cards: toolCards });
  }
  const displayOutput = formatPlanStepOutputForDisplay(stepRecord.output || '');
  if (displayOutput) {
    segments.push({
      type: stepRecord.role === 'summarizer' ? 'text' : 'handoff',
      text: displayOutput,
      isStreaming: false
    });
  }
  const fileChanges = (Array.isArray(extraFileChanges) ? extraFileChanges : [])
    .map(normalizeStepDiffChange)
    .filter(Boolean);
  if (stepRecord.role === 'summarizer' && fileChanges.length > 0) {
    for (const change of fileChanges) {
      segments.push({
        type: 'handoff',
        text: '',
        isStreaming: false,
        fileChange: change
      });
    }
  }

  return {
    step: stepIndex + 1,
    total: totalSteps,
    role: stepRecord.role || 'general',
    title: stepRecord.title || '',
    status: stepRecord.failed ? 'failed' : 'done',
    summary: stepRecord.failed ? stepRecord.failureReason : trimInline(stepRecord.output || '', 160),
    segments,
    ...(fileChanges.length > 0 ? { fileChanges } : {}),
    ...(stepRecord.usage ? { usage: stepRecord.usage } : {})
  };
}


function normalizeStepDiffChange(change = {}) {
  const pathText = String(change?.path || '').trim();
  if (!pathText) return null;
  return {
    ...change,
    path: pathText,
    action: String(change.action || 'edit').trim() || 'edit',
    changedLine: Number(change.changedLine ?? change.changed_line ?? 0),
    linesAdded: Number(change.linesAdded ?? change.lines_added ?? 0),
    linesRemoved: Number(change.linesRemoved ?? change.lines_removed ?? 0),
    diffPreview: String(change.diffPreview ?? change.diff_preview ?? '')
  };
}

function summarizeStepDiffEvidence(messages = []) {
  const changes = [];
  const seen = new Set();
  for (const msg of Array.isArray(messages) ? messages : []) {
    const items = [msg?.tool_file_change, ...(Array.isArray(msg?.tool_file_changes) ? msg.tool_file_changes : [])].filter(Boolean);
    for (const item of items) {
      const change = normalizeStepDiffChange(item);
      if (!change) continue;
      const key = `${change.path}:${change.action}:${change.changedLine}:${change.linesAdded}:${change.linesRemoved}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push(change);
    }
  }
  if (changes.length === 0) return '';
  const lines = ['## Diff Self-Review', 'Changed files from tool results:'];
  for (const change of changes.slice(0, 8)) {
    const added = Number(change.linesAdded || 0);
    const removed = Number(change.linesRemoved || 0);
    const risky = removed > 40 || added > 120 || change.action === 'delete';
    lines.push(`- ${change.action || 'edit'} ${change.path}:${change.changedLine || 1} (+${added}/-${removed})${risky ? ' [review broad change]' : ''}`);
    const preview = String(change.diffPreview || '').trim();
    if (preview) lines.push(`  ${preview.split('\n').slice(0, 3).join('\n  ')}`);
  }
  lines.push('Self-check: confirm these changes are intentional, scoped to the step contract, and handed to reviewer/tester when needed.');
  return lines.join('\n');
}

function classifyStepFailureType(role, text = '', output = {}) {
  const body = String(text || '');
  if (output.blockedCount > 0 || /declined|denied|User declined|requires approval|approval/i.test(body)) return 'approval_declined';
  if (/old_text not found|old_hash mismatch|not unique|anchor not found|anchor not unique|edit requires/i.test(body)) return 'edit_mismatch';
  if (/command not found|missing dependenc|ENOENT|Cannot find module|No such file|environment|not installed/i.test(body)) return 'env_missing';
  if (role === 'tester') return 'verification_failed';
  if (/\b(?:verification|verify|test(?:s|ing)?)\b[^\n]{0,80}\b(?:failed|failure|error|did not pass|not passing)\b/i.test(body)) return 'verification_failed';
  if (/\b(?:failed|failure|error|did not pass|not passing)\b[^\n]{0,80}\b(?:verification|verify|test(?:s|ing)?)\b/i.test(body)) return 'verification_failed';
  return 'unknown';
}

function shouldRetryStepFailure(failureType, role) {
  if (['approval_declined', 'env_missing', 'verification_failed'].includes(failureType)) return false;
  if (failureType === 'edit_mismatch') return ['coder', 'refactorer', 'writer'].includes(role);
  return role !== 'summarizer';
}

function formatPlanStepOutputForDisplay(output, maxChars = 6000) {
  const text = String(output || '').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n\n... [step handoff truncated for display]`;
}

async function executePlanWithSubAgents({
  planState,
  parentSession,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  requestToolApproval,
  signal,
  onSubSessionActive,
  changeTracker = null,
  backupManager = null,
  projectIsGit = Boolean(config?.runtime?.project_is_git),
  workspaceRoot = process.cwd()
}) {
  const workspaceHasGit = Boolean(config?.runtime?.project_is_git)
    || changeTracker?.mode === 'git-oplog'
    || await detectWorkspaceIsGit(workspaceRoot);
  const resolvedProjectIsGit = resolveApprovalProjectIsGit({
    projectIsGit,
    changeTrackerEnabled: changeTracker?.mode === 'git-oplog',
    workspaceHasGit
  });
  const steps = Array.isArray(planState.steps) ? planState.steps : [];
  const goal = planState.goal || '';
  const planFilePath = planState.filePath || '';
  let partialDeltaText = '';
  const planSdkProvider = config.sdk?.provider === 'anthropic'
    ? 'anthropic'
    : 'openai-compatible';
  const emitPlanEvent = (evt) => {
    const event = evt?.type === 'assistant:start' || String(evt?.type || '').startsWith('plan:')
      ? {
          ...evt,
          sdkProvider: evt.sdkProvider || planSdkProvider,
          ...(evt.model ? {} : { model: model || config.model?.name || '' })
        }
      : evt;
    if (event?.type === 'assistant:delta' && event.text) {
      partialDeltaText += String(event.text);
    }
    if (onAgentEvent) onAgentEvent(event);
  };
  if (steps.length === 0) {
    return { text: '(no steps to execute)', aborted: false };
  }

  emitPlanEvent({ type: 'assistant:start' });

  const priorSteps = [];
  const results = [];
  const transcript = [];
  let totalUsage = null;

  // Emit structured plan steps so TUI can show all steps with real role/title
  emitPlanEvent({
    type: 'plan:steps',
    goal,
    steps: steps.map((s, idx) => ({ index: idx + 1, role: s.role, title: s.title, status: 'pending' }))
  });

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (signal?.aborted) break;

    const MAX_STEP_RETRIES = 1;
    const planningModel = model || config.model?.name || '';

    const stepGuidance = buildPipelineStepGuidance({ role: step.role, stepIndex: i, totalSteps: steps.length, isFirst: i === 0, isLast: i === steps.length - 1, priorSteps });
    const firstModel = resolveSubAgentModel(config, planningModel);

    emitPlanEvent({
      type: 'plan:step_start',
      planFile: planFilePath,
      step: i + 1,
      total: steps.length,
      role: step.role,
      title: step.title,
      model: firstModel
    });

    emitPlanEvent({
      type: 'plan:progress',
      planFile: planFilePath,
      step: i + 1,
      total: steps.length,
      role: step.role,
      title: step.title,
      status: 'running',
      model: firstModel
    });

    emitPlanEvent({
      type: 'assistant:delta',
      text: `\n[plan] Step ${i + 1}/${steps.length} -> ${step.role}: ${step.title}\n`
    });

    // Read accumulated plan file context from prior step results (skip for step 0)
    let planFileContext = '';
    if (i > 0 && planFilePath) {
      const cleanContextRole = step.role === 'reviewer' || step.role === 'tester';
      planFileContext = await readPlanFileAsContext(planFilePath, 6000, {
        ledgerOnly: cleanContextRole
      });
    }

    let output = await runSubAgentTask({
      role: step.role,
      task: [renderStepContractBlock(step), step.task].filter(Boolean).join('\n\n'),
      goal,
      priorSteps,
      parentSession,
      config,
      model: firstModel,
      systemPrompt,
      onAgentEvent: emitPlanEvent,
      requestToolApproval,
      extraRolePrompt: stepGuidance,
      signal,
      onSessionActive: onSubSessionActive,
      planFileContext,
      changeTracker,
      backupManager,
      projectIsGit: resolvedProjectIsGit,
      workspaceRoot
    });

    if (['coder', 'refactorer', 'writer'].includes(step.role)) {
      const diffReview = summarizeStepDiffEvidence(output.messages || []);
      if (diffReview && !String(output.text || '').includes('## Diff Self-Review')) {
        output.text = `${String(output.text || '').trim()}

${diffReview}`.trim();
      }
    }

    const stepOutputOptions = { artifactPaths: output.artifactPaths || [] };
    let stepFailed = stepOutputHasFailureSignals(step.role, output.text || '', stepOutputOptions);
    let failureReason = stepFailed ? buildExitCriteriaFailureReason(step.role, output.text || '', stepOutputOptions) : '';
    let failureType = stepFailed ? classifyStepFailureType(step.role, output.text || '', output) : '';
    let retryCount = 0;

    while (stepFailed && retryCount < MAX_STEP_RETRIES && shouldRetryStepFailure(failureType, step.role) && !signal?.aborted) {
      retryCount += 1;
      const retryModel = resolveSubAgentModel(config, planningModel);
      emitPlanEvent({
        type: 'assistant:delta',
        text: `\n[plan] Step ${i + 1}/${steps.length} retry ${retryCount}/${MAX_STEP_RETRIES} (previous: ${failureReason})\n`
      });
      emitPlanEvent({
        type: 'plan:progress',
        planFile: planFilePath,
        step: i + 1,
        total: steps.length,
        role: step.role,
        title: step.title,
        status: 'running',
        model: retryModel
      });

      const retryGuidance = buildPipelineStepGuidance({
        role: step.role,
        stepIndex: i,
        totalSteps: steps.length,
        isFirst: i === 0,
        isLast: i === steps.length - 1,
        priorSteps,
        isRetry: true,
        previousError: `${failureType}: ${failureReason}`
      });

      output = await runSubAgentTask({
        role: step.role,
        task: [renderStepContractBlock(step), step.task].filter(Boolean).join('\n\n'),
        goal,
        priorSteps,
        parentSession,
        config,
        model: retryModel,
        systemPrompt,
        onAgentEvent: emitPlanEvent,
        requestToolApproval,
        extraRolePrompt: retryGuidance,
        signal,
        onSessionActive: onSubSessionActive,
        planFileContext,
        changeTracker,
        backupManager,
        projectIsGit: resolvedProjectIsGit,
        workspaceRoot
      });

      if (['coder', 'refactorer', 'writer'].includes(step.role)) {
        const diffReview = summarizeStepDiffEvidence(output.messages || []);
        if (diffReview && !String(output.text || '').includes('## Diff Self-Review')) {
          output.text = `${String(output.text || '').trim()}

${diffReview}`.trim();
        }
      }
      stepOutputOptions.artifactPaths = output.artifactPaths || [];
      stepFailed = stepOutputHasFailureSignals(step.role, output.text || '', stepOutputOptions);
      failureType = stepFailed ? classifyStepFailureType(step.role, output.text || '', output) : '';
      failureReason = stepFailed ? buildExitCriteriaFailureReason(step.role, output.text || '', stepOutputOptions) : '';
    }

    const stepUsage = collectAssistantUsage(output.messages || []);
    totalUsage = mergeModelUsage(totalUsage, stepUsage);
    const displayUsage = step.role === 'summarizer'
      ? totalUsage
      : stepUsage;

    const stepRecord = {
      role: step.role,
      title: step.title,
      task: step.task,
      output: output.text || '',
      blockedCount: output.blockedCount || 0,
      toolErrorCount: output.toolErrorCount || 0,
      hasErrorLine: output.hasErrorLine || false,
      artifactPaths: output.artifactPaths || [],
      messages: output.messages || [],
      usage: displayUsage,
      retryCount,
      failed: stepFailed,
      failureType,
      failureReason
    };
    priorSteps.push(stepRecord);
    results.push(stepRecord);
    transcript.push(buildPlanStepTranscript({
      stepRecord,
      stepIndex: i,
      totalSteps: steps.length,
      messages: output.messages || [],
      extraFileChanges: step.role === 'summarizer'
        ? collectPlanImplementationFileChanges(priorSteps)
        : []
    }));

    // Write step result to plan file for subsequent steps to read
    if (planFilePath) {
      await appendStepResultToPlanFile(
        planFilePath,
        i,
        step.title,
        step.role,
        stepRecord.output,
        stepRecord.artifactPaths
      );
    }

    emitPlanEvent({
      type: 'plan:progress',
      planFile: planFilePath,
      step: i + 1,
      total: steps.length,
      role: step.role,
      title: step.title,
      status: stepRecord.failed ? 'failed' : 'done',
      summary: stepRecord.failed
        ? `[${stepRecord.retryCount > 0 ? `retried ${stepRecord.retryCount}x] ` : ''}${stepRecord.failureType ? `${stepRecord.failureType}: ` : ''}${stepRecord.failureReason}`
        : trimInline(stepRecord.output, 160),
      ...(stepRecord.retryCount > 0 ? { retryCount: stepRecord.retryCount } : {}),
      ...(displayUsage ? { usage: displayUsage } : {})
    });

    emitPlanEvent({
      type: 'plan:step_done',
      planFile: planFilePath,
      step: i + 1,
      total: steps.length,
      role: step.role,
      title: step.title,
      status: stepRecord.failed ? 'failed' : 'done',
      summary: stepRecord.failed
        ? `[${stepRecord.retryCount > 0 ? `retried ${stepRecord.retryCount}x] ` : ''}${stepRecord.failureType ? `${stepRecord.failureType}: ` : ''}${stepRecord.failureReason}`
        : trimInline(stepRecord.output, 160),
      output: formatPlanStepOutputForDisplay(stepRecord.output),
      ...(stepRecord.retryCount > 0 ? { retryCount: stepRecord.retryCount } : {}),
      ...(displayUsage
        ? {
            usage: displayUsage,
            usageScope: step.role === 'summarizer' ? 'turn-total' : 'subagent'
          }
        : {})
    });

    if (stepRecord.failed && i < steps.length - 1) {
      await capturePlanFailureLesson({
        goal,
        step: stepRecord,
        stepIndex: i,
        totalSteps: steps.length,
        config
      });
      const summarizerIndex = steps.findIndex((candidate, index) => index > i && candidate.role === 'summarizer');
      if (summarizerIndex > i) {
        i = summarizerIndex - 1;
        continue;
      }
      break;
    }
    if (stepRecord.failed && i >= steps.length - 1) {
      await capturePlanFailureLesson({
        goal,
        step: stepRecord,
        stepIndex: i,
        totalSteps: steps.length,
        config
      });
    }
  }

  const summaryLines = [];
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const tag = r.failed ? 'FAILED' : 'DONE';
    summaryLines.push(`[${tag}] ${r.role}: ${r.title}`);
    summaryLines.push(r.output.slice(0, 400));
    summaryLines.push('');
  }

  const failedSteps = results.filter((r) => r.failed);
  if (failedSteps.length > 0) {
    summaryLines.push(`${failedSteps.length} step(s) had errors.`);
    const firstFailed = failedSteps[0];
    if (firstFailed?.failureReason) {
      summaryLines.push(`Pipeline stopped after exit criteria failed at [${firstFailed.role}] ${firstFailed.title}: ${firstFailed.failureReason}.`);
    }
  }

  const hadImplementation = results.some(
    (r) => IMPLEMENTATION_EVIDENCE_ROLES.has(r.role) && !r.failed && implementationRoleHasToolEvidence(r.role, r.artifactPaths || [])
  );
  const testerPassed = results.some((r) => r.role === 'tester' && !r.failed);
  const testerRan = results.some((r) => r.role === 'tester');
  if (hadImplementation && (!testerRan || !testerPassed)) {
    const reason = !testerRan
      ? 'Implementation changed files but no tester step ran.'
      : 'Implementation changed files but tester step failed or left items Not Verified.';
    summaryLines.push(`[VERIFIER] ${reason}`);
    await capturePlanFailureLesson({
      goal,
      step: {
        role: 'tester',
        title: 'Verifier gate',
        failed: true,
        failureReason: reason,
        output: reason
      },
      stepIndex: results.length,
      totalSteps: steps.length,
      config
    });
  }

  if (signal?.aborted) {
    const partial = partialDeltaText.trim();
    if (partial) {
      const clipped = partial.length > 6000 ? `${partial.slice(0, 6000)}\n... [partial output truncated]` : partial;
      parentSession.messages.push(stampedMessage('assistant', clipped));
      await saveSession(parentSession);
    }
  }

  return {
    text: summaryLines.join('\n'),
    aborted: !!signal?.aborted,
    results,
    transcript,
    usage: totalUsage,
    verificationGap: Boolean(hadImplementation && (!testerRan || !testerPassed)),
    sessionText:
      [...results].reverse().find((r) => r.role === 'summarizer')?.output ||
      summaryLines.join('\n')
  };
}

async function buildAutoPlanArtifact({
  goal,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  sessionId,
  taskClass,
  workspaceRoot = process.cwd()
}) {
  const normalizedTaskClass = taskClass || classifyPlanTaskClass(goal);
  const requirementPacket = buildGoalRequirementPacket(goal, 'explorer');
  const plannerPrompt = [
    buildAutoPlanPlannerGuidance(),
    'Planning policy:',
    '- First classify the user goal as one of: advisory, implementation, verification-heavy, debugging, or a hybrid.',
    '- advisory = analysis, review, audit, optimization suggestions, architecture feedback, brainstorming, planning, or recommendation requests.',
    '- implementation = add/build/create/implement/refactor/fix/update/change behavior in code or files.',
    '- verification-heavy = the user explicitly asks to run tests, verify findings, reproduce a bug, prove a claim, or validate a result.',
    '- debugging = investigate bugs, crashes, errors, diagnose root causes, or trace unexpected behavior.',
    '- implementation-advisory = analyze AND implement (e.g. "analyze this and fix it").',
    '- Explicit repair requests such as "start fixing", "fix the review findings", "开始修复", or "修复发现的问题" are implementation or implementation-advisory, never advisory-only.',
    '- For debugging goals, prefer: explorer -> debugger -> coder -> tester -> summarizer.',
    '- For implementation-advisory hybrid goals, prefer: explorer -> advisor -> coder -> summarizer.',
    '- For advisory goals, prefer explorer and advisor roles. Do not use coder unless the plan will actually modify code or files.',
    '- For advisory goals, do not use reviewer, tester, or debugger unless the user explicitly asks for verification, review, or debugging as a separate deliverable.',
    '- For advisory goals, do not emit generic filler steps such as "Test and verify", "Review recommendations", or other template-only steps.',
    '- For implementation goals, reviewer and tester are optional support roles, not defaults. Only include them when they clearly add value.',
    '- Every step title must be concrete and tied to the goal. Avoid vague titles like "Initial analysis", "Review recommendations", or "Test and verify" unless the user explicitly requested those activities.',
    '- If the task is purely to inspect the current project and suggest improvements, a lean 2-step or 3-step plan is preferred.',
    '- Example advisory roles: explorer -> inspect project shape, advisor -> synthesize findings and prioritized recommendations.',
    '- Example implementation roles: explorer -> inspect target area, coder -> implement change, tester -> verify changed behavior.',
    '- Example debugging roles: explorer -> inspect failing area, debugger -> trace root cause, coder -> fix, tester -> verify fix.',
    `Return strict JSON only with shape {"summary":"...","task_size":"trivial|small|medium|large","task_type":"advisory|implementation|debugging|verification|refactor|documentation|hybrid","target_confidence":"known|likely|unknown","rationale":"...","steps":[{"title":"...","role":"${EXECUTOR_AGENT_ROLES.join('|')}","task":"...","consumes":"...","produces":"...","target_files":["..."],"success_criteria":"...","verification":"...","handoff":"..."}]}. No markdown.`
  ].join('\n');
  let autoPlan = {
    summary: `Auto plan for: ${goal}`,
    steps: [
      {
        title: 'Initial exploration',
        role: 'explorer',
        task: `Inspect the codebase and map the target area for: ${goal}`
      }
    ]
  };
  let planningError = '';
  try {
    const plannerSystemPrompt = await composeSystemPrompt({
      shellRulesPrompt: systemPrompt,
      config,
      workspaceRoot,
      skillsPrompt: plannerPrompt,
      includeSoul: false,
      includeMemory: false
    });
    const planning = await createChatCompletion({
      sdkProvider: config.sdk?.provider,
      baseUrl: config.gateway.base_url,
      apiKey: config.gateway.api_key,
      model: model || config.model.name,
      messages: [
        { role: 'system', content: plannerSystemPrompt },
        {
          role: 'user',
          content: [
            'Create an execution plan and assign best sub-agent role for each step.',
            `Task class: ${normalizedTaskClass}`,
            requirementPacket,
            'Follow the planning policy and JSON schema in the system prompt; do not repeat or explain them.'
          ]
            .filter(Boolean)
            .join('\n')
        }
      ],
      timeoutMs: config.gateway.timeout_ms || 1800000,
      maxRetries: config.gateway.max_retries ?? 2
    });
    const parsed = parseModelJsonObject(planning.text || '');
    autoPlan = normalizeAutoPlan(parsed, goal);
  } catch (err) {
    planningError = String(err?.message || err || 'planning failed');
    autoPlan = buildFallbackAutoPlan(goal);
  }

  const finalSummary = planningError
    ? `Plan created with fallback guidance because planning hit an error: ${planningError}`
    : 'Plan created for engineering-mode execution.';

  const filePath = await writeMarkdownInProjectDir(
    'plans',
    `${goal}-auto`,
    renderAutoPlanMarkdown({
      goal,
      autoPlan,
      finalSummary,
      planningError,
      approvalText: 'Plan does not require approval; execution is controlled by coding mode and the Stop control.',
      progressLine: '- Plan created for execution.'
    }),
    'plan-auto',
    sessionId,
    workspaceRoot
  );
  return {
    filePath,
    summary: autoPlan.summary,
    finalSummary,
    executionPolicy: 'automatic',
    steps: autoPlan.steps,
    completedCount: 0,
    warningCount: planningError ? 1 : 0,
    failedCount: 0,
    warningTitles: planningError ? ['planner:fallback-plan'] : [],
    failedTitles: []
  };
}

export async function writeExplicitAutoPlan({
  goal,
  steps = [],
  sessionId,
  workspaceRoot = process.cwd()
}) {
  const autoPlan = normalizeAutoPlan({
    summary: `Structured plan for: ${goal}`,
    steps
  }, goal);
  const finalSummary = 'Structured plan created for engineering-mode execution.';
  const filePath = await writeMarkdownInProjectDir(
    'plans',
    `${goal}-auto`,
    renderAutoPlanMarkdown({
      goal,
      autoPlan,
      finalSummary,
      approvalText: 'Plan does not require approval; execution is controlled by coding mode and the Stop control.',
      progressLine: '- Structured plan created for execution.'
    }),
    'plan-auto',
    sessionId,
    workspaceRoot
  );
  return {
    filePath,
    summary: autoPlan.summary,
    finalSummary,
    executionPolicy: 'automatic',
    steps: autoPlan.steps,
    completedCount: 0,
    warningCount: 0,
    failedCount: 0,
    warningTitles: [],
    failedTitles: []
  };
}

function renderAutoPlanMarkdown({
  goal,
  autoPlan,
  finalSummary,
  planningError = '',
  approvalText = 'Plan does not require approval; execution is controlled by coding mode and the Stop control.',
  progressLine = '- Plan created for execution.'
}) {
  const lines = [];
  lines.push(`# Auto Plan: ${goal}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(autoPlan?.summary || `Auto plan for: ${goal}`);
  lines.push('');
  lines.push('## Final Summary');
  lines.push(finalSummary || '(empty)');
  if (planningError) {
    lines.push('');
    lines.push(`Planning Error: ${planningError}`);
  }
  lines.push('');
  lines.push('## Steps');
  (Array.isArray(autoPlan?.steps) ? autoPlan.steps : []).forEach((s, idx) => {
    lines.push(`${idx + 1}. [${s.role}] ${s.title}`);
    lines.push(`   - task: ${s.task}`);
    if (Array.isArray(s.target_files) && s.target_files.length > 0) {
      lines.push(`   - targets: ${s.target_files.join(', ')}`);
    }
    if (s.success_criteria) lines.push(`   - success: ${s.success_criteria}`);
    if (s.verification) lines.push(`   - verification: ${s.verification}`);
    if (s.handoff) lines.push(`   - handoff: ${s.handoff}`);
  });
  lines.push('');
  lines.push('## Approval');
  lines.push(approvalText);
  lines.push('');
  lines.push('## Working Memory');
  lines.push('### Findings Ledger');
  lines.push(PLAN_MEMORY_MARKERS.findings[0]);
  lines.push('- None recorded yet.');
  lines.push(PLAN_MEMORY_MARKERS.findings[1]);
  lines.push('');
  lines.push('### Progress Ledger');
  lines.push(PLAN_MEMORY_MARKERS.progress[0]);
  lines.push(progressLine);
  lines.push(PLAN_MEMORY_MARKERS.progress[1]);
  return lines.join('\n');
}

export function parseProjectRequirementsOptions(args = [], { defaultOutputFormat = 'html' } = {}) {
  let depth = 'fast';
  let runner = 'agent';
  let outputFormat = defaultOutputFormat === 'md' ? 'md' : 'html';
  const focusArgs = [];
  const inputArgs = Array.isArray(args) ? args : [];
  for (let index = 0; index < inputArgs.length; index += 1) {
    const arg = inputArgs[index];
    const value = String(arg || '').trim();
    const normalized = value.toLowerCase();
    if (['--fast', '--quick', '--lite', '--light', '--快速'].includes(normalized)) {
      depth = 'fast';
      continue;
    }
    // Legacy --standard maps to full/deep; UI only exposes fast vs full.
    if (['--standard', '--balanced', '--默认', '--标准'].includes(normalized)) {
      depth = 'deep';
      continue;
    }
    if (['--deep', '--full', '--thorough', '--深度', '--完整'].includes(normalized)) {
      depth = 'deep';
      continue;
    }
    if (['--html', '--format=html', '--output=html', '--html版', '--网页版'].includes(normalized)) {
      outputFormat = 'html';
      continue;
    }
    if (['--md', '--markdown', '--format=md', '--format=markdown', '--output=md', '--output=markdown', '--md版', '--markdown版'].includes(normalized)) {
      outputFormat = 'md';
      continue;
    }
    if (['--format', '--output', '--格式'].includes(normalized)) {
      const next = String(inputArgs[index + 1] || '').trim().toLowerCase();
      if (['html', '网页', 'html版'].includes(next)) {
        outputFormat = 'html';
        index += 1;
        continue;
      }
      if (['md', 'markdown', 'markdown版'].includes(next)) {
        outputFormat = 'md';
        index += 1;
        continue;
      }
    }
    if (['--agent', '--single-agent', '--single', '--普通', '--单agent', '--单-agent'].includes(normalized)) {
      runner = 'agent';
      continue;
    }
    if (['--pipeline', '--plan', '--subagents', '--sub-agents', '--流水线', '--计划'].includes(normalized)) {
      // Pipeline generation is intentionally disabled by default for CodeWiki quality/stability.
      // Keep the old pipeline implementation in place for future controlled experiments, but do
      // not expose this flag as an active runner switch.
      continue;
    }
    focusArgs.push(arg);
  }
  const raw = focusArgs.join(' ').trim();
  const normalized = raw.toLowerCase();
  const hasIgnoreIntent = /(忽略|跳过|不生成|不要|无需|排除|exclude|skip|omit|without|no\s+)/i.test(raw);
  if (!hasIgnoreIntent) return { raw, focusArgs, depth, runner, outputFormat, ignoredSections: [] };

  const ignored = [];
  for (const section of PROJECT_REQUIREMENTS_SECTION_MARKERS) {
    const matched = section.labels.some((label) => {
      const value = String(label).toLowerCase();
      if (/^\d+$/.test(value)) {
        return new RegExp(`(^|[^0-9])${value}([^0-9]|$)`).test(normalized);
      }
      return normalized.includes(value);
    });
    if (matched) ignored.push(section);
  }
  return { raw, focusArgs, depth, runner, outputFormat, ignoredSections: ignored };
}

function getProjectRequirementsOutputPaths(reportSlug, outputFormat = 'html') {
  const normalizedFormat = outputFormat === 'md' ? 'md' : 'html';
  const base = `docs/requirements/${reportSlug}-project-requirements`;
  return {
    outputFormat: normalizedFormat,
    reportPath: `${base}.${normalizedFormat}`,
    companionPath: normalizedFormat === 'html' ? `${base}.md` : `${base}.html`,
    htmlPath: `${base}.html`,
    markdownPath: `${base}.md`
  };
}

function stripFrontmatter(raw = '') {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return text.trim();
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return text.trim();
  return text.slice(end + 5).trim();
}

async function loadBundledProjectRequirementsSkill(name = 'project-requirements') {
  const normalized = String(name || '').toLowerCase();
  if (normalized === 'project-requirements-md') {
    const raw = await fs.readFile(PROJECT_REQUIREMENTS_MD_INSTRUCTIONS, 'utf8');
    return {
      name: 'project-requirements-md',
      metadata: { type: 'skill', description: 'CodeWiki Markdown report' },
      content: stripFrontmatter(raw),
      source: 'bundled-skill'
    };
  }
  return {
    name: 'project-requirements',
    metadata: { type: 'skill', description: 'CodeWiki HTML report' },
    content: [
      'Generate a CodeWiki project requirements report into the pre-created HTML shell.',
      'Inspect the repository first, then fill every REQUIREMENTS_* marker section at the primary report path.',
      'Do not rewrite unrelated shell CSS, JavaScript, navigation, or metadata.',
      'Cite evidence file paths. Label claims EXTRACTED, INFERRED, or UNKNOWN.',
      'Honor user args:',
      '```text',
      '{{args}}',
      '```'
    ].join('\n'),
    source: 'bundled-skill'
  };
}

export function renderProjectRequirementsDepthContract(depth = 'fast') {
  if (depth === 'fast') {
    return [
      'Depth: fast.',
      'Cover entry points and the highest-value APIs/commands only.',
      'Skip exhaustive edge cases, compliance deep-dives, and full data-ownership mapping.',
      'Keep the report compact: inventory, key flows, top risks, and open questions.',
      'If the repo is large, stop after the core surface and list gaps explicitly.'
    ].join('\n');
  }
  return [
    'Depth: full.',
    'Cover major HTTP/CLI/tool/MCP/queue/SDK entry points as completely as practical.',
    'Include validation/permissions, data read/write, core user flows, risks, and acceptance criteria where evidence exists.',
    'Prefer evidence over speculation; mark UNKNOWN rather than inventing.'
  ].join('\n');
}

async function renderProjectRequirementsSkillPrompt(custom, options, workspaceRoot = process.cwd()) {
  if (options?.outputFormat === 'md') {
    const raw = await fs.readFile(PROJECT_REQUIREMENTS_MD_INSTRUCTIONS, 'utf8');
    const mdSkill = {
      name: 'project-requirements-md',
      metadata: { type: 'skill' },
      content: stripFrontmatter(raw)
    };
    return expandFileMentions(renderCommandPrompt(mdSkill, options.focusArgs, { cwd: workspaceRoot }), workspaceRoot);
  }
  const skill = custom?.content
    ? custom
    : await loadBundledProjectRequirementsSkill('project-requirements');
  return expandFileMentions(renderCommandPrompt(skill, options.focusArgs, { cwd: workspaceRoot }), workspaceRoot);
}

function getProjectRequirementsDefaultOutputFormat(custom) {
  return custom?.name === 'project-requirements-md' ? 'md' : 'html';
}

function validateProjectRequirementsFormat(skillName, outputFormat) {
  if (skillName === 'project-requirements-md' && outputFormat !== 'md') {
    return [
      'project-requirements-md always outputs Markdown CodeWiki.',
      'Use the HTML project-requirements workflow for a CodeWiki report instead of passing --html here.'
    ].join(' ');
  }
  return null;
}

function renderProjectRequirementsSectionContract(ignoredSections = []) {
  const ignored = new Set(ignoredSections.map((section) => section.marker));
  const required = PROJECT_REQUIREMENTS_SECTION_MARKERS
    .filter((section) => !ignored.has(section.marker))
    .map((section) => section.marker);
  const lines = [`Required marker sections: ${required.join(', ')}.`];
  if (ignoredSections.length > 0) {
    lines.push(`User-requested omitted sections: ${ignoredSections.map((section) => `${section.key} (${section.marker})`).join(', ')}.`);
    lines.push('For omitted sections, leave the shell section visibly marked as omitted and do not spend analysis or writing budget filling it.');
  }
  return lines.join('\n');
}

function buildProjectRequirementsSteps(renderedSkillPrompt, args = [], config = {}, reportSlug = formatLocalDateTimeSlug(), defaultOutputFormat = 'html') {
  const options = parseProjectRequirementsOptions(args, { defaultOutputFormat });
  const userArgs = options.raw;
  const requestedFocus = userArgs ? `User request/focus: ${userArgs}` : 'User request/focus: full workspace requirements report.';
  const replyLanguageName = getReplyLanguageName(config);
  const { reportPath, companionPath, outputFormat } = getProjectRequirementsOutputPaths(reportSlug, options.outputFormat);
  const htmlOutput = outputFormat === 'html';
  const reportContract = [
    requestedFocus,
    `Reply language: write generated report prose, UI labels inserted into the report, review notes, and final user-facing status in ${replyLanguageName} unless the user explicitly requested a different language. Do not translate REQUIREMENTS_* marker names or source code identifiers.`,
    `Requested output format: ${outputFormat}.`,
    `Primary report path: ${reportPath}`,
    outputFormat === 'html' ? `Optional companion Markdown path: ${companionPath}` : `Optional companion HTML path: ${companionPath}`,
    htmlOutput
      ? 'A pre-created HTML shell already exists at the primary report path.'
      : 'A pre-created Markdown template already exists at the primary report path.',
    htmlOutput
      ? 'Fill or replace only the named marker sections in that shell instead of rewriting the whole document.'
      : 'Write a complete Markdown requirements document at the primary report path. Use headings, tables, lists, fenced diagrams only when requested, and preserve evidence paths.',
    renderProjectRequirementsSectionContract(options.ignoredSections),
    htmlOutput
      ? 'For diagrams, write polished inline HTML/CSS or SVG directly in the report. Do not use Mermaid unless the user explicitly asks for Mermaid source.'
      : 'For diagrams in Markdown, prefer concise ASCII tables/lists or Mermaid source only when the user explicitly asks for Mermaid.',
    htmlOutput
      ? 'Follow the pre-created HTML shell Notion/Linear visual style: white background, warm neutral text (#37352f), subtle borders (#e9e9e7), and blue accents (#2383e2).'
      : 'Keep the Markdown document professional, scannable, PR-friendly, and evidence-backed.',
    'Prioritize API/interface-level business requirements. Every major interface should map to business capability, actor, trigger, inputs, outputs, rules, permissions, data reads/writes, errors, acceptance criteria, and evidence.',
    'Use EXTRACTED, INFERRED, and UNKNOWN labels. Preserve source evidence paths.',
    'Query query_project_graph before broad raw-file exploration. Use graph paths, confidence labels, and evidence as the fact map; verify uncertain or AMBIGUOUS relationships in source.',
    'Do not invent dates; use the report paths above.'
  ].join('\n');

  const writeReportStep = {
    title: '🎨 Write requirements report',
    role: 'coder',
    task: [
      'Create the final project requirements report from the accumulated plan context.',
      reportContract,
      htmlOutput
        ? 'Follow the project-requirements skill instructions below exactly, including chunked HTML writing for medium/large reports.'
        : 'Follow the project-requirements-md skill instructions below exactly, filling the Markdown template at the primary path.',
      htmlOutput
        ? 'Use the pre-created Notion/Linear-style shell and produce polished inline HTML/CSS/SVG diagrams. Keep the report clean, readable, and professional.'
        : 'Keep the Markdown document professional, scannable, PR-friendly, and evidence-backed.',
      'Organize the main requirements section primarily by API/interface business requirement cards.',
      htmlOutput
        ? 'The final HTML must be self-contained and directly openable from disk.'
        : 'The final Markdown must be readable in plain text and Markdown previewers.',
      outputFormat === 'html'
        ? 'Write the primary report to the exact primary report path above. Create the companion Markdown only if useful.'
        : 'Write the primary Markdown report to the exact primary report path above. Create the companion HTML only if explicitly useful.',
      'Skill instructions:',
      renderedSkillPrompt
    ].join('\n\n')
  };
  const reviewStep = {
    title: '🔎 Review API coverage and traceability',
    role: 'reviewer',
    task: [
      'Review the generated requirements report against the project-requirements contract and accumulated evidence.',
      reportContract,
      htmlOutput
        ? 'Check that major APIs/interfaces are represented, business requirements are decomposed per API, evidence paths are present, inferred/unknown content is labeled, diagrams are visible as inline HTML/CSS/SVG without external rendering libraries, and the report path matches the required local date.'
        : 'Check that major APIs/interfaces are represented, business requirements are decomposed per API, evidence paths are present, inferred/unknown content is labeled, Markdown tables/lists are readable, and the report path matches the required local date.',
      htmlOutput
        ? 'Check that the visual style matches the Notion/Linear shell (warm neutrals, blue accents) and remains readable when opened from disk.'
        : 'Check that the Markdown is suitable for review in Git diffs and Markdown previewers.',
      'Report concrete gaps and risks only. Do not rewrite the whole report.'
    ].join('\n')
  };
  const summaryStep = {
    title: '🧾 Summarize final report and unresolved questions',
    role: 'summarizer',
    task: [
      'Synthesize the project requirements pipeline results into a concise final status for the user.',
      reportContract,
      'Mention the generated report path, API/interface coverage, strongest business requirement findings, unresolved questions, what was not verified, and the best next action.',
      'Do not re-analyze the codebase unless the accumulated evidence is clearly insufficient.'
    ].join('\n')
  };

  if (options.depth === 'fast') {
    return [
      {
        title: '⚡ Map evidence and interfaces',
        role: 'explorer',
        task: [
          'Quickly map project evidence and build a practical API/interface inventory before report writing.',
          reportContract,
          'Inspect top-level docs, manifests, route/command entry points, obvious handlers, schemas, tests, and project index results when available.',
          'Produce a concise evidence map and major interface inventory with evidence paths, prioritizing broad coverage over exhaustive edge cases.',
          'Do not write the final report.'
        ].join('\n')
      },
      {
        title: '🧩 Synthesize requirements, flows, and risks',
        role: 'advisor',
        task: [
          'Synthesize requirement-ready findings from the evidence map and interface inventory.',
          reportContract,
          'For major interfaces capture capability, actor, trigger, inputs, outputs, business rules, validation/permission notes, data reads/writes, core flow dependencies, risks, acceptance criteria, and open questions.',
          'Keep findings compact and API-centered. Preserve evidence paths and EXTRACTED/INFERRED/UNKNOWN labels. Do not write the final report.'
        ].join('\n')
      },
      writeReportStep,
      {
        title: '🔎 Review and summarize coverage',
        role: 'reviewer',
        task: [
          'Review the generated report and produce the final user-facing status in one pass.',
          reportContract,
          'Check major interface coverage, evidence paths, EXTRACTED/INFERRED/UNKNOWN labels, visible diagrams, and report path.',
          'Do not rewrite the whole report. Report concrete gaps, unresolved questions, and the single best next action.'
        ].join('\n')
      }
    ];
  }

  if (options.depth === 'standard') {
    return [
      {
        title: '🧭 Map entry points and evidence sources',
        role: 'explorer',
        task: [
          'Map project entry points and evidence sources before any report writing.',
          reportContract,
          'Inspect top-level docs, package manifests, route/command entry points, tests, obvious interface files, and project index results when useful.',
          'Produce a concise evidence map grouped by docs, routes/commands, handlers, schemas, tests, configuration, storage, and operations.',
          'Include evidence paths and open questions. Do not write the final report.'
        ].join('\n')
      },
      {
        title: '📚 Build API and interface inventory',
        role: 'explorer',
        task: [
          'Build the canonical API/interface inventory using the evidence map.',
          reportContract,
          'Enumerate every major HTTP endpoint, CLI command, tool call, MCP/RPC handler, queue/scheduled job, exported SDK function, and user-facing workflow entry point.',
          'For each item include type, route/command/function, owner module, evidence path, likely actor, and whether it is EXTRACTED, INFERRED, or UNKNOWN.',
          'Do not write the final report.'
        ].join('\n')
      },
      {
        title: '🧩 Decompose requirements, flows, data, and risks',
        role: 'advisor',
        task: [
          'Decompose requirement-ready findings for each major API/interface from the inventory.',
          reportContract,
          'For each interface capture business capability, actor, user goal, trigger, inputs, outputs, preconditions, main/alternate flows, business rules, validation and permission checks, sensitive data, data reads/writes, side effects, acceptance criteria, and open questions.',
          'Keep findings API-centered rather than module-centered. Preserve evidence paths and EXTRACTED/INFERRED/UNKNOWN labels. Do not write the final report.'
        ].join('\n')
      },
      writeReportStep,
      reviewStep,
      summaryStep
    ];
  }

  return [
    {
      title: '🧭 Map entry points and evidence sources',
      role: 'explorer',
      task: [
        'Map project entry points and evidence sources before any report writing.',
        reportContract,
        'Inspect top-level docs, package manifests, route/command entry points, tests, and obvious interface files.',
        'Produce a concise evidence map grouped by docs, routes/commands, handlers, schemas, tests, configuration, storage, and operations.',
        'Include evidence paths and open questions. Do not write the final report.'
      ].join('\n')
    },
    {
      title: '📚 Build API and interface inventory',
      role: 'explorer',
      task: [
        'Build the canonical API/interface inventory using the evidence map.',
        reportContract,
        'Enumerate every major HTTP endpoint, CLI command, tool call, MCP/RPC handler, queue/scheduled job, exported SDK function, and user-facing workflow entry point.',
        'For each item include type, route/command/function, owner module, evidence path, likely actor, and whether it is EXTRACTED, INFERRED, or UNKNOWN.',
        'Do not write the final report.'
      ].join('\n')
    },
    {
      title: '🧩 Decompose business requirements per API',
      role: 'advisor',
      task: [
        'Decompose business requirements for each major API/interface from the inventory.',
        reportContract,
        'For each interface capture business capability, actor, user goal, trigger, inputs, outputs, preconditions, main flow, alternate flows, business rules, acceptance criteria, and open questions.',
        'Keep findings API-centered rather than module-centered. Do not write the final report.'
      ].join('\n')
    },
    {
      title: '🔐 Analyze validation, permissions, and compliance',
      role: 'advisor',
      task: [
        'Analyze validation, authorization, security, audit, and compliance implications per API/interface.',
        reportContract,
        'For each relevant interface identify validation rules, permission checks, sensitive data, audit/traceability needs, policy constraints, retry/rollback behavior, and UNKNOWN compliance gaps.',
        'Return requirement-ready findings with evidence paths. Do not write the final report.'
      ].join('\n')
    },
    {
      title: '💾 Map data ownership and state changes',
      role: 'advisor',
      task: [
        'Map data ownership, storage paths, state transitions, and side effects per API/interface.',
        reportContract,
        'Identify data reads, data writes, config/session/memory/file/database ownership, lifecycle states, cache/index behavior, external dependencies, and operational side effects.',
        'Return requirement-ready findings with evidence paths. Do not write the final report.'
      ].join('\n')
    },
    {
      title: '🔄 Connect user flows to API dependencies',
      role: 'advisor',
      task: [
        'Connect user-facing flows to the API/interface inventory and implementation dependencies.',
        reportContract,
        'Create flow-ready findings for core journeys, API dependency maps, sequence summaries, error paths, and cross-interface handoffs.',
        'Favor clear business process decomposition over broad architecture prose. Do not write the final report.'
      ].join('\n')
    },
    writeReportStep,
    reviewStep,
    summaryStep
  ];
}

function renderProjectRequirementsPlanMarkdown({ goal, steps, reportPath, companionPath }) {
  const autoPlan = {
    summary: 'Dedicated sub-agent pipeline for project requirements discovery and report generation.',
    steps
  };
  const progressLines = steps
    .map((step, index) => `- [ ] Step ${index + 1} [${step.role}] ${step.title}`)
    .join('\n');
  return [
    `# Project Requirements Pipeline: ${goal}`,
    '',
    `Primary Report: ${reportPath}`,
    `Optional Companion: ${companionPath}`,
    '',
    renderAutoPlanMarkdown({
      goal,
      autoPlan,
      finalSummary: 'Project requirements pipeline created and will execute immediately.',
      approvalText: 'No approval required. Triggered explicitly by the project-requirements workflow.',
      progressLine: progressLines
    })
  ].join('\n');
}

function replaceTemplateVariables(template, variables) {
  let out = String(template || '');
  for (const [key, value] of Object.entries(variables || {})) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ''));
  }
  return out;
}

async function createProjectRequirementsShell({
  workspaceRoot = process.cwd(),
  reportPath,
  companionPath,
  manifestPath,
  planFile,
  goal,
  steps,
  depth = 'fast',
  outputFormat = 'html',
  config = {}
}) {
  workspaceRoot = path.resolve(workspaceRoot);
  const absoluteReportPath = path.resolve(workspaceRoot, reportPath);
  const absoluteManifestPath = path.resolve(workspaceRoot, manifestPath);
  await fs.mkdir(path.dirname(absoluteReportPath), { recursive: true });
  const now = new Date().toISOString();
  const initializedGraph = await initializeProjectIndex(workspaceRoot).catch(() => null);
  const graphMetadata = initializedGraph?.projectRoot
    ? queryProjectKnowledgeGraph(initializedGraph.projectRoot, {
        operation: 'overview',
        depth: 0,
        token_budget: 250
      })
    : null;
  if (outputFormat === 'md') {
    const template = await fs.readFile(PROJECT_REQUIREMENTS_MD_TEMPLATE, 'utf8');
    const markdown = replaceTemplateVariables(template, {
      title: goal,
      workspace_name: path.basename(workspaceRoot) || workspaceRoot,
      date: formatLocalDate(),
      generated_at: now,
      reply_language: getReplyLanguageName(config)
    });
    await fs.writeFile(absoluteReportPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  } else {
    const template = await fs.readFile(PROJECT_REQUIREMENTS_TEMPLATE, 'utf8');
    const shellCopy = PROJECT_REQUIREMENTS_SHELL_COPY[getReplyLanguage(config)] || PROJECT_REQUIREMENTS_SHELL_COPY.zh;
    const html = replaceTemplateVariables(template, {
      ...shellCopy,
      workspace_name: path.basename(workspaceRoot) || workspaceRoot,
      date: formatLocalDate(),
      generated_at: now
    });
    await fs.writeFile(absoluteReportPath, html, 'utf8');
  }

  const manifest = {
    status: 'running',
    depth,
    outputFormat,
    goal,
    html: outputFormat === 'html' ? reportPath : companionPath,
    markdown: outputFormat === 'md' ? reportPath : companionPath,
    primary: reportPath,
    manifest: manifestPath,
    plan: planFile,
    createdAt: now,
    updatedAt: now,
    graphVersion: graphMetadata?.graph_version || '',
    graphBuiltAt: graphMetadata?.built_at || '',
    sections: Object.fromEntries(PROJECT_REQUIREMENTS_SECTION_NAMES.map((name) => [name, 'pending'])),
    steps: steps.map((step, index) => ({
      step: index + 1,
      role: step.role,
      title: step.title,
      status: 'pending'
    }))
  };
  await fs.writeFile(absoluteManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

async function updateProjectRequirementsManifest(manifestPath, updates = {}, workspaceRoot = process.cwd()) {
  if (!manifestPath) return;
  try {
    const absoluteManifestPath = path.resolve(workspaceRoot, manifestPath);
    const current = JSON.parse(await fs.readFile(absoluteManifestPath, 'utf8'));
    const next = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(absoluteManifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch {
    // Manifest is best-effort; plan file and events remain the source of truth.
  }
}

function buildProjectRequirementsTerminalManifestPatch(status = 'completed', extra = {}) {
  const normalizedStatus = ['completed', 'failed', 'aborted'].includes(String(status || '').toLowerCase())
    ? String(status).toLowerCase()
    : 'completed';
  return {
    status: normalizedStatus,
    failedCount: normalizedStatus === 'completed' ? 0 : Number(extra.failedCount || 1),
    sections: Object.fromEntries(PROJECT_REQUIREMENTS_SECTION_NAMES.map((name) => [
      name,
      normalizedStatus === 'completed' ? 'completed' : normalizedStatus
    ])),
    steps: [{
      step: 1,
      role: 'coder',
      title: 'Generate project requirements report',
      status: normalizedStatus === 'completed' ? 'done' : normalizedStatus
    }],
    ...extra
  };
}

export async function readProjectRequirementsReportState(reportPath, outputFormat = 'html', workspaceRoot = process.cwd()) {
  const absoluteReportPath = path.resolve(workspaceRoot, reportPath);
  const text = await fs.readFile(absoluteReportPath, 'utf8');
  const stat = await fs.stat(absoluteReportPath);
  const normalizedFormat = outputFormat === 'md' ? 'md' : 'html';
  let looksComplete = false;

  if (normalizedFormat === 'md') {
    looksComplete = text.length > 5000
      && !/PROJECT_REQUIREMENTS_MD_TEMPLATE/.test(text)
      && !/<!--\s*Fill with /i.test(text)
      && !/\|\s*TBD\s*\|\s*TBD\s*\|\s*TBD\s*\|/i.test(text)
      && !/等待填写/i.test(text);
  } else {
    const filledMarkers = ['REQUIREMENTS_SUMMARY', 'REQUIREMENTS_INTERFACE_INVENTORY', 'REQUIREMENTS_API_CARDS']
      .filter((marker) => {
        const match = text.match(new RegExp(`<!--\\s*${marker}\\s*-->([\\s\\S]*?)<!--\\s*/${marker}\\s*-->`, 'i'));
        const body = String(match?.[1] || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
        return body.length > 80 && !/待生成|等待填写|TODO|TBD/i.test(body);
      }).length;
    looksComplete = filledMarkers >= 2;
  }

  return {
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    looksComplete
  };
}

async function runProjectRequirementsPipeline({
  custom,
  parsedInput,
  currentSession,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  signal,
  onSubSessionActive,
  workspaceRoot = process.cwd()
}) {
  const defaultOutputFormat = getProjectRequirementsDefaultOutputFormat(custom);
  const options = parseProjectRequirementsOptions(parsedInput.args, { defaultOutputFormat });
  const renderedSkillPrompt = await renderProjectRequirementsSkillPrompt(custom, options, workspaceRoot);
  const userFocus = options.raw;
  const goal = userFocus ? `project requirements report: ${userFocus}` : 'project requirements report';
  const reportSlug = formatLocalDateTimeSlug();
  const { reportPath, companionPath, outputFormat } = getProjectRequirementsOutputPaths(reportSlug, options.outputFormat);
  const manifestPath = `docs/requirements/${reportSlug}-project-requirements.manifest.json`;
  const steps = buildProjectRequirementsSteps(renderedSkillPrompt, parsedInput.args, config, reportSlug, defaultOutputFormat);
  const planFile = await writeMarkdownInProjectDir(
    'plans',
    'project-requirements-pipeline',
    renderProjectRequirementsPlanMarkdown({ goal, steps, reportPath, companionPath }),
    'project-requirements',
    currentSession.id,
    workspaceRoot
  );
  await createProjectRequirementsShell({
    workspaceRoot,
    reportPath,
    companionPath,
    manifestPath,
    planFile,
    goal,
    steps,
    depth: options.depth,
    outputFormat,
    config
  });
  const planState = {
    status: 'running',
    source: 'project-requirements',
    depth: options.depth,
    outputFormat,
    goal,
    filePath: planFile,
    summary: `Dedicated ${options.depth} sub-agent pipeline for project requirements report generation.`,
    finalSummary: `Executing ${options.depth} project requirements pipeline.`,
    steps
  };
  if (onAgentEvent) {
    onAgentEvent({ type: 'skill:start', name: custom.name });
    onAgentEvent({
      type: 'plan:progress',
      planFile,
      reportPath,
      manifestPath,
      step: 0,
      total: steps.length,
      status: 'created',
      summary: 'Project requirements pipeline created'
    });
  }
  let execution;
  try {
    execution = await executePlanWithSubAgents({
      planState,
      parentSession: currentSession,
      config,
      model,
      systemPrompt,
      onAgentEvent,
      signal,
      onSubSessionActive,
      workspaceRoot
    });
  } catch (error) {
    if (onAgentEvent) {
      onAgentEvent({
        type: 'skill:error',
        name: custom.name,
        summary: error instanceof Error ? error.message : String(error)
      });
      onAgentEvent({ type: 'skill:end', name: custom.name });
    }
    if (manifestPath) {
      await updateProjectRequirementsManifest(manifestPath, {
        status: 'failed',
        failedCount: steps.length,
        error: error instanceof Error ? error.message : String(error)
      }, workspaceRoot).catch(() => {});
    }
    return {
      type: 'assistant',
      text: `Project requirements pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
      planFile,
      reportPath,
      manifestPath,
      aborted: true
    };
  }
  if (onAgentEvent) {
    onAgentEvent({
      type: 'plan:progress',
      planFile,
      reportPath,
      manifestPath,
      step: steps.length,
      total: steps.length,
      status: execution.aborted ? 'aborted' : 'done',
      summary: 'Project requirements pipeline finished'
    });
    onAgentEvent({ type: 'skill:end', name: custom.name });
  }
  const failedCount = Array.isArray(execution.results)
    ? execution.results.filter((item) => item.failed).length
    : 0;
  await updateProjectRequirementsManifest(manifestPath, {
    ...(execution.aborted
      ? buildProjectRequirementsTerminalManifestPatch('aborted', { failedCount })
      : failedCount > 0
        ? buildProjectRequirementsTerminalManifestPatch('failed', { failedCount })
        : buildProjectRequirementsTerminalManifestPatch('completed'))
  }, workspaceRoot);
  const text = [
    execution.text || '',
    '',
    'Project requirements pipeline completed.',
    `Plan File: ${planFile}`,
    `Report Path: ${reportPath}`,
    `Manifest: ${manifestPath}`,
    `Steps: ${steps.length} total`,
    `Failed: ${failedCount}`,
    `Output Format: ${outputFormat}`
  ]
    .filter(Boolean)
    .join('\n');
  return {
    type: 'assistant',
    text,
    planFile,
    reportPath,
    manifestPath,
    aborted: !!execution.aborted
  };
}

async function runProjectRequirementsSingleAgent({
  custom,
  parsedInput,
  currentSession,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  requestToolApproval,
  signal,
  compactedForModel,
  onCompactedUpdate,
  titleCoordinator = null,
  codeWikiGenerate = false,
  workspaceRoot = process.cwd()
}) {
  const defaultOutputFormat = getProjectRequirementsDefaultOutputFormat(custom);
  const options = parseProjectRequirementsOptions(parsedInput.args, { defaultOutputFormat });
  const renderedSkillPrompt = await renderProjectRequirementsSkillPrompt(custom, options, workspaceRoot);
  const userFocus = options.raw;
  const goal = userFocus ? `project requirements report: ${userFocus}` : 'project requirements report';
  const reportSlug = formatLocalDateTimeSlug();
  const { reportPath, companionPath, outputFormat } = getProjectRequirementsOutputPaths(reportSlug, options.outputFormat);
  const manifestPath = `docs/requirements/${reportSlug}-project-requirements.manifest.json`;
  const planFile = await writeMarkdownInProjectDir(
    'plans',
    'project-requirements-agent',
    [
      `# Project Requirements Agent: ${goal}`,
      '',
      `Primary Report: ${reportPath}`,
      `Optional Companion: ${companionPath}`,
      '',
      'Runner: single agent',
      `Depth: ${options.depth}`,
      `Output Format: ${outputFormat}`
    ].join('\n'),
    'project-requirements',
    currentSession.id,
    workspaceRoot
  );
  const steps = [{ title: 'Generate project requirements report', role: 'coder', task: goal }];
  await createProjectRequirementsShell({
    workspaceRoot,
    reportPath,
    companionPath,
    manifestPath,
    planFile,
    goal,
    steps,
    depth: options.depth,
    outputFormat,
    config
  });
  const htmlOutput = outputFormat === 'html';
  const reportContract = [
    userFocus ? `User request/focus: ${userFocus}` : 'User request/focus: full workspace requirements report.',
    `Reply language: write generated report prose, UI labels inserted into the report, review notes, and final user-facing status in ${getReplyLanguageName(config)} unless the user explicitly requested a different language.`,
    `Requested output format: ${outputFormat}.`,
    `Primary report path: ${reportPath}`,
    outputFormat === 'html' ? `Optional companion Markdown path: ${companionPath}` : `Optional companion HTML path: ${companionPath}`,
    htmlOutput
      ? 'A pre-created HTML shell already exists at the primary report path.'
      : 'A pre-created Markdown template already exists at the primary report path.',
    htmlOutput
      ? 'Fill or replace only the named REQUIREMENTS_* marker sections in that shell instead of rewriting unrelated shell CSS, JavaScript, navigation, or metadata.'
      : 'Fill every named REQUIREMENTS_* marker section in the Markdown template at the primary report path. Use headings, tables, lists, and evidence paths. Remove template-only comments before final delivery.',
    renderProjectRequirementsSectionContract(options.ignoredSections),
    renderProjectRequirementsDepthContract(options.depth),
    'Use one coherent agent pass: inspect the project, build the evidence map, decompose APIs/interfaces, write the report, and self-check before answering.',
    options.depth === 'fast'
      ? [
          'Stay inside the fast budget: finish the core surface, then stop with explicit gaps instead of expanding scope.',
          'Use at most three evidence-gathering rounds before writing. Batch independent graph queries, searches, and reads in the same round; do not re-read unchanged files.'
        ].join(' ')
      : 'Prefer a complete, evidence-backed report. If the project is too large, cover the most important entry points first and clearly list gaps.',
    'Do not invent dates; use the report paths above.'
  ].join('\n');

  if (onAgentEvent) {
    onAgentEvent({ type: 'skill:start', name: custom.name });
    onAgentEvent({
      type: 'plan:steps',
      goal,
      steps: [{
        index: 1,
        role: 'coder',
        title: 'Generate project requirements report',
        status: 'running'
      }]
    });
    onAgentEvent({
      type: 'plan:progress',
      planFile,
      reportPath,
      manifestPath,
      step: 1,
      total: 1,
      role: 'coder',
      title: 'Generate project requirements report',
      status: 'running',
      summary: 'Project requirements single-agent generation started'
    });
  }

  try {
    // CodeWiki must not inherit chat transcript: orphan tool_use / compact
    // history reliably 400s the gateway and leaves the empty shell behind.
    const transientSession = codeWikiGenerate
      ? {
          ...structuredClone(currentSession),
          messages: [],
          compact: null,
          planState: null,
          specState: null
        }
      : currentSession;
    const agentConfig = codeWikiGenerate
      ? {
          ...config,
          execution: {
            ...(config.execution || {}),
            approval_mode: 'full_access'
          }
        }
      : config;
    const result = await askModel({
      text: parsedInput.full ? `/${parsedInput.full}` : `/${custom.name}`,
      modelText: [reportContract, 'Skill instructions:', renderedSkillPrompt].join('\n\n'),
      session: transientSession,
      config: agentConfig,
      model,
      systemPrompt,
      onAgentEvent,
      requestToolApproval,
      executionMode: 'normal',
      allowedTools: codeWikiGenerate ? CODEWIKI_GENERATE_TOOLS : undefined,
      alwaysAllowTools: codeWikiGenerate ? CODEWIKI_GENERATE_TOOLS : undefined,
      signal,
      compactedForModel: codeWikiGenerate ? null : compactedForModel,
      onCompactedUpdate: codeWikiGenerate ? null : onCompactedUpdate,
      persistSession: !codeWikiGenerate,
      titleCoordinator,
      workspaceRoot
    });
    const reportState = await readProjectRequirementsReportState(
      reportPath,
      outputFormat,
      workspaceRoot
    ).catch(() => ({ looksComplete: false }));
    const succeeded = !result?.aborted && reportState.looksComplete;
    const failureReason = result?.aborted
      ? (String(result?.text || '').trim() || 'Project requirements generation aborted')
      : 'Report shell was not filled (still showing placeholders)';
    await updateProjectRequirementsManifest(manifestPath, {
      ...(succeeded
        ? buildProjectRequirementsTerminalManifestPatch('completed')
        : buildProjectRequirementsTerminalManifestPatch(
          result?.aborted ? 'aborted' : 'failed',
          { failedCount: 1, error: failureReason }
        ))
    }, workspaceRoot);
    if (onAgentEvent) {
      onAgentEvent({
        type: 'plan:progress',
        planFile,
        reportPath,
        manifestPath,
        step: 1,
        total: 1,
        role: 'coder',
        title: 'Generate project requirements report',
        status: succeeded ? 'done' : (result?.aborted ? 'aborted' : 'failed'),
        summary: succeeded
          ? 'Project requirements single-agent generation finished'
          : failureReason
      });
      onAgentEvent({ type: 'skill:end', name: custom.name });
    }
    const text = [
      result?.text || '',
      '',
      succeeded
        ? 'Project requirements generation completed.'
        : `Project requirements generation failed: ${failureReason}`,
      `Plan File: ${planFile}`,
      `Report Path: ${reportPath}`,
      `Manifest: ${manifestPath}`,
      'Runner: single agent',
      `Output Format: ${outputFormat}`
    ].filter(Boolean).join('\n');
    return { type: 'assistant', text, planFile, reportPath, manifestPath, aborted: !succeeded };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateProjectRequirementsManifest(manifestPath, {
      ...buildProjectRequirementsTerminalManifestPatch('failed', {
        failedCount: 1,
        error: message
      })
    }, workspaceRoot).catch(() => {});
    if (onAgentEvent) {
      onAgentEvent({ type: 'skill:error', name: custom.name, summary: message });
      onAgentEvent({ type: 'skill:end', name: custom.name });
    }
    return {
      type: 'assistant',
      text: `Project requirements generation failed: ${message}`,
      planFile,
      reportPath,
      manifestPath,
      aborted: true
    };
  }
}

async function revisePendingPlanWithModel({
  planState,
  feedback,
  config,
  model,
  systemPrompt
}) {
  const goal = String(planState?.goal || '').trim();
  const priorSummary = String(planState?.summary || '').trim();
  const priorSteps = Array.isArray(planState?.steps) ? planState.steps : [];
  if (!goal || !feedback) {
    throw new Error('Plan revision requires both goal and feedback.');
  }
  const prompt = [
    buildAutoPlanPlannerGuidance(),
    'You are revising an existing plan based on explicit user feedback.',
    'Return strict JSON only with shape {"summary":"...","task_size":"trivial|small|medium|large","task_type":"advisory|implementation|debugging|verification|refactor|documentation|hybrid","target_confidence":"known|likely|unknown","rationale":"...","steps":[{"title":"...","role":"' + EXECUTOR_AGENT_ROLES.join('|') + '","task":"...","consumes":"...","produces":"...","target_files":["..."],"success_criteria":"...","verification":"...","handoff":"..."}]}. No markdown.',
    'Keep roles minimal and only include steps that materially help the goal.',
    'Always keep a summarizer as the final step.'
  ].join('\n');
  const revisionSystemPrompt = await composeSystemPrompt({
    shellRulesPrompt: systemPrompt,
    config,
    skillsPrompt: prompt,
    includeSoul: false,
    includeMemory: false
  });
  const result = await createChatCompletion({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: model || config.model.name,
    messages: [
      { role: 'system', content: revisionSystemPrompt },
      {
        role: 'user',
        content: [
          `Goal: ${goal}`,
          `Current summary: ${priorSummary || '-'}`,
          'Current plan steps:',
          ...priorSteps.map((step, index) => `${index + 1}. [${step.role}] ${step.title} :: ${step.task}`),
          '',
          `User revision feedback: ${feedback}`,
          'Revise the summary and steps accordingly while keeping them executable.'
        ].join('\n')
      }
    ],
    timeoutMs: config.gateway.timeout_ms || 1800000,
    maxRetries: config.gateway.max_retries ?? 2
  });
  const parsed = parseModelJsonObject(result.text || '');
  const revised = normalizeAutoPlan(parsed, goal);
  const revisedFinalSummary = `Plan revised based on feedback: ${feedback}`;
  const planFilePath = String(planState?.filePath || '').trim();
  if (planFilePath) {
    const content = renderAutoPlanMarkdown({
      goal,
      autoPlan: revised,
      finalSummary: revisedFinalSummary,
      approvalText: buildPlanReviewApprovalText('revised', { feedback }),
      progressLine: buildPlanReviewProgressLine('revised', { feedback })
    });
    await fs.writeFile(planFilePath, `${content.trim()}\n`, 'utf8');
  }
  return {
    status: 'ready',
    source: String(planState?.source || 'auto'),
    goal,
    filePath: planFilePath,
    summary: revised.summary || `Auto plan for: ${goal}`,
    finalSummary: revisedFinalSummary,
    steps: revised.steps
  };
}

async function handleShellInput(shellText, config, workspaceRoot = process.cwd()) {
  if (!shellText) return { text: '' };
  if (
    !config.policy.allow_dangerous_commands &&
    isDangerousCommand(shellText, config.policy.blocked_command_patterns)
  ) {
    return { text: 'Blocked by policy: dangerous command pattern detected' };
  }
  const check = evaluateCommandPolicy(shellText, config, workspaceRoot);
  if (!check.allowed) {
    return { text: `Blocked by safe mode: ${check.reason}${check.suggestion ? ` | ${check.suggestion}` : ''}` };
  }
  const result = await runShellCommand({
    command: shellText,
    shell: config.shell.default,
    timeoutMs: config.shell.timeout_ms,
    config,
  });
  const chunks = [];
  if (result.stdout.trim()) chunks.push(result.stdout.trimEnd());
  if (result.stderr.trim()) chunks.push(result.stderr.trimEnd());
  if (result.code !== 0) chunks.push(`exit code: ${result.code}`);
  return { text: chunks.join('\n') };
}

function formatHistoryTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'updated unknown';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return `updated ${raw}`;
  return `updated ${parsed.toISOString().slice(0, 16).replace('T', ' ')}`;
}

function compactHistoryPreview(value, maxChars = 72) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '(no preview)';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function formatHistoryList({ currentSession, sessions }) {
  const currentMessages = Array.isArray(currentSession?.messages) ? currentSession.messages.length : 0;
  const lines = [
    `Current session  ${currentSession.title || currentSession.id}`,
    `Session id       ${currentSession.id}`,
    `Messages         ${currentMessages}`,
    '',
    'Recent sessions'
  ];

  for (const [index, session] of sessions.entries()) {
    const count = Number(session.messageCount || 0);
    lines.push(
      `${index + 1}. ${session.title || session.id}`,
      `   id=${session.id}`,
      `   ${count} ${count === 1 ? 'msg' : 'msgs'}  |  ${formatHistoryTimestamp(session.updatedAt)}${session.model ? `  |  ${session.model}` : ''}`,
      `   ${compactHistoryPreview(session.preview)}`,
      `   session: ${session.id}`
    );
  }

  return lines.join('\n');
}

export async function createChatRuntime({
  session,
  config: initialConfig,
  model,
  systemPrompt,
  systemPromptFactory,
  requestToolApproval,
  workspaceRoot
}) {
  const root = path.resolve(workspaceRoot || session?.projectDir || process.cwd());
  if (session && typeof session === 'object') session.projectDir = root;
  let requestToolApprovalObserver = typeof requestToolApproval === 'function' ? requestToolApproval : null;
  const approvalRequestState = { current: null };
  const activeRequestToolApproval = async (request) => {
    let resolveStructuredApproval;
    const structuredDecision = new Promise((resolve) => {
      resolveStructuredApproval = resolve;
    });
    approvalRequestState.current = { ...request, resolve: resolveStructuredApproval };
    try {
      const observerDecision = requestToolApprovalObserver
        ? Promise.resolve(requestToolApprovalObserver(request))
        : new Promise(() => {});
      return await Promise.race([structuredDecision, observerDecision]);
    } finally {
      approvalRequestState.current = null;
    }
  };
  let activeRequestUserInput = null;
  let onTitleUpdateCallback = null;
  let onTitleStatusCallback = null;
  const startupEvents = [];
  const initialIndexPromise = initializeProjectIndex(root).catch(() => null);
  const initialTodos = normalizeTodos(session?.todos);
  if (initialTodos.length > 0) {
    startupEvents.push({
      type: 'tool',
      id: `startup-todos-${String(session?.id || 'session')}`,
      name: 'tasks',
      status: 'done',
      arguments: { tasks: initialTodos },
      summary: `${initialTodos.length} task item(s)`
    });
  }
  const initialPlanState = normalizePlanState(session?.planState);
  if (initialPlanState) {
    startupEvents.push({
      type: 'tool',
      id: `startup-plan-${String(session?.id || 'session')}`,
      name: 'update_plan',
      status: 'done',
      arguments: { plan: initialPlanState },
      summary: `plan status=${initialPlanState.status || 'draft'}`
    });
  }
  let currentSession = session;
  const titleCoordinator = createSessionTitleTaskCoordinator();
  let config = initialConfig;
  model = model || currentSession?.model || resolveDefaultModel(config);
  scheduleMemoryReviewBacklog({ config, currentSessionId: currentSession?.id });
  if (currentSession && typeof currentSession === 'object') {
    currentSession.model = model;
  }
  const baseSystemPrompt = systemPrompt;
  const getBaseSystemPrompt = () =>
    typeof systemPromptFactory === 'function'
      ? systemPromptFactory(config)
      : baseSystemPrompt;
  let executionMode = resolveRuntimeExecutionMode(config.execution?.mode || 'normal', config, currentSession);
  let compactState = null;
  const normalizeCompactThreshold = (value, fallback = 60) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(95, Math.max(50, num));
  };
  const syncCompactStateFromConfig = () => {
    if (!compactState) return;
    compactState.threshold = normalizeCompactThreshold(config.context?.preflight_trigger_pct, 60);
  };
  const syncRuntimeFromConfig = async ({ model: nextModel } = {}) => {
    const previousMode = executionMode;
    const previouslyArmed = new Set(
      typeof skillHooksSession?.activeSkills?.keys === 'function'
        ? [...skillHooksSession.activeSkills.keys()]
        : [],
    );
    executionMode = resolveRuntimeExecutionMode(config.execution?.mode || 'normal', config, currentSession);
    syncCompactStateFromConfig();

    const resolvedModel = String(nextModel || '').trim();
    if (resolvedModel) {
      model = resolvedModel;
      if (currentSession && typeof currentSession === 'object') {
        currentSession.model = model;
        await saveSession(currentSession).catch(() => {});
      }
    }
    if (typeof reloadWorkspaceHooks === 'function') {
      await reloadWorkspaceHooks();
      if (
        typeof reconcileSessionStartForModeChange === 'function'
        && normalizeExecutionMode(previousMode) !== normalizeExecutionMode(executionMode)
      ) {
        await reconcileSessionStartForModeChange(previouslyArmed);
      }
    }
  };
  const [initialIndex, commands] = await Promise.all([
    initialIndexPromise,
    loadCommandsAndSkills(root),
  ]);
  if (initialIndex?.summary) {
    startupEvents.unshift({
      type: 'system_tool',
      name: 'project_index(.codemini/index.sqlite)',
      status: 'done',
      summary: initialIndex.summary
    });
  }
  const COMMAND_RELOAD_TTL_MS = 5_000;
  let commandsReloadedAt = Date.now();
  let commandsReloadPromise = null;
  let skillIndexPromptCache = null;
  // Memoize the deterministic base prompt and the volatile memory snapshot so
  // the composed system prompt is not re-read/re-rendered from disk every turn.
  let baseSystemPromptMemo = { configRef: null, root: '', value: '' };
  let memorySnapshotMemo = null;
  const getMemoizedBaseSystemPrompt = () => {
    if (baseSystemPromptMemo.configRef === config && baseSystemPromptMemo.root === root) {
      return baseSystemPromptMemo.value;
    }
    const value = getBaseSystemPrompt();
    baseSystemPromptMemo = { configRef: config, root, value };
    return value;
  };
  const memoryFilesMtimeKey = async (workspaceRoot) => {
    const paths = [
      path.join(getBaseConfigDir(), 'codemini.sqlite'),
      path.join(getProjectIndexDir(workspaceRoot), 'index.sqlite'),
    ];
    const stamps = await Promise.all(paths.map((filePath) =>
      fs.stat(filePath).then((stat) => `${filePath}:${stat.mtimeMs}`, () => `${filePath}:missing`),
    ));
    return stamps.join('|');
  };
  const getMemoizedMemorySnapshot = async (userQuery = '') => {
    const mtimeKey = `${await memoryFilesMtimeKey(root)}::${String(userQuery || '')}`;
    if (
      memorySnapshotMemo
      && memorySnapshotMemo.configRef === config
      && memorySnapshotMemo.mtimeKey === mtimeKey
    ) {
      return memorySnapshotMemo.value;
    }
    const composed = await composeMemorySnapshot({ config, workspaceRoot: root, query: userQuery }).catch(() => ({ text: '', inject: null }));
    memorySnapshotMemo = { configRef: config, mtimeKey, value: composed.text || '', retrievedText: composed.retrievedText || '', inject: composed.inject || null };
    return memorySnapshotMemo.value;
  };
  const reloadCommandsAndSkills = async ({ force = false } = {}) => {
    if (!force && Date.now() - commandsReloadedAt < COMMAND_RELOAD_TTL_MS) return false;
    if (commandsReloadPromise) return commandsReloadPromise;
    commandsReloadPromise = (async () => {
      const next = await loadCommandsAndSkills(root);
      commands.clear();
      for (const [name, command] of next.entries()) {
        commands.set(name, command);
      }
      commandsReloadedAt = Date.now();
      skillIndexPromptCache = null;
      return true;
    })().finally(() => {
      commandsReloadPromise = null;
    });
    return commandsReloadPromise;
  };
  // Skill hooks (SessionStart/UserPromptSubmit/PreToolUse/...) are armed per skill
  // as skills get selected or loaded, then fired against this session's active set.
  // Workspace (project/global) hooks are always armed for this runtime.
  const skillHooksSession = createSkillHooksSession();
  const reloadWorkspaceHooks = async () => {
    const hookContext = normalizeExecutionMode(executionMode) === 'plan' ? 'coding' : 'daily';
    const [projectLayer, globalLayer, customProfiles] = await Promise.all([
      loadProjectHooks(root, { context: hookContext }).catch(() => ({ hooks: {} })),
      loadGlobalHooks().catch(() => ({ hooks: {} })),
      listCustomHookProfiles(root).catch(() => []),
    ]);

    for (const name of [...skillHooksSession.activeSkills.keys()]) {
      if (isPackageHooksArmName(name)) {
        disarmSkillHooks(skillHooksSession, name);
      }
    }

    const legacyMerged = mergeWorkspaceHookLayers(globalLayer.hooks, projectLayer.hooks);
    // Package profiles arm as their own layer; only custom profiles merge into workspace.
    const activeCustomHooks = mergeHookProfileHooks(
      customProfiles.filter(
        (profile) =>
          profile.kind !== 'package' && hookProfileIsActive(profile, executionMode),
      ),
    );
    const merged = mergeWorkspaceHookLayers(legacyMerged, activeCustomHooks);
    if (Object.keys(merged).length > 0) {
      armSkillHooks(skillHooksSession, workspaceHooksArmEntry(merged, root));
    } else {
      disarmSkillHooks(skillHooksSession, PROJECT_HOOKS_SKILL_NAME);
    }

    for (const profile of customProfiles) {
      if (profile.kind !== 'package' || !hookProfileIsActive(profile, executionMode)) continue;
      const entry = packageProfileArmEntry(profile, root);
      if (Object.keys(entry.hooks).length > 0) {
        armSkillHooks(skillHooksSession, entry);
      }
    }
  };
  try {
    await reloadWorkspaceHooks();
  } catch {
    // Workspace hooks are best-effort at startup.
  }
  // `always` skills inject their full prompt content and arm their hooks on every
  // eligible chat turn. Explicitly selected/model-loaded skills arm hooks on demand.
  let sessionStartCompleted = false;
  // Boot-time SessionStart already ran before any chat turn. Keep a copy of the
  // hook UI events and replay them on the first submit so they appear at the top
  // of that reply — without putting messages into an empty chat.
  const sessionStartUiEvents = [];
  const runSessionStartHooksOnce = (() => {
    let started = null;
    return (onAgentEvent) => {
      if (!started) {
        started = fireSkillHookEvent({
          session: skillHooksSession,
          eventName: 'SessionStart',
          input: { source: 'startup' },
          workspaceRoot: root,
          onAgentEvent
        })
          .then((result) => {
            skillHooksSession.sessionStartContexts = formatHookContextLines(result, 'SessionStart');
            sessionStartCompleted = true;
            return result;
          })
          .catch(() => {
            skillHooksSession.sessionStartContexts = [];
            sessionStartCompleted = true;
            return { ok: false, denied: false, contexts: [], ran: [] };
          });
      }
      return started;
    };
  })();
  await runSessionStartHooksOnce((event) => {
    startupEvents.push(event);
    if (
      event?.type === 'hook:start'
      || event?.type === 'hook:end'
      || event?.type === 'hook:error'
    ) {
      sessionStartUiEvents.push(event);
    }
  });
  // Coding↔daily changes disarm package/project arms, but boot SessionStart UI/context
  // was already queued. Drop stale rows and rebuild from arms that still apply.
  const reconcileSessionStartForModeChange = (previouslyArmed) =>
    reconcileSessionStartAfterActivationChange({
      skillHooksSession,
      sessionStartUiEvents,
      sessionStartCompleted,
      previouslyArmed,
      workspaceRoot: root,
    });
  // Arms hooks for a skill by name, looking it up first in the manual-selection
  // command map, then falling back to the agent-facing indexed skill catalog
  // (covers skills the model loaded itself via the `skill` tool).
  const armSkillHooksByName = async (
    skillName,
    { fireSessionStart = true, onAgentEvent = null } = {},
  ) => {
    const name = String(skillName || '').trim();
    if (!name) return null;
    if (skillHooksSession.activeSkills.has(name)) {
      return { alreadyArmed: true };
    }
    let command = commands.get(name);
    if (!command) {
      try {
        const indexed = await loadIndexedSkills(root);
        command = indexed.get(name);
      } catch {
        command = null;
      }
    }
    if (!command) return null;
    const armed = await armSkillFromCommand(skillHooksSession, command).catch(() => null);
    if (armed && sessionStartCompleted && fireSessionStart) {
      const startResult = await fireSkillHookEvent({
        session: skillHooksSession,
        eventName: 'SessionStart',
        skillName: name,
        input: { source: 'skill_activation' },
        workspaceRoot: root,
        onAgentEvent,
      }).catch(() => null);
      if (
        (Array.isArray(startResult?.contexts) && startResult.contexts.length > 0)
        || (Array.isArray(startResult?.ran) && startResult.ran.length > 0)
      ) {
        skillHooksSession.sessionStartContexts.push(
          ...formatHookContextLines(startResult, 'SessionStart'),
        );
      }
    }
    return armed;
  };
  const reloadArmedHooks = async () => {
    await reloadWorkspaceHooks();
    const activeNames = [...skillHooksSession.activeSkills.keys()]
      .filter((name) => name !== PROJECT_HOOKS_SKILL_NAME && !isPackageHooksArmName(name));
    for (const name of activeNames) {
      disarmSkillHooks(skillHooksSession, name);
      await armSkillHooksByName(name, { fireSessionStart: false });
    }
  };
  let changeTracker = await createGitOplogChangeTracker({
    workspaceRoot: root,
    sessionId: currentSession.id
  });
  let workspaceIsGit = changeTracker?.mode === 'git-oplog';
  if (!workspaceIsGit) {
    workspaceIsGit = await detectWorkspaceIsGit(root);
  }
  let backupManager = workspaceIsGit
    ? null
    : await createNonGitBackupManager({
        workspaceRoot: root,
        sessionId: currentSession.id
      }).catch(() => null);
  const fileObservations = new Map();
  const attachRuntimeState = (nextConfig) => {
    nextConfig.runtime = {
      ...(nextConfig.runtime || {}),
      project_is_git: workspaceIsGit,
      fileObservations
    };
    return nextConfig;
  };
  config = attachRuntimeState(config);

  compactState = {
    backupMessages: null,
    autoEnabled: true,
    threshold: normalizeCompactThreshold(config.context?.preflight_trigger_pct, 60),
    mode: 'conservative'
  };
  let compactedForModel = currentSession.compact?.view || null;
  const setCompactedView = (view, meta = {}) => {
    compactedForModel = view;
    currentSession.compact = view
      ? { ...(currentSession.compact || {}), view, timestamp: new Date().toISOString(), ...meta }
      : null;
  };
  const adoptContinuationSession = (next) => {
    if (!next?.id || next.id === currentSession?.id) return;
    currentSession = next;
    compactedForModel = Array.isArray(next.compact?.view) ? next.compact.view : null;
  };
  const appendSessionMessage = (message) => {
    currentSession.messages.push(message);
    if (compactedForModel) {
      compactedForModel.push({ ...message });
      setCompactedView(compactedForModel);
    }
  };
  const persistLocalExchange = async (userText, systemText, { includeUser = true, modelVisible = false } = {}) => {
    const localMeta = modelVisible ? {} : { model_visible: false, local_only: true };
    if (includeUser && userText) {
      appendSessionMessage(stampedMessage('user', userText, localMeta));
    }
    if (systemText) {
      appendSessionMessage(stampedMessage('system', systemText, localMeta));
    }
    let derivedTitle = false;
    if (shouldReplaceSessionTitle(currentSession.title)) {
      currentSession.title = deriveSessionTitle(currentSession.messages);
      derivedTitle = true;
    }
    currentSession.model = model || config.model.name;
    currentSession.mode = executionMode || config.execution?.mode || 'normal';
    await saveSession(currentSession);
    if (derivedTitle) titleCoordinator.emit(currentSession.id, currentSession.title);
  };

  const persistAssistantExchange = async (userText, assistantText, { includeUser = true, extra = {} } = {}) => {
    const priorUserCount = currentSession.messages.filter((msg) => msg?.role === 'user').length;
    const priorAssistantCount = currentSession.messages.filter((msg) => msg?.role === 'assistant').length;
    const shouldGenerateTitle =
      (includeUser && userText && priorUserCount === 0) ||
      (!includeUser && userText && priorUserCount === 1 && priorAssistantCount === 0);
    if (includeUser && userText) {
      appendSessionMessage(stampedMessage('user', userText));
    }
    if (assistantText) {
      appendSessionMessage(stampedMessage('assistant', assistantText, extra));
    }
    let derivedTitle = false;
    if (shouldReplaceSessionTitle(currentSession.title)) {
      currentSession.title = deriveSessionTitle(currentSession.messages);
      derivedTitle = true;
    }
    currentSession.model = model || config.model.name;
    currentSession.mode = executionMode || config.execution?.mode || 'normal';
    await saveSession(currentSession);
    if (derivedTitle) titleCoordinator.emit(currentSession.id, currentSession.title);
    // Generate a better title asynchronously after saving
    if (shouldGenerateTitle || shouldReplaceSessionTitle(currentSession.title)) {
      const firstUser = (currentSession.messages || []).find((msg) => msg?.role === 'user');
      const titleUserText = String(userText || '').trim() || resolveTitleUserText(firstUser || {});
      if (titleUserText) {
        titleCoordinator.schedule({
          session: currentSession,
          userText: titleUserText,
          assistantText,
          config
        });
      }
    }
  };

  const persistApprovedPlanExecution = async (planState, result) => {
    const executionText = result.sessionText || result.text || '';
    const planFilePath = String(planState?.filePath || '').trim();
    await finalizeApprovedPlanFile(planState, result);
    const approvalNote = planFilePath ? await readPlanApprovalSection(planFilePath) : '';
    const modelContent = [approvalNote, executionText].filter(Boolean).join('\n\n');
    await persistAssistantExchange('', executionText, {
      includeUser: false,
      extra: {
        ...(modelContent ? { model_content: modelContent } : {}),
        plan_goal: planState?.goal || '',
        ...(planFilePath ? { plan_file: planFilePath } : {}),
        ...(Array.isArray(result.transcript) ? { plan_transcript: result.transcript } : {})
      }
    });
  };

  const persistUserExchange = async (userText) => {
    if (!userText) return;
    appendSessionMessage(stampedMessage('user', userText));
    let derivedTitle = false;
    if (shouldReplaceSessionTitle(currentSession.title)) {
      currentSession.title = deriveSessionTitle(currentSession.messages);
      derivedTitle = true;
    }
    currentSession.model = model || config.model.name;
    currentSession.mode = executionMode || config.execution?.mode || 'normal';
    await saveSession(currentSession);
    if (derivedTitle) titleCoordinator.emit(currentSession.id, currentSession.title);
  };

  const persistRunStatus = async (userText, statusText, { status = 'error' } = {}) => {
    const prompt = String(userText || '').trim();
    const text = String(statusText || '').trim();
    if (!prompt && !text) return;
    const messages = Array.isArray(currentSession.messages) ? currentSession.messages : [];
    const lastUser = [...messages].reverse().find((msg) => msg?.role === 'user');
    if (prompt && String(lastUser?.content || '').trim() !== prompt) {
      appendSessionMessage(stampedMessage('user', userText));
    }
    if (text || status === 'aborted') {
      appendSessionMessage(stampedMessage('assistant', status === 'aborted' ? '' : text, {
        model_visible: false,
        local_only: true,
        response_status: status,
        ...(prompt ? { retry_prompt: userText } : {})
      }));
    }
    let derivedTitle = false;
    if (shouldReplaceSessionTitle(currentSession.title)) {
      currentSession.title = deriveSessionTitle(currentSession.messages);
      derivedTitle = true;
    }
    currentSession.model = model || config.model.name;
    currentSession.mode = executionMode || config.execution?.mode || 'normal';
    await saveSession(currentSession);
    if (derivedTitle) titleCoordinator.emit(currentSession.id, currentSession.title);
  };

  const captureCompactSummary = async ({ summary, mode, beforeTokens, afterTokens }) => {
    if (config?.memory?.enabled === false || config?.memory?.auto_capture === false) return null;
    const normalizedSummary = String(summary || '').trim();
    if (!normalizedSummary) return null;
    const entrySummary = `Context compacted (${mode}): ${beforeTokens} -> ${afterTokens} tokens`;
    return captureToInbox({
      scope: 'project',
      type: 'note',
      summary: entrySummary,
      details: normalizedSummary,
      tags: ['compact', 'context-summary'],
      source: 'auto-compact',
      projectDir: root
    }).catch(() => null);
  };

  const shouldAutoCaptureUserPrompt = (text) => {
    if (config?.memory?.enabled === false || config?.memory?.auto_capture === false) return false;
    return shouldAutoCaptureUserPromptShared(text);
  };

  const captureUserPromptForDream = async (text) => {
    // The background reviewer evaluates the completed exchange with evidence and
    // replaces noisy task-prompt capture. Keep this path only as a fallback.
    if (config?.memory?.background_review?.enabled !== false) return null;
    if (!shouldAutoCaptureUserPrompt(text)) return null;
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return captureToInbox({
      scope: 'project',
      type: 'note',
      summary: `User task: ${value.slice(0, 120)}`,
      details: value,
      tags: ['user-prompt'],
      source: 'auto-user-prompt',
      projectDir: root
    }).catch(() => null);
  };

  const getSkillIndexPrompt = async () => {
    const skillIndexCacheKey = `${executionMode}:${JSON.stringify(config.skills || {})}:${Array.from(commands.keys()).sort().join(',')}`;
    if (
      !skillIndexPromptCache
      || skillIndexPromptCache.key !== skillIndexCacheKey
      || Date.now() >= skillIndexPromptCache.expiresAt
    ) {
      const value = await buildSkillIndexPromptBlock(root, config, executionMode, {
        modelInvocableOnly: true,
      });
      skillIndexPromptCache = {
        key: skillIndexCacheKey,
        expiresAt: Date.now() + COMMAND_RELOAD_TTL_MS,
        value,
      };
    }
    return skillIndexPromptCache.value;
  };

  const buildActiveSystemPrompt = async ({
    includeSkillIndex = true,
    includeMemoryGuide = true,
    userQuery = '',
  } = {}) => {
    const memoryGuide = `Use save_memory only for explicit lasting preferences or stable project conventions; never store secrets or duplicates. Write it in ${getReplyLanguageName(config)}. Coding discoveries go through later Dream/session review.`;
    const [skillsPrompt, memorySnapshot] = await Promise.all([
      includeSkillIndex ? getSkillIndexPrompt() : Promise.resolve(''),
      getMemoizedMemorySnapshot(userQuery),
    ]);
    return composeSystemPrompt({
      shellRulesPrompt: getMemoizedBaseSystemPrompt(),
      config,
      workspaceRoot: root,
      skillsPrompt,
      memorySnapshot,
      extraPrompts: includeMemoryGuide ? [memoryGuide] : [],
      soulContext: normalizeExecutionMode(executionMode) === 'plan' ? 'coding' : 'daily',
    });
  };

  // 当前的 AbortController 引用，用于中止正在进行的回答
  let activeAbortController = null;
  let activeSubSession = null;
  const restoreConfiguredExecutionMode = () => {
    executionMode = normalizeExecutionMode(config.execution?.mode || 'normal');
  };
  const syncExecutionModeWithSession = () => {
    executionMode = resolveRuntimeExecutionMode(executionMode, config, currentSession);
  };
  const persistLastSystemPrompt = async (prompt) => {
    const next = String(prompt || '');
    if (!currentSession || currentSession.lastSystemPrompt === next) return;
    currentSession.lastSystemPrompt = next;
    await saveSession(currentSession).catch(() => {});
  };

  const executeSubmission = async (line, onAgentEvent, options = {}) => {
    // 每次提交创建新的 AbortController，替代旧的
    activeAbortController = new AbortController();
    const { signal } = activeAbortController;
    const codingRouteEnabled = normalizeExecutionMode(executionMode) === 'plan';
    const inputText = String(line || '');
    const activeReplySystemPrompt = await buildActiveSystemPrompt({
      includeSkillIndex: !codingRouteEnabled,
      includeMemoryGuide: !codingRouteEnabled,
      userQuery: inputText,
    });
    const memoryInject = memorySnapshotMemo?.inject || null;
    const retrievedText = memorySnapshotMemo?.retrievedText || '';
    if (memoryInject && typeof onAgentEvent === 'function') {
      onAgentEvent({
        type: 'memory:retrieved',
        startedAt: new Date().toISOString(),
        ...memoryInject,
      });
    }
    const optionModelText = typeof options?.modelText === 'string' && options.modelText.trim()
      ? await expandFileMentions(options.modelText, root)
      : '';
    const readOnlyCodeWiki = options?.readOnlyCodeWiki === true;
    const codeWikiGenerate = options?.codeWikiGenerate === true;
    if (codeWikiGenerate) {
      const trimmed = inputText.trim();
      const slash = trimmed.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
      const argLine = String(slash?.[2] || '').trim();
      const args = argLine ? argLine.split(/\s+/).filter(Boolean) : [];
      const prelim = parseProjectRequirementsOptions(args, { defaultOutputFormat: 'html' });
      const custom = await loadBundledProjectRequirementsSkill(
        prelim.outputFormat === 'md' ? 'project-requirements-md' : 'project-requirements'
      );
      await persistLastSystemPrompt(activeReplySystemPrompt);
      return runProjectRequirementsSingleAgent({
        custom,
        parsedInput: {
          name: custom.name,
          args,
          full: `${custom.name}${args.length ? ` ${args.join(' ')}` : ''}`
        },
        currentSession,
        config,
        model,
        systemPrompt: activeReplySystemPrompt,
        onAgentEvent,
        requestToolApproval: activeRequestToolApproval,
        signal,
        compactedForModel,
        onCompactedUpdate: setCompactedView,
        titleCoordinator,
        codeWikiGenerate: true,
        workspaceRoot: root
      });
    }
    const dismissedAlwaysSkills = new Set(
      (Array.isArray(options?.dismissedAlwaysSkills) ? options.dismissedAlwaysSkills : [])
        .map((name) => String(name || '').trim())
        .filter(Boolean)
    );
    const maybeAutoDreamFromRuntime = async () => {
      const threshold = Number(config?.memory?.auto_dream_threshold ?? 10);
      if (!(threshold > 0)) return null;
      let entries = [];
      try {
        entries = await listInbox();
      } catch {
        return null;
      }
      if (entries.length < threshold) return null;
      if (onAgentEvent) onAgentEvent({ type: 'dream:auto', message: 'inbox threshold reached' });
      try {
        const report = await runDreamConsolidation({
          dryRun: false,
          workspaceRoot: root,
          config,
          writeAudit: true
        });
        if (onAgentEvent) {
          onAgentEvent({ type: 'dream:complete', report });
        }
        return report;
      } catch (error) {
        if (onAgentEvent) {
          onAgentEvent({
            type: 'dream:complete',
            report: { ok: false, error: String(error?.message || error || 'unknown dream error') }
          });
        }
        return null;
      }
    };
    const approvePendingSpec = async ({ executeImmediately = false, saveOnly = false } = {}) => {
      if (!hasPendingSpecApproval(currentSession)) {
        return { type: 'system', text: 'No pending spec approval.' };
      }
      const specState = getPendingSpecState(currentSession);
      const specText = String(specState.specText || '').trim() || buildFallbackStructuredSpec(specState.goal || 'spec');
      const specTitle = extractSpecTitle(specText, specState.goal || 'spec');
      const specPath = String(specState.specPath || '').trim() || await writeMarkdownInProjectDir(
        'specs',
        specTitle,
        specText,
        'spec',
        currentSession.id,
        root
      );
      await fs.writeFile(specPath, `${specText.trim()}\n`, 'utf8');
      if (saveOnly) {
        currentSession.specState = null;
        if (currentSession.planState?.status === 'pending_spec_approval') currentSession.planState = null;
        restoreConfiguredExecutionMode();
        if (onAgentEvent) onAgentEvent({ type: 'spec:approval_cleared' });
        const text = `Spec saved: ${specPath}`;
        await persistLocalExchange('', text, { includeUser: false });
        return { type: 'system', text };
      }
      if (onAgentEvent) onAgentEvent({ type: 'spec:approval_cleared' });
      const planGoal = [
        `Implement the approved spec: ${specTitle}`,
        `Spec path: ${specPath}`,
        '',
        specText
      ].join('\n');
      if (executeImmediately) {
        currentSession.specState = null;
        if (currentSession.planState?.status === 'pending_spec_approval') {
          currentSession.planState = null;
        }
        restoreConfiguredExecutionMode();
        const displayGoal = [
          `Execute approved spec: ${specTitle}`,
          `Spec path: ${specPath}`
        ].join('\n');
        const result = await askModel({
          text: displayGoal,
          modelText: planGoal,
          session: currentSession,
          config,
          model,
          systemPrompt: activeReplySystemPrompt,
          onAgentEvent,
          requestToolApproval: activeRequestToolApproval,
          requestUserInput: activeRequestUserInput,
          executionMode,
          signal,
          compactedForModel,
          onCompactedUpdate: setCompactedView,
          changeTracker,
          backupManager,
          titleCoordinator,
          onExecutionModeSync: syncExecutionModeWithSession,
          onContinuationSession: adoptContinuationSession,
          workspaceRoot: root,
          skillHooksSession
        });
        syncExecutionModeWithSession();
        return { type: 'assistant', text: result.text, aborted: !!result.aborted };
      }
      const auto = await buildAutoPlanArtifact({
        goal: planGoal,
        session: currentSession,
        config,
        model,
        systemPrompt: activeReplySystemPrompt,
        onAgentEvent,
        sessionId: currentSession.id,
        taskClass: classifyPlanTaskClass(planGoal),
        workspaceRoot: root
      });
      currentSession.planState = {
        status: 'running',
        source: 'spec',
        goal: specTitle,
        specRef: specPath,
        filePath: auto.filePath,
        summary: auto.summary || '',
        finalSummary: auto.finalSummary || auto.summary || '',
        steps: Array.isArray(auto.steps) ? auto.steps : []
      };
      executionMode = 'plan';
      await reloadWorkspaceHooks();
      currentSession.specState = null;
      if (currentSession.planState?.status === 'pending_spec_approval') currentSession.planState = null;
      const planState = { ...currentSession.planState };
      await recordPlanReviewStatus(planState, 'executing');
      const result = await executePlanWithSubAgents({
        planState,
        parentSession: currentSession,
        config,
        model,
        systemPrompt: getBaseSystemPrompt(),
        onAgentEvent,
        signal,
        onSubSessionActive: (sub) => { activeSubSession = sub; },
        requestToolApproval: activeRequestToolApproval,
        changeTracker,
        backupManager,
        projectIsGit: resolveApprovalProjectIsGit({
          projectIsGit: changeTracker?.mode === 'git-oplog',
          changeTrackerEnabled: changeTracker?.mode === 'git-oplog',
          workspaceHasGit: Boolean(config?.runtime?.project_is_git) || workspaceIsGit
        }),
        workspaceRoot: root
      });
      activeSubSession = null;
      currentSession.planState = normalizePlanState({
        ...planState,
        status: result.aborted ? 'failed' : 'completed',
        finalSummary: result.sessionText || result.text || planState.finalSummary
      });
      restoreConfiguredExecutionMode();
      await persistApprovedPlanExecution(planState, result);
      return { type: 'assistant', text: result.text, aborted: !!result.aborted };
    };
    const structuredAction = options?.structuredAction;
    if (structuredAction) {
      await persistLastSystemPrompt(activeReplySystemPrompt);
      const { name, payload = {} } = structuredAction;
      if (name === CHAT_ACTIONS.SPEC_SAVE) return approvePendingSpec({ saveOnly: true });
      if (name === CHAT_ACTIONS.SPEC_EXECUTE) return approvePendingSpec({ executeImmediately: true });
      if (name === CHAT_ACTIONS.SPEC_PLAN_AND_EXECUTE) return approvePendingSpec();
      if (name === CHAT_ACTIONS.SPEC_REVISE) {
        const state = getPendingSpecState(currentSession);
        const revised = await buildSpecWithModel({
          topic: [
            state.goal || state.summary || 'spec',
            `Revise the pending spec using this feedback: ${payload.feedback}`,
            '',
            state.specText || ''
          ].join('\n'),
          config,
          model,
          systemPrompt: activeReplySystemPrompt
        });
        currentSession.specState = { ...state, specText: revised };
        if (state.specPath) await fs.writeFile(state.specPath, `${revised.trim()}\n`, 'utf8');
        await saveSession(currentSession);
        return { type: 'system', text: 'Spec draft revised.' };
      }
      if (name === CHAT_ACTIONS.REFLECT) {
        const scope = 'global';
        const request = String(payload.request || '').trim();
        const drafts = await buildReflectSkillDraft({
          request,
          scope,
          session: currentSession,
          config,
          model,
          systemPrompt: activeReplySystemPrompt
        });
        const candidates = attachReflectTargets({ candidates: drafts, scope, workspaceRoot: root });
        if (candidates.length === 0) return { type: 'system', text: 'Reflect found no reusable skill candidate.' };
        currentSession.planState = {
          status: 'pending_reflect_skill',
          source: 'reflect',
          targetScope: scope,
          targetContext: 'global',
          request,
          candidates
        };
        await saveSession(currentSession);
        return { type: 'system', text: buildPendingReflectSkillMessage(currentSession.planState) };
      }
      if (name === CHAT_ACTIONS.REFLECT_APPROVE) {
        const state = { ...currentSession.planState };
        const candidate = Array.isArray(state.candidates) ? state.candidates[0] : null;
        if (!candidate) throw new Error('No reflect skill draft to write');
        const written = await writeReflectSkillDraft({
          draft: candidate
        });
        const reflectContext = ['global', 'coding', 'daily'].includes(candidate.context)
          ? candidate.context
          : state.targetContext || 'global';
        const nextConfig = await loadConfig();
        nextConfig.skills = nextConfig.skills || {};
        nextConfig.skills.contexts = nextConfig.skills.contexts || {};
        nextConfig.skills.contexts[written.draft.name] = reflectContext === 'global'
          ? ['coding', 'daily']
          : [reflectContext];
        await saveConfig(nextConfig);
        config = attachRuntimeState(await loadConfig());
        currentSession.planState = null;
        restoreConfiguredExecutionMode();
        await saveSession(currentSession);
        await reloadCommandsAndSkills({ force: true });
        return { type: 'system', text: `Reflect skill written and loaded: /${written.draft.name}\nPath: ${written.filePath}` };
      }
      if (name === CHAT_ACTIONS.REFLECT_REVISE) {
        const state = { ...currentSession.planState };
        const previousDraft = Array.isArray(state.candidates) ? state.candidates[0] : null;
        const drafts = await buildReflectSkillDraft({
          request: state.request || '',
          scope: 'global',
          session: currentSession,
          config,
          model,
          systemPrompt: activeReplySystemPrompt,
          previousDraft,
          feedback: payload.feedback
        });
        currentSession.planState = {
          ...state,
          candidates: attachReflectTargets({
            candidates: drafts.map((draft) => ({
              ...draft,
              context: previousDraft?.context || state.targetContext || 'global'
            }))
          })
        };
        await saveSession(currentSession);
        return { type: 'system', text: `Reflect skill draft revised.\n${buildPendingReflectSkillMessage(currentSession.planState)}` };
      }
      if (name === CHAT_ACTIONS.COMPACT) {
        const args = Array.isArray(payload.args) ? payload.args : [];
        const cargs = parseCompactArgs(args);
        if (cargs.restore) {
          setCompactedView(null);
          return { type: 'system', text: 'Context restored to full view' };
        }
        const source = modelVisibleMessages(compactedForModel ?? currentSession.messages);
        const beforeTokens = estimateMessagesTokens(source);
        const result = cargs.micro
          ? (() => {
              const micro = microCompactMessages(source, {
                keepRecent: Number(config.context?.microcompact_keep_recent || 5),
                enabled: true
              });
              return { changed: micro.changed, compacted: micro.messages, summary: '', tokensSaved: micro.tokensSaved };
            })()
          : await compactMessagesLocally(source, {
              mode: cargs.mode || compactState.mode,
              force: true,
              generateSummary: createCompactSummaryGenerator(config, null)
            });
        if (!result.changed) return { type: 'system', text: 'Nothing to compact yet' };
        const afterTokens = estimateMessagesTokens(result.compacted);
        const report = `Compact ${cargs.preview ? 'preview' : 'applied'}: ${beforeTokens} -> ${afterTokens} tokens`;
        if (!cargs.preview) {
          setCompactedView(result.compacted.map((message) => ({ ...message, at: new Date().toISOString() })));
          await saveSession(currentSession);
        }
        return { type: 'system', text: report };
      }
      throw new Error(`Chat action handler is not available: ${name}`);
    }
    if (!inputText.trim()) return { type: 'noop' };
    if (inputText.trimStart().startsWith('!')) {
      const shell = await handleShellInput(inputText.trimStart().slice(1), config, root);
      return { type: 'shell', text: shell.text };
    }
    if (readOnlyCodeWiki) {
      const expandedText = await expandFileMentions(line, root);
      const codeWikiConfig = {
        ...config,
        soul: {
          preset: 'default',
          custom_path: ''
        }
      };
      const codeWikiBasePrompt = await composeSystemPrompt({
        shellRulesPrompt: getBaseSystemPrompt(),
        config: codeWikiConfig,
        workspaceRoot: root,
        includeMemory: false,
        includeProjectInstructions: true,
        includeSoul: true
      });
      const readOnlySystemPrompt = [
        codeWikiBasePrompt,
        '[Role: codewiki]',
        '- Answer questions about the current repository and generated CodeWiki/project-requirements report.',
        '- Use the CodeWiki role regardless of the user-selected global soul. Tone is the default Codemini tone: clear, concise, and technical.',
        '- Use read-only project inspection tools when evidence is needed.',
        '- You may modify files only when the user explicitly asks you to add or edit code comments. In that case, use add_code_comment or update_code_comment only, and never change executable code.',
        '- Do not use shell commands, edit/write/apply_patch/delete tools, update plans, generate reports, or write memories.',
        '- Be concise and cite relevant files or report sections when useful.'
      ].join('\n\n');
      await persistLastSystemPrompt(readOnlySystemPrompt);
      const transientSession = structuredClone(currentSession);
      const result = await askModel({
        text: expandedText,
        session: transientSession,
        config,
        model,
        systemPrompt: readOnlySystemPrompt,
        onAgentEvent,
        requestToolApproval: activeRequestToolApproval,
        executionMode: 'normal',
        alwaysAllowTools: CODEWIKI_ROLE_TOOLS,
        allowedTools: CODEWIKI_ROLE_TOOLS,
        persistSession: false,
        skipAnalysisNudge: true,
        signal,
        workspaceRoot: root,
        skillHooksSession
      });
      return { type: 'assistant', text: result.text, aborted: !!result.aborted };
    }
    const expandedText = await expandFileMentions(inputText, root);
    const autoRoute = classifyAutoRoute(expandedText);
    const isCodingMode = normalizeExecutionMode(executionMode) === 'plan';
    const memoryRoute = classifyMemoryRoute(expandedText);
    const routingRuntimeState = isCodingMode
      ? buildRuntimeStateSnapshot({
          currentSession,
          config,
          model,
          executionMode,
          extraSession: null,
          workspaceRoot: root,
        })
      : null;
    const contextUsage = routingRuntimeState
      ? {
          estimated_tokens: routingRuntimeState.currentContextTokens,
          max_tokens: routingRuntimeState.maxContextTokens,
          usage_pct: routingRuntimeState.contextUsagePct,
        }
      : {};
    const toolTrace = isCodingMode ? buildPreviousTurnToolTrace(currentSession) : {};
    const useSemanticJudge = isCodingMode;
    const codingRoutePromise = (async () => {
      const codingSkillIndexPrompt = useSemanticJudge ? await getSkillIndexPrompt() : '';
      return {
        codingSkillIndexPrompt,
        codingRoute: await evaluateCodingRouteGraph({
          executionMode: normalizeExecutionMode(executionMode),
          text: expandedText,
          autoRoute,
          memoryRoute,
          skillIndexPrompt: codingSkillIndexPrompt,
          contextUsage,
          sensitive: isSensitiveMemoryContent(expandedText),
          judge: useSemanticJudge
            ? (request) => judgeCodingRouteNodes({ request, config, model, signal })
            : null,
          toolTrace,
        }),
      };
    })();

    // Refresh workspace + package profiles every turn so installs/toggles take
    // effect without restarting the runtime. SessionStart only re-fires for
    // package arms that were not present when this session first started.
    const previouslyArmedPackages = new Set(
      [...skillHooksSession.activeSkills.keys()].filter(isPackageHooksArmName),
    );
    await reloadWorkspaceHooks();
    if (sessionStartCompleted) {
      const newlyArmedPackages = [...skillHooksSession.activeSkills.keys()]
        .filter(isPackageHooksArmName)
        .filter((name) => !previouslyArmedPackages.has(name));
      for (const packageArmName of newlyArmedPackages) {
        const startResult = await fireSkillHookEvent({
          session: skillHooksSession,
          eventName: 'SessionStart',
          input: { source: 'package-arm' },
          workspaceRoot: root,
          skillName: packageArmName,
          onAgentEvent,
        }).catch(() => null);
        if (
          (Array.isArray(startResult?.contexts) && startResult.contexts.length > 0)
          || (Array.isArray(startResult?.ran) && startResult.ran.length > 0)
        ) {
          skillHooksSession.sessionStartContexts.push(
            ...formatHookContextLines(startResult, 'SessionStart'),
          );
        }
      }
    }

    const selectedSkillNamesForHooks = [...new Set(
      (Array.isArray(options?.selectedSkillNames) ? options.selectedSkillNames : [])
        .map((name) => String(name || '').trim())
        .filter(Boolean)
    )];
    for (const skillName of selectedSkillNamesForHooks) {
      await armSkillHooksByName(skillName, { onAgentEvent });
    }
    if (sessionStartUiEvents.length > 0 && typeof onAgentEvent === 'function') {
      for (const event of sessionStartUiEvents.splice(0, sessionStartUiEvents.length)) {
        onAgentEvent(event);
      }
    }
    const userPromptHookResult = await fireSkillHookEvent({
      session: skillHooksSession,
      eventName: 'UserPromptSubmit',
      input: { prompt: expandedText },
      workspaceRoot: root,
      onAgentEvent
    });
    if (userPromptHookResult.denied) {
      const denyText = userPromptHookResult.reason || 'This turn was blocked by a skill hook.';
      await persistLocalExchange(inputText, denyText, { includeUser: true });
      return { type: 'system', text: denyText };
    }
    const hookContexts = [
      ...(Array.isArray(skillHooksSession.sessionStartContexts) ? skillHooksSession.sessionStartContexts : []),
      ...formatHookContextLines(userPromptHookResult, 'UserPromptSubmit'),
    ];
    const { codingSkillIndexPrompt, codingRoute } = await codingRoutePromise;
    if (codingRoute.active) {
      onAgentEvent?.({
        type: 'routing:graph',
        startedAt: new Date().toISOString(),
        graphVersion: codingRoute.graph_version,
        path: codingRoute.path,
        source: codingRoute.source,
        delegationMode: codingRoute.delegation_mode,
        decisions: codingRoute.decisions,
      });
    }
    const graphSelectedSkillNames = (
      codingRoute?.decisions?.skills?.selected_names || []
    ).filter((name) => {
      const skill = commands?.get?.(name);
      return Boolean(
        skill
        && isSkillIndexEligible(skill)
        && !isSkillModelInvocationDisabled(skill)
        && isSkillEnabled(config, name, skill, executionMode)
      );
    });
    if (graphSelectedSkillNames.length > 0) {
      onAgentEvent?.({
        type: 'skill:auto-selected',
        names: graphSelectedSkillNames,
        source: 'coding-route-graph',
      });
      await Promise.all(
        graphSelectedSkillNames.map((skillName) =>
          armSkillHooksByName(skillName, { onAgentEvent })),
      );
    }
    const injectAlwaysSkills = shouldInjectAlwaysSkills(executionMode);
    const alwaysSkills = injectAlwaysSkills
      ? getAlwaysSkillCommands(commands, config, dismissedAlwaysSkills, executionMode)
      : [];
    if (alwaysSkills.length > 0) {
      onAgentEvent?.({ type: 'skill:always', names: alwaysSkills.map((skill) => skill.name) });
      await Promise.all(
        alwaysSkills.map((skill) => armSkillHooksByName(skill.name, { onAgentEvent })),
      );
    }
    const alwaysSkillPrompt = injectAlwaysSkills
      ? buildAlwaysSkillPromptBlock(commands, config, dismissedAlwaysSkills, executionMode, root)
      : '';
    const routedSkillIndexPrompt = codingRoute?.decisions?.skills?.inject_index
      ? codingSkillIndexPrompt
      : '';
    const routedSelectedSkillPrompt = buildSelectedSkillPromptBlock(
      commands,
      graphSelectedSkillNames,
      config,
      executionMode,
      root,
    );
    const memoryHint = isCodingMode ? '' : buildMemoryRouteHintBlock(memoryRoute);
    const codingRouteDecisionBlock = buildCodingRouteDecisionBlock(codingRoute);
    // Per-turn routing / skill / hook context belongs in the user turn, not the
    // system prompt, so the system prompt stays a stable, cacheable prefix.
    const turnRoutingContext = [
      routedSkillIndexPrompt,
      routedSelectedSkillPrompt,
      alwaysSkillPrompt,
      memoryHint,
      codingRouteDecisionBlock,
      ...hookContexts,
    ].filter(Boolean).join('\n\n');
    const codingRouteAllowedTools = isCodingMode
      ? EXECUTION_MODE_TOOL_POLICY.plan.filter((toolName) => (
          isCodingRouteToolAllowed(codingRoute, toolName)
        ))
      : undefined;
    await persistLastSystemPrompt(activeReplySystemPrompt);
    const result = await askModel({
      text: expandedText,
      ...(optionModelText ? { modelText: optionModelText } : {}),
      modelImages: Array.isArray(options?.modelImages) ? options.modelImages : [],
      session: currentSession,
      config,
      model,
      systemPrompt: activeReplySystemPrompt,
      turnRoutingContext,
      onAgentEvent,
      requestToolApproval: activeRequestToolApproval,
      requestUserInput: activeRequestUserInput,
      executionMode,
      allowedTools: codingRouteAllowedTools,
      signal,
      compactedForModel,
      onCompactedUpdate: setCompactedView,
      changeTracker,
      backupManager,
      titleCoordinator,
      onExecutionModeSync: syncExecutionModeWithSession,
      onContinuationSession: adoptContinuationSession,
      workspaceRoot: root,
      selectedSkillNames: [
        ...(Array.isArray(options?.selectedSkillNames) ? options.selectedSkillNames : []),
        ...graphSelectedSkillNames,
      ],
      skillHooksSession,
      onSkillLoaded: (skillName) => armSkillHooksByName(skillName, { onAgentEvent }),
      memoryInject,
      retrievedText,
    });
    syncExecutionModeWithSession();
    void captureUserPromptForDream(expandedText);
    return { type: 'assistant', text: result.text, aborted: !!result.aborted };
  };
  const getAvailableSkills = () =>
    Array.from(commands.values())
      .filter((command) => isUserInvocableSkill(command))
      .filter((command) => isSkillEnabled(config, command.name, command, executionMode))
      .map((command) => {
        const source = String(command.source || '');
        const scope = source.startsWith('project-')
          ? 'project'
          : source.startsWith('global-') || source.startsWith('registry-')
            ? 'global'
            : source.startsWith('bundled-')
              ? 'builtin'
              : '';
        return {
          name: String(command.name || ''),
          description: String(command.metadata?.description || '').trim(),
          ...(scope ? { scope } : {})
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

  const submitMessage = async (submission, onAgentEvent) => {
    const normalized = normalizeChatSubmission(submission);
    await reloadCommandsAndSkills();
    const composed = composeSelectedSkills(commands, normalized, {
      isEnabled: (command) => isSkillEnabled(config, command.name, command, executionMode),
      config,
      cwd: root,
    });
    if (composed.error) throw new Error(composed.error);
    if (typeof onAgentEvent === 'function') {
      for (const name of composed.skillNames || []) {
        const startedAt = new Date().toISOString();
        onAgentEvent({ type: 'skill:start', name, startedAt });
        onAgentEvent({
          type: 'skill:end',
          name,
          startedAt,
          endedAt: new Date().toISOString()
        });
      }
    }
    const result = await executeSubmission(composed.text, onAgentEvent, {
      modelText: appendAttachmentContext(composed.modelText, submission?.modelText),
      modelImages: Array.isArray(submission?.modelImages) ? submission.modelImages : [],
      attachmentIds: normalized.attachmentIds,
      dismissedAlwaysSkills: normalized.dismissedAlwaysSkills,
      selectedSkillNames: composed.skillNames
    });
    if (result?.type === 'assistant' && config?.memory?.background_review?.after_turn !== false) {
      scheduleSessionMemoryReview({ sessionId: currentSession.id, config });
    }
    return result;
  };

  const submit = async (line, onAgentEvent) => {
    const text = String(line || '');
    if (!text.trim()) return { type: 'noop' };
    if (text.trimStart().startsWith('!')) {
      const shell = await handleShellInput(text.trimStart().slice(1), config, root);
      return { type: 'shell', text: shell.text };
    }
    return submitMessage({ text }, onAgentEvent);
  };

  const dispatchAction = async (action, options = {}) => {
    const onAgentEvent = typeof options.onAgentEvent === 'function'
      ? options.onAgentEvent
      : undefined;
    const normalized = validateChatAction(action, buildChatActionValidationState(buildRuntimeStateSnapshot({
      currentSession,
      config,
      model,
      executionMode,
      extraSession: activeSubSession,
      alwaysSkillNames: getAlwaysSkillCommands(commands, config, null, executionMode).map((skill) => skill.name)
    }), approvalRequestState.current));
    const payload = normalized.payload;
    const handlers = {
      [CHAT_ACTIONS.CAPTURE]: async () => captureToInbox({
        summary: String(payload.summary || '').trim(),
        scope: payload.scope || 'project',
        type: payload.type || 'note',
        details: String(payload.details || '').trim(),
        source: 'chat-action',
        projectDir: root
      }),
      [CHAT_ACTIONS.INBOX]: async () => listInbox(),
      [CHAT_ACTIONS.DREAM]: async () => runDreamConsolidation({
        dryRun: payload.dryRun === true,
        scope: payload.scope || null,
        workspaceRoot: root,
        config,
        writeAudit: true
      }),
      [CHAT_ACTIONS.SPEC_REJECT]: async () => {
        currentSession.specState = null;
        if (currentSession.planState?.status === 'pending_spec_approval') currentSession.planState = null;
        restoreConfiguredExecutionMode();
        await saveSession(currentSession);
        return { type: 'system', text: 'Spec rejected.' };
      },
      [CHAT_ACTIONS.REFLECT_REJECT]: async () => {
        currentSession.planState = null;
        restoreConfiguredExecutionMode();
        await saveSession(currentSession);
        return { type: 'system', text: 'Reflect skill draft rejected.' };
      },
      [CHAT_ACTIONS.COMPACT]: async () => executeSubmission('', onAgentEvent, { structuredAction: normalized }),
      [CHAT_ACTIONS.REFLECT]: async () => executeSubmission('', onAgentEvent, { structuredAction: normalized }),
      [CHAT_ACTIONS.SPEC_PLAN_AND_EXECUTE]: async () => executeSubmission('', onAgentEvent, { structuredAction: normalized }),
      [CHAT_ACTIONS.SPEC_EXECUTE]: async () => executeSubmission('', onAgentEvent, { structuredAction: normalized }),
      [CHAT_ACTIONS.SPEC_SAVE]: async () => executeSubmission('', onAgentEvent, { structuredAction: normalized }),
      [CHAT_ACTIONS.SPEC_REVISE]: async () => executeSubmission('', onAgentEvent, { structuredAction: normalized }),
      [CHAT_ACTIONS.REFLECT_APPROVE]: async () => executeSubmission('', onAgentEvent, { structuredAction: normalized }),
      [CHAT_ACTIONS.REFLECT_REVISE]: async () => executeSubmission('', onAgentEvent, { structuredAction: normalized }),
      [CHAT_ACTIONS.APPROVAL_APPROVE]: async () => resolvePendingApproval(
        approvalRequestState,
        payload.requestId,
        { approved: true }
      ),
      [CHAT_ACTIONS.APPROVAL_REJECT]: async () => resolvePendingApproval(
        approvalRequestState,
        payload.requestId,
        { approved: false, reason: payload.reason || '' }
      )
    };
    const handler = handlers[normalized.name];
    if (!handler) {
      throw new Error(`Chat action handler is not available: ${normalized.name}`);
    }
    return handler();
  };

  return {
    submit,
    submitMessage,
    submitCodeWiki: (line, onAgentEvent, options = {}) => executeSubmission(line, onAgentEvent, options),
    dispatchAction,
    getSession: () => currentSession,
    abort: (options = {}) => {
      if (activeAbortController && !activeAbortController.signal.aborted) {
        if (options?.continueInPlace === true) {
          activeAbortController.abort({ continueInPlace: true });
        } else {
          activeAbortController.abort();
        }
        return true;
      }
      return false;
    },
    consumeStartupEvents: () => startupEvents.splice(0, startupEvents.length),
    getInputHistory: () => loadInputHistory(),
    getCurrentSessionId: () => currentSession.id,
    getSessionMessages: () => currentSession.messages || [],
    getSessionHistory: async (limit = 30) => (await listSessions(limit)).map((entry) => ({
      ...entry,
      projectKey: normalizeProjectDirKey(entry.projectDir) || 'unknown',
      isGeneral: isGeneralWorkspaceProjectDir(entry.projectDir)
    })),
    getSessionCompact: () => currentSession.compact || null,
    getAvailableSkills,
    getLastSystemPrompt: () => String(currentSession?.lastSystemPrompt || ''),
    persistRunStatus,
    getChangeSets: () => listGitOplogChanges(changeTracker),
    getChangeSetPatch: (id) => readGitOplogPatch(changeTracker, id),
    undoChangeSet: (id) => undoGitOplogChange(changeTracker, id),
    undoChangeSets: (ids) => undoGitOplogChanges(changeTracker, ids),
    reloadConfig: async (options = {}) => {
      config = attachRuntimeState(await loadConfig());
      await syncRuntimeFromConfig(options);
      return config;
    },
    reloadCommandsAndSkills: async () => {
      await reloadCommandsAndSkills({ force: true });
      await reloadArmedHooks();
      return true;
    },
    setExecutionMode: async (next) => {
      if (!isExecutionModeInput(next)) return false;
      const normalized = normalizeExecutionMode(next);
      if (!['normal', 'plan'].includes(normalized)) return false;
      if (normalized === normalizeExecutionMode(executionMode)) return true;
      const previouslyArmed = new Set([...skillHooksSession.activeSkills.keys()]);
      executionMode = normalized;
      await setConfigValue('execution.mode', normalized);
      config = attachRuntimeState(await loadConfig());
      await reloadWorkspaceHooks();
      // Drop coding SessionStart UI/context queued before the switch; rebuild for arms that still apply.
      await reconcileSessionStartForModeChange(previouslyArmed);
      return true;
    },
    setApprovalMode: async (next) => {
      const normalized = String(next || '').toLowerCase().replace(/-/g, '_');
      if (!['review', 'auto', 'full_access'].includes(normalized)) return false;
      await setConfigValue('execution.approval_mode', normalized);
      config = attachRuntimeState(await loadConfig());
      return true;
    },
    setReasoningEffort: async (next) => {
      const normalized = String(next || '').trim().toLowerCase();
      if (!['off', 'auto', 'low', 'medium', 'high'].includes(normalized)) return false;
      await setConfigValue('model.reasoning_enabled', normalized !== 'off');
      if (normalized !== 'off') await setConfigValue('model.reasoning_effort', normalized);
      config = attachRuntimeState(await loadConfig());
      return true;
    },
    setSandboxMode: async (next) => {
      const { normalizeSandboxMode } = await import('./sandbox-policy.js');
      const normalized = normalizeSandboxMode(next, { platform: process.platform });
      if (!['read-only', 'workspace-write', 'danger-full-access'].includes(normalized)) return false;
      await setConfigValue('sandbox.mode', normalized);
      // Ensure sandbox stays enabled when user picks a confining mode from UI.
      if (normalized !== 'danger-full-access') {
        const enabled = config?.sandbox?.enabled;
        if (enabled === false || enabled === 'false' || enabled === 'off' || enabled === 'never') {
          await setConfigValue('sandbox.enabled', 'auto');
        }
      }
      config = attachRuntimeState(await loadConfig());
      return true;
    },
    getAvailableSouls: () => listSouls(config),
    setSoul: async (next, category) => {
      const resolvedCategory = normalizeSoulCategory(category, soulContextFromExecutionMode(executionMode));
      const soul = (await listSouls(config)).find((item) => item.category === resolvedCategory && soulNameEquals(item.name, next));
      if (!soul) return false;
      config.soul = { ...config.soul, [resolvedCategory]: soul.name, preset: soul.name, custom_path: '' };
      await saveConfig(config);
      config = attachRuntimeState(await loadConfig());
      return true;
    },
    setRequestToolApproval: (handler) => {
      requestToolApprovalObserver = typeof handler === 'function' ? handler : null;
      return true;
    },
    resolveToolApproval: (requestId, decision = {}) => {
      const pending = peekPendingApproval(approvalRequestState, requestId);
      if (!pending) return { ok: false, code: 'NO_PENDING_APPROVAL' };
      try {
        return {
          ok: true,
          result: resolvePendingApproval(approvalRequestState, requestId, decision)
        };
      } catch (error) {
        return {
          ok: false,
          code: error?.code || 'NO_PENDING_APPROVAL',
          message: error?.message || 'No matching approval request is pending'
        };
      }
    },
    hasPendingToolApproval: (requestId) => Boolean(peekPendingApproval(approvalRequestState, requestId)),
    setRequestUserInput: (handler) => {
      activeRequestUserInput = typeof handler === 'function' ? handler : null;
      return true;
    },
    setOnTitleUpdate: (cb) => {
      onTitleUpdateCallback = typeof cb === 'function' ? cb : null;
      titleCoordinator.setOnTitleUpdate(onTitleUpdateCallback);
    },
    setOnTitleStatus: (cb) => {
      onTitleStatusCallback = typeof cb === 'function' ? cb : null;
      titleCoordinator.setOnTitleStatus(onTitleStatusCallback);
    },
    regenerateSessionTitle: async () => {
      const exchange = resolveLatestTitleExchange(currentSession.messages);
      if (!exchange) {
        return { error: true, message: 'No completed user and assistant exchange found' };
      }
      const persisted = await loadSession(currentSession.id).catch(() => currentSession);
      const title = await titleCoordinator.schedule({
        session: currentSession,
        ...exchange,
        config,
        preserveUpdatedAt: persisted?.updatedAt || currentSession.updatedAt || ''
      });
      if (!title) return { error: true, message: 'Title generation was cancelled' };
      return { ok: true, title };
    },
    updatePendingReflect: async (patch = {}) => {
      const next = updatePendingReflectState(currentSession, patch, root);
      if (!next) return null;
      await saveSession(currentSession);
      return next;
    },
    updatePendingSpec: async (patch = {}) => {
      const next = updatePendingSpecState(currentSession, patch);
      if (!next) return null;
      const filePath = String(currentSession.specState?.specPath || '').trim();
      if (filePath) {
        await fs.writeFile(filePath, `${String(currentSession.specState?.specText || '').trim()}\n`, 'utf8').catch(() => {});
      }
      await saveSession(currentSession);
      return buildPendingSpecSnapshot(currentSession.specState);
    },
    setPendingSpecFromFile: async ({ filePath = '', specText = '', goal = '', summary = '' } = {}) => {
      const resolvedPath = String(filePath || '').trim();
      const text = String(specText || '').trim();
      if (!resolvedPath || !text) return null;
      const existing = getPendingSpecState(currentSession);
      const existingPath = String(existing?.specPath || '').trim();
      const samePendingSpec =
        existingPath && path.resolve(existingPath) === path.resolve(resolvedPath);
      const title = summary || extractSpecTitle(text, path.basename(resolvedPath, '.md'));
      const displayGoal = extractSpecDisplayGoal(text, {
        fallback: goal || (samePendingSpec ? existing.goal : '') || extractSpecTopicTitle(title)
      });
      currentSession.specState = {
        status: 'pending_approval',
        source: 'spec-file',
        goal: displayGoal || goal || (samePendingSpec ? existing.goal : '') || title,
        summary: summary || (samePendingSpec ? existing.summary : '') || title,
        specPath: resolvedPath,
        specText: text
      };
      if (currentSession.planState?.status === 'pending_spec_approval') currentSession.planState = null;
      syncExecutionModeWithSession();
      await saveSession(currentSession);
      return buildPendingSpecSnapshot(currentSession.specState);
    },
    deletePendingSpec: async () => {
      if (!hasPendingSpecApproval(currentSession)) return null;
      const pendingSpec = getPendingSpecState(currentSession);
      const filePath = String(pendingSpec?.specPath || '').trim();
      if (filePath) {
        await fs.unlink(filePath).catch(() => {});
      }
      currentSession.specState = null;
      if (currentSession.planState?.status === 'pending_spec_approval') currentSession.planState = null;
      restoreConfiguredExecutionMode();
      await saveSession(currentSession);
      return { filePath };
    },
    dispose: async () => {
      await titleCoordinator.dispose();
      onTitleUpdateCallback = null;
      onTitleStatusCallback = null;
      if (typeof disposeTools === 'function') {
        await disposeTools();
      }
      return true;
    },
    getRuntimeState: () =>
      buildRuntimeStateSnapshot({
        currentSession,
        config,
        model,
        executionMode,
        extraSession: activeSubSession,
        workspaceRoot: root,
        alwaysSkillNames: getAlwaysSkillCommands(commands, config, null, executionMode).map((skill) => skill.name)
      })
  };
}
