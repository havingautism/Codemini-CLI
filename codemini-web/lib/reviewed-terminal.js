import { resolveShellContext } from '../../src/core/shell-profile.js';
import path from 'node:path';
import { reviewCommandAccess } from '../../src/core/command-access-review.js';
import { runShellCommand } from '../../src/core/shell.js';

export function createReviewedTerminal({ review = reviewCommandAccess, execute = runShellCommand } = {}) {
  const sessions = new Map();
  function session(cwd, shell = 'bash') {
    const key = path.resolve(cwd);
    if (!sessions.has(key)) sessions.set(key, { cwd: key, shell, data: '', clients: new Set(), controller: null, pending: null, command: '', cols: 100, rows: 30 });
    return sessions.get(key);
  }
  function snapshot(s) {
    return { cwd: s.cwd, shell: s.shell, data: s.data, connected: true, running: Boolean(s.controller), command: s.command,
      cols: s.cols, rows: s.rows, pendingApproval: s.pending?.request || null, lines: [] };
  }
  function publish(s, event) {
    for (const res of s.clients) {
      try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { s.clients.delete(res); }
    }
  }
  function status(s) { publish(s, { type: 'snapshot', snapshot: snapshot(s) }); }
  function output(s, text) {
    const data = String(text).replace(/\r?\n/g, '\r\n');
    s.data = (s.data + data).slice(-1_000_000);
    publish(s, { type: 'data', data });
  }
  return {
    getTerminalSnapshot(cwd, shell) { return snapshot(session(cwd, shell)); },
    subscribeTerminal(cwd, res, shell) {
      const s = session(cwd, shell); s.clients.add(res);
      res.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot: snapshot(s) })}\n\n`);
      const timer = setInterval(() => { try { res.write(': ping\n\n'); } catch { cleanup(); } }, 15000);
      const cleanup = () => { clearInterval(timer); s.clients.delete(res); };
      res.on('close', cleanup); res.on('error', cleanup);
      return cleanup;
    },
    runTerminalCommand({ cwd, command, config }) {
      const text = String(command || '').trim();
      if (!text || text.length > 32000) return { ok: false, error: 'Command must contain 1–32000 characters' };
      const s = session(cwd, config?.shell?.default);
      if (s.controller) return { ok: false, error: 'A command is already being reviewed or running' };
      const controller = new AbortController(); s.controller = controller; s.command = text;
      s.shell = resolveShellContext(config, { cwd: s.cwd }).shell;
      output(s, `$ ${text}\n[reviewing command]\n`); status(s);
      // Capture the exact command, cwd, and config before asynchronous review.
      const runConfig = structuredClone(config);
      runConfig.shell = { ...runConfig.shell, default: s.shell };
      const completion = (async () => {
        try {
          const decision = await review({ command: text, config: runConfig, workspaceRoot: s.cwd,
            capability: 'Web terminal command with outbound network for this process and its children',
            signal: controller.signal,
            requestApproval: request => new Promise(resolve => { s.pending = { request, resolve }; status(s); }),
          });
          controller.signal.throwIfAborted();
          s.pending = null; status(s);
          if (!decision.approved) { output(s, `[denied: ${decision.reason || 'not approved'}]\n`); return; }
          output(s, `[approved by ${decision.source || 'review'}]\n`);
          // User-entered terminal commands have network access without changing agent defaults.
          const scopedConfig = { ...runConfig, sandbox: { ...runConfig.sandbox, network: 'allow-all', network_isolated: true } };
          const result = await execute({ command: text, cwd: s.cwd, shell: s.shell, config: scopedConfig,
            timeoutMs: runConfig?.shell?.timeout_ms || 1800000, signal: controller.signal,
            onOutput: data => output(s, data),
          });
          output(s, `\n[exit ${result.exitCode ?? result.code ?? (result.ok === false ? 1 : 0)}]\n`);
        } catch (error) {
          output(s, `[${controller.signal.aborted ? 'stopped' : error.message || error}]\n`);
        } finally {
          s.pending?.resolve({ approved: false, reason: 'Command ended' });
          s.pending = null; s.controller = null; s.command = ''; status(s);
        }
      })();
      s.completion = completion;
      return { ok: true, snapshot: snapshot(s), completion };
    },
    resolveTerminalApproval(cwd, id, approved) {
      const s = session(cwd);
      if (!s.pending || s.pending.request.id !== id) return { ok: false, error: 'No matching pending approval' };
      const pending = s.pending; s.pending = null;
      pending.resolve({ approved: approved === true }); status(s);
      return { ok: true };
    },
    stopTerminal(cwd) {
      const s = session(cwd); s.controller?.abort(new Error('Stopped by user'));
      s.pending?.resolve({ approved: false, reason: 'Stopped by user' }); s.pending = null;
      return { ok: true, stopped: true, snapshot: snapshot(s) };
    },
    clearTerminal(cwd) { const s = session(cwd); s.data = ''; status(s); return snapshot(s); },
    restartTerminal(cwd) { this.stopTerminal(cwd); return { ok: true, snapshot: this.clearTerminal(cwd) }; },
    resizeTerminal(cwd, cols, rows) { const s = session(cwd); s.cols = Math.max(20, Math.min(500, Number(cols) || 100)); s.rows = Math.max(5, Math.min(200, Number(rows) || 30)); return { ok: true }; },
    async dispose() {
      for (const s of sessions.values()) {
        this.stopTerminal(s.cwd);
        for (const res of s.clients) { try { res.end(); } catch {} }
        s.clients.clear();
      }
      await Promise.allSettled([...sessions.values()].map(s => s.completion));
      sessions.clear();
    },
    writeTerminalInput() { return { ok: false, error: 'Raw terminal input is disabled; submit a command for review' }; },
  };
}
const terminal = createReviewedTerminal();
export const getTerminalSnapshot = terminal.getTerminalSnapshot.bind(terminal);
export const subscribeTerminal = terminal.subscribeTerminal.bind(terminal);
export const runTerminalCommand = terminal.runTerminalCommand.bind(terminal);
export const resolveTerminalApproval = terminal.resolveTerminalApproval.bind(terminal);
export const stopTerminal = terminal.stopTerminal.bind(terminal);
export const clearTerminal = terminal.clearTerminal.bind(terminal);
export const restartTerminal = terminal.restartTerminal.bind(terminal);
export const resizeTerminal = terminal.resizeTerminal.bind(terminal);
export const writeTerminalInput = terminal.writeTerminalInput.bind(terminal);

export const disposeReviewedTerminals = terminal.dispose.bind(terminal);
