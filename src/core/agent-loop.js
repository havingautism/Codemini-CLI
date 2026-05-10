import path from 'node:path';
import { trimInline as _trimInline, normalizePath } from './string-utils.js';
import { captureToInbox, listInbox } from './memory-store.js';
import { requiresApprovalEvaluation } from './command-risk.js';
import { getToolOutputSanitizeOptions, sanitizeTextForModel } from './tool-output.js';
import { normalizeToolArguments } from './tool-args.js';
import { storeResultIfNeeded, summarizeToolResult } from './tool-result-store.js';

/**
 * 安全解析 JSON 字符串。
 * 解析失败时返回带 _raw 和 _invalid_json 标记的对象，
 * 调用方可据此决定是回退到原始文本还是报告错误。
 */
function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch (parseError) {
    return {
      _raw: String(raw),
      _invalid_json: true,
      _parseError: parseError.message
    };
  }
}

function buildDeleteApprovalDetails(source, rawPath) {
  const existing =
    source?.approval && typeof source.approval === 'object' && !Array.isArray(source.approval)
      ? source.approval
      : {};
  const approvalPath = String(existing.path || rawPath || '').trim();
  const approvalName = String(existing.name || (approvalPath ? path.basename(approvalPath) : '') || '').trim();
  const approvalType = String(existing.type || '').trim();

  const approval = {};
  if (approvalPath) approval.path = approvalPath;
  if (approvalName) approval.name = approvalName;
  if (approvalType) approval.type = approvalType;
  return Object.keys(approval).length > 0 ? approval : undefined;
}

function buildDeleteCancellationResult(args) {
  const approval =
    args?.approval && typeof args.approval === 'object' && !Array.isArray(args.approval)
      ? args.approval
      : undefined;
  const pathValue = String(approval?.path || args?.path || '').trim();
  const nameValue = String(approval?.name || (pathValue ? path.basename(pathValue) : '') || '').trim();
  const typeValue = String(approval?.type || '').trim();
  return {
    ok: false,
    ...(pathValue ? { path: pathValue } : {}),
    ...(nameValue ? { name: nameValue } : {}),
    ...(typeValue ? { type: typeValue } : {}),
    deleted: false,
    cancelled: true,
    reason: 'User denied deletion approval'
  };
}

function emptyToolResultMarker(toolName) {
  const name = String(toolName || 'tool').trim() || 'tool';
  return `(${name} completed with no output)`;
}

function clipToolResult(result, maxChars = 12000) {
  const raw = sanitizeTextForModel(typeof result === 'string' ? result : JSON.stringify(result));
  if (!maxChars || raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n... [tool result truncated ${raw.length - maxChars} chars]`;
}

function compactToolResult(result, toolName, args, maxChars = 12000) {
  if (result === null || result === undefined) return 'no output';
  if (typeof result === 'string') {
    const sanitized = sanitizeTextForModel(result);
    if (sanitized.length <= maxChars) return sanitized;
    return `${sanitized.slice(0, maxChars)}\n... [tool result truncated ${sanitized.length - maxChars} chars, original: ${sanitized.length}]`;
  }
  if (typeof result !== 'object') return String(result);

  const obj = result;
  const rawLen = JSON.stringify(obj).length;

  // Read file result: { path, phase, content, ... }
  if ('path' in obj && 'phase' in obj && obj.phase === 'content') {
    const header = `[File: ${obj.path}, lines ${obj.start_line || 1}-${obj.end_line || '?'}${obj.total_lines ? ` of ${obj.total_lines}` : ''}${obj.truncated ? ', truncated' : ''}]`;
    const content = obj.content || obj.text || '';
    if (typeof content !== 'string' || content.length <= maxChars) {
      const body = typeof content === 'string' ? content : JSON.stringify(content);
      return body.length <= maxChars ? `${header}\n${body}` : `${header}\n${body.slice(0, maxChars)}\n... [omitted ${body.length - maxChars} chars, original: ${rawLen}]`;
    }
    // Keep head + tail
    const headLen = Math.floor(maxChars * 0.6);
    const tailLen = Math.floor(maxChars * 0.3);
    return `${header}\n${content.slice(0, headLen)}\n... [omitted ${content.length - headLen - tailLen} chars] ...\n${content.slice(-tailLen)}\n[original: ${rawLen} chars]`;
  }

  // File edit/write result: { path, action, ... }
  if ('path' in obj && 'action' in obj) {
    const summary = summarizeToolResult(obj);
    const diff = obj.diff || obj.patch || obj.content_preview || '';
    if (diff && typeof diff === 'string' && diff.length <= 800) {
      return `${summary}\n${diff}`;
    }
    if (diff) {
      return `${summary}\n${diff.slice(0, 800)}\n... [diff truncated, original: ${rawLen}]`;
    }
    return `${summary} [original: ${rawLen} chars]`;
  }

  // Shell command result: { stdout, stderr, code, ... }
  if ('stdout' in obj || 'stderr' in obj || 'code' in obj) {
    const command = String(obj.command || '').slice(0, 200);
    const stdout = String(obj.stdout || '').slice(0, 500);
    const stderr = String(obj.stderr || '').slice(0, 500);
    const code = obj.code ?? 0;
    const parts = [`[exit: ${code}]`];
    if (command) parts.push(`command: ${command}`);
    if (stdout) parts.push(`stdout:\n${stdout}`);
    if (stderr) parts.push(`stderr:\n${stderr}`);
    if (rawLen > 2000) parts.push(`[original: ${rawLen} chars]`);
    return parts.join('\n');
  }

  // Array results (file lists, grep results, etc.)
  if (Array.isArray(obj)) {
    const maxItems = 50;
    if (obj.length <= maxItems) {
      const serialized = JSON.stringify(obj);
      return serialized.length <= maxChars ? serialized : clipToolResult(obj, maxChars);
    }
    const kept = obj.slice(0, maxItems);
    const items = typeof kept[0] === 'string'
      ? kept.join('\n')
      : kept.map((item) => JSON.stringify(item)).join('\n');
    return `${items}\n... and ${obj.length - maxItems} more items [total: ${obj.length}, original: ${rawLen} chars]`;
  }

  // Patch result: { files: [...] }
  if ('files' in obj && Array.isArray(obj.files)) {
    return `patched ${obj.files.length} file(s): ${obj.files.slice(0, 10).join(', ')}${obj.files.length > 10 ? ` ... and ${obj.files.length - 10} more` : ''} [original: ${rawLen}]`;
  }

  // Task results
  if ('created' in obj && Array.isArray(obj.created)) {
    return `created ${obj.created.length} task(s)`;
  }
  if ('tasks' in obj && Array.isArray(obj.tasks)) {
    return `${obj.tasks.length} task(s)`;
  }
  if ('newTodos' in obj && Array.isArray(obj.newTodos)) {
    return obj.newTodos.length > 0 ? `updated ${obj.newTodos.length} todo item(s)` : 'cleared todo list';
  }
  if ('newPlan' in obj) {
    return obj.newPlan ? `updated plan state (${String(obj.newPlan.status || 'draft')})` : 'cleared plan state';
  }

  // Fallback: clip with reduced limit
  return clipToolResult(obj, Math.min(maxChars, 4000));
}

// ─── P1a: Read-only tool classification ──────────────────────────────

const READ_ONLY_TOOLS = new Set([
  'read', 'grep', 'glob', 'list',
  'ast_query', 'read_ast_node',
  'web_fetch', 'web_search',
  'list_background_tasks', 'get_background_task',
  'read_plan'
]);

// ─── Auto-capture tool errors to dream loop inbox ────────────────────

const DREAM_AUTO_CAPTURE_TOOLS = new Set([
  'edit', 'write', 'run', 'delete'
]);

const DREAM_AUTO_CAPTURE_COOLDOWN_MS = 60_000;
const lastAutoCaptureByTool = new Map();

function isAutoCaptureEnabled(config = {}) {
  return config?.memory?.enabled !== false && config?.memory?.auto_capture !== false;
}

function shouldAutoCaptureError(toolName, message) {
  if (!DREAM_AUTO_CAPTURE_TOOLS.has(toolName)) return false;
  const now = Date.now();
  const lastTime = lastAutoCaptureByTool.get(toolName) || 0;
  if (now - lastTime < DREAM_AUTO_CAPTURE_COOLDOWN_MS) return false;
  const noisePatterns = [
    /file already exists/i,
    /no such file/i,
    /not found$/i,
    /already exists$/i,
    /cancelled/i,
    /aborted/i,
    /blocked by (?:safe mode|policy|dangerous command)/i,
    /exit 127/i,
    /command not found/i,
    /permission denied/i,
    /args\?\s/i,
    /path.*outside workspace/i,
    /escapes workspace/i
  ];
  if (noisePatterns.some((p) => p.test(message))) return false;
  lastAutoCaptureByTool.set(toolName, now);
  return true;
}

async function captureToolFailure(toolName, message, args, config = {}) {
  if (!isAutoCaptureEnabled(config)) return;
  const summary = `[${toolName}] ${String(message).slice(0, 120)}`;
  const details = args
    ? `Tool: ${toolName}\nError: ${message}\nArgs: ${JSON.stringify(args).slice(0, 300)}`
    : `Tool: ${toolName}\nError: ${message}`;
  await captureToInbox({
    scope: 'repo',
    type: 'failure',
    summary,
    details,
    source: 'auto-capture'
  });
}

async function checkAutoDreamThreshold(config) {
  const threshold = Number(config?.memory?.auto_dream_threshold || 10);
  if (threshold <= 0) return false;
  try {
    const entries = await listInbox();
    return entries.length >= threshold;
  } catch {
    return false;
  }
}

// ─── Exported helpers ────────────────────────────────────────────────

function extractFileChange(toolName, result) {
  if (!result || typeof result !== 'object') return null;
  const FILE_TOOLS = new Set(['edit', 'write', 'delete']);
  if (!FILE_TOOLS.has(toolName)) return null;

  /* delete */
  if ('deleted' in result && result.deleted) {
    return { path: String(result.path || ''), action: 'delete', linesAdded: 0, linesRemoved: 0 };
  }

  /* edit / write */
  if ('path' in result && 'action' in result) {
    const action = String(result.action || '');
    const isCreate = action === 'create';
    const added = Number(result.lines_added || 0);
    const removed = Number(result.lines_removed || 0);
    return {
      path: String(result.path || ''),
      action: isCreate ? 'create' : 'edit',
      linesAdded: added,
      linesRemoved: removed
    };
  }

  return null;
}

export const trimInline = _trimInline;

function normalizeAssistantText(value) {
  return String(value || '').trim();
}

function hasTrailingToolContext(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'tool') return true;
    if (message.role === 'assistant' || message.role === 'user') return false;
  }
  return false;
}

function isGenericCompletionText(text) {
  const normalized = normalizeAssistantText(text).toLowerCase();
  if (!normalized) return false;
  const genericPhrases = new Set([
    'done',
    'completed',
    'complete',
    'finished',
    'task completed',
    'all done',
    'ok',
    'okay',
    '已完成',
    '已完成任务',
    '完成',
    '任务完成'
  ]);
  return genericPhrases.has(normalized);
}

function shouldAskForConcreteFinalAnswer(text, messages = []) {
  if (!hasTrailingToolContext(messages)) return false;
  const normalized = normalizeAssistantText(text);
  if (!normalized) return true;
  return isGenericCompletionText(normalized);
}

function isBroadRepositoryAnalysisTask(text) {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    /optimi|improve|analy[sz]e|audit|review|overview|architecture|codebase|repository|repo/.test(normalized) ||
    /项目.*优化|项目.*问题|可优化|分析这个项目|看看.*项目|代码库|仓库/.test(String(text || ''))
  );
}

function parseProjectIndexSummary(text) {
  const sourceRoots = [];
  const entryCandidates = [];
  const candidateFiles = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('source_roots:')) {
      sourceRoots.push(
        ...String(trimmed.slice('source_roots:'.length))
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      );
    } else if (trimmed.startsWith('entry_candidates:')) {
      entryCandidates.push(
        ...String(trimmed.slice('entry_candidates:'.length))
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      );
    } else if (trimmed.startsWith('- ')) {
      const match = trimmed.match(/^- ([^ ]+)/);
      if (match?.[1]) candidateFiles.push(match[1].trim());
    }
  }
  return { sourceRoots, entryCandidates, candidateFiles };
}

function createAnalysisGuardState(userPrompt) {
  return {
    active: isBroadRepositoryAnalysisTask(userPrompt),
    indexQueried: false,
    sourceRoots: new Set(),
    entryCandidates: new Set(),
    candidateFiles: new Set(),
    relevantSourceReads: new Set(),
    blockedExplorations: 0
  };
}

function topLevelPath(value) {
  const normalized = normalizePath(value).trim();
  return normalized.split('/')[0] || '';
}

function isRelevantSourcePath(filePath, state) {
  const normalized = normalizePath(filePath).trim();
  if (!normalized) return false;
  if (state.candidateFiles.has(normalized) || state.entryCandidates.has(normalized)) return true;
  for (const root of state.sourceRoots) {
    if (normalized === root || normalized.startsWith(`${root}/`)) return true;
  }
  return false;
}

function blockedExplorationReason(toolName, args, state) {
  if (!state.active) return '';

  // Always note when query_project_index is used, but never force it
  if (toolName === 'query_project_index') return '';

  const target = normalizePath(String(args?.path || args?.pattern || args?.query || '')).trim();
  const top = topLevelPath(target);
  if (!top) return '';

  if (['skills', 'souls', 'templates', '.codemini', '.codemini-global'].includes(top)) {
    return `Skip ${top}/ for broad repository analysis unless the user explicitly asks for it. Inspect relevant source files first.`;
  }
  return '';
}

function noteAnalysisEvidence(state, toolName, args, toolResult) {
  if (!state.active) return;
  if (toolName === 'query_project_index') {
    state.indexQueried = true;
    const summary = parseProjectIndexSummary(JSON.stringify(toolResult));
    for (const root of summary.sourceRoots) state.sourceRoots.add(root);
    for (const entry of summary.entryCandidates) state.entryCandidates.add(entry);
    for (const file of summary.candidateFiles) state.candidateFiles.add(file);
    const projectMap = toolResult?.project_map || {};
    for (const root of projectMap.source_roots || []) state.sourceRoots.add(String(root));
    for (const entry of projectMap.entry_candidates || []) state.entryCandidates.add(String(entry));
    for (const match of toolResult?.matches || []) {
      if (match?.file) state.candidateFiles.add(String(match.file));
    }
    return;
  }

  if (toolName === 'read') {
    const filePath = String(toolResult?.path || args?.path || '').split(':')[0];
    if (isRelevantSourcePath(filePath, state)) {
      state.relevantSourceReads.add(filePath);
    }
  }
}

function needsMoreAnalysisEvidence(state) {
  if (!state.active) return false;
  if (!state.indexQueried) return true;
  return state.relevantSourceReads.size < 2;
}

function normalizeToolCallName(name) {
  return String(name || '').trim();
}

function formatToolDisplayName(name, args) {
  if (name === 'grep') {
    const query = trimInline(args?.pattern || args?.query || args?.symbol || '', 96);
    return query ? `grep("${query}")` : 'grep';
  }
  if (name === 'glob') {
    const pattern = trimInline(args?.pattern || '', 96);
    return pattern ? `glob("${pattern}")` : 'glob';
  }
  if (name === 'list') {
    const target = trimInline(args?.path || '.', 96) || '.';
    return `list(${target})`;
  }
  if (name === 'read' || name === 'write') {
    const target = trimInline(args?.path || '.', 96) || '.';
    if (name === 'read') {
      const start = Number(args?.start_line);
      const end = Number(args?.end_line);
      const hasRange = Number.isFinite(start) && start > 0;
      const suffix = hasRange ? `:${start}-${Number.isFinite(end) && end >= start ? end : start}` : '';
      return `read(${target}${suffix})`;
    }
    return `write(${target})`;
  }
  if (name === 'run') {
    const command = trimInline(args?.command || '', 96);
    return command ? `run(${command})` : name;
  }
  if (name === 'web_fetch') {
    const url = trimInline(args?.url || args?.href || '', 96);
    return url ? `web_fetch(${url})` : name;
  }
  if (name === 'web_search') {
    const query = trimInline(args?.query || args?.q || '', 96);
    return query ? `web_search(${query})` : name;
  }
  if (name === 'edit') {
    const target = trimInline(args?.path || args?.file || '.', 96) || '.';
    return `edit(${target})`;
  }
  if (name === 'delete') {
    const target = trimInline(args?.path || args?.target || '.', 96) || '.';
    return `delete(${target})`;
  }
  if (name === 'update_todos') {
    return 'update_todos';
  }
  if (name === 'read_plan' || name === 'update_plan') {
    return name;
  }
  if (name === 'list_background_tasks') {
    return name;
  }
  if (name === 'get_background_task' || name === 'stop_background_task') {
    const taskId = trimInline(args?.task_id || args?.taskId || '', 96);
    return taskId ? `${name}(${taskId})` : name;
  }
  return name;
}

// ─── Format a single tool result using per-tool formatter or fallback ──

function formatToolResult(toolResult, toolName, args, toolFormatters, toolResultMaxChars) {
  const sanitizeOptions = getToolOutputSanitizeOptions(toolName);
  if (toolFormatters && typeof toolFormatters[toolName] === 'function') {
    const formatted = toolFormatters[toolName](toolResult, args);
    if (typeof formatted === 'string') {
      const sanitized = sanitizeTextForModel(formatted, sanitizeOptions);
      return sanitized.trim() ? sanitized : emptyToolResultMarker(toolName);
    }
  }
  const fallback = compactToolResult(toolResult, toolName, args, toolResultMaxChars);
  const sanitizedFallback = sanitizeTextForModel(fallback, sanitizeOptions);
  return String(sanitizedFallback || '').trim() ? sanitizedFallback : emptyToolResultMarker(toolName);
}

// ─── Main agent loop ────────────────────────────────────────────────

export async function runAgentLoop({
  systemPrompt,
  userPrompt,
  model,
  requestCompletion,
  toolHandlers = {},
  toolDefinitions = [],
  maxSteps = 8,
  initialMessages = [],
  onEvent,
  executionMode = 'auto',
  alwaysAllowTools = [],
  requestToolApproval,
  toolResultMaxChars = 12000,
  toolFormatters = {},
  deferredDefinitions = {},
  signal,
  skipAnalysisNudge = false,
  config = {}
}) {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  if (Array.isArray(initialMessages) && initialMessages.length > 0) {
    messages.push(...initialMessages);
  }
  if (userPrompt) {
    messages.push({ role: 'user', content: userPrompt });
  }

  let finalText = '';
  let lastAssistantText = '';
  let pendingSummaryNudges = 0;
  const analysisGuard = createAnalysisGuardState(userPrompt);
  const alwaysAllowSet = new Set((Array.isArray(alwaysAllowTools) ? alwaysAllowTools : []).map((t) => String(t)));
  let lastAutoDreamCheckStep = 0;

  // Mutable tool list — grows as tool_search loads deferred tools
  const activeTools = [...toolDefinitions];

  async function maybeRunAutoDream(stepNumber = 0, { force = false } = {}) {
    if (executionMode === 'plan') return;
    const interval = Math.max(1, Number(config?.memory?.auto_dream_check_interval_steps || 20));
    const normalizedStep = Math.max(1, Number(stepNumber || 1));
    if (!force && lastAutoDreamCheckStep > 0 && normalizedStep - lastAutoDreamCheckStep < interval) return;
    if (force && lastAutoDreamCheckStep === normalizedStep) return;
    lastAutoDreamCheckStep = normalizedStep;
    const autoDreamResult = await checkAutoDreamThreshold(config);
    if (!autoDreamResult) return;
    const dreamTool = toolHandlers['dream_consolidate'];
    if (typeof dreamTool !== 'function') return;
    if (onEvent) onEvent({ type: 'dream:auto', message: 'inbox threshold reached' });
    try {
      const report = await dreamTool({});
      if (onEvent) {
        onEvent({ type: 'dream:complete', report });
      }
    } catch (error) {
      if (onEvent) {
        onEvent({
          type: 'dream:complete',
          report: { ok: false, error: String(error?.message || error || 'unknown dream error') }
        });
      }
      // Auto-dream is best-effort; don't block the loop
    }
  }

  for (let step = 0; step < maxSteps; step += 1) {
    // 检查是否已被用户中止
    if (signal?.aborted) {
      if (onEvent) onEvent({ type: 'aborted', step: step + 1 });
      break;
    }
    if (onEvent) onEvent({ type: 'step:start', step: step + 1 });
    await maybeRunAutoDream(step + 1);
    const completion = await requestCompletion({
      model,
      messages,
      tools: activeTools,
      signal
    });

    // 流式请求完成后再次检查中止状态
    if (signal?.aborted) {
      if (onEvent) onEvent({ type: 'aborted', step: step + 1 });
      break;
    }

    if (completion?.incomplete) {
      continue;
    }

    const toolCalls = Array.isArray(completion.toolCalls) ? completion.toolCalls : [];
    const assistantText = completion.text || '';
    lastAssistantText = assistantText || lastAssistantText;

    const assistantMessage = completion?.assistantMessage
      ? {
          ...completion.assistantMessage,
          role: 'assistant',
          content: completion.assistantMessage.content ?? completion?.content ?? assistantText
        }
      : { role: 'assistant', content: completion?.content ?? assistantText };
    if (!Array.isArray(assistantMessage.tool_calls) && toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments || '{}' }
      }));
    }
    messages.push(assistantMessage);
    if (onEvent) {
      onEvent({
        type: 'assistant:response',
        step: step + 1,
        text: assistantText,
        toolCalls: toolCalls.map((tc) => tc.name),
        assistantMessage
      });
    }

    if (toolCalls.length === 0) {
      if (!skipAnalysisNudge && needsMoreAnalysisEvidence(analysisGuard) && pendingSummaryNudges < 2) {
        pendingSummaryNudges += 1;
        messages.push({
          role: 'user',
          content:
            'You have not inspected enough relevant source files yet. Query the project index if needed, then inspect the next relevant source files before concluding. Do not stop after unrelated directories, tests, skills, souls, or templates.'
        });
        continue;
      }
      if (!skipAnalysisNudge && shouldAskForConcreteFinalAnswer(assistantText, messages.slice(0, -1)) && pendingSummaryNudges < 2) {
        pendingSummaryNudges += 1;
        messages.push({
          role: 'user',
          content:
            'You have already inspected tool results. Before stopping, check whether the task is actually complete. If it is, provide a concise final answer with specific findings or concrete next steps. If it is not, continue with the next tool call.'
        });
        continue;
      }
      finalText = assistantText;
      await maybeRunAutoDream(step + 1, { force: true });
      return { text: finalText, messages, steps: step + 1 };
    }

    pendingSummaryNudges = 0;

    if (executionMode === 'plan') {
      const plannedLines = callsToPlanSummary(toolCalls);
      finalText = [
        assistantText || '',
        '',
        `[plan mode] ${toolCalls.length} tool call(s) were planned but not executed.`,
        plannedLines.length > 0 ? 'Planned exploration:' : '',
        ...plannedLines
      ]
        .filter(Boolean)
        .join('\n');
      await maybeRunAutoDream(step + 1, { force: true });
      return { text: finalText.trim(), messages, steps: step + 1 };
    }

    // ─── P1a: Partition into read-only (parallel) and write (serial) ──

    const callsWithMeta = toolCalls.map((call) => {
      const toolName = normalizeToolCallName(call.name);
      const args = normalizeToolArguments(toolName, safeJsonParse(call.arguments), call.arguments);
      const displayName = formatToolDisplayName(toolName, args);
      const isReadOnly = READ_ONLY_TOOLS.has(toolName);
      return { call, args, toolName, displayName, isReadOnly };
    });

    // Approval checks first — must be done synchronously before any execution
    const approvalResults = new Map();
    for (const { call, toolName, displayName, args } of callsWithMeta) {
      let approved = true;
      let approvalArgs = args;
      let preflightErrorContent = '';
      const isSafeModeRun = toolName === 'run'
        && config?.policy?.safe_mode !== false
        && requiresApprovalEvaluation(args?.command || '', config?.shell?.default);
      const needsApproval = toolName === 'delete' || isSafeModeRun
        || (executionMode === 'normal' && !alwaysAllowSet.has(toolName));
      if (needsApproval) {
        approved = false;
        const handler = toolHandlers[toolName];
        if (toolName === 'delete' && typeof handler?.prepareApproval === 'function') {
          try {
            const approval = await handler.prepareApproval(args);
            const normalizedApproval = buildDeleteApprovalDetails({ approval }, args?.path);
            if (normalizedApproval) {
              approvalArgs = { ...args, approval: normalizedApproval };
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            preflightErrorContent = clipToolResult({ error: message }, toolResultMaxChars);
          }
        }
        /* Run tool: safe mode LLM-based command evaluation */
        if (toolName === 'run' && isSafeModeRun && !preflightErrorContent) {
          try {
            const { evaluateCommandWithLLM } = await import('./command-evaluator.js');
            const evaluation = await evaluateCommandWithLLM({
              command: args?.command || '',
              config,
              workspaceRoot: config?.workspaceRoot || process.cwd()
            });
            approvalArgs = { ...args, _risk: evaluation.risk, _evaluation: evaluation };
            /* LLM says low-risk + allow → auto-approve, skip confirmation panel */
            if (evaluation.risk === 'low' && evaluation.recommendation === 'allow') {
              approvalResults.set(call.id, { approved: true, args: approvalArgs });
              continue;
            }
          } catch (_) {
            approvalArgs = { ...args, _risk: 'high', _evaluation: null };
          }
          if (typeof handler?.prepareApproval === 'function') {
            try {
              const approval = await handler.prepareApproval(approvalArgs);
              approvalArgs = { ...approvalArgs, approval };
            } catch (_) { /* skip */ }
          }
        }
        if (preflightErrorContent) {
          approvalResults.set(call.id, {
            approved: false,
            args: approvalArgs,
            errorContent: preflightErrorContent
          });
          continue;
        }
        if (typeof requestToolApproval === 'function') {
          const decision = await requestToolApproval({
            id: call.id,
            name: toolName,
            displayName,
            arguments: approvalArgs,
            approvalDetails: toolName === 'delete' ? approvalArgs.approval
              : (toolName === 'run' ? approvalArgs.approval : undefined)
          });
          approved = Boolean(decision?.approved);
        }
      }
      approvalResults.set(call.id, { approved, args: approvalArgs });
    }

    // Collect results keyed by call.id, then write to messages in original order
    const resultEntries = new Map(); // call.id -> { content, error? }

    // Helper to execute a single tool call
    async function executeOne({ call, args, toolName, displayName, isReadOnly }) {
      const startedAt = Date.now();
      const approvalState = approvalResults.get(call.id) || { approved: true, args };
      const effectiveArgs = approvalState.args || args;

      if (approvalState.errorContent) {
        const summary = trimInline(approvalState.errorContent, 120);
        if (onEvent) {
          onEvent({ type: 'tool:error', name: displayName, id: call.id, arguments: effectiveArgs, durationMs: 0, summary });
        }
        return {
          callId: call.id,
          content: approvalState.errorContent,
          error: true,
          durationMs: 0,
          summary,
          status: 'error'
        };
      }

      if (!approvalState.approved) {
        if (onEvent) onEvent({ type: 'tool:blocked', name: displayName, id: call.id, arguments: effectiveArgs });
        const blockedPayload =
          toolName === 'delete'
            ? buildDeleteCancellationResult(effectiveArgs)
            : { blocked: true, reason: 'Tool call requires approval in normal mode' };
        return {
          callId: call.id,
          content: JSON.stringify(blockedPayload),
          blocked: true,
          summary: 'Tool call requires approval',
          status: 'blocked'
        };
      }

      if (onEvent) onEvent({ type: 'tool:start', name: displayName, id: call.id, arguments: effectiveArgs });
      const handler = toolHandlers[toolName];
      if (!handler) {
        const available = Object.keys(toolHandlers).join(', ');
        const msg = `Unknown tool: "${toolName}". Available tools: ${available || '(none)'}`;
        const summary = trimInline(msg, 200);
        if (onEvent) {
          onEvent({ type: 'tool:error', name: displayName, id: call.id, arguments: effectiveArgs, durationMs: 0, summary });
        }
        return {
          callId: call.id,
          content: JSON.stringify({ error: msg }),
          error: true,
          durationMs: 0,
          summary,
          status: 'error'
        };
      }

      const blockedReason = blockedExplorationReason(toolName, effectiveArgs, analysisGuard);
      if (blockedReason) {
        analysisGuard.blockedExplorations += 1;
        const content = clipToolResult({ error: blockedReason }, toolResultMaxChars);
        const summary = trimInline(blockedReason, 120);
        if (onEvent) {
          onEvent({ type: 'tool:error', name: displayName, id: call.id, arguments: effectiveArgs, durationMs: 0, summary });
        }
        return {
          callId: call.id,
          content,
          error: true,
          durationMs: 0,
          summary,
          status: 'error'
        };
      }

      let toolResult;
      try {
        toolResult = await handler(effectiveArgs);
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        const summary = trimInline(message, 120);
        if (onEvent) {
          onEvent({ type: 'tool:error', name: displayName, id: call.id, arguments: effectiveArgs, durationMs, summary });
        }
        if (isAutoCaptureEnabled(config) && shouldAutoCaptureError(toolName, message)) {
          await captureToolFailure(toolName, message, effectiveArgs, config).catch(() => {});
        }
        return {
          callId: call.id,
          content: clipToolResult({ error: message }, toolResultMaxChars),
          error: true,
          durationMs,
          summary,
          status: 'error'
        };
      }

      const durationMs = Date.now() - startedAt;
      const summary = summarizeToolResult(toolResult);
      /* 提取文件改动统计 */
      const fileChange = extractFileChange(toolName, toolResult);
      if (onEvent) {
        onEvent({ type: 'tool:end', name: displayName, id: call.id, arguments: effectiveArgs, durationMs, summary, fileChange });
      }

      // Auto-capture non-throwing tool failures (e.g. shell non-zero exit)
      if (toolResult && typeof toolResult === 'object') {
        const exitCode = toolResult.code ?? toolResult.exitCode;
        const stderr = String(toolResult.stderr || '');
        if (typeof exitCode === 'number' && exitCode !== 0 && stderr) {
          const failMsg = `exit ${exitCode}: ${stderr.slice(0, 120)}`;
          if (isAutoCaptureEnabled(config) && shouldAutoCaptureError(toolName, failMsg)) {
            await captureToolFailure(toolName, failMsg, effectiveArgs, config).catch(() => {});
          }
        }
        if (toolResult.error) {
          const errMsg = String(toolResult.error).slice(0, 120);
          if (isAutoCaptureEnabled(config) && shouldAutoCaptureError(toolName, errMsg)) {
            await captureToolFailure(toolName, errMsg, effectiveArgs, config).catch(() => {});
          }
        }
      }

      // P1b: Use per-tool formatter if available, else fallback
      let formatted = formatToolResult(toolResult, toolName, effectiveArgs, toolFormatters, toolResultMaxChars);
      noteAnalysisEvidence(analysisGuard, toolName, effectiveArgs, toolResult);

      // P2: If tool_search loaded deferred tools, inject their schemas into activeTools
      if (toolName === 'tool_search' && toolResult && Array.isArray(toolResult.schemas)) {
        for (const schema of toolResult.schemas) {
          const name = schema?.function?.name;
          if (name && !activeTools.some((t) => t?.function?.name === name)) {
            activeTools.push(schema);
          }
        }
      }

      // P0: Persist to disk if still large
      formatted = await storeResultIfNeeded(call.id, formatted, toolResult);

      return { callId: call.id, content: formatted, durationMs, summary, status: 'done' };
    }

    // Separate read-only and write calls, preserving order
    const readOnlyCalls = callsWithMeta.filter((c) => c.isReadOnly && approvalResults.get(c.call.id)?.approved);
    const writeCalls = callsWithMeta.filter((c) => !c.isReadOnly || !approvalResults.get(c.call.id)?.approved);

    // Execute read-only calls in parallel
    if (readOnlyCalls.length > 0) {
      const readOnlyResults = await Promise.all(readOnlyCalls.map((c) => executeOne(c)));
      for (const r of readOnlyResults) {
        resultEntries.set(r.callId, r);
      }
    }

    // Execute write calls serially
    for (const c of writeCalls) {
      const r = await executeOne(c);
      resultEntries.set(r.callId, r);
    }

    // Write results to messages in original tool call order
    for (const { call, displayName, args } of callsWithMeta) {
      const entry = resultEntries.get(call.id);
      if (!entry) continue;

      if (entry.blocked) {
        attachToolCallSessionMeta(assistantMessage, call.id, { summary: entry.summary || '', status: entry.status || 'blocked' });
        messages.push({ role: 'tool', tool_call_id: call.id, content: entry.content, tool_summary: entry.summary || '', tool_status: entry.status || 'blocked' });
        if (onEvent) {
          onEvent({ type: 'tool:result', name: displayName, id: call.id, arguments: args, content: entry.content, blocked: true });
        }
        continue;
      }

      if (entry.error) {
        attachToolCallSessionMeta(assistantMessage, call.id, { durationMs: entry.durationMs, summary: entry.summary || '', status: entry.status || 'error' });
        messages.push({ role: 'tool', tool_call_id: call.id, content: entry.content, tool_duration_ms: entry.durationMs, tool_summary: entry.summary || '', tool_status: entry.status || 'error' });
        if (onEvent) {
          onEvent({ type: 'tool:result', name: displayName, id: call.id, arguments: args, content: entry.content, error: true });
        }
        continue;
      }

      attachToolCallSessionMeta(assistantMessage, call.id, { durationMs: entry.durationMs, summary: entry.summary || '', status: entry.status || 'done' });
      messages.push({ role: 'tool', tool_call_id: call.id, content: entry.content, tool_duration_ms: entry.durationMs, tool_summary: entry.summary || '', tool_status: entry.status || 'done' });
      if (onEvent) {
        onEvent({ type: 'tool:result', name: displayName, id: call.id, arguments: args, content: entry.content });
      }
    }
  }

  // 如果被用户中止，返回已有内容并标记
  if (signal?.aborted) {
    const fallback = lastAssistantText || '';
    return {
      text: fallback,
      messages,
      steps: maxSteps,
      aborted: true
    };
  }

  const fallback = lastAssistantText || 'Stopped before final response.';
  await maybeRunAutoDream(maxSteps, { force: true });
  return {
    text: `${fallback}\n\n[stopped] Reached max tool steps (${maxSteps}). Try a narrower prompt or increase execution.max_steps.`,
    messages,
    steps: maxSteps
  };
}

function callsToPlanSummary(toolCalls = []) {
  return toolCalls
    .slice(0, 8)
    .map((call) => {
      const args = safeJsonParse(call?.arguments);
      return `- ${formatToolDisplayName(normalizeToolCallName(call?.name), args)}`;
    });
}

function attachToolCallSessionMeta(assistantMessage, callId, meta = {}) {
  if (!assistantMessage || !Array.isArray(assistantMessage.tool_calls)) return;
  const call = assistantMessage.tool_calls.find((tc) => String(tc?.id || '') === String(callId || ''));
  if (!call) return;
  if (Number.isFinite(Number(meta.durationMs))) call.durationMs = Number(meta.durationMs);
  if (typeof meta.summary === 'string' && meta.summary.trim()) call.summary = meta.summary.trim();
  if (typeof meta.status === 'string' && meta.status.trim()) call.status = meta.status.trim();
}
