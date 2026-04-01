import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {
      _raw: String(raw),
      _invalid_json: true
    };
  }
}

function clipToolResult(result, maxChars = 12000) {
  const raw = typeof result === 'string' ? result : JSON.stringify(result);
  if (!maxChars || raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n... [tool result truncated ${raw.length - maxChars} chars]`;
}

function compactToolResult(result, toolName, args, maxChars = 12000) {
  if (result === null || result === undefined) return 'no output';
  if (typeof result === 'string') {
    if (result.length <= maxChars) return result;
    return `${result.slice(0, maxChars)}\n... [tool result truncated ${result.length - maxChars} chars, original: ${result.length}]`;
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

  // Fallback: clip with reduced limit
  return clipToolResult(obj, Math.min(maxChars, 4000));
}

// ─── P0: Large result disk store ─────────────────────────────────────

const TOOL_RESULT_DISK_THRESHOLD = 6000;
const PREVIEW_SIZE_BYTES = 2000;
const TOOL_RESULTS_SUBDIR = 'tool-results';

let currentResultDir = null;
let resultDirReady = false;
const storedResults = new Map(); // callId -> { filePath, summary }
const readCache = new Map();     // "path:startLine:endLine:mtimeMs" -> true

function generatePreview(content) {
  if (content.length <= PREVIEW_SIZE_BYTES) {
    return { preview: content, hasMore: false };
  }
  const truncated = content.slice(0, PREVIEW_SIZE_BYTES);
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = lastNewline > PREVIEW_SIZE_BYTES * 0.5 ? lastNewline : PREVIEW_SIZE_BYTES;
  return { preview: content.slice(0, cutPoint), hasMore: true };
}

function formatFileSize(chars) {
  if (chars < 1024) return `${chars} B`;
  return `${(chars / 1024).toFixed(1)} KB`;
}

export function setResultDir(dir) {
  currentResultDir = dir ? path.join(dir, TOOL_RESULTS_SUBDIR) : null;
  resultDirReady = false;
}

async function ensureResultDir() {
  if (!currentResultDir) return false;
  if (!resultDirReady) {
    await fs.mkdir(currentResultDir, { recursive: true });
    resultDirReady = true;
  }
  return true;
}

async function storeResultIfNeeded(callId, formattedContent, rawResult) {
  if (formattedContent.length <= TOOL_RESULT_DISK_THRESHOLD) {
    return formattedContent;
  }
  try {
    const ready = await ensureResultDir();
    const dir = ready ? currentResultDir : path.join(os.tmpdir(), 'codemini-results');
    if (!resultDirReady && dir === currentResultDir) {
      await fs.mkdir(dir, { recursive: true });
    } else if (!resultDirReady) {
      await fs.mkdir(dir, { recursive: true });
    }
    const filePath = path.join(dir, `${callId}.txt`);
    const payload = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
    await fs.writeFile(filePath, payload, 'utf-8');
    const summary = summarizeToolResult(rawResult);
    const { preview, hasMore } = generatePreview(payload);
    storedResults.set(callId, { filePath, summary });

    return `<persisted-output>
Output too large (${formatFileSize(payload.length)}). Full output saved to: ${filePath}

Preview (first ${formatFileSize(PREVIEW_SIZE_BYTES)}):
${preview}${hasMore ? '\n...' : ''}

Summary: ${summary}
</persisted-output>`;
  } catch {
    return formattedContent;
  }
}

export function clearResultStore() {
  const files = [];
  for (const [, val] of storedResults) {
    files.push(val.filePath);
  }
  storedResults.clear();
  readCache.clear();
  return Promise.allSettled(files.map((f) => fs.unlink(f).catch(() => {})));
}

// ─── Read deduplication ─────────────────────────────────────────────

export function checkReadDedup(filePath, startLine, endLine, mtimeMs) {
  const key = `${filePath}:${startLine || 0}:${endLine || 0}:${mtimeMs}`;
  if (readCache.has(key)) {
    return true;
  }
  readCache.set(key, true);
  // Keep cache bounded
  if (readCache.size > 100) {
    const firstKey = readCache.keys().next().value;
    readCache.delete(firstKey);
  }
  return false;
}

// ─── P1a: Read-only tool classification ──────────────────────────────

const READ_ONLY_TOOLS = new Set([
  'read', 'grep', 'glob', 'list',
  'ast_query', 'read_ast_node', 'generate_diff',
  'list_services', 'get_service_status', 'get_service_logs'
]);

// ─── Exported helpers ────────────────────────────────────────────────

export function summarizeToolResult(result) {
  if (result === null || result === undefined) return 'no output';
  if (typeof result === 'string') {
    const oneLine = result.replace(/\s+/g, ' ').trim();
    return oneLine.length > 90 ? `${oneLine.slice(0, 87)}...` : oneLine || 'empty string';
  }
  if (typeof result === 'object') {
    const obj = result;
    if (Array.isArray(obj)) return `array(${obj.length})`;
    if ('path' in obj && 'action' in obj) {
      const p = String(obj.path || '');
      const action = String(obj.action || 'write');
      const line = Number(obj.changed_line || 1);
      const suffix =
        action === 'delete'
          ? 'deleted'
          : action === 'create'
            ? 'created'
            : action === 'patch'
              ? 'patched'
              : action === 'replace_block' || action === 'replace_text'
                ? 'edited'
                : action === 'append'
                  ? 'appended'
                  : 'updated';
      return p ? `${suffix} ${p}${line > 0 ? ` @L${line}` : ''}` : suffix;
    }
    if ('path' in obj && 'phase' in obj) {
      const phase = String(obj.phase || '');
      const p = String(obj.path || '');
      const total = Number(obj.total_lines);
      const start =
        Number(obj.suggested_start_line || obj.start_line) > 0
          ? Number(obj.suggested_start_line || obj.start_line)
          : 1;
      const end =
        Number(obj.suggested_end_line || obj.end_line) >= start
          ? Number(obj.suggested_end_line || obj.end_line)
          : start;
      const rangeText = start > 0 && end >= start ? ` lines ${start}-${end}` : '';
      const totalText = total > 0 ? ` of ${total}` : '';
      const errorText = obj.error ? ` (${trimInline(obj.error, 64)})` : '';
      const truncatedText = obj.truncated ? ' [truncated]' : '';
      return phase === 'metadata'
        ? `metadata for ${p}${rangeText}${totalText}${errorText}`
        : `content from ${p}${rangeText}${totalText}${truncatedText}`;
    }
    if ('stdout' in obj || 'stderr' in obj || 'code' in obj) {
      const stdout = trimInline(obj.stdout || '', 96);
      const stderr = trimInline(obj.stderr || '', 96);
      const command = trimInline(obj.command || '', 72);
      const lead = command ? `${command} -> ` : '';
      if (stdout) return `${lead}exit ${obj.code ?? 0}\nstdout: ${stdout}`;
      if (stderr) return `${lead}exit ${obj.code ?? 0}\nstderr: ${stderr}`;
      return `${lead}exit ${obj.code ?? 0}`;
    }
    if ('task_id' in obj && 'startup_confirmed' in obj) {
      const status = trimInline(obj.status || 'unknown', 32);
      const taskId = trimInline(obj.task_id || '', 24);
      const source = trimInline(obj.startup_source || '', 24);
      const logs = Array.isArray(obj.recent_logs) ? trimInline(obj.recent_logs.slice(-1)[0] || '', 96) : '';
      return `${taskId || 'service'} ${status}${source ? ` (${source})` : ''}${logs ? `\n${logs}` : ''}`;
    }
    if ('services' in obj && Array.isArray(obj.services)) {
      const count = obj.services.length;
      const first = obj.services[0];
      const lead = first?.task_id ? `${trimInline(first.task_id, 24)} ${trimInline(first.status || 'unknown', 24)}` : '';
      return `services(${count})${lead ? `\n${lead}` : ''}`;
    }
    if ('task_id' in obj && 'recent_logs' in obj) {
      const taskId = trimInline(obj.task_id || '', 24);
      const logs = Array.isArray(obj.recent_logs) ? trimInline(obj.recent_logs.slice(-1)[0] || '', 96) : '';
      return `${taskId || 'service logs'}${logs ? `\n${logs}` : ''}`;
    }
    if ('files' in obj && Array.isArray(obj.files)) {
      return `patched ${obj.files.length} file(s)`;
    }
    if ('diff' in obj && 'new_hash' in obj && 'path' in obj) {
      const p = String(obj.path || '');
      return p ? `diff preview for ${p}` : 'diff preview';
    }
    if ('created' in obj && Array.isArray(obj.created)) {
      return `created ${obj.created.length} task(s)`;
    }
    if ('tasks' in obj && Array.isArray(obj.tasks)) {
      return `${obj.tasks.length} task(s)`;
    }
    const keys = Object.keys(obj);
    return keys.length > 0 ? `keys: ${keys.slice(0, 5).join(',')}` : 'object';
  }
  return String(result);
}

export function trimInline(value, maxLen = 72) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 3)}...`;
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
  if (name === 'edit') {
    const target = trimInline(args?.path || args?.file || '.', 96) || '.';
    return `edit(${target})`;
  }
  if (name === 'patch') {
    const target = trimInline(args?.path || args?.file || args?.patch || '', 96) || '.';
    return `patch(${target})`;
  }
  if (name === 'start_service') {
    const command = trimInline(args?.command || args?.cmd || '', 96);
    return command ? `${name}(${command})` : name;
  }
  if (name === 'list_services') {
    return name;
  }
  if (name === 'get_service_status' || name === 'get_service_logs' || name === 'stop_service') {
    const taskId = trimInline(args?.task_id || args?.taskId || '', 96);
    return taskId ? `${name}(${taskId})` : name;
  }
  if (name === 'read' || name === 'write' || name === 'run' || name === 'grep' || name === 'glob' || name === 'list' || name === 'edit' || name === 'patch' || name === 'generate_diff') {
    const target = trimInline(args?.path || args?.query || args?.symbol || '', 96);
    return target ? `${name}(${target})` : name;
  }
  return name;
}

// ─── Format a single tool result using per-tool formatter or fallback ──

function formatToolResult(toolResult, toolName, args, toolFormatters, toolResultMaxChars) {
  if (toolFormatters && typeof toolFormatters[toolName] === 'function') {
    const formatted = toolFormatters[toolName](toolResult, args);
    if (typeof formatted === 'string') return formatted;
  }
  return compactToolResult(toolResult, toolName, args, toolResultMaxChars);
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
  deferredDefinitions = {}
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
  const alwaysAllowSet = new Set((Array.isArray(alwaysAllowTools) ? alwaysAllowTools : []).map((t) => String(t)));

  // Mutable tool list — grows as tool_search loads deferred tools
  const activeTools = [...toolDefinitions];

  for (let step = 0; step < maxSteps; step += 1) {
    if (onEvent) onEvent({ type: 'step:start', step: step + 1 });
    const completion = await requestCompletion({
      model,
      messages,
      tools: activeTools
    });

    const toolCalls = Array.isArray(completion.toolCalls) ? completion.toolCalls : [];
    const assistantText = completion.text || '';
    lastAssistantText = assistantText || lastAssistantText;

    const assistantMessage = { role: 'assistant', content: assistantText };
    if (toolCalls.length > 0) {
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
      finalText = assistantText;
      return { text: finalText, messages, steps: step + 1 };
    }

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
      return { text: finalText.trim(), messages, steps: step + 1 };
    }

    // ─── P1a: Partition into read-only (parallel) and write (serial) ──

    const callsWithMeta = toolCalls.map((call) => {
      const args = safeJsonParse(call.arguments);
      const toolName = normalizeToolCallName(call.name);
      const displayName = formatToolDisplayName(toolName, args);
      const isReadOnly = READ_ONLY_TOOLS.has(toolName);
      return { call, args, toolName, displayName, isReadOnly };
    });

    // Approval checks first — must be done synchronously before any execution
    const approvalResults = new Map();
    for (const { call, toolName, displayName, args } of callsWithMeta) {
      let approved = true;
      if (executionMode === 'normal' && !alwaysAllowSet.has(toolName)) {
        approved = false;
        if (typeof requestToolApproval === 'function') {
          const decision = await requestToolApproval({
            id: call.id,
            name: toolName,
            displayName,
            arguments: args
          });
          approved = Boolean(decision?.approved);
        }
      }
      approvalResults.set(call.id, approved);
    }

    // Collect results keyed by call.id, then write to messages in original order
    const resultEntries = new Map(); // call.id -> { content, error? }

    // Helper to execute a single tool call
    async function executeOne({ call, args, toolName, displayName, isReadOnly }) {
      const startedAt = Date.now();

      if (!approvalResults.get(call.id)) {
        if (onEvent) onEvent({ type: 'tool:blocked', name: displayName, id: call.id, arguments: args });
        return {
          callId: call.id,
          content: JSON.stringify({ blocked: true, reason: 'Tool call requires approval in normal mode' }),
          blocked: true
        };
      }

      if (onEvent) onEvent({ type: 'tool:start', name: displayName, id: call.id, arguments: args });
      const handler = toolHandlers[toolName];
      if (!handler) {
        throw new Error(`Unknown tool: ${call.name}`);
      }

      let toolResult;
      try {
        toolResult = await handler(args);
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        if (onEvent) {
          onEvent({ type: 'tool:error', name: displayName, id: call.id, arguments: args, durationMs, summary: trimInline(message, 120) });
        }
        return {
          callId: call.id,
          content: clipToolResult({ error: message }, toolResultMaxChars),
          error: true
        };
      }

      const durationMs = Date.now() - startedAt;
      if (onEvent) {
        onEvent({ type: 'tool:end', name: displayName, id: call.id, arguments: args, durationMs, summary: summarizeToolResult(toolResult) });
      }

      // P1b: Use per-tool formatter if available, else fallback
      let formatted = formatToolResult(toolResult, toolName, args, toolFormatters, toolResultMaxChars);

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

      return { callId: call.id, content: formatted };
    }

    // Separate read-only and write calls, preserving order
    const readOnlyCalls = callsWithMeta.filter((c) => c.isReadOnly && approvalResults.get(c.call.id));
    const writeCalls = callsWithMeta.filter((c) => !c.isReadOnly || !approvalResults.get(c.call.id));

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
        messages.push({ role: 'tool', tool_call_id: call.id, content: entry.content });
        if (onEvent) {
          onEvent({ type: 'tool:result', name: displayName, id: call.id, arguments: args, content: entry.content, blocked: true });
        }
        continue;
      }

      if (entry.error) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: entry.content });
        if (onEvent) {
          onEvent({ type: 'tool:result', name: displayName, id: call.id, arguments: args, content: entry.content, error: true });
        }
        continue;
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: entry.content });
      if (onEvent) {
        onEvent({ type: 'tool:result', name: displayName, id: call.id, arguments: args, content: entry.content });
      }
    }
  }

  const fallback = lastAssistantText || 'Stopped before final response.';
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
