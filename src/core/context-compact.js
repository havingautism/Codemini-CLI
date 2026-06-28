import { trimInline } from './string-utils.js';
import { summarizeToolResult } from './tool-result-store.js';

const MICRO_CLEAR_MARKER = '[Old tool result cleared by micro-compact]';
export const AGGRESSIVE_PRUNE_MARKER = '[Tool result pruned — summary only]';

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

function finiteNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const message of messages || []) {
    const roleOverhead = 6;
    const text = textFromContent(message.content);
    let asciiChars = 0;
    let nonAsciiChars = 0;
    for (const char of text) {
      if (char.charCodeAt(0) <= 0x7f) asciiChars += 1;
      else nonAsciiChars += 1;
    }
    total += roleOverhead + Math.ceil(asciiChars / 4) + Math.ceil(nonAsciiChars / 2);
  }
  return total;
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
  // Plain-text tool results (e.g. update_todos, read_plan, update_plan) are
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

Write in the same language as the conversation. Be concise but do not omit important details.`;

/**
 * Micro-compact: in-place clearing of old tool result content.
 * Does NOT change message count or order — only replaces tool result text
 * with a lightweight marker, preserving conversation structure.
 *
 * Strategy inspired by Claude Code's Phase 0 micro-compact:
 * keep recent N tool results intact, clear the rest.
 */
export function microCompactMessages(messages, {
  keepRecent = 5,
  enabled = true,
  replaceWith = 'clear',
  maxSummaryChars = 600,
  summaryTailChars,
  triggerExtra = 0
} = {}) {
  if (!enabled || !Array.isArray(messages)) {
    return { messages: [...messages], changed: false, tokensSaved: 0 };
  }

  // Collect indices of all tool-role messages
  const toolIndices = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') toolIndices.push(i);
  }

  // Triggered: only prune once the number of tool results exceeds keepRecent
  // plus a configurable buffer (triggerExtra). This avoids rewriting tool
  // payloads on every step, which would invalidate cached prefixes downstream.
  if (toolIndices.length <= keepRecent + Math.max(0, Number(triggerExtra || 0))) {
    return { messages: [...messages], changed: false, tokensSaved: 0 };
  }

  // Indices to clear = all except the last keepRecent
  const keepSet = new Set(toolIndices.slice(-keepRecent));
  const clearSet = new Set(toolIndices.filter((idx) => !keepSet.has(idx)));

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
 * Keeps only the most recent N tool payloads intact for exact recall, and
 * only triggers when the tool-result count exceeds keepRecent + triggerExtra
 * so cached prefixes are not invalidated on every step.
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
    triggerExtra
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

  const compacted = [{ role: 'assistant', content: summary }, ...recent];
  const boundaryIndex = recentStart;

  return {
    compacted,
    changed: true,
    summary,
    boundaryIndex
  };
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
