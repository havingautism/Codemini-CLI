import { trimInline } from './string-utils.js';
import { summarizeToolResult } from './tool-result-store.js';

const MICRO_CLEAR_MARKER = '[Old tool result cleared by micro-compact]';
export const AGGRESSIVE_PRUNE_MARKER = '[Tool result pruned — summary only]';
export const PRUNE_OUTPUT_PLACEHOLDER = '[Old tool result cleared]';
export const PRUNE_INPUT_PLACEHOLDER = '[Old tool input cleared]';
export const COMPACT_START_SUMMARY = '自动压缩中…';
export const COMPACT_START_SUMMARY_EN = 'Auto-compacting…';
export const COMPACT_DONE_SUMMARY = '已压缩上下文';
export const COMPACT_DONE_SUMMARY_EN = 'Context compacted';

// opencode SessionCompaction: keep this share of the window free, and at least
// RESERVE_MIN when the window is large enough to give it up.
export const RESERVE_SHARE = 0.15;
export const RESERVE_MIN = 16_000;
export const PRUNE_PROTECT = 40_000;
export const PRUNE_MINIMUM = 20_000;
export const SUMMARY_KEEP_TOKENS = 15_000;
export const SUMMARY_KEEP_TOKENS_AGGRESSIVE = 4_000;
export const SHRINK_STEPS = [0.85, 0.7, 0.5, 0.35];
const IMAGE_TOKEN_ESTIMATE = 1_500;
const TRANSCRIPT_CLIP = 2_000;

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        if (part?.type === 'reasoning') return part.text || part.reasoning || '';
        return '';
      })
      .join('');
  }
  if (content && typeof content === 'object') {
    try { return JSON.stringify(content); } catch { return ''; }
  }
  return '';
}

function finiteNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

export function estimateTextTokens(value) {
  const text = typeof value === 'string'
    ? value
    : value == null
      ? ''
      : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  if (!text) return 0;
  let asciiChars = 0;
  let nonAsciiChars = 0;
  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) asciiChars += 1;
    else nonAsciiChars += 1;
  }
  return Math.ceil(asciiChars / 4) + Math.ceil(nonAsciiChars / 2);
}

function estimateContentTokens(content) {
  if (typeof content === 'string') return estimateTextTokens(content);
  if (Array.isArray(content)) {
    let total = 0;
    for (const part of content) {
      if (typeof part === 'string') total += estimateTextTokens(part);
      else if (part?.type === 'text' || part?.type === 'reasoning') {
        total += estimateTextTokens(part.text || part.reasoning || '');
      } else if (part?.type === 'image_url' || part?.type === 'image' || part?.type === 'input_image') {
        total += IMAGE_TOKEN_ESTIMATE;
      }
    }
    return total;
  }
  if (content && typeof content === 'object') return estimateTextTokens(content);
  return 0;
}

function toolCallArgumentText(call) {
  const args = call?.function?.arguments ?? call?.arguments ?? '';
  if (typeof args === 'string') return args;
  if (args == null) return '';
  try { return JSON.stringify(args); } catch { return ''; }
}

export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const message of messages || []) {
    if (!message || typeof message !== 'object') continue;
    total += 6;
    total += estimateContentTokens(message.model_content || message.content);
    if (Array.isArray(message.model_images)) total += message.model_images.length * IMAGE_TOKEN_ESTIMATE;
    if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
      total += estimateTextTokens(message.reasoning_content);
    }
    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        total += estimateTextTokens(getToolCallName(call));
        total += estimateTextTokens(toolCallArgumentText(call));
      }
    }
  }
  return total;
}

export function estimateToolDefinitionsTokens(tools) {
  if (!tools) return 0;
  const list = Array.isArray(tools) ? tools : [tools];
  if (list.length === 0) return 0;
  return estimateTextTokens(list);
}

function modeToKeepRecent(mode) {
  if (mode === 'aggressive') return 4;
  if (mode === 'conservative') return 10;
  return 6;
}

function getToolCallId(call) {
  return String(call?.id || '').trim();
}

function getMessageToolCallIds(message) {
  if (!Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls.map(getToolCallId).filter(Boolean);
}

function getToolCallName(call) {
  return String(call?.function?.name || call?.name || '').trim();
}

function mapToolCallNames(messages) {
  const names = new Map();
  for (const message of messages || []) {
    if (!Array.isArray(message?.tool_calls)) continue;
    for (const call of message.tool_calls) {
      const id = getToolCallId(call);
      const name = getToolCallName(call);
      if (id && name) names.set(id, name);
    }
  }
  return names;
}

function summarizeToolResultText(text, options = {}) {
  const maxSummaryChars = Number(options.maxSummaryChars ?? 600);
  const summaryTailChars = Number(options.summaryTailChars ?? Math.floor(maxSummaryChars * 0.2));
  const raw = String(text || '').trim();
  if (!raw) return 'No content';
  if (raw === MICRO_CLEAR_MARKER || raw.startsWith(AGGRESSIVE_PRUNE_MARKER)) {
    return raw.startsWith(AGGRESSIVE_PRUNE_MARKER)
      ? raw.slice(AGGRESSIVE_PRUNE_MARKER.length).trim() || 'No content'
      : 'cleared';
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (parsed && typeof parsed === 'object') {
    return summarizeObjectToolResult(parsed, { maxSummaryChars, summaryTailChars });
  }
  // Plain-text tool results (e.g. tasks, read_plan, update_plan) are
  // already structured summaries. Preserve newlines so the model can still
  // read the structure; only clip by length.
  if (raw.length <= maxSummaryChars) return raw;
  return clipWithTail(raw, maxSummaryChars, summaryTailChars);
}

function clipWithTail(text, maxChars, tailChars = Math.floor(maxChars * 0.25)) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  const markerBudget = 40;
  const tail = Math.max(0, Math.min(Number(tailChars) || 0, maxChars - markerBudget));
  const head = Math.max(0, maxChars - tail - markerBudget);
  const tailText = tail > 0 ? `\n${value.slice(-tail)}` : '';
  return `${value.slice(0, head)}\n... [omitted ${value.length - head - tail} chars] ...${tailText}`;
}

function extractPersistedFilePath(text) {
  const match = String(text || '').match(/Full output saved to:[ \t]*([^\r\n<]+)/);
  return match ? match[1].trim() : null;
}

function summarizeObjectToolResult(obj, {
  maxSummaryChars = 600,
  summaryTailChars = Math.floor(maxSummaryChars * 0.25)
} = {}) {
  const base = summarizeToolResult(obj);
  const parts = [base];

  // Content-bearing results: keep head + tail of the actual content for semantic recall.
  if (typeof obj.content === 'string' && obj.content.length > 0) {
    const contentClip = clipWithTail(obj.content, maxSummaryChars, summaryTailChars);
    parts.push(`content:\n${contentClip}`);
  } else if (typeof obj.text === 'string' && obj.text.length > 0) {
    const textClip = clipWithTail(obj.text, maxSummaryChars, summaryTailChars);
    parts.push(`text:\n${textClip}`);
  } else if (typeof obj.stdout === 'string' && obj.stdout.length > 0) {
    const stdoutBudget = Math.min(maxSummaryChars, 400);
    const stdoutClip = clipWithTail(obj.stdout, stdoutBudget, Math.min(summaryTailChars, Math.floor(stdoutBudget / 2)));
    parts.push(`stdout:\n${stdoutClip}`);
  } else if (typeof obj.stderr === 'string' && obj.stderr.length > 0) {
    const stderrBudget = Math.min(maxSummaryChars, 400);
    const stderrClip = clipWithTail(obj.stderr, stderrBudget, Math.min(summaryTailChars, Math.floor(stderrBudget / 2)));
    parts.push(`stderr:\n${stderrClip}`);
  } else if (typeof obj.diff === 'string' && obj.diff.length > 0) {
    const diffBudget = Math.min(maxSummaryChars, 400);
    parts.push(`diff:\n${clipWithTail(obj.diff, diffBudget, Math.min(summaryTailChars, Math.floor(diffBudget / 2)))}`);
  }

  return parts.join('\n');
}

function buildPrunedToolResultContent(text, options = {}) {
  const maxSummaryChars = Number(options.maxSummaryChars ?? 600);
  const summaryTailChars = Number(options.summaryTailChars ?? Math.floor(maxSummaryChars * 0.2));
  const summary = summarizeToolResultText(text, { maxSummaryChars, summaryTailChars });
  const persisted = extractPersistedFilePath(text);
  const persistedLine = persisted ? `\n<persisted full output: ${persisted}>` : '';
  return `${AGGRESSIVE_PRUNE_MARKER}${persistedLine}\n${summary}`;
}

function toolResultNote(message) {
  const summary = summarizeToolResultText(textFromContent(message?.content));
  return `[Compacted orphan tool result]\n${summary}`;
}

function expandRecentStartToToolBoundary(messages, start) {
  let adjusted = Math.max(0, Math.min(start, messages.length));
  while (adjusted > 0 && messages[adjusted]?.role === 'tool') {
    adjusted -= 1;
  }
  if (
    adjusted > 0 &&
    messages[adjusted]?.role !== 'assistant' &&
    messages[adjusted + 1]?.role === 'tool'
  ) {
    adjusted += 1;
  }
  return adjusted;
}

function sanitizeRecentMessagesForModel(messages) {
  const out = [];
  let activeAssistantIndex = -1;
  let expectedToolIds = new Set();
  let matchedToolIds = new Set();

  const finalizeActiveAssistant = () => {
    if (activeAssistantIndex < 0) return;
    const assistant = out[activeAssistantIndex];
    if (!Array.isArray(assistant?.tool_calls)) {
      activeAssistantIndex = -1;
      expectedToolIds = new Set();
      matchedToolIds = new Set();
      return;
    }
    const toolCalls = assistant.tool_calls.filter((call) => matchedToolIds.has(getToolCallId(call)));
    if (toolCalls.length > 0) {
      out[activeAssistantIndex] = { ...assistant, tool_calls: toolCalls };
    } else {
      const { tool_calls, ...rest } = assistant;
      out[activeAssistantIndex] = rest;
    }
    activeAssistantIndex = -1;
    expectedToolIds = new Set();
    matchedToolIds = new Set();
  };

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'assistant') {
      finalizeActiveAssistant();
      const clone = { ...message };
      out.push(clone);
      const ids = getMessageToolCallIds(clone);
      if (ids.length > 0) {
        activeAssistantIndex = out.length - 1;
        expectedToolIds = new Set(ids);
        matchedToolIds = new Set();
      }
      continue;
    }

    if (message.role === 'tool') {
      const id = String(message.tool_call_id || '').trim();
      if (id && expectedToolIds.has(id)) {
        out.push({ ...message });
        matchedToolIds.add(id);
        continue;
      }
      finalizeActiveAssistant();
      out.push({ role: 'assistant', content: toolResultNote(message), at: message.at });
      continue;
    }

    finalizeActiveAssistant();
    out.push({ ...message });
  }

  finalizeActiveAssistant();
  return out;
}

function buildLocalSummary(messages) {
  const goal = [];
  const constraints = [];
  const changedFiles = new Set();
  const verification = [];
  const openThreads = [];
  const limit = 16;
  for (const msg of messages.slice(-limit)) {
    if (msg.role === 'tool') {
      const text = textFromContent(msg.content);
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (parsed && typeof parsed === 'object') {
        const summary = summarizeToolResult(parsed);
        if (parsed.path) changedFiles.add(String(parsed.path));
        if (parsed.command || parsed.code != null || parsed.stderr || parsed.stdout) {
          verification.push(summary);
        } else {
          openThreads.push(`tool_result: ${summary}`);
        }
      } else {
        const clipped = text.length > 120 ? `${text.slice(0, 117)}...` : text;
        const match = clipped.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):\d+/);
        if (match) changedFiles.add(match[1]);
        openThreads.push(`tool_result: ${clipped}`);
      }
      continue;
    }
    if (msg.role === 'assistant') {
      const text = textFromContent(msg.content).replace(/\s+/g, ' ').trim();
      const toolCallCount = Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0;
      const toolInfo = toolCallCount > 0 ? ` [called ${toolCallCount} tool(s)]` : '';
      const clipped = text.length > 300 ? `${text.slice(0, 297)}...` : text;
      if (clipped) openThreads.push(`assistant: ${clipped}${toolInfo}`);
      continue;
    }
    if (msg.role === 'user') {
      const text = textFromContent(msg.content).replace(/\s+/g, ' ').trim();
      const clipped = text.length > 200 ? `${text.slice(0, 197)}...` : text;
      if (goal.length === 0) goal.push(clipped);
      else constraints.push(clipped);
      continue;
    }
    const text = textFromContent(msg.content).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const clipped = text.length > 160 ? `${text.slice(0, 157)}...` : text;
    openThreads.push(`${msg.role}: ${clipped}`);
  }
  const lines = [
    'Context Summary',
    'Goal:',
    goal.length > 0 ? `- ${goal[0]}` : '- Unknown from compacted context',
    'Key Constraints:',
    ...(constraints.length > 0 ? constraints.slice(-4).map((item) => `- ${item}`) : ['- None recorded']),
    'Changed Files:',
    ...(changedFiles.size > 0 ? [...changedFiles].slice(0, 8).map((item) => `- ${item}`) : ['- None recorded']),
    'Verification:',
    ...(verification.length > 0 ? verification.slice(-4).map((item) => `- ${item}`) : ['- None recorded']),
    'Open Threads:',
    ...(openThreads.length > 0 ? openThreads.slice(-8).map((item) => `- ${item}`) : ['- None recorded'])
  ];
  return lines.join('\n').trim();
}

/**
 * Build a conversation transcript from messages for LLM summarization input.
 * Includes structured metadata (tool calls, file changes) alongside the text.
 */
export function buildTranscriptForLLM(messages) {
  const parts = [];
  for (const msg of messages) {
    const text = textFromContent(msg.content).replace(/\s+/g, ' ').trim();
    if (!text && !Array.isArray(msg.tool_calls) && msg.role !== 'user') continue;
    if (msg.role === 'user') {
      parts.push(`[User]\n${text.slice(0, 600)}`);
    } else if (msg.role === 'assistant') {
      let block = `[Assistant]\n${text.slice(0, 600)}`;
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const toolNames = msg.tool_calls.map(tc => tc.function?.name || tc.name || 'tool').join(', ');
        block += `\n[Called tools: ${toolNames}]`;
      }
      parts.push(block);
    } else if (msg.role === 'tool') {
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (parsed && typeof parsed === 'object') {
        const summary = summarizeToolResult(parsed);
        parts.push(`[Tool Result]\n${summary.slice(0, 400)}`);
      } else {
        parts.push(`[Tool Result]\n${text.slice(0, 300)}`);
      }
    }
  }
  return parts.join('\n\n');
}

export const COMPACT_SUMMARY_PROMPT = `Summarize the following conversation into a structured context summary that preserves all critical information for continuing the task. Be thorough and specific.

Include:
- The user's goal and requirements
- Key decisions made and reasoning
- Files that were read, modified, or created (with paths)
- Current progress and what remains
- Any errors encountered and how they were resolved
- Important constraints or conventions discovered

If the transcript includes a previous checkpoint, carry forward requirements that still apply and update it with newer progress.
Write in the same language as the conversation. Be concise but do not omit important details.`;

/**
 * Group tool results by their parent assistant message (step boundary).
 * Returns the Set of tool-result indices to KEEP, or null if pruning
 * shouldn't trigger yet (not enough steps).
 *
 * Each assistant message with tool_calls defines a "step". All tool results
 * belonging to the same step are kept or pruned together as a group, so
 * parallel tool calls within the same step are preserved atomically.
 */
function computeStepKeepSet(messages, toolIndices, keepRecent, triggerExtra) {
  // Map tool_call_id → step number (1-based, by assistant message position)
  const toolCallStep = new Map();
  let stepNum = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      stepNum++;
      for (const call of msg.tool_calls) {
        const id = String(call?.id || '').trim();
        if (id) toolCallStep.set(id, stepNum);
      }
    }
  }

  // Assign each tool result to its step group
  // Also track orphans (no matching assistant) — always keep those
  const stepIndices = new Map(); // stepNum → [tool message indices]
  const orphans = [];
  for (const idx of toolIndices) {
    const id = String(messages[idx]?.tool_call_id || '').trim();
    const step = toolCallStep.get(id);
    if (step) {
      if (!stepIndices.has(step)) stepIndices.set(step, []);
      stepIndices.get(step).push(idx);
    } else {
      orphans.push(idx);
    }
  }

  const totalSteps = stepIndices.size;

  // Trigger: prune only when step count exceeds keepRecent + triggerExtra
  if (totalSteps <= keepRecent + Math.max(0, Number(triggerExtra || 0))) {
    return null;
  }

  // Keep the last keepRecent steps — all their tool results stay intact
  const sortedSteps = [...stepIndices.keys()].sort((a, b) => a - b);
  const keepSteps = new Set(sortedSteps.slice(-keepRecent));

  const keepSet = new Set();
  for (const [step, indices] of stepIndices) {
    if (keepSteps.has(step)) {
      for (const idx of indices) keepSet.add(idx);
    }
  }
  // Always keep orphans (tool results without a matching assistant message)
  for (const idx of orphans) keepSet.add(idx);

  return keepSet;
}

/**
 * Micro-compact: in-place clearing of old tool result content.
 * Does NOT change message count or order — only replaces tool result text
 * with a lightweight marker, preserving conversation structure.
 *
 * Strategy inspired by Claude Code's Phase 0 micro-compact:
 * keep recent N tool results intact, clear the rest.
 *
 * When groupByStep is true, tool results are grouped by their parent
 * assistant message (step boundary). All tool results within the same
 * step are kept or pruned together, so parallel tool calls are preserved
 * atomically.
 */
export function microCompactMessages(messages, {
  keepRecent = 5,
  enabled = true,
  replaceWith = 'clear',
  maxSummaryChars = 600,
  summaryTailChars,
  protectedToolNames = [],
  triggerExtra = 0,
  groupByStep = false
} = {}) {
  if (!enabled || !Array.isArray(messages)) {
    return { messages: [...messages], changed: false, tokensSaved: 0 };
  }

  // Collect indices of all tool-role messages
  const toolIndices = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') toolIndices.push(i);
  }

  const protectedNames = new Set(
    (Array.isArray(protectedToolNames) ? protectedToolNames : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  );
  const toolCallNames = protectedNames.size > 0 ? mapToolCallNames(messages) : new Map();

  let keepSet;
  if (groupByStep) {
    keepSet = computeStepKeepSet(messages, toolIndices, keepRecent, triggerExtra);
    if (!keepSet) return { messages: [...messages], changed: false, tokensSaved: 0 };
  } else {
    // Triggered: only prune once the number of tool results exceeds keepRecent
    // plus a configurable buffer (triggerExtra). This avoids rewriting tool
    // payloads on every step, which would invalidate cached prefixes downstream.
    if (toolIndices.length <= keepRecent + Math.max(0, Number(triggerExtra || 0))) {
      return { messages: [...messages], changed: false, tokensSaved: 0 };
    }
    // Indices to keep = last keepRecent tool results
    keepSet = new Set(toolIndices.slice(-keepRecent));
  }

  const clearSet = new Set(toolIndices.filter((idx) => {
    if (keepSet.has(idx)) return false;
    const message = messages[idx];
    const toolName = toolCallNames.get(String(message?.tool_call_id || '').trim()) || '';
    return !protectedNames.has(toolName);
  }));

  if (clearSet.size === 0) {
    return { messages: [...messages], changed: false, tokensSaved: 0 };
  }

  const beforeTokens = estimateMessagesTokens(messages);
  const result = messages.map((msg, i) => {
    if (!clearSet.has(i)) return msg;
    const text = textFromContent(msg.content);
    if (!text || text === MICRO_CLEAR_MARKER || text.startsWith(AGGRESSIVE_PRUNE_MARKER)) return msg;
    const content = replaceWith === 'summary'
      ? buildPrunedToolResultContent(text, { maxSummaryChars, summaryTailChars })
      : MICRO_CLEAR_MARKER;
    return { ...msg, content };
  });
  const afterTokens = estimateMessagesTokens(result);
  const tokensSaved = beforeTokens - afterTokens;

  if (tokensSaved <= 0) {
    return { messages: [...messages], changed: false, tokensSaved: 0 };
  }

  return { messages: result, changed: true, tokensSaved };
}

export function isAggressiveToolPruneBetaEnabled(config = {}) {
  return config.context?.aggressive_tool_prune_beta === true;
}

/**
 * Beta: proactively replace older tool results with structured summaries.
 * Keeps only the most recent N steps intact for exact recall (parallel tool
 * calls within a step are grouped together), and only triggers when the
 * step count exceeds keepRecent + triggerExtra so cached prefixes are not
 * invalidated on every step.
 */
export function applyAggressiveToolPruneBeta(messages, config = {}) {
  if (!isAggressiveToolPruneBetaEnabled(config)) {
    return { messages: [...(messages || [])], changed: false, tokensSaved: 0 };
  }
  const ctx = config.context || {};
  const keepRecent = Math.floor(finiteNumber(ctx.aggressive_tool_prune_keep_recent, 3, 1));
  const triggerExtra = Math.floor(finiteNumber(ctx.aggressive_tool_prune_trigger_extra, 2, 0));
  const summaryHeadChars = Math.floor(finiteNumber(ctx.aggressive_tool_prune_summary_head, 600, 80));
  const summaryTailChars = Math.floor(finiteNumber(ctx.aggressive_tool_prune_summary_tail, 240, 0));
  return microCompactMessages(messages, {
    keepRecent,
    enabled: true,
    replaceWith: 'summary',
    maxSummaryChars: summaryHeadChars + summaryTailChars,
    summaryTailChars,
    protectedToolNames: ['skill', 'tasks'],
    triggerExtra,
    groupByStep: true
  });
}

export async function compactMessagesLocally(messages, { mode = 'default', force = false, generateSummary = null } = {}) {
  const keepRecent = modeToKeepRecent(mode);
  if (!Array.isArray(messages) || messages.length <= 1) {
    return {
      compacted: [...(messages || [])],
      changed: false
    };
  }
  // Skip compact when message count is low enough to keep all, unless forced
  if (!force && messages.length <= keepRecent + 1) {
    return {
      compacted: [...(messages || [])],
      changed: false
    };
  }

  const recentStart = expandRecentStartToToolBoundary(messages, Math.max(0, messages.length - keepRecent));
  const older = messages.slice(0, recentStart);
  const recent = sanitizeRecentMessagesForModel(messages.slice(recentStart));

  let summary;
  if (typeof generateSummary === 'function') {
    try {
      summary = await generateSummary(older);
    } catch {
      summary = buildLocalSummary(older);
    }
  } else {
    summary = buildLocalSummary(older);
  }

  const compacted = [{
    role: 'assistant',
    content: summary,
    compaction: { kind: 'summary', suppress: true },
  }, ...recent];
  const boundaryIndex = recentStart;

  return {
    compacted,
    changed: true,
    summary,
    boundaryIndex
  };
}

export function contextWindowTokens(config = {}) {
  const modelCap = Number(config?.model?.max_context_tokens);
  if (Number.isFinite(modelCap) && modelCap > 0) return modelCap;
  const legacy = Number(config?.context?.max_tokens);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return 32000;
}

function positiveRatio(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(4, Math.max(0.25, parsed));
}

export function calibrationRatio(measuredTokens, estimatedTokens) {
  const measured = Number(measuredTokens);
  const estimated = Number(estimatedTokens);
  if (!(measured > 0) || !(estimated > 0)) return 1;
  return positiveRatio(measured / estimated, 1);
}

/**
 * Parse `context.buffer`: a share such as "15%" or "12.5%" (1%–99%), or a
 * token count. Invalid values, and a count at least as large as the window,
 * are ignored so the reserve fallback can apply. Matches opencode.
 */
export function parseContextBuffer(buffer, window) {
  if (buffer == null || buffer === '') return null;
  const size = Number(window);
  let tokens;
  if (typeof buffer === 'string') {
    const raw = buffer.trim();
    const percent = raw.match(/^([1-9]\d?(?:\.\d+)?)%$/);
    if (percent) tokens = Math.round((size * Number.parseFloat(percent[1])) / 100);
    else if (/^\d+$/.test(raw)) tokens = Number(raw);
    else return null;
  } else {
    tokens = Number(buffer);
    if (!Number.isFinite(tokens) || tokens < 0) return null;
    tokens = Math.round(tokens);
  }
  if (!(size > 0) || !Number.isFinite(tokens) || !(tokens < size)) return null;
  return tokens;
}

export function isAutoCompactEnabled(config = {}) {
  return config?.context?.auto_compact !== false;
}

/**
 * Room kept free below the window before auto-compact, matching opencode
 * `calculateCeiling`: max(RESERVE_MIN, RESERVE_SHARE of the window) when the
 * window can spare RESERVE_MIN, otherwise the share only. A configured
 * `context.buffer` ("15%" or a token count) overrides that default. A
 * configured output limit replaces the reserve when it is larger and still
 * leaves room. `context.reserve_share` and `context.reserve_min` override
 * the defaults when buffer is unset or ignored.
 */
export function calculateReserve(window, config = {}) {
  const size = Number(window);
  if (!(size > 0)) return 0;
  const share = finiteNumber(config?.context?.reserve_share, RESERVE_SHARE, 0);
  const min = finiteNumber(config?.context?.reserve_min, RESERVE_MIN, 0);
  const shareReserve = Math.floor(size * share);
  const minReserve = size >= 2 * min ? min : 0;
  const fromBuffer = parseContextBuffer(config?.context?.buffer, size);
  let reserve = fromBuffer != null ? fromBuffer : Math.max(shareReserve, minReserve);
  const output = finiteNumber(config?.model?.max_output_tokens, 0, 0);
  if (output > reserve && output < size) reserve = output;
  if (!(reserve < size)) {
    reserve = shareReserve > 0 && shareReserve < size ? shareReserve : Math.floor(size * RESERVE_SHARE);
  }
  return Math.max(0, reserve);
}

export function calculateCeiling(window, config = {}) {
  const size = Number(window);
  if (!(size > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(1, size - calculateReserve(size, config));
}

/**
 * Trigger tokens are the opencode ceiling (window minus buffer / reserve).
 * Legacy `context.preflight_trigger_pct` is ignored. Target sits at
 * `compact_target_ratio` (default 60%) of the trigger so a compact does not
 * immediately fire again.
 */
export function resolveCompactBudget(config = {}) {
  const window = contextWindowTokens(config);
  const ceiling = calculateCeiling(window, config);
  const trigger = ceiling;
  const ratio = Math.min(0.95, finiteNumber(config?.context?.compact_target_ratio, 0.6, 0.05));
  const targetPct = Number(config?.context?.compact_target_pct);
  const fromPct = window > 0 && Number.isFinite(targetPct) && targetPct > 0
    ? Math.floor(window * targetPct / 100)
    : Math.floor(trigger * ratio);
  const target = Math.max(1, Math.min(trigger - 1, fromPct));
  return { window, ceiling, trigger, target };
}

export function isCompactionSummary(message) {
  return message?.compaction?.kind === 'summary';
}

export function isContextOverflowError(error) {
  if (!error) return false;
  const code = String(error.code || error.error?.code || error.cause?.code || '').toLowerCase();
  if (
    code.includes('context_length')
    || code.includes('context_overflow')
    || code === 'payload_too_large'
  ) return true;
  const status = Number(error.status || error.statusCode || error.error?.status);
  if (status === 413) return true;
  const nested = typeof error.error === 'string' ? error.error : error.error?.message;
  const msg = `${error.message || ''} ${nested || ''}`.toLowerCase();
  if (/gateway error 413\b/.test(msg)) return true;
  return /context length|context window|maximum context|prompt is too long|too many tokens|max(?:imum)? context|context_length_exceeded|input is too long|exceeds the context|payload too large|request too large|token limit exceeded|reduce the length/.test(msg);
}

export function measurementDeltaIndex(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index;
  }
  return messages.length;
}

export function formatCompactDivider({ beforePct = 0, afterPct = 0, mode = '', language = 'zh' } = {}) {
  const before = Math.max(0, Math.round(Number(beforePct) || 0));
  const after = Math.max(0, Math.round(Number(afterPct) || 0));
  const english = language === 'en';
  const lead = english ? COMPACT_DONE_SUMMARY_EN : COMPACT_DONE_SUMMARY;
  const modeLabel = mode === 'prune'
    ? (english ? 'prune' : '裁剪')
    : mode === 'summary'
      ? (english ? 'summary' : '摘要')
      : '';
  const range = `${before}% → ${after}%`;
  return modeLabel ? `${lead} · ${range} · ${modeLabel}` : `${lead} · ${range}`;
}

function isPrunedToolContent(text) {
  const value = String(text || '');
  return value === MICRO_CLEAR_MARKER
    || value === PRUNE_OUTPUT_PLACEHOLDER
    || value.startsWith(AGGRESSIVE_PRUNE_MARKER);
}

function stripUsage(messages) {
  return messages.map((message) => {
    if (!message || !Object.prototype.hasOwnProperty.call(message, 'usage')) return message;
    const { usage, ...rest } = message;
    return rest;
  });
}

/**
 * Usage of the prompt we are about to send.
 * A provider measurement covers messages before `measuredIndex`; everything
 * after that, plus `extraTokens` (the pending user turn), is estimated and
 * scaled by the calibration ratio. With no measurement, the whole transcript
 * is estimated and `overheadTokens` (system prompt and tool definitions that
 * are not already in the messages) is added once.
 */
export function estimatePromptUsage({
  messages = [],
  measuredTokens = 0,
  measuredIndex = -1,
  overheadTokens = 0,
  extraTokens = 0,
  calibrationRatio: ratioInput = 1,
} = {}) {
  const ratio = positiveRatio(ratioInput, 1);
  const measured = Number(measuredTokens);
  const extra = Math.max(0, Number(extraTokens) || 0);
  const overhead = Math.max(0, Number(overheadTokens) || 0);
  if (measured > 0 && measuredIndex >= 0) {
    const delta = estimateMessagesTokens(messages.slice(measuredIndex));
    return Math.round(measured + delta * ratio + extra);
  }
  if (measured > 0) return Math.round(measured + extra);
  return Math.round((estimateMessagesTokens(messages) + overhead) * ratio + extra);
}

function pruneMinimumTokens(config, window) {
  const absolute = finiteNumber(config?.context?.prune_minimum, PRUNE_MINIMUM, 0);
  const pct = finiteNumber(config?.context?.prune_minimum_pct, 0.1, 0);
  return Math.max(absolute, Math.floor(Math.max(0, Number(window) || 0) * pct));
}

/**
 * Clear old tool outputs, and large tool-call inputs that belong to them.
 * The newest `prune_protect_tokens` (default 40k) of tool output stay verbatim.
 * Tool output older than `prune_protect_turns` (default 2) user turns is also
 * eligible, which is what opencode's prune does past the protected tail.
 * Inside one long turn the token budget still wins, so a single turn can be
 * pruned once it passes 40k. Nothing is rewritten unless the savings reach
 * max(prune_minimum, prune_minimum_pct of the window).
 */
export function pruneToolPayloads(messages, {
  protectTurns = 2,
  protectTokens = PRUNE_PROTECT,
  minimumSavings = PRUNE_MINIMUM,
  clearToolInputs = true,
  inputClearMinTokens = 500,
  protectedToolNames = ['skill', 'tasks'],
} = {}) {
  const source = Array.isArray(messages) ? messages : [];
  if (source.length === 0) return { messages: source, changed: false, tokensSaved: 0 };
  const protectedNames = new Set(
    (Array.isArray(protectedToolNames) ? protectedToolNames : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  );
  const toolCallNames = mapToolCallNames(source);
  let userTurns = 0;
  let toolTokens = 0;
  const clearIndexes = [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (isCompactionSummary(message)) break;
    if (message?.role === 'user') {
      userTurns += 1;
      continue;
    }
    if (message?.role !== 'tool') continue;
    const text = textFromContent(message.content);
    if (isPrunedToolContent(text)) break;
    const toolName = toolCallNames.get(String(message.tool_call_id || '').trim()) || '';
    const tokens = estimateTextTokens(text);
    if (protectedNames.has(toolName)) {
      toolTokens += tokens;
      continue;
    }
    toolTokens += tokens;
    const beyondTurns = userTurns >= Math.max(0, Number(protectTurns) || 0);
    const beyondTokens = toolTokens > Math.max(0, Number(protectTokens) || 0);
    if (beyondTurns || beyondTokens) clearIndexes.push(index);
  }
  if (clearIndexes.length === 0) return { messages: [...source], changed: false, tokensSaved: 0 };
  const clearSet = new Set(clearIndexes);
  const clearedIds = new Set(
    clearIndexes
      .map((index) => String(source[index]?.tool_call_id || '').trim())
      .filter(Boolean)
  );
  const before = estimateMessagesTokens(source);
  let changed = false;
  const result = source.map((message, index) => {
    if (message?.role === 'tool' && clearSet.has(index)) {
      changed = true;
      return { ...message, content: PRUNE_OUTPUT_PLACEHOLDER };
    }
    if (!clearToolInputs || message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) return message;
    let callChanged = false;
    const toolCalls = message.tool_calls.map((call) => {
      const id = getToolCallId(call);
      if (!id || !clearedIds.has(id)) return call;
      const argText = toolCallArgumentText(call);
      if (argText.includes(PRUNE_INPUT_PLACEHOLDER)) return call;
      if (estimateTextTokens(argText) < inputClearMinTokens) return call;
      callChanged = true;
      const nextArgs = JSON.stringify({ _compacted: PRUNE_INPUT_PLACEHOLDER });
      if (call?.function) return { ...call, function: { ...call.function, arguments: nextArgs } };
      return { ...call, arguments: nextArgs };
    });
    if (!callChanged) return message;
    changed = true;
    return { ...message, tool_calls: toolCalls };
  });
  const tokensSaved = before - estimateMessagesTokens(result);
  if (!changed || tokensSaved < minimumSavings) {
    return { messages: [...source], changed: false, tokensSaved: 0 };
  }
  return { messages: result, changed: true, tokensSaved };
}

function selectRecentStart(messages, keepTokens) {
  const budget = Math.max(0, Number(keepTokens) || 0);
  let total = 0;
  let start = messages.length;
  while (start > 0) {
    const next = total + estimateMessagesTokens([messages[start - 1]]);
    if (next > budget) break;
    total = next;
    start -= 1;
  }
  start = expandRecentStartToToolBoundary(messages, start);
  if (start === 0) {
    const anchor = messages.findLastIndex((message) => message?.role === 'user'
      && !message.model_context && !isCompactionSummary(message));
    if (anchor > 0) start = anchor;
  }
  return start;
}

function resolveKeepTokens(budget, config, aggressive) {
  const configured = finiteNumber(
    aggressive ? config?.context?.summary_keep_tokens_aggressive : config?.context?.summary_keep_tokens,
    aggressive ? SUMMARY_KEEP_TOKENS_AGGRESSIVE : SUMMARY_KEEP_TOKENS,
    200
  );
  const cap = Math.max(50, Math.floor(budget.target * (aggressive ? 0.35 : 0.7)));
  return Math.min(configured, cap);
}

function clipTranscript(value) {
  const text = String(value || '');
  if (text.length <= TRANSCRIPT_CLIP) return text;
  const half = Math.floor(TRANSCRIPT_CLIP / 2);
  const omitted = text.length - TRANSCRIPT_CLIP;
  return `${text.slice(0, half)}\n[… ${omitted} characters omitted …]\n${text.slice(-half)}`;
}

function renderTranscriptMessage(message, level) {
  if (!message || level >= 4) return '';
  if (level >= 3 && message.role !== 'user') return '';
  const lines = [];
  const text = textFromContent(message.model_content || message.content).trim();
  if (isCompactionSummary(message) && level < 4) {
    return `[Previous checkpoint]: ${level >= 3 ? clipTranscript(text) : text}`;
  }
  if (message.role === 'user' || message.role === 'assistant') {
    const body = level >= 3 ? clipTranscript(text) : text;
    if (body) lines.push(`[${message.role === 'user' ? 'User' : 'Assistant'}]: ${body}`);
  }
  if (level < 3 && Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      const name = getToolCallName(call) || 'tool';
      const args = toolCallArgumentText(call);
      const shown = level >= 2 ? clipTranscript(args) : args;
      lines.push(`[Assistant tool call]: ${name}(${shown})`);
    }
  }
  if (message.role === 'tool' && level < 3) {
    if (level >= 2) lines.push('[Tool result omitted]');
    else lines.push(`[Tool result]: ${level >= 1 ? clipTranscript(text) : text}`);
  }
  return lines.join('\n');
}

/**
 * One transcript for the single summary call. Oldest exchanges are shortened
 * first (full → clipped outputs → outputs dropped → user text only → omitted),
 * matching opencode's graded summary fallback, instead of a hard 12k cut.
 */
export function buildGradedTranscript(messages, { maxChars = 80_000, maxTokens = Infinity } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const groups = [];
  for (const message of source) {
    if (!message) continue;
    if (message.role === 'user' || groups.length === 0) groups.push([message]);
    else groups[groups.length - 1].push(message);
  }
  const renders = groups.map((group) => [0, 1, 2, 3, 4].map((level) => {
    const text = group.map((message) => renderTranscriptMessage(message, level)).filter(Boolean).join('\n');
    return { text, chars: text.length + 2, tokens: estimateTextTokens(text) + 1 };
  }));
  if (!renders.length) return '';
  const selected = renders.map((variants) => variants[0]);
  let chars = selected.reduce((sum, item) => sum + item.chars, 0);
  let tokens = selected.reduce((sum, item) => sum + item.tokens, 0);
  for (const level of [1, 2, 3, 4]) {
    for (let index = 0; index < renders.length && (chars > maxChars || tokens > maxTokens); index += 1) {
      if (index === renders.length - 1 && level === 4) continue;
      const next = renders[index][level];
      chars += next.chars - selected[index].chars;
      tokens += next.tokens - selected[index].tokens;
      selected[index] = next;
    }
  }
  const omitted = selected.filter((item) => !item.text).length;
  const note = omitted ? `[${omitted} older exchanges omitted]\n\n` : '';
  const text = note + selected.map((item) => item.text).filter(Boolean).join('\n\n');
  if (text.length <= maxChars && estimateTextTokens(text) <= maxTokens) return text;
  const limit = Math.min(maxChars, Math.floor(text.length * maxTokens / Math.max(1, estimateTextTokens(text))));
  let shortened = limit > 0 ? text.slice(-limit) : '';
  while (shortened.length > maxChars || estimateTextTokens(shortened) > maxTokens) {
    shortened = shortened.slice(Math.max(1, Math.floor(shortened.length / 8)));
  }
  return shortened;
}

async function summarizePrefix(older, generateSummary, summaries, boundaryIndex, signal) {
  if (summaries.has(boundaryIndex)) return summaries.get(boundaryIndex);
  let summary;
  if (typeof generateSummary === 'function') {
    try {
      summary = await generateSummary(older);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  if (!summary) {
    const previous = older.findLast(isCompactionSummary);
    const local = buildLocalSummary(older.filter((message) => !isCompactionSummary(message)));
    summary = previous ? `${clipTranscript(textFromContent(previous.content))}\n\n${local}` : local;
  }
  summaries.set(boundaryIndex, summary);
  return summary;
}

function splitLeadingSystemMessages(messages = []) {
  let index = 0;
  while (index < messages.length && messages[index]?.role === 'system') index += 1;
  return {
    system: messages.slice(0, index),
    body: messages.slice(index),
  };
}

/**
 * Compress the live transcript between model calls.
 * Prune old tool payloads first. Summarize (one model call, local fallback)
 * only when the projected result is still above the target. A summary message
 * is flagged so a stale pre-summary measurement cannot immediately compact again.
 * Open tool calls that are still waiting for results stay untouched.
 */
export async function compactInFlightMessages(messages, config = {}, inputTokens = 0, options = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const opts = typeof options === 'function' ? { generateSummary: options } : (options || {});
  const generateSummary = opts.generateSummary;
  const onStart = typeof opts.onStart === 'function' ? opts.onStart : null;
  const force = opts.force === true;
  const budget = resolveCompactBudget(config);
  const unchanged = {
    messages: source,
    changed: false,
    mode: '',
    threshold: 0,
    beforePct: 0,
    afterPct: 0,
    tokensSaved: 0,
    estimatedTokens: 0,
    summaryCalls: opts.summaryCache?.size || 0,
  };
  const summaryGuarded = source.some((message) => isCompactionSummary(message));
  const measuredIndex = Number.isInteger(opts.measuredIndex) ? opts.measuredIndex : -1;
  if (!force && summaryGuarded && opts.measuredFresh !== true && measuredIndex < 0 && Number(inputTokens) > 0) {
    return { ...unchanged, skipped: 'summary' };
  }

  const usage = estimatePromptUsage({
    messages: source,
    measuredTokens: Number(inputTokens) || 0,
    measuredIndex,
    overheadTokens: opts.overheadTokens,
    extraTokens: opts.extraTokens,
    calibrationRatio: opts.calibrationRatio,
  });
  const beforePct = budget.window > 0 ? Math.round((usage / budget.window) * 100) : 0;
  unchanged.threshold = beforePct;
  unchanged.beforePct = beforePct;
  unchanged.estimatedTokens = usage;
  const target = Number.isFinite(Number(opts.targetTokens)) && Number(opts.targetTokens) > 0
    ? Math.floor(Number(opts.targetTokens))
    : budget.target;
  // Manual /compact always runs. Auto and overflow recovery follow
  // opencode: both are skipped when compaction.auto / context.auto_compact is off.
  if (opts.manual !== true && !isAutoCompactEnabled(config)) {
    return { ...unchanged, skipped: 'auto-off' };
  }
  if (!force && (!(usage > 0) || usage < budget.trigger)) return unchanged;

  const { system, body } = splitLeadingSystemMessages(source);
  const pending = body[body.length - 1];
  if (pending?.role === 'assistant' && Array.isArray(pending.tool_calls) && pending.tool_calls.length > 0) {
    return unchanged;
  }

  const overhead = Math.max(0, Number(opts.overheadTokens) || 0);
  const extra = Math.max(0, Number(opts.extraTokens) || 0);
  const localOf = (nextBody) => estimateMessagesTokens([...system, ...nextBody]) + overhead;
  const beforeLocal = localOf(body);
  const scale = beforeLocal > 0 ? positiveRatio((usage - extra) / beforeLocal, 1) : 1;
  const project = (afterLocal) => Math.round(afterLocal * scale + extra);

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    onStart?.({ beforePct });
  };

  let working = body;
  let workingLocal = beforeLocal;
  let mode = '';
  let changed = false;
  let boundaryIndex;
  let projected = usage;
  let summaryText = '';
  const summaryCache = opts.summaryCache ?? new Map();

  const microEnabled = opts.skipPrune !== true && (opts.pruneOnly === true || config?.context?.microcompact_enabled !== false);
  if (microEnabled) {
    const protectedTools = Array.isArray(config?.context?.prune_protected_tools)
      ? config.context.prune_protected_tools
      : ['skill', 'tasks'];
    const pruned = pruneToolPayloads(working, {
      protectTurns: finiteNumber(config?.context?.prune_protect_turns, 2, 0),
      protectTokens: finiteNumber(config?.context?.prune_protect_tokens, PRUNE_PROTECT, 0),
      minimumSavings: force && opts.pruneOnly === true
        ? 1
        : pruneMinimumTokens(config, budget.window),
      protectedToolNames: protectedTools,
      inputClearMinTokens: finiteNumber(config?.context?.prune_input_min_tokens, 500, 0),
    });
    const prunedLocal = beforeLocal - pruned.tokensSaved;
    if (pruned.changed && project(prunedLocal) < projected) {
      start();
      working = pruned.messages;
      workingLocal = prunedLocal;
      mode = 'prune';
      changed = true;
      projected = project(prunedLocal);
      if (opts.pruneOnly === true || projected <= target) {
        return finish();
      }
    }
  }

  if (opts.pruneOnly === true) return changed ? finish() : unchanged;

  const hardPct = finiteNumber(config?.context?.hard_limit_pct, 98, 1);
  const aggressive = opts.aggressive === true
    || opts.mode === 'aggressive'
    || (budget.window > 0 && (usage / budget.window) * 100 >= hardPct);
  const user = working.findLast((message) => message?.role === 'user'
    && !message.model_context && !isCompactionSummary(message));
  let keep = resolveKeepTokens({ ...budget, target: Math.max(1, target - extra) }, config, aggressive);
  let recentStart = selectRecentStart(working, keep);
  while (keep > 0 && (recentStart === 0 || (recentStart === 1 && body[0] === user))) {
    keep = Math.floor(keep / 2);
    recentStart = selectRecentStart(working, keep);
  }
  const older = body.slice(0, recentStart);
  // Keep the active user request verbatim even when the tail starts inside that turn.
  if (older.some((message) => message !== user)) {
    start();
    summaryText = await summarizePrefix(older, generateSummary, summaryCache, recentStart, opts.signal);
    opts.signal?.throwIfAborted();
    const retainedUser = user && older.includes(user) ? [user] : [];
    const summarized = [
      { role: 'user', content: `<conversation-checkpoint>\n${summaryText}\n</conversation-checkpoint>`, compaction: { kind: 'summary' } },
      ...retainedUser,
      ...sanitizeRecentMessagesForModel(working.slice(recentStart)),
    ];
    const nextLocal = localOf(summarized);
    const nextProjected = project(nextLocal);
    if (nextLocal < workingLocal && nextProjected < projected) {
      working = summarized;
      workingLocal = nextLocal;
      boundaryIndex = system.length + recentStart;
      mode = 'summary';
      changed = true;
      projected = nextProjected;
    }
  }

  if (!changed) return unchanged;
  return finish();

  function finish() {
    const compactedMessages = stripUsage([...system, ...working]);
    const afterUsage = projected;
    const afterPct = budget.window > 0 ? Math.round((afterUsage / budget.window) * 100) : 0;
    const divider = {
      beforePct,
      afterPct,
      mode: mode === 'prune' ? 'prune' : 'summary',
    };
    return {
      messages: compactedMessages,
      changed: true,
      mode: divider.mode,
      threshold: beforePct,
      beforePct,
      afterPct,
      tokensSaved: beforeLocal - workingLocal,
      estimatedTokens: afterUsage,
      boundaryIndex,
      boundaryMessage: source[boundaryIndex],
      summaryText: summaryText || '',
      summaryCalls: summaryCache.size,
      summary: formatCompactDivider({ ...divider, language: 'zh' }),
      summaryEn: formatCompactDivider({ ...divider, language: 'en' }),
    };
  }
}

export function parseCompactArgs(args = []) {
  const parsed = {
    mode: 'default',
    preview: false,
    restore: false,
    micro: false,
    auto: undefined,
    threshold: undefined
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--preview') parsed.preview = true;
    if (arg === '--restore') parsed.restore = true;
    if (arg === '--micro') parsed.micro = true;
    if (arg === '--aggressive') parsed.mode = 'aggressive';
    if (arg === '--conservative') parsed.mode = 'conservative';
    if (arg === '--default') parsed.mode = 'default';
    if (arg === '--auto-on') parsed.auto = 'on';
    if (arg === '--auto-off') parsed.auto = 'off';
    if (arg === '--threshold') {
      const n = Number(args[i + 1]);
      if (!Number.isNaN(n)) parsed.threshold = n;
      i += 1;
    }
  }

  return parsed;
}
