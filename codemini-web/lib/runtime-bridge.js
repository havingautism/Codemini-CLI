import { ApprovalManager } from './approval-manager.js';
import { summarizeToolResult } from '../../src/core/tool-result-store.js';
import { formatToolLabel } from '../../src/core/tool-display.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSessionsDir } from '../../src/core/paths.js';

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

function isWorkflowControlLine(line = '', state = {}) {
  const trimmed = String(line || '').trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return false;
  if (['/yes', '/no', '/reject', 'yes', 'y', 'approve', 'approved', 'no', 'n'].includes(lower)) return true;
  if (lower.startsWith('/edit ')) return true;
  if (/^\/(?:plan|spec|reflect)(?:\s|$)/i.test(trimmed)) return true;
  return false;
}

function addToolToSegments(segments, toolCard) {
  if (!Array.isArray(segments) || segments.length === 0) return [{ type: 'tools', cards: [toolCard] }];
  const last = segments[segments.length - 1];
  if (last.type === 'tools') return [...segments.slice(0, -1), { ...last, cards: [...last.cards, toolCard] }];
  return [...segments, { type: 'tools', cards: [toolCard] }];
}

function updateToolInSegments(segments, toolId, updater) {
  return (Array.isArray(segments) ? segments : []).map((seg) => {
    if (seg.type !== 'tools') return seg;
    const idx = seg.cards.findIndex((card) => card.id === toolId);
    if (idx === -1) return seg;
    const cards = [...seg.cards];
    cards[idx] = updater(cards[idx]);
    return { ...seg, cards };
  });
}

function hasToolInSegments(segments, toolId) {
  return (Array.isArray(segments) ? segments : []).some((seg) =>
    seg?.type === 'tools' &&
    Array.isArray(seg.cards) &&
    seg.cards.some((card) => card.id === toolId)
  );
}

function updateToolInMessages(messages, toolId, updater) {
  let updated = false;
  const nextMessages = (Array.isArray(messages) ? messages : []).map((message) => {
    if (!hasToolInSegments(message.segments, toolId)) return message;
    updated = true;
    return {
      ...message,
      segments: updateToolInSegments(message.segments, toolId, updater)
    };
  });
  return { messages: nextMessages, updated };
}

function appendTextSegment(segments, delta, isStreaming = true) {
  const value = String(delta || '');
  if (!value) return segments || [];
  const current = Array.isArray(segments) ? segments : [];
  const last = current[current.length - 1];
  if (last?.type === 'text') {
    return [
      ...current.slice(0, -1),
      { ...last, text: `${last.text || ''}${value}`, isStreaming }
    ];
  }
  return [...current, { type: 'text', text: value, isStreaming }];
}

function replaceTextSegment(segments, text, isStreaming = false) {
  const value = String(text || '');
  const current = Array.isArray(segments) ? segments : [];
  const index = current.findLastIndex((seg) => seg?.type === 'text');
  if (index === -1) return value ? [...current, { type: 'text', text: value, isStreaming }] : current;
  return current.map((seg, i) => (
    i === index ? { ...seg, text: value, isStreaming } : seg
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
  #busy = false;
  #codeWikiGenerating = false;
  #startupConsumed = false;
  #uiMessages = [];
  #uiActiveMsgId = null;
  #uiPlanStepIds = new Map();
  #uiPlanOverviewId = null;
  #uiTranscriptSessionId = '';
  #uiPersisting = false;
  #uiPersistQueued = false;

  constructor(runtime) {
    this.#runtime = runtime;
    this.#installApprovalHandler();
    this.#uiTranscriptSessionId = this.getSessionId();
    runtime.setOnTitleUpdate?.((sessionId, title) => {
      this.#broadcast({ type: 'session:title', sessionId, title });
    });
  }

  #installApprovalHandler() {
    this.#runtime.setRequestToolApproval((request) => {
      const { id, name, displayName, arguments: args, approvalDetails } = request;
      this.#broadcast({ type: 'approval:request', id, toolName: name, displayName, arguments: args, details: approvalDetails });
      return this.#approval.create(id);
    });
  }

  #broadcast(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.#clients) {
      try { res.write(data); } catch {}
    }
  }

  #broadcastRuntimeState() {
    this.#broadcast({ type: 'runtime:state', state: this.getState() });
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

  #updateUiToolCard(toolId, updater, mapMessage = null) {
    const result = updateToolInMessages(this.#uiMessages, toolId, updater);
    if (!result.updated) return false;
    this.#uiMessages = typeof mapMessage === 'function'
      ? result.messages.map((message) => hasToolInSegments(message.segments, toolId) ? mapMessage(message) : message)
      : result.messages;
    this.#persistUiTranscriptSoon();
    return true;
  }

  #removeUiTransientWaiting() {
    this.#uiMessages = this.#uiMessages.filter((message) => message.transientKey !== 'waiting-response');
  }

  #recordUiEvent(event) {
    if (!event?.type) return;
    this.#resetUiTranscriptIfSessionChanged();
    const activeId = this.#uiActiveMsgId;

    switch (event.type) {
      case 'assistant:start': {
        this.#removeUiTransientWaiting();
        if (!activeId) {
          this.#uiActiveMsgId = this.#addUiMessage({
            role: 'general',
            text: '',
            timestamp: new Date().toISOString()
          });
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
            durationMs: null,
            summary: '',
            result: ''
          };
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: addToolToSegments(finishThinkingSegments(message.segments), toolCard)
          }));
        }
        break;
      }
      case 'tool:end': {
        const eventChanges = Array.isArray(event.fileChanges) && event.fileChanges.length
          ? event.fileChanges
          : (event.fileChange?.path ? [event.fileChange] : []);
        this.#updateUiToolCard(
          event.id,
          (card) => ({
            ...card,
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
        this.#updateUiToolCard(event.id, (card) => ({ ...card, result: event.content || '' }));
        break;
      }
      case 'tool:error': {
        this.#updateUiToolCard(event.id, (card) => ({
          ...card,
          status: 'error',
          durationMs: event.durationMs,
          summary: event.summary || card.summary
        }));
        break;
      }
      case 'tool:blocked': {
        this.#updateUiToolCard(event.id, (card) => ({
          ...card,
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
            planStep: { ...(message.planStep || {}), status: 'running' }
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
      default:
        break;
    }
  }

  addClient(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    this.#clients.add(res);
    res.on('close', () => this.#clients.delete(res));
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
        timestamp: new Date().toISOString()
      });
    }
    this.#busy = true;
    this.#runtime.submit(line, (event) => {
      this.#recordUiEvent(event);
      this.#broadcast(event);
      if (['spec:pending_approval', 'reflect:pending_approval'].includes(event?.type)) {
        this.#busy = false;
        this.#broadcastRuntimeState();
      }
    }, options).then((result) => {
      if (this.#uiActiveMsgId) {
        this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
          ...message,
          segments: finishThinkingSegments(message.segments)
            .map((seg) => seg.type === 'text' ? { ...seg, isStreaming: false } : seg)
        }));
      }
      this.#uiActiveMsgId = null;
      this.#uiPlanStepIds = new Map();
      this.#broadcast({ type: 'submit:done', result: { type: result.type, aborted: result.aborted, text: result.text } });
    }).catch((err) => {
      this.#addUiMessage({
        role: 'error',
        text: `Failed: ${err.message}`,
        timestamp: new Date().toISOString()
      });
      this.#broadcast({ type: 'submit:done', result: { type: 'error', text: err.message } });
    }).finally(() => {
      this.#busy = false;
      this.#broadcastRuntimeState();
    });
    return { accepted: true };
  }

  handleCodeWikiGenerate(line) {
    if (this.#busy) return { error: true, message: 'A request is already in progress' };
    this.#busy = true;
    this.#codeWikiGenerating = true;
    this.#broadcastRuntimeState();
    const emitProgress = (event) => {
      try {
        const progress = toCodeWikiGenerateProgress(event);
        if (progress) this.#broadcast(progress);
      } catch {}
    };
    // Keep this above the model gateway timeout used by the runtime. Large CodeWiki
    // generations can legitimately exceed ten minutes.
    const safetyTimer = setTimeout(() => {
      if (this.#busy) {
        this.#busy = false;
        this.#codeWikiGenerating = false;
        this.#broadcast({ type: 'codewiki:generate_error', message: 'CodeWiki generation timed out' });
        this.#broadcastRuntimeState();
      }
    }, CODEWIKI_GENERATE_TIMEOUT_MS);
    const clearSafetyTimer = () => clearTimeout(safetyTimer);
    this.#runtime.submit(line, emitProgress, { codeWikiGenerate: true }).then((result) => {
      clearSafetyTimer();
      if (result?.aborted) {
        this.#broadcast({
          type: 'codewiki:generate_error',
          message: result?.text || 'CodeWiki generation failed'
        });
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
    }).catch((err) => {
      clearSafetyTimer();
      this.#broadcast({
        type: 'codewiki:generate_error',
        message: err?.message || 'CodeWiki generation failed'
      });
    }).finally(() => {
      clearSafetyTimer();
      this.#busy = false;
      this.#codeWikiGenerating = false;
      this.#broadcastRuntimeState();
    });
    return { accepted: true };
  }

  async handleCodeWikiAsk(line, onEvent = null) {
    if (this.#busy) return { error: true, message: 'A request is already in progress' };
    this.#busy = true;
    const emit = (event) => {
      if (typeof onEvent === 'function' && event?.type) onEvent(event);
    };
    try {
      const result = await this.#runtime.submit(line, emit, { readOnlyCodeWiki: true });
      const payload = {
        ok: true,
        type: result?.type || 'assistant',
        text: result?.text || '',
        aborted: !!result?.aborted
      };
      emit({ type: 'codewiki:done', result: payload });
      return payload;
    } catch (err) {
      const payload = { error: true, message: err?.message || 'Request failed' };
      emit({ type: 'codewiki:error', message: payload.message });
      return payload;
    } finally {
      this.#busy = false;
    }
  }

  isBusy() {
    return this.#busy;
  }

  handleAbort() {
    const aborted = this.#runtime.abort();
    if (this.#busy && !aborted) {
      this.#busy = false;
      this.#broadcast({ type: 'submit:done', result: { type: 'aborted', aborted: true, text: 'Request released.' } });
      this.#broadcastRuntimeState();
    } else if (this.#busy && aborted) {
      setTimeout(() => {
        if (!this.#busy) return;
        this.#busy = false;
        this.#broadcast({ type: 'submit:done', result: { type: 'aborted', aborted: true, text: 'Request aborted.' } });
        this.#broadcastRuntimeState();
      }, 5000);
    }
    return aborted;
  }

  async setExecutionMode(mode) {
    if (this.#busy) return false;
    const ok = await this.#runtime.setExecutionMode(mode);
    if (ok) this.#broadcast({ type: 'mode:changed', mode, ...this.getState() });
    return ok;
  }

  async setApprovalMode(mode) {
    if (this.#busy) return false;
    const ok = await this.#runtime.setApprovalMode?.(mode);
    if (ok) this.#broadcast({ type: 'approval-mode:changed', approvalMode: mode, ...this.getState() });
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
    if (draft) this.#broadcast({ type: 'reflect:pending_approval', draft });
    this.#broadcastRuntimeState();
    return draft || null;
  }

  async updatePendingSpec(patch = {}) {
    const spec = await this.#runtime.updatePendingSpec?.(patch);
    if (spec) this.#broadcast({ type: 'spec:pending_approval', spec });
    this.#broadcastRuntimeState();
    return spec || null;
  }

  async setPendingSpecFromFile(payload = {}) {
    const spec = await this.#runtime.setPendingSpecFromFile?.(payload);
    if (spec) this.#broadcast({ type: 'spec:pending_approval', spec });
    this.#broadcastRuntimeState();
    return spec || null;
  }

  async deletePendingSpec() {
    const result = await this.#runtime.deletePendingSpec?.();
    if (result) this.#broadcast({ type: 'spec:approval_cleared' });
    this.#broadcastRuntimeState();
    return result || null;
  }

  handleApproval(id, approved) {
    return this.#approval.resolve(id, approved);
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
      pendingSpecApproval: serializableState.pendingSpecApproval
    };
  }

  getSessionMessages() {
    const messages = this.#runtime.getSessionMessages();
    if (!Array.isArray(messages)) return [];
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
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
        at: m.at || null
      }));
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
    this.#broadcast({ type: 'change:undone', result });
    return result || { error: true, message: 'Git change oplog is not available' };
  }

  async undoChangeSets(ids) {
    if (this.#busy) return { error: true, message: 'A request is already in progress' };
    const result = await this.#runtime.undoChangeSets?.(ids);
    this.#broadcast({ type: 'change:undone', result });
    return result || { error: true, message: 'Git change oplog is not available' };
  }

  async getUiMessages(sessionId = '') {
    const requestedSessionId = String(sessionId || '').trim();
    if (!requestedSessionId) {
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

  async switchRuntime(newRuntime) {
    if (this.#busy) {
      throw new Error('Runtime is busy');
    }
    // Dispose old runtime
    try { await this.#runtime.dispose?.(); } catch {}
    // Swap
    this.#runtime = newRuntime;
    this.#startupConsumed = false;
    this.#approval = new ApprovalManager();
    this.#uiMessages = [];
    this.#uiActiveMsgId = null;
    this.#uiPlanStepIds = new Map();
    this.#uiTranscriptSessionId = newRuntime.getCurrentSessionId?.() || '';
    this.#installApprovalHandler();
    // Push title updates via SSE
    newRuntime.setOnTitleUpdate?.((sessionId, title) => {
      this.#broadcast({ type: 'session:title', sessionId, title });
    });
    // Notify clients
    this.#broadcast({ type: 'runtime:switched', sessionId: newRuntime.getCurrentSessionId?.() });
  }

  async dispose() {
    for (const res of this.#clients) {
      try { res.end(); } catch {}
    }
    this.#clients.clear();
    await this.#runtime.dispose?.();
  }
}
