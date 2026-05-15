import { ApprovalManager } from './approval-manager.js';
import { summarizeToolResult } from '../../src/core/tool-result-store.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSessionsDir } from '../../src/core/paths.js';

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

export class RuntimeBridge {
  #runtime = null;
  #clients = new Set();
  #approval = new ApprovalManager();
  #busy = false;
  #startupConsumed = false;
  #uiMessages = [];
  #uiActiveMsgId = null;
  #uiPlanStepIds = new Map();
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
            segments: appendTextSegment(message.segments, delta, true)
          }));
        }
        break;
      }
      case 'assistant:response': {
        if (this.#uiActiveMsgId && event.text) {
          const text = stripPlanProgressText(event.text);
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: text ? [{ type: 'text', text, isStreaming: false }] : message.segments
          }));
        }
        break;
      }
      case 'tool:start': {
        if (this.#uiActiveMsgId) {
          const toolCard = { id: event.id, name: event.name, arguments: event.arguments, status: 'running', durationMs: null, summary: '', result: '' };
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: addToolToSegments(message.segments, toolCard)
          }));
        }
        break;
      }
      case 'tool:end': {
        if (this.#uiActiveMsgId) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: updateToolInSegments(message.segments, event.id, (card) => ({
              ...card,
              status: 'done',
              durationMs: event.durationMs,
              summary: event.summary || card.summary
            }))
          }));
        }
        break;
      }
      case 'tool:result': {
        if (this.#uiActiveMsgId) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: updateToolInSegments(message.segments, event.id, (card) => ({ ...card, result: event.content || '' }))
          }));
        }
        break;
      }
      case 'tool:error': {
        if (this.#uiActiveMsgId) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: updateToolInSegments(message.segments, event.id, (card) => ({
              ...card,
              status: 'error',
              durationMs: event.durationMs,
              summary: event.summary || card.summary
            }))
          }));
        }
        break;
      }
      case 'tool:blocked': {
        if (this.#uiActiveMsgId) {
          this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
            ...message,
            segments: updateToolInSegments(message.segments, event.id, (card) => ({
              ...card,
              status: 'blocked',
              summary: card.summary || 'Tool blocked'
            }))
          }));
        }
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
        break;
      }
      case 'plan:step_done': {
        const msgId = this.#uiPlanStepIds.get(String(event.step));
        if (msgId) {
          this.#updateUiMessage(msgId, (message) => ({
            ...message,
            segments: message.segments.map((seg) => seg.type === 'text' ? { ...seg, isStreaming: false } : seg),
            planStep: {
              ...(message.planStep || {}),
              status: event.status || 'done',
              summary: event.summary || ''
            }
          }));
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
    const lower = trimmed.toLowerCase();
    const planControl = ['/yes', '/plan approve', '/no', '/reject'].includes(lower) || lower.startsWith('/edit ');
    if (!options?.readOnlyCodeWiki && trimmed && !planControl) {
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
    }, options).then((result) => {
      if (this.#uiActiveMsgId) {
        this.#updateUiMessage(this.#uiActiveMsgId, (message) => ({
          ...message,
          segments: message.segments.map((seg) => seg.type === 'text' ? { ...seg, isStreaming: false } : seg)
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
    return this.#runtime.abort();
  }

  async setExecutionMode(mode) {
    if (this.#busy) return false;
    const ok = await this.#runtime.setExecutionMode(mode);
    if (ok) this.#broadcast({ type: 'mode:changed', mode, ...this.getState() });
    return ok;
  }

  async reloadConfig(options = {}) {
    return this.#runtime.reloadConfig?.(options);
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
      pendingPlanApproval: this.#busy ? null : serializableState.pendingPlanApproval,
      pendingReflectSkill: this.#busy ? null : serializableState.pendingReflectSkill
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
        toolCalls: m.tool_calls || [],
        toolCallId: m.tool_call_id || null,
        toolSummary: m.role === 'tool' ? summarizeHistoricalToolMessage(m) : null,
        toolDurationMs: Number.isFinite(Number(m.tool_duration_ms)) ? Number(m.tool_duration_ms) : null,
        toolStatus: m.tool_status || null,
        planTranscript: Array.isArray(m.plan_transcript) ? m.plan_transcript : null,
        at: m.at || null
      }));
  }

  getSessionCompactMeta() {
    const compact = this.#runtime.getSessionCompact();
    if (!compact) return null;
    return { boundaryIndex: compact.boundaryIndex, mode: compact.mode, timestamp: compact.timestamp };
  }

  async getUiMessages() {
    this.#resetUiTranscriptIfSessionChanged();
    if (this.#uiMessages.length > 0) return this.#uiMessages;
    const sessionId = this.getSessionId();
    if (!sessionId) return [];
    try {
      const raw = await fs.readFile(webTranscriptPath(sessionId), 'utf8');
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
    // Abort anything in-flight
    if (this.#busy) {
      try { this.#runtime.abort(); } catch {}
      this.#busy = false;
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
