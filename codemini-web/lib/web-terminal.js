import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveShell } from '../../src/core/shell.js';

const MAX_TRANSCRIPT_CHARS = 1_000_000;
const MAX_LINES = 2000;
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const HOST_FILE = fileURLToPath(new URL('./web-terminal-host.js', import.meta.url));
const sessions = new Map();
let terminalHost = null;

export function stripAnsi(text = '') {
  return String(text || '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b./g, '');
}

export function shellPrompt(shell = 'pwsh', cwd = '') {
  const resolvedCwd = String(cwd || '').trim();
  if (/^pwsh$|powershell/i.test(shell)) {
    return resolvedCwd ? `PS ${resolvedCwd}>` : 'PS>';
  }
  if (/^cmd$/i.test(shell)) {
    return resolvedCwd ? `${resolvedCwd}>` : '>';
  }
  return '$';
}

export function formatTerminalPlainText(lines = [], { cwd = '', shell = 'pwsh' } = {}) {
  const header = [shell, cwd].filter(Boolean).join(' · ');
  const values = Array.isArray(lines) ? lines : [];
  const startsWithHeader =
    header &&
    values[0]?.kind === 'sys' &&
    String(values[0]?.text || '').trim() === header;
  const body = values
    .map((line) => {
      const text = String(line?.text ?? '');
      if (line?.kind === 'in') return `${shellPrompt(shell, cwd)} ${text}`;
      return text;
    })
    .join('\n');
  return header && !startsWithHeader ? `${header}\n${body}` : body;
}

function sessionKey(cwd) {
  return path.resolve(String(cwd || process.cwd()));
}

function shellLabel(shellDefault) {
  const spec = resolveShell(shellDefault);
  const base = path.basename(spec.command).replace(/\.exe$/i, '');
  if (/pwsh|powershell/i.test(base)) return 'pwsh';
  if (/cmd/i.test(base)) return 'cmd';
  return base || 'shell';
}

function broadcast(session, event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of session.clients) {
    try {
      client.write(payload);
    } catch {
      session.clients.delete(client);
    }
  }
}

function appendTranscript(session, data) {
  session.transcript += String(data || '');
  if (session.transcript.length > MAX_TRANSCRIPT_CHARS) {
    session.transcript = session.transcript.slice(-MAX_TRANSCRIPT_CHARS);
  }
}

function pushLine(session, line) {
  session.lines.push(line);
  if (session.lines.length > MAX_LINES) {
    session.lines.splice(0, session.lines.length - MAX_LINES);
  }
}

function handleHostMessage(message) {
  const session = sessions.get(message?.key);
  if (!session) return;
  if (message.type === 'ready') {
    session.connected = true;
    broadcast(session, { type: 'status', connected: true });
    return;
  }
  if (message.type === 'data') {
    appendTranscript(session, message.data);
    broadcast(session, { type: 'data', data: message.data });
    return;
  }
  if (message.type === 'error') {
    const data = `\r\n[terminal error: ${message.error}]\r\n`;
    appendTranscript(session, data);
    broadcast(session, { type: 'data', data });
    return;
  }
  if (message.type === 'exit') {
    session.connected = false;
    session.command = '';
    const suffix = message.signal
      ? `signal ${message.signal}`
      : `code ${message.exitCode}`;
    const data = `\r\n[terminal exited with ${suffix}]\r\n`;
    appendTranscript(session, data);
    broadcast(session, { type: 'data', data });
    broadcast(session, { type: 'status', connected: false });
  }
}

function ensureHost() {
  if (terminalHost?.connected) return terminalHost;
  const host = fork(HOST_FILE, [], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  terminalHost = host;
  host.on('message', handleHostMessage);
  host.on('exit', () => {
    if (terminalHost !== host) return;
    terminalHost = null;
    for (const session of sessions.values()) {
      session.connected = false;
      broadcast(session, { type: 'status', connected: false });
    }
  });
  return host;
}

function sendToHost(message) {
  const host = ensureHost();
  if (host.connected) host.send(message);
}

function spawnSession(session) {
  sendToHost({
    type: 'spawn',
    key: session.key,
    cwd: session.cwd,
    shellDefault: session.shellDefault,
    cols: session.cols,
    rows: session.rows,
  });
}

function ensureSession(cwd, shellDefault = 'powershell') {
  const key = sessionKey(cwd);
  let session = sessions.get(key);
  if (!session) {
    session = {
      key,
      cwd: key,
      shellDefault,
      shell: shellLabel(shellDefault),
      clients: new Set(),
      transcript: '',
      lines: [],
      command: '',
      connected: false,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
    };
    sessions.set(key, session);
    spawnSession(session);
  } else {
    session.shellDefault = shellDefault || session.shellDefault;
    session.shell = shellLabel(session.shellDefault);
    if (!session.connected) spawnSession(session);
  }
  return session;
}

export function getTerminalSnapshot(cwd, shellDefault = 'powershell') {
  const session = ensureSession(cwd, shellDefault);
  return {
    cwd: session.cwd,
    shell: session.shell,
    connected: session.connected,
    running: Boolean(session.command),
    command: session.command,
    data: session.transcript,
    lines: [...session.lines],
    cols: session.cols,
    rows: session.rows,
  };
}

export function subscribeTerminal(cwd, res, shellDefault = 'powershell') {
  const session = ensureSession(cwd, shellDefault);
  session.clients.add(res);
  res.write(
    `data: ${JSON.stringify({
      type: 'snapshot',
      snapshot: getTerminalSnapshot(cwd, shellDefault),
    })}\n\n`,
  );
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);
  const cleanup = () => {
    clearInterval(heartbeat);
    session.clients.delete(res);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
  return cleanup;
}

export function writeTerminalInput(cwd, data, shellDefault = 'powershell') {
  const session = ensureSession(cwd, shellDefault);
  const input = String(data ?? '');
  if (!input) return { ok: true, written: 0 };
  sendToHost({ type: 'input', key: session.key, data: input });
  return { ok: true, written: input.length };
}

export function resizeTerminal(
  cwd,
  cols,
  rows,
  shellDefault = 'powershell',
) {
  const session = ensureSession(cwd, shellDefault);
  const nextCols = Math.max(20, Math.min(500, Number(cols) || DEFAULT_COLS));
  const nextRows = Math.max(5, Math.min(200, Number(rows) || DEFAULT_ROWS));
  session.cols = nextCols;
  session.rows = nextRows;
  sendToHost({
    type: 'resize',
    key: session.key,
    cols: nextCols,
    rows: nextRows,
  });
  return { ok: true, cols: nextCols, rows: nextRows };
}

export function clearTerminal(cwd, shellDefault = 'powershell') {
  const session = ensureSession(cwd, shellDefault);
  session.transcript = '';
  session.lines = [];
  sendToHost({ type: 'clear', key: session.key });
  return getTerminalSnapshot(cwd, shellDefault);
}

export function restartTerminal(cwd, shellDefault = 'powershell') {
  const session = ensureSession(cwd, shellDefault);
  session.command = '';
  session.transcript = '';
  session.lines = [];
  session.connected = false;
  sendToHost({
    type: 'restart',
    key: session.key,
    cwd: session.cwd,
    shellDefault: session.shellDefault,
    cols: session.cols,
    rows: session.rows,
  });
  const snapshot = getTerminalSnapshot(cwd, shellDefault);
  broadcast(session, { type: 'snapshot', snapshot });
  return { ok: true, snapshot };
}

export function stopTerminal(cwd, shellDefault = 'powershell') {
  const session = ensureSession(cwd, shellDefault);
  const cmd = session.command;
  sendToHost({ type: 'input', key: session.key, data: '\x03' });
  session.command = '';
  if (cmd) {
    pushLine(session, {
      kind: 'sys',
      text: `stopped: ${cmd}`,
      at: Date.now(),
    });
  }
  return {
    ok: true,
    stopped: true,
    snapshot: getTerminalSnapshot(cwd, shellDefault),
  };
}

/**
 * Compatibility helper for API callers and tests. The browser terminal writes
 * keystrokes through writeTerminalInput instead.
 */
export function runTerminalCommand({
  cwd,
  command,
  shellDefault = 'powershell',
} = {}) {
  const text = String(command || '').trim();
  if (!text) return { ok: false, error: 'command is required' };
  const session = ensureSession(cwd, shellDefault);
  session.command = text;
  pushLine(session, { kind: 'in', text, at: Date.now() });
  sendToHost({ type: 'input', key: session.key, data: `${text}\r` });
  return { ok: true, snapshot: getTerminalSnapshot(cwd, shellDefault) };
}

/** Test helper */
export async function _resetTerminalSessionsForTests() {
  sessions.clear();
  const host = terminalHost;
  terminalHost = null;
  if (!host) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2000);
    host.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      host.kill();
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

process.once('exit', () => {
  try {
    terminalHost?.kill();
  } catch {}
});
