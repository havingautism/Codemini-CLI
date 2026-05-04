import { ApprovalManager } from './approval-manager.js';

export class RuntimeBridge {
  #runtime = null;
  #clients = new Set();
  #approval = new ApprovalManager();
  #busy = false;
  #startupConsumed = false;

  constructor(runtime) {
    this.#runtime = runtime;
    this.#installApprovalHandler();
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

  handleSubmit(line) {
    if (this.#busy) return { error: true, message: 'A request is already in progress' };
    this.#busy = true;
    this.#runtime.submit(line, (event) => {
      this.#broadcast(event);
    }).then((result) => {
      this.#broadcast({ type: 'submit:done', result: { type: result.type, aborted: result.aborted, text: result.text } });
    }).catch((err) => {
      this.#broadcast({ type: 'submit:done', result: { type: 'error', text: err.message } });
    }).finally(() => {
      this.#busy = false;
    });
    return { accepted: true };
  }

  handleAbort() {
    return this.#runtime.abort();
  }

  handleApproval(id, approved) {
    return this.#approval.resolve(id, approved);
  }

  getState() {
    return this.#runtime.getRuntimeState();
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
        at: m.at || null
      }));
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
    this.#installApprovalHandler();
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
