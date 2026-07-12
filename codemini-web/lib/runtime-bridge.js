import { ApprovalManager } from './approval-manager.js';
import { UserInputManager } from './user-input-manager.js';
import { summarizeToolResult } from '../../src/core/tool-result-store.js';
import { formatToolLabel } from '../../src/core/tool-display.js';
import {
  hasToolInSegments,
  updateToolInMessages,
  upsertToolCardInSegments,
} from '../shared/tool-segments.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSessionsDir } from '../../src/core/paths.js';
import { CHAT_ACTIONS } from '../../src/core/chat-action-dispatcher.js';

const CODEWIKI_GENERATE_TIMEOUT_MS = 35 * 60 * 1000;

function webTranscriptPath(sessionId) {
  return path.join(getSessionsDir(), 'web-ui-transcripts', `${String(sessionId || 'unknown')}.json`);
}

function parseToolContent(content) {
  if (typeof content !== 'string') return content;
  const text = content.trim();
  if (!text) return '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function summarizeHistoricalToolMessage(message) {
  const explicit = String(message?.tool_summary || '').trim();
  if (explicit) return explicit;
  return summarizeToolResult(parseToolContent(message?.content || ''));
}

function stripPlanProgressText(text) {
  return String(text || '').replace(/(?:^|\n)\[plan\]\s+Step\s+\d+\/\d+\s+->[^\n]*\n?/g, '');
}

function isAbortLikeError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const message = String(err.message || err || '').trim();
  return /operation was aborted|request aborted|request released/i.test(message);
}

function isWorkflowControlLine(line = '', state = {}) {
  const trimmed = String(line || '').trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return false;
  if (['/yes', '/no', '/reject', 'yes', 'y', 'approve', 'approved', 'no', 'n'].includes(lower)) return true;
  if (lower.startsWith('/edit ')) return true;
  if (/^\/(?:plan|spec|reflect)(?:\s|$)/i.test(trimmed)) return true;
  return false;
}

function appendUniqueSkillBadges(current = [], next = []) {
  const out = Array.isArray(current) ? [...current] : [];
  const seen = new Set(out.map((badge) => `${String(badge?.status || 'done')}::${String(badge?.name || '').trim()}`));
  for (const badge of Array.isArray(next) ? next : []) {
    const key = `${String(badge?.status || 'done')}::${String(badge?.name || '').trim()}`;
    if (!String(badge?.name || '').trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(badge);
  }
  return out;
}

function selectedSkillBadgesFromNames(names = []) {
  return [...new Set(
    (Array.isArray(names) ? names : [])
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  )].map((name) => ({ name, status: 'selected' }));
}

function skillBadgesFromSessionMessage(message = {}) {
  const explicit = Array.isArray(message.skillBadges)
    ? message.skillBadges
    : Array.isArray(message.skill_badges)
      ? message.skill_badges
      : [];
  const normalized = [];
  for (const badge of explicit) {
    const status = String(badge?.status || 'selected').trim() || 'selected';
    if (status !== 'selected' && status !== 'always') continue;
    for (const rawName of String(badge?.name || '').split(',')) {
      const name = rawName.trim();
      if (name) normalized.push({ name, status });
    }
  }
  if (normalized.length) return appendUniqueSkillBadges([], normalized);
  const names = Array.isArray(message.selectedSkillNames)
    ? message.selectedSkillNames
    : Array.isArray(message.selected_skill_names)
      ? message.selected_skill_names
      : [];
  return selectedSkillBadgesFromNames(names);
}

function createSkillSegment(event, status = 'running') {
  const now = new Date().toISOString();
  return {
    type: 'skill',
    name: event.name,
    status,
    startedAt: event.startedAt || now,
    ...(status === 'done' || status === 'error'
      ? { endedAt: event.endedAt || now }
      : {}),
    ...(status === 'error' && event.summary ? { summary: event.summary } : {})
  };
}

function addSkillToSegments(segments, event) {
  const source = Array.isArray(segments) ? segments : [];
  const existingIndex = source.findIndex(
    (segment) => segment?.type === 'skill' && segment.name === event.name
  );
  if (existingIndex === -1) return [...source, createSkillSegment(event)];
  return source.map((segment, index) => (
    index === existingIndex ? createSkillSegment(event) : segment
  ));
}

function updateSkillInSegments(segments, name, updater) {
  const source = Array.isArray(segments) ? segments : [];
  let targetIndex = -1;
  for (let i = source.length - 1; i >= 0; i -= 1) {
    const segment = source[i];
    if (segment?.type === 'skill' && segment.name === name && segment.status === 'running') {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) return source;
  return source.map((segment, index) => (index === targetIndex ? updater(segment) : segment));
}

function updatePendingSkillSegments(segments, name, updater) {
  return updateSkillInSegments(segments, name, updater);
}

function appendTextSegment(segments, delta, isStreaming = true) {
  const value = String(delta || '');
  if (!value) return segments || [];
  const current = Array.isArray(segments) ? segments : [];
  const now = new Date().toISOString();
  const last = current[current.length - 1];
  if (last?.type === 'text') {
    return [
      ...current.slice(0, -1),
      { ...last, text: `${last.text || ''}${value}`, isStreaming, startedAt: last.startedAt || now }
    ];
  }
  return [...current, { type: 'text', text: value, isStreaming, startedAt: now }];
}

function replaceTextSegment(segments, text, isStreaming = false) {
  const value = String(text || '');
  const current = Array.isArray(segments) ? segments : [];
  const index = current.length - 1;
  if (current[index]?.type !== 'text') return value ? [...current, { type: 'text', text: value, isStreaming, startedAt: new Date().toISOString() }] : current;
  return current.map((seg, i) => (
    i === index ? { ...seg, text: value, isStreaming, startedAt: seg.startedAt || new Date().toISOString() } : seg
  ));
}

function appendThinkingSegment(segments, delta, isStreaming = true) {
  const value = String(delta || '');
  if (!value) return segments || [];
  const current = Array.isArray(segments) ? segments : [];
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const last = current[current.length - 1];
  if (last?.type === 'thinking') {
    const startedAt = last.startedAt || now;
    return [
      ...current.slice(0, -1),
      {
        ...last,
        text: `${last.text || ''}${value}`,
        isStreaming,
        startedAt,
        endedAt: isStreaming ? null : (last.endedAt || now),
        durationMs: Math.max(Number(last.durationMs || 0), nowMs - Date.parse(startedAt))
      }
    ];
  }
  return [...current, { type: 'thinking', text: value, isStreaming, startedAt: now, endedAt: isStreaming ? null : now, durationMs: isStreaming ? 0 : null }];
}

function resolveThinkingDurationMs(seg, endedAt) {
  const explicit = Number(seg?.durationMs);
  const startMs = Date.parse(seg?.startedAt || '');
  const endMs = Date.parse(seg?.endedAt || endedAt || '');
  const measured = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null;
  if (Number.isFinite(explicit) && measured != null) return Math.max(explicit, measured);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  return measured;
}

function finishThinkingSegments(segments) {
  const endedAt = new Date().toISOString();
  return (Array.isArray(segments) ? segments : []).map((seg) => (
    seg.type === 'thinking'
      ? {
          ...seg,
          isStreaming: false,
          endedAt: seg.endedAt || endedAt,
          durationMs: resolveThinkingDurationMs(seg, endedAt)
        }
      : seg
  ));
}

function getReasoningTextFromAssistantMessage(message = {}) {
  if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
    return message.reasoning_content.trim();
  }
  if (!Array.isArray(message.reasoning_details)) return '';
  return message.reasoning_details
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      if (block.type === 'thinking') return block.thinking || block.text || '';
      if (block.type === 'reasoning' || block.type === 'reasoning_content') return block.text || block.reasoning_content || '';
      if (block.type === 'redacted_thinking') return '[redacted thinking]';
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function hasThinkingSegment(segments) {
  return (Array.isArray(segments) ? segments : []).some((seg) => seg.type === 'thinking' && String(seg.text || '').trim());
}

function normalizeUiUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const out = {};
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'cacheMissInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'requests']) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value)) out[key] = Math.max(0, Math.round(value));
  }
  return Object.keys(out).length ? out : null;
}

function mergeUiUsage(left, right) {
  const a = normalizeUiUsage(left);
  const b = normalizeUiUsage(right);
  if (!a) return b;
  if (!b) return a;
  const out = {};
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'cacheMissInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'requests']) {
    out[key] = Math.max(0, Math.round(Number(a[key] || 0) + Number(b[key] || 0)));
  }
  return out;
}

function toCodeWikiGenerateProgress(event) {
  if (!event?.type) return null;
  const now = new Date().toISOString();
  if (event.type === 'plan:steps') {
    return {
      type: 'codewiki:generate_progress',
      phase: 'steps',
      timestamp: now,
      steps: (Array.isArray(event.steps) ? event.steps : []).map((step, index) => ({
        index: Number(step.index || index + 1),
        title: step.title || '',
        role: step.role || 'general',
        status: step.status || 'pending'
      }))
    };
  }
  if (event.type === 'plan:step_start') {
    return {
      type: 'codewiki:generate_progress',
      phase: 'step_start',
      timestamp: now,
      step: Number(event.step || 0),
      total: Number(event.total || 0),
      role: event.role || 'general',
      title: event.title || '',
      status: 'running'
    };
  }
  if (event.type === 'plan:step_done' || event.type === 'plan:progress') {
    return {
      type: 'codewiki:generate_progress',
      phase: event.type === 'plan:step_done' ? 'step_done' : 'step_progress',
      timestamp: now,
      step: Number(event.step || 0),
      total: Number(event.total || 0),
      role: event.role || 'general',
      title: event.title || '',
      status: event.status || (event.type === 'plan:step_done' ? 'done' : 'running'),
      summary: event.summary || ''
    };
  }
  if (event.type === 'skill:start' || event.type === 'skill:end' || event.type === 'skill:error') {
    return {
      type: 'codewiki:generate_progress',
      phase: event.type.replace('skill:', 'skill_'),
      timestamp: now,
      name: event.name || 'project-requirements',
      status: event.type === 'skill:error' ? 'failed' : event.type === 'skill:end' ? 'done' : 'running',
      summary: event.summary || ''
    };
  }
  return null;
}

function createPlanStepUiMessage(event) {
  return {
    id: `plan-step-${event.step}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: event.role || 'general',
    text: '',
    segments: [],
    skillBadges: [],
    fileChanges: [],
    timestamp: new Date().toISOString(),
    planStep: {
      step: event.step,
      total: event.total,
      role: event.role || 'general',
      title: event.title || '',
      model: event.model || '',
      status: 'running',
      summary: ''
    }
  };
}

function createPlanOverviewUiMessage(event) {
  const steps = (event.steps || []).map((s, i) => ({
    index: s.index ?? (i + 1),
    title: s.title || '',
    role: s.role || 'general',
    status: s.status || 'pending'
  }));
  return {
    id: `plan-overview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'plan-overview',
    text: event.goal || '',
    segments: [],
    skillBadges: [],
    fileChanges: [],
    timestamp: new Date().toISOString(),
    planOverview: {
      goal: event.goal || '',
      steps
    }
  };
}

export class RuntimeBridge {
  #runtime = null;
  #clients = new Set();
  #approval = new ApprovalManager();
  #userInput = new UserInputManager();
  #busy = false;
  #codeWikiGenerating = false;
  #startupConsumed = false;
  #uiMessages = [];
  #uiActiveMsgId = null;
  #aggressivePruneSaved = 0;
  #uiPlanStepIds = new Map();
  #uiPlanOverviewId = null;
  #uiPendingSkillBadges = [];
  #uiPendingSkillSegments = [];
  #uiTranscriptSessionId = '';
  #uiPersisting = false;
  #uiPersistQueued = false;
  #activeSubmitLine = '';
  #runStatusRecorded = false;
  #submitToken = 0;
  #operationSequence = 0;
  #activeStructuredOperationId = null;
  #sessionId = '';
  #onEvent = null;
  #onLifecycle = null;

  #isSubmitActive(token) {
    return token === this.#submitToken;
  }

  #invalidateSubmit() {
    this.#submitToken += 1;
    return this.#submitToken;
  }

  constructor(runtime, {
    sessionId = runtime.getCurrentSessionId?.(),
    onEvent = null,
    onLifecycle = null
  } = {}) {
    this.#runtime = runtime;
    this.#sessionId = String(sessionId || '');
    this.#onEvent = onEvent;
    this.#onLifecycle = onLifecycle;
    this.#installApprovalHandler();
    this.#uiTranscriptSessionId = this.getSessionId();
    runtime.setOnTitleUpdate?.((sessionId, title) => {
      this.#publish({ type: 'session:title', sessionId, title });
    });
  }

  #installApprovalHandler() {
    this.#runtime.setRequestToolApproval((request) => {
      const { id, name, displayName, arguments: args, approvalDetails } = request;
      const pending = this.#approval.create(id);
      this.#publish({ type: 'approval:request', id, toolName: name, displayName, arguments: args, details: approvalDetails });
      return pending;
    });
    this.#runtime.setRequestUserInput?.((form) => {
      const id = `user-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const request = { ...form, id };
      const pending = this.#userInput.create(id, form);
      this.#publish({ type: 'user-input:request', request });
      this.#broadcastRuntimeState();
      return pending;
    });
  }

  #publish(event) {
    const tagged = { ...event, sessionId: this.#sessionId };
    this.#onEvent?.(tagged);
    this.#broadcast(tagged);
    if (event?.type === 'approval:request') {
      this.#publishLifecycle('waiting_approval', event.id);
    } else if (event?.type === 'user-input:request') {
      this.#publishLifecycle('waiting_input', event.request?.id);
    }
  }

  #publishLifecycle(status, requestId = null) {
    // Never terminal-settle the Pool RUN while an interaction is still open.
    // Otherwise completed can consume the lifecycle waiter before waiting_*,
    // and the UI falls into RECOVERED_FALLBACK forever for this turn.
    if (
      (status === 'completed' || status === 'failed' || status === 'aborted') &&
      (this.#approval.pendingCount > 0 || this.#userInput.pendingCount > 0)
    ) {
      return;
    }
    this.#onLifecycle?.({
      sessionId: this.#sessionId,
      status,
      ...(requestId ? { requestId } : {})
    });
  }

  #broadcast(event) {
    const tagged = event?.sessionId === this.#sessionId
      ? event
      : { ...event, sessionId: this.#sessionId };
    if (tagged !== event) this.#onEvent?.(tagged);
    const data = `data: ${JSON.stringify(tagged)}\n\n`;
    for (const res of this.#clients) {
      try { res.write(data); } catch {}
    }
  }

  #broadcastRuntimeState() {
    this.#publish({ type: 'runtime:state', state: this.getState() });
  }

  broadcastRuntimeState() {
    this.#broadcastRuntimeState();
  }

  async #writeUiTranscriptSnapshot() {
    const sessionId = this.getSessionId();
    if (!sessionId) return;
    try {
      const filePath = webTranscriptPath(sessionId);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({
        sessionId,
        updatedAt: new Date().toISOString(),
        messages: this.#uiMessages
      }), 'utf8');
    } catch {}
  }

  #persistUiTranscriptSoon() {
    this.#uiPersistQueued = true;
    if (this.#uiPersisting) return;
    this.#uiPersisting = true;
    (async () => {
      while (this.#uiPersistQueued) {
        this.#uiPersistQueued = false;
        await this.#writeUiTranscriptSnapshot();
      }
      this.#uiPersisting = false;
    })();
  }

  #resetUiTranscriptIfSessionChanged() {
    const sessionId = this.getSessionId();
    if (sessionId === this.#uiTranscriptSessionId) return;
    this.#uiTranscriptSessionId = sessionId;
    this.#uiMessages = [];
    this.#uiActiveMsgId = null;
    this.#uiPlanStepIds = new Map();
    this.#uiPlanOverviewId = null;
    this.#uiPendingSkillBadges = [];
    this.#uiPendingSkillSegments = [];
    this.#aggressivePruneSaved = 0;
  }

  #addUiMessage(message) {
    const next = {
      ...message,
      id: message.id || `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      segments: Array.isArray(message.segments)
        ? message.segments
        : (message.text ? [{ type: 'text', text: message.text, isStreaming: false }] : []),
      skillBadges: Array.isArray(message.skillBadges) ? message.skillBadges : [],
      fileChanges: Array.isArray(message.fileChanges) ? message.fileChanges : []
    };
    this.#uiMessages = [...this.#uiMessages, next];
    this.#persistUiTranscriptSoon();
    return next.id;
  }

  #updateUiMessage(id, mapper) {
    if (!id) return;
    this.#uiMessages = this.#uiMessages.map((message) => message.id === id ? mapper(message) : message);
    this.#persistUiTranscriptSoon();
  }

  #updateUiToolCard(tool, updater, mapMessage = null) {
    const result = updateToolInMessages(this.#uiMessages, tool, updater);
    if (!result.updated) return false;
    this.#uiMessages = typeof mapMessage === 'function'
      ? result.messages.map((message) => hasToolInSegments(message.segments, tool) ? mapMessage(message) : message)
      : result.messages;
    this.#persistUiTranscriptSoon();
    return true;
  }

  #removeUiTransientWaiting() {
    this.#uiMessages = this.#uiMessages.filter((message) => message.transientKey !== 'waiting-response');
  }

  #markUiMessageManualAborted() {
    const mark = (id) => {
      if (!id) return false;
      return this.#updateUiMessage(id, (message) => ({
        ...message,
        manualAborted: true,
        isComplete: true
      }));
    };
    if (mark(this.#uiActiveMsgId)) return this.#uiActiveMsgId;
    const lastAssistant = [...this.#uiMessages]
      .reverse()
      .find((message) =>
        message?.role !== 'you' &&
        message?.role !== 'divider' &&
        message?.role !== 'system' &&
        !message?.transientKey
      );
    if (lastAssistant?.id) mark(lastAssistant.id);
    return lastAssistant?.id || '';
  }

  #addUiRunStatusMessage(text, { status = 'error', retryPrompt = '' } = {}) {
    const messageText = String(text || '').trim();
    if (!messageText) return '';
    if (status === 'aborted') {
      return this.#markUiMessageManualAborted();
    }
    return this.#addUiMessage({
      role: 'error',
      text: messageText,
      timestamp: new Date().toISOString(),
      responseStatus: status,
      retryPrompt: String(retryPrompt || ''),
      retryable: status === 'error' && Boolean(String(retryPrompt || '').trim())
    });
  }

  async #persistRunStatus(text, { status = 'error', retryPrompt = '' } = {}) {
    const messageText = String(text || '').trim();
    if (!messageText) return;
    try {
      await this.#runtime.persistRunStatus?.(retryPrompt, messageText, { status });
    } catch {}
  }

  async #recordRunStatus(text, { status = 'error', retryPrompt = '' } = {}) {
    if (this.#runStatusRecorded) return;
    this.#runStatusRecorded = true;
    this.#addUiRunStatusMessage(text, { status, retryPrompt });
    await this.#persistRunStatus(text, { status, retryPrompt });
  }

  #lastUserMessageId() {
    for (let i = this.#uiMessages.length - 1; i >= 0; i--) {
      if (this.#uiMessages[i].role === 'you') return this.#uiMessages[i].id;
    }
    return null;
  }

  #recordUiEvent(event) {
    if (!event?.type) return null;
    this.#resetUiTranscriptIfSessionChanged();
    const activeId = this.#uiActiveMsgId;

    switch (event.type) {
      case 'assistant:start': {
        this.#removeUiTransientWaiting();
        const pendingSkillBadges = this.#uiPendingSkillBadges;
        const pendingSkillSegments = this.#uiPendingSkillSegments;
        this.#uiPendingSkillBadges = [];
        this.#uiPendingSkillSegments = [];
        if (!activeId) {
          this.#uiActiveMsgId = this.#addUiMessage({
            role: 'general',
            text: '',
            timestamp: new Date().toISOString(),
            skillBadges: pendingSkillBadges,
            segments: pendingSkillSegments,
            isComplete: false
          });
        } else {
          this.#updateUiMessage(activeId, (message) => ({
            ...message,
            isComplete: false,
            skillBadges: appendUniqueSkillBadges(message.skillBadges || [], pendingSkillBadges),
            segments: pendingSkillSegments.length
              ? [...pendingSkillSegments, ...(Array.isArray(message.segments) ? message.segments : [])]
              : message.segments
          }));
        }
        break;
      }
      case 'assistant:delta': {
        const delta = stripPlanProgressText(event.text);
        if (this.#uiActiveMsgId && delta) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: appendTextSegment(finishThinkingSegments(message.segments), delta, true)
          }));
        }
        break;
      }
      case 'assistant:reasoning_delta': {
        if (this.#uiActiveMsgId && event.text) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: appendThinkingSegment(message.segments, event.text, true)
          }));
        }
        break;
      }
      case 'assistant:response': {
        const reasoningText = getReasoningTextFromAssistantMessage(event.assistantMessage);
        if (this.#uiActiveMsgId && reasoningText) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: hasThinkingSegment(message.segments)
              ? message.segments
              : appendThinkingSegment(message.segments, reasoningText, false)
          }));
        }
        if (this.#uiActiveMsgId && event.text) {
          const text = stripPlanProgressText(event.text);
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: text
              ? replaceTextSegment(finishThinkingSegments(message.segments), text, false)
              : message.segments
          }));
        }
        if (this.#uiActiveMsgId) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: finishThinkingSegments(message.segments),
            usage: mergeUiUsage(message.usage, event.usage || event.assistantMessage?.usage) || message.usage || null
          }));
        }
        break;
      }
      case 'tool:start': {
        if (this.#uiActiveMsgId) {
          const toolCard = {
            id: event.id,
            name: event.name,
            displayName: event.displayName || formatToolLabel(event.name),
            arguments: event.arguments,
            status: 'running',
            startedAt: event.startedAt || new Date().toISOString(),
            durationMs: null,
            summary: '',
            result: ''
          };
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: upsertToolCardInSegments(finishThinkingSegments(message.segments), toolCard)
          }));
        }
        break;
      }
      case 'tool:end': {
        const eventChanges = Array.isArray(event.fileChanges) && event.fileChanges.length
          ? event.fileChanges
          : (event.fileChange?.path ? [event.fileChange] : []);
        this.#updateUiToolCard(
          event,
          (card) => ({
            ...card,
            id: event.id || card.id,
            name: event.name || card.name,
            displayName: event.displayName || card.displayName,
            status: 'done',
            durationMs: event.durationMs,
            summary: event.summary || card.summary,
            ...(event.resultMeta ? { resultMeta: event.resultMeta } : {}),
            ...(event.fileChange ? { fileChange: event.fileChange } : {}),
            ...(eventChanges.length ? { fileChanges: eventChanges } : {})
          }),
          (message) => ({
            ...message,
            fileChanges: eventChanges.length
              ? [...(Array.isArray(message.fileChanges) ? message.fileChanges : []), ...eventChanges]
              : (Array.isArray(message.fileChanges) ? message.fileChanges : [])
          })
        );
        break;
      }
      case 'tool:result': {
        this.#updateUiToolCard(event, (card) => ({
          ...card,
          id: event.id || card.id,
          name: event.name || card.name,
          displayName: event.displayName || card.displayName,
          result: event.content || ''
        }));
        break;
      }
      case 'tool:error': {
        this.#updateUiToolCard(event, (card) => ({
          ...card,
          id: event.id || card.id,
          name: event.name || card.name,
          displayName: event.displayName || card.displayName,
          status: 'error',
          durationMs: event.durationMs,
          summary: event.summary || card.summary
        }));
        break;
      }
      case 'tool:blocked': {
        this.#updateUiToolCard(event, (card) => ({
          ...card,
          id: event.id || card.id,
          name: event.name || card.name,
          displayName: event.displayName || card.displayName,
          status: 'blocked',
          summary: card.summary || 'Tool blocked'
        }));
        break;
      }
      case 'plan:steps': {
        if (this.#uiActiveMsgId) {
          this.#uiMessages = this.#uiMessages.filter((message) => {
            if (message.id !== this.#uiActiveMsgId) return true;
            return message.planStep || (Array.isArray(message.segments) && message.segments.length > 0);
          });
          this.#uiActiveMsgId = null;
          this.#persistUiTranscriptSoon();
        }
        this.#uiPlanStepIds = new Map();
        const overviewMsg = createPlanOverviewUiMessage(event);
        this.#uiPlanOverviewId = overviewMsg.id;
        this.#uiMessages = [...this.#uiMessages.filter((message) => message.transientKey !== 'waiting-response'), overviewMsg];
        this.#persistUiTranscriptSoon();
        break;
      }
      case 'plan:step_start': {
        const key = String(event.step);
        let msgId = this.#uiPlanStepIds.get(key);
        if (!msgId) {
          const message = createPlanStepUiMessage(event);
          msgId = message.id;
          this.#uiPlanStepIds.set(key, msgId);
          this.#uiMessages = [...this.#uiMessages.filter((message) => message.transientKey !== 'waiting-response'), message];
          this.#persistUiTranscriptSoon();
        } else {
          this.#updateUiMessage(msgId, (message) => ({
            ...message,
            planStep: {
              ...(message.planStep || {}),
              status: 'running',
              ...(event.model ? { model: event.model } : {})
            }
          }));
        }
        this.#uiActiveMsgId = msgId;
        if (this.#uiPlanOverviewId) {
          this.#updateUiMessage(this.#uiPlanOverviewId, (message) => {
            if (!message.planOverview) return message;
            return {
              ...message,
              planOverview: {
                ...message.planOverview,
                steps: message.planOverview.steps.map((s, i) =>
                  i === event.step - 1 ? { ...s, status: 'running' } : s
                )
              }
            };
          });
        }
        break;
      }
      case 'plan:progress': {
        if (event.model) {
          const msgId = this.#uiPlanStepIds.get(String(event.step));
          if (msgId) {
            this.#updateUiMessage(msgId, (message) => ({
              ...message,
              planStep: {
                ...(message.planStep || {}),
                ...(event.status ? { status: event.status } : {}),
                model: event.model
              }
            }));
          }
        }
        if (this.#uiPlanOverviewId) {
          this.#updateUiMessage(this.#uiPlanOverviewId, (message) => {
            if (!message.planOverview) return message;
            return {
              ...message,
              planOverview: {
                ...message.planOverview,
                steps: message.planOverview.steps.map((s, i) =>
                  i === event.step - 1 ? { ...s, status: event.status || s.status } : s
                )
              }
            };
          });
        }
        break;
      }
      case 'plan:step_done': {
        const msgId = this.#uiPlanStepIds.get(String(event.step));
        if (msgId) {
          this.#updateUiMessage(msgId, (message) => ({
            ...message,
            usage: normalizeUiUsage(event.usage) || message.usage || null,
            segments: (() => {
              const outputText = String(event.output || '').trim();
              const finishedSegments = message.segments.map((seg) => (
                seg.type === 'text' ? { ...seg, isStreaming: false } : seg
              ));
              const hasOutputText = outputText && finishedSegments.some((seg) =>
                (seg.type === 'text' || seg.type === 'handoff') &&
                String(seg.text || '').trim() === outputText
              );
              if (!outputText || hasOutputText) return finishedSegments;
              return [
                ...finishedSegments,
                {
                  type: String(event.role || message.planStep?.role || '').toLowerCase() === 'summarizer'
                    ? 'text'
                    : 'handoff',
                  text: outputText,
                  isStreaming: false
                }
              ];
            })(),
            planStep: {
              ...(message.planStep || {}),
              status: event.status || 'done',
              summary: event.summary || ''
            }
          }));
        }
        if (this.#uiPlanOverviewId) {
          this.#updateUiMessage(this.#uiPlanOverviewId, (message) => {
            if (!message.planOverview) return message;
            return {
              ...message,
              planOverview: {
                ...message.planOverview,
                steps: message.planOverview.steps.map((s, i) =>
                  i === event.step - 1 ? { ...s, status: event.status || 'done' } : s
                )
              }
            };
          });
        }
        break;
      }
      case 'compact:auto': {
        this.#addUiMessage({
          role: 'divider',
          dividerType: 'compact',
          text: `以上内容已压缩 (${event.mode || ''}, ${event.threshold || ''}%)`,
          timestamp: new Date().toISOString()
        });
        break;
      }
      case 'compact:aggressive-prune': {
        // Beta aggressive prune runs proactively every step; stay silent in the
        // transcript to avoid divider spam. Callers that want visibility can
        // surface this via runtime activity.
        break;
      }
      case 'skill:start': {
        if (this.#uiActiveMsgId) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: addSkillToSegments(finishThinkingSegments(message.segments), event)
          }));
        } else {
          this.#uiPendingSkillSegments = addSkillToSegments(
            this.#uiPendingSkillSegments,
            event
          );
        }
        break;
      }
      case 'skill:end': {
        const endedAt = event.endedAt || new Date().toISOString();
        if (this.#uiActiveMsgId) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: updateSkillInSegments(message.segments, event.name, (segment) => ({
              ...segment,
              status: 'done',
              endedAt
            }))
          }));
        } else {
          this.#uiPendingSkillSegments = updatePendingSkillSegments(
            this.#uiPendingSkillSegments,
            event.name,
            (segment) => ({ ...segment, status: 'done', endedAt })
          );
        }
        break;
      }
      case 'skill:error': {
        const endedAt = event.endedAt || new Date().toISOString();
        if (this.#uiActiveMsgId) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: updateSkillInSegments(message.segments, event.name, (segment) => ({
              ...segment,
              status: 'error',
              summary: event.summary,
              endedAt
            }))
          }));
        } else {
          this.#uiPendingSkillSegments = updatePendingSkillSegments(
            this.#uiPendingSkillSegments,
            event.name,
            (segment) => ({
              ...segment,
              status: 'error',
              summary: event.summary,
              endedAt
            })
          );
        }
        break;
      }
      case 'skill:always': {
        const names = (event.names || []).join(', ');
        if (!names) break;
        const badge = {
          name: names,
          status: 'always',
          startedAt: event.startedAt || new Date().toISOString()
        };
        if (this.#uiActiveMsgId) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            skillBadges: appendUniqueSkillBadges(message.skillBadges || [], [badge])
          }));
        } else {
          this.#uiPendingSkillBadges = appendUniqueSkillBadges(
            this.#uiPendingSkillBadges,
            [badge]
          );
        }
        // Also attach to the last user message so the badge appears on
        // the user's own bubble alongside the assistant response.
        const userMsgId = this.#lastUserMessageId();
        if (userMsgId && userMsgId !== this.#uiActiveMsgId) {
          this.#updateUiMessage(userMsgId, (message) => ({
            ...message,
            skillBadges: appendUniqueSkillBadges(message.skillBadges || [], [badge])
          }));
        }
        break;
      }
      default:
        break;
    }
    return (
      String(event.type).startsWith('assistant:') ||
      String(event.type).startsWith('tool:') ||
      String(event.type).startsWith('skill:')
    )
      ? this.#uiActiveMsgId
      : null;
  }

  addClient(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', sessionId: this.#sessionId })}\n\n`);
    this.#clients.add(res);
    res.on('close', () => this.#clients.delete(res));
  }

  removeClient(res) {
    return this.#clients.delete(res);
  }

  async handleStartupEvents() {
    if (this.#startupConsumed) return [];
    this.#startupConsumed = true;
    return this.#runtime.consumeStartupEvents();
  }

  handleSubmit(line, options = {}) {
    if (this.#busy) return { error: true, message: 'A request is already in progress' };
    this.#resetUiTranscriptIfSessionChanged();
    const trimmed = String(line || '').trim();
    if (!options?.readOnlyCodeWiki && trimmed && !isWorkflowControlLine(trimmed, this.getState())) {
      this.#addUiMessage({
        role: 'you',
        text: line,
        attachments: Array.isArray(options.attachments) ? options.attachments : [],
        timestamp: new Date().toISOString()
      });
    }
    this.#busy = true;
    this.#publishLifecycle('running');
    this.#uiPendingSkillBadges = [];
    this.#uiPendingSkillSegments = [];
    const submitToken = this.#invalidateSubmit();
    this.#activeSubmitLine = line;
    this.#runStatusRecorded = false;
    this.#runtime.submit(line, (event) => {
      if (!this.#isSubmitActive(submitToken)) return;
      const messageId = this.#recordUiEvent(event);
      this.#publish(messageId ? { ...event, messageId } : event);
      if (['spec:pending_approval', 'reflect:pending_approval'].includes(event?.type)) {
        this.#busy = false;
        this.#broadcastRuntimeState();
      }
    }, options).then(async (result) => {
      if (!this.#isSubmitActive(submitToken)) return;
      if (this.#uiActiveMsgId) {
        this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
          ...message,
          isComplete: true,
          segments: finishThinkingSegments(message.segments)
            .map((seg) => seg.type === 'text' ? { ...seg, isStreaming: false } : seg)
        }));
      }
      this.#uiActiveMsgId = null;
      this.#uiPlanStepIds = new Map();
      let suppressDone = false;
      if (result?.aborted) {
        const text = result?.text ? `Aborted: ${result.text}` : 'Aborted: Request aborted.';
        suppressDone = this.#runStatusRecorded;
        await this.#recordRunStatus(text, { status: 'aborted', retryPrompt: line });
      }
      if (suppressDone) return;
      this.#publish({ type: 'submit:done', result: { type: result.type, aborted: result.aborted, text: result.text } });
      this.#publishLifecycle(result?.aborted ? 'aborted' : 'completed');
    }).catch(async (err) => {
      if (!this.#isSubmitActive(submitToken)) return;
      if (isAbortLikeError(err)) {
        if (!this.#runStatusRecorded) {
          await this.#recordRunStatus('Aborted: Request aborted.', { status: 'aborted', retryPrompt: line });
          this.#publish({
            type: 'submit:done',
            result: { type: 'aborted', aborted: true, text: 'Request aborted.' }
          });
        }
        this.#publishLifecycle('aborted');
        return;
      }
      const text = `Failed: ${err.message}`;
      await this.#recordRunStatus(text, { status: 'error', retryPrompt: line });
      this.#publish({ type: 'submit:done', result: { type: 'error', text: err.message, retryPrompt: line } });
      this.#publishLifecycle('failed');
    }).finally(() => {
      if (!this.#isSubmitActive(submitToken)) return;
      this.#busy = false;
      this.#activeSubmitLine = '';
      this.#broadcastRuntimeState();
    });
    return { accepted: true };
  }

  #handleStructuredRun(run, { userMessage = null, retryPrompt = '', selectedSkillNames = [] } = {}) {
    if (this.#busy) {
      return { accepted: false, error: true, code: 'BUSY', message: 'A request is already in progress' };
    }
    this.#resetUiTranscriptIfSessionChanged();
    const selectedSkills = [...new Set(
      (Array.isArray(selectedSkillNames) ? selectedSkillNames : [])
        .map((name) => String(name || '').trim())
        .filter(Boolean)
    )];
    const selectedBadges = selectedSkills.map((name) => ({
      name,
      status: 'selected'
    }));
    if (userMessage) {
      this.#addUiMessage({
        id: userMessage.id,
        role: 'you',
        text: userMessage.text,
        attachments: userMessage.attachments || [],
        skillBadges: selectedBadges,
        timestamp: new Date().toISOString()
      });
    }
    this.#busy = true;
    this.#publishLifecycle('running');
    this.#uiPendingSkillBadges = [];
    this.#uiPendingSkillSegments = [];
    const submitToken = this.#invalidateSubmit();
    const operationId = `chat-${Date.now()}-${++this.#operationSequence}`;
    this.#activeStructuredOperationId = operationId;
    const onAgentEvent = (event) => {
      if (!this.#isSubmitActive(submitToken)) return;
      const messageId = this.#recordUiEvent(event);
      this.#publish(messageId ? { ...event, messageId } : event);
    };
    Promise.resolve().then(() => run(onAgentEvent)).then((result) => {
      if (!this.#isSubmitActive(submitToken)) return;
      if (this.#uiActiveMsgId) {
        this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
          ...message,
          isComplete: true,
          segments: finishThinkingSegments(message.segments)
            .map((seg) => seg.type === 'text' ? { ...seg, isStreaming: false } : seg)
        }));
      }
      this.#uiActiveMsgId = null;
      this.#uiPlanStepIds = new Map();
      this.#publish({ type: 'submit:done', operationId, result });
      this.#publishLifecycle(result?.aborted || result?.type === 'aborted' ? 'aborted' : 'completed');
    }).catch(async (err) => {
      if (!this.#isSubmitActive(submitToken)) return;
      await this.#recordRunStatus(`Failed: ${err.message}`, {
        status: 'error',
        retryPrompt
      });
      this.#publish({
        type: 'submit:done',
        operationId,
        result: { type: 'error', text: err.message, retryPrompt }
      });
      this.#publishLifecycle(isAbortLikeError(err) ? 'aborted' : 'failed');
    }).finally(() => {
      if (!this.#isSubmitActive(submitToken)) return;
      if (this.#activeStructuredOperationId === operationId) {
        this.#activeStructuredOperationId = null;
      }
      this.#busy = false;
      this.#broadcastRuntimeState();
    });
    this.#broadcastRuntimeState();
    return { accepted: true, operationId };
  }

  handleSubmitMessage(message = {}) {
    const text = String(message.text || '');
    return this.#handleStructuredRun(
      (onAgentEvent) => this.#runtime.submitMessage(message, onAgentEvent),
      {
        userMessage: {
          id: message.messageId,
          text,
          attachments: Array.isArray(message.attachments) ? message.attachments : []
        },
        selectedSkillNames: message.skillNames,
        retryPrompt: text
      }
    );
  }

  handleAction(action = {}) {
    const isApprovalDecision = action?.name === CHAT_ACTIONS.APPROVAL_APPROVE
      || action?.name === CHAT_ACTIONS.APPROVAL_REJECT;
    if (isApprovalDecision) {
      const requestId = String(action?.payload?.requestId || '').trim();
      const approved = action?.name === CHAT_ACTIONS.APPROVAL_APPROVE;
      const resolved = this.resolveApproval(requestId, approved, action?.payload?.reason || '');
      if (!resolved) {
        const hasOtherPendingApproval = this.hasPendingApproval();
        return {
          accepted: false,
          error: true,
          code: hasOtherPendingApproval ? 'STALE_ACTION' : 'NO_PENDING_APPROVAL',
          message: hasOtherPendingApproval
            ? 'Stale approval request id'
            : 'No matching approval request is pending'
        };
      }
      return {
        accepted: true,
        result: {
          type: 'approval',
          approved,
          requestId
        }
      };
    }
    return this.#handleStructuredRun(
      (onAgentEvent) => this.#runtime.dispatchAction(action, { onAgentEvent })
    );
  }

  handleCodeWikiGenerate(line) {
    if (this.#busy) return { error: true, message: 'A request is already in progress' };
    this.#busy = true;
    this.#publishLifecycle('running');
    const submitToken = this.#invalidateSubmit();
    const requestRuntime = this.#runtime;
    this.#codeWikiGenerating = true;
    let terminalPublished = false;
    const publishTerminal = (status) => {
      if (terminalPublished) return;
      terminalPublished = true;
      this.#publishLifecycle(status);
    };
    this.#broadcastRuntimeState();
    const emitProgress = (event) => {
      if (timedOut || !this.#isSubmitActive(submitToken)) return;
      try {
        const progress = toCodeWikiGenerateProgress(event);
        if (progress) this.#publish(progress);
      } catch {}
    };
    // Keep this above the model gateway timeout used by the runtime. Large CodeWiki
    // generations can legitimately exceed ten minutes.
    let timedOut = false;
    const safetyTimer = setTimeout(() => {
      if (!this.#busy || !this.#isSubmitActive(submitToken)) return;
      timedOut = true;
      publishTerminal('failed');
      this.#invalidateSubmit();
      try { requestRuntime.abort?.(); } catch {}
      this.#busy = false;
      this.#codeWikiGenerating = false;
      this.#publish({ type: 'codewiki:generate_error', message: 'CodeWiki generation timed out' });
      this.#broadcastRuntimeState();
    }, CODEWIKI_GENERATE_TIMEOUT_MS);
    const clearSafetyTimer = () => clearTimeout(safetyTimer);
    requestRuntime.submitCodeWiki(line, emitProgress, { codeWikiGenerate: true }).then((result) => {
      clearSafetyTimer();
      if (timedOut || !this.#isSubmitActive(submitToken)) return;
      if (result?.aborted) {
        this.#broadcast({
          type: 'codewiki:generate_error',
          message: result?.text || 'CodeWiki generation failed'
        });
        publishTerminal('aborted');
        return;
      }
      this.#broadcast({
        type: 'codewiki:generate_done',
        result: {
          type: result?.type || 'assistant',
          aborted: !!result?.aborted,
          text: result?.text || ''
        }
      });
      publishTerminal('completed');
    }).catch((err) => {
      clearSafetyTimer();
      if (timedOut || !this.#isSubmitActive(submitToken)) return;
      this.#broadcast({
        type: 'codewiki:generate_error',
        message: err?.message || 'CodeWiki generation failed'
      });
      publishTerminal(isAbortLikeError(err) ? 'aborted' : 'failed');
    }).finally(() => {
      clearSafetyTimer();
      if (timedOut || !this.#isSubmitActive(submitToken)) return;
      this.#busy = false;
      this.#codeWikiGenerating = false;
      this.#broadcastRuntimeState();
    });
    return { accepted: true };
  }

  async handleCodeWikiAsk(line, onEvent = null) {
    if (this.#busy) return { error: true, message: 'A request is already in progress' };
    this.#busy = true;
    const submitToken = this.#invalidateSubmit();
    const emit = (event) => {
      if (!this.#isSubmitActive(submitToken)) return;
      if (typeof onEvent === 'function' && event?.type) onEvent(event);
    };
    try {
      const result = await this.#runtime.submitCodeWiki(line, emit, { readOnlyCodeWiki: true });
      if (!this.#isSubmitActive(submitToken)) return { error: true, stale: true, message: 'Request superseded' };
      const payload = {
        ok: true,
        type: result?.type || 'assistant',
        text: result?.text || '',
        aborted: !!result?.aborted
      };
      emit({ type: 'codewiki:done', result: payload });
      return payload;
    } catch (err) {
      if (!this.#isSubmitActive(submitToken)) return { error: true, stale: true, message: 'Request superseded' };
      const payload = { error: true, message: err?.message || 'Request failed' };
      emit({ type: 'codewiki:error', message: payload.message });
      return payload;
    } finally {
      if (this.#isSubmitActive(submitToken)) this.#busy = false;
    }
  }

  isBusy() {
    return this.#busy;
  }

  async handleAbort() {
    const retryPrompt = this.#activeSubmitLine;
    const wasBusy = this.#busy;
    const operationId = this.#activeStructuredOperationId;
    this.#activeStructuredOperationId = null;
    this.#userInput.resolveAll({ status: 'skipped', answers: {} });
    this.#approval.resolveAll({ approved: false, reason: 'aborted' });
    if (wasBusy) this.#invalidateSubmit();
    const abortToken = this.#submitToken;
    const aborted = this.#runtime.abort();
    if (wasBusy && !aborted) {
      if (!this.#runStatusRecorded) {
        const text = 'Aborted: Request released.';
        await this.#recordRunStatus(text, { status: 'aborted', retryPrompt });
        this.#broadcast({
          type: 'submit:done',
          ...(operationId ? { operationId } : {}),
          result: { type: 'aborted', aborted: true, text: 'Request released.' }
        });
      }
      this.#busy = false;
      this.#codeWikiGenerating = false;
      this.#activeSubmitLine = '';
      this.#publishLifecycle('aborted');
      this.#broadcastRuntimeState();
    } else if (wasBusy && aborted) {
      if (!this.#runStatusRecorded) {
        const text = 'Aborted: Request aborted.';
        await this.#recordRunStatus(text, { status: 'aborted', retryPrompt });
        this.#broadcast({
          type: 'submit:done',
          ...(operationId ? { operationId } : {}),
          result: { type: 'aborted', aborted: true, text: 'Request aborted.' }
        });
      }
      this.#publishLifecycle('aborted');
      setTimeout(async () => {
        if (!this.#busy || !this.#isSubmitActive(abortToken)) return;
        this.#busy = false;
        this.#broadcastRuntimeState();
      }, 5000);
    }
    return aborted;
  }

  async setExecutionMode(mode) {
    if (this.#busy) return false;
    const ok = await this.#runtime.setExecutionMode(mode);
    if (ok) this.#publish({ type: 'mode:changed', mode, ...this.getState() });
    return ok;
  }

  async setApprovalMode(mode) {
    if (this.#busy) return false;
    const ok = await this.#runtime.setApprovalMode?.(mode);
    if (ok) this.#publish({ type: 'approval-mode:changed', approvalMode: mode, ...this.getState() });
    return ok;
  }

  async reloadConfig(options = {}) {
    return this.#runtime.reloadConfig?.(options);
  }

  async reloadCommandsAndSkills() {
    const ok = await this.#runtime.reloadCommandsAndSkills?.();
    if (ok) this.#broadcastRuntimeState();
    return ok;
  }

  async updatePendingReflect(patch = {}) {
    const draft = await this.#runtime.updatePendingReflect?.(patch);
    if (draft) this.#publish({ type: 'reflect:pending_approval', draft });
    this.#broadcastRuntimeState();
    return draft || null;
  }

  async updatePendingSpec(patch = {}) {
    const spec = await this.#runtime.updatePendingSpec?.(patch);
    if (spec) this.#publish({ type: 'spec:pending_approval', spec });
    this.#broadcastRuntimeState();
    return spec || null;
  }

  async setPendingSpecFromFile(payload = {}) {
    const spec = await this.#runtime.setPendingSpecFromFile?.(payload);
    if (spec) this.#publish({ type: 'spec:pending_approval', spec });
    this.#broadcastRuntimeState();
    return spec || null;
  }

  async deletePendingSpec() {
    const result = await this.#runtime.deletePendingSpec?.();
    if (result) this.#publish({ type: 'spec:approval_cleared' });
    this.#broadcastRuntimeState();
    return result || null;
  }

  resolveApproval(id, approved, reason = '') {
    const requestId = String(id || '').trim();
    if (!requestId) return false;
    const bridgeResolved = this.#approval.resolve(requestId, approved, reason);
    const runtimeResolved = this.#runtime.resolveToolApproval?.(requestId, {
      approved: Boolean(approved),
      reason
    });
    const resolved = bridgeResolved || runtimeResolved?.ok === true;
    if (!resolved) return false;
    this.#publish({ type: 'approval:resolved', id: requestId, approved: Boolean(approved) });
    this.#publishLifecycle('running', requestId);
    this.#broadcastRuntimeState();
    return true;
  }

  handleApproval(id, approved) {
    return this.resolveApproval(id, approved);
  }

  hasPendingApproval(id) {
    if (id == null || id === '') {
      return this.#approval.pendingCount > 0
        || Boolean(this.#runtime.hasPendingToolApproval?.());
    }
    return this.#approval.has(id) || Boolean(this.#runtime.hasPendingToolApproval?.(id));
  }

  get approvalPendingCount() {
    return this.#approval.pendingCount;
  }

  handleUserInput(id, response) {
    const resolved = this.#userInput.resolve(id, response);
    if (resolved) {
      this.#publish({ type: 'user-input:resolved', id });
      this.#publishLifecycle('running', id);
      this.#broadcastRuntimeState();
    }
    return resolved;
  }

  hasPendingUserInput(id) {
    if (id == null || id === '') return this.#userInput.pendingCount > 0;
    return this.#userInput.has(id);
  }

  get hasOpenUserInput() {
    return this.#userInput.pendingCount > 0;
  }

  getState() {
    const state = this.#runtime.getRuntimeState();
    const serializableState = typeof state?.toJSON === 'function' ? state.toJSON() : state;
    return {
      ...serializableState,
      busy: this.#busy,
      requestInFlight: this.#busy,
      codeWikiGenerating: this.#codeWikiGenerating,
      pendingReflectSkill: serializableState.pendingReflectSkill,
      pendingSpecApproval: serializableState.pendingSpecApproval,
      pendingUserInput: this.#userInput.current
    };
  }

  getSessionMessages() {
    const messages = this.#runtime.getSessionMessages();
    if (!Array.isArray(messages)) return [];
    return messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const selectedSkillNames = Array.isArray(m.selectedSkillNames)
          ? m.selectedSkillNames
          : Array.isArray(m.selected_skill_names)
            ? m.selected_skill_names
            : [];
        return {
          role: m.role,
          content: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map(c => c.text || '').join('') : ''),
          reasoningContent: typeof m.reasoning_content === 'string' ? m.reasoning_content : '',
          reasoningDetails: Array.isArray(m.reasoning_details) ? m.reasoning_details : [],
          reasoningStartedAt: m.reasoning_started_at || null,
          reasoningEndedAt: m.reasoning_ended_at || null,
          reasoningDurationMs: Number.isFinite(Number(m.reasoning_duration_ms)) ? Number(m.reasoning_duration_ms) : null,
          toolCalls: m.tool_calls || [],
          fileChanges: Array.isArray(m.file_changes) ? m.file_changes : [],
          toolCallId: m.tool_call_id || null,
          toolSummary: m.role === 'tool' ? summarizeHistoricalToolMessage(m) : null,
          toolDurationMs: Number.isFinite(Number(m.tool_duration_ms)) ? Number(m.tool_duration_ms) : null,
          toolStatus: m.tool_status || null,
          toolResultMeta: m.tool_result_meta || null,
          toolFileChange: m.tool_file_change || null,
          toolFileChanges: Array.isArray(m.tool_file_changes) ? m.tool_file_changes : [],
          planTranscript: Array.isArray(m.plan_transcript) ? m.plan_transcript : null,
          planGoal: typeof m.plan_goal === 'string' ? m.plan_goal : '',
          planFile: typeof m.plan_file === 'string' ? m.plan_file : '',
          usage: normalizeUiUsage(m.usage),
          responseStatus: typeof m.response_status === 'string' ? m.response_status : '',
          retryPrompt: typeof m.retry_prompt === 'string' ? m.retry_prompt : '',
          selectedSkillNames,
          skillBadges: skillBadgesFromSessionMessage(m),
          at: m.at || null
        };
      });
  }

  getSessionCompactMeta() {
    const compact = this.#runtime.getSessionCompact();
    if (!compact) return null;
    return { boundaryIndex: compact.boundaryIndex, mode: compact.mode, timestamp: compact.timestamp };
  }

  getChangeSets() {
    return this.#runtime.getChangeSets?.() || [];
  }

  getChangeSetPatch(id) {
    return this.#runtime.getChangeSetPatch?.(id) || '';
  }

  async undoChangeSet(id) {
    if (this.#busy) return { error: true, message: 'A request is already in progress' };
    const result = await this.#runtime.undoChangeSet?.(id);
    this.#publish({ type: 'change:undone', result });
    return result || { error: true, message: 'Git change oplog is not available' };
  }

  async undoChangeSets(ids) {
    if (this.#busy) return { error: true, message: 'A request is already in progress' };
    const result = await this.#runtime.undoChangeSets?.(ids);
    this.#publish({ type: 'change:undone', result });
    return result || { error: true, message: 'Git change oplog is not available' };
  }

  async getUiMessages(sessionId = '') {
    const requestedSessionId = String(sessionId || '').trim();
    // Return in-memory messages for the bridge's own session so the
    // caller always sees the freshest state (streaming text, running
    // tools, isComplete flags).  Falls back to the persisted transcript
    // only for cross-session reads, which shouldn't happen in the pool
    // architecture (one bridge per session).
    if (!requestedSessionId || requestedSessionId === this.getSessionId()) {
      this.#resetUiTranscriptIfSessionChanged();
      if (this.#uiMessages.length > 0) return this.#uiMessages;
    }
    const sessionIdToRead = requestedSessionId || this.getSessionId();
    if (!sessionIdToRead) return [];
    try {
      const raw = await fs.readFile(webTranscriptPath(sessionIdToRead), 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.messages) ? parsed.messages : [];
    } catch {
      return [];
    }
  }

  getCompletions(input) {
    return this.#runtime.getCompletionOptions(input);
  }

  getHistory() {
    return this.#runtime.getInputHistory();
  }

  getCommands() {
    return this.#runtime.listCommandNames();
  }

  getSessionId() {
    return this.#runtime.getCurrentSessionId();
  }

  get busy() { return this.#busy; }

  get runtime() { return this.#runtime; }

  async dispose() {
    for (const res of this.#clients) {
      try { res.end(); } catch {}
    }
    this.#clients.clear();
    await this.#runtime.dispose?.();
  }
}
