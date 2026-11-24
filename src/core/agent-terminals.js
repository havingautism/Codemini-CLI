import { randomUUID } from 'node:crypto';
import stripAnsi from 'strip-ansi';

const MAX_SESSIONS = 40;
const MAX_COMMANDS = 12;
const MAX_OUTPUT = 65_536;
const sessions = new Map();
const listeners = new Set();

function notify(sessionId) {
  for (const listener of listeners) {
    try { listener(sessionId); } catch { /* An observer cannot fail the command. */ }
  }
}

export function subscribeAgentTerminals(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createAgentTerminal(sessionId, { command, cwd }) {
  if (!sessionId) return null;
  const id = randomUUID();
  const entry = {
    id, command: command.slice(0, 2048), cwd,
    background: true, status: 'running', output: '', revision: 0,
  };
  let finished = false;

  return {
    publish() {
      if (finished) return;
      const commands = sessions.get(sessionId) || new Map();
      sessions.delete(sessionId);
      sessions.set(sessionId, commands);
      commands.set(id, entry);
      if (commands.size > MAX_COMMANDS) commands.delete(commands.keys().next().value);
      if (sessions.size > MAX_SESSIONS) {
        const oldest = sessions.keys().next().value;
        sessions.delete(oldest);
        notify(oldest);
      }
      notify(sessionId);
    },
    write(chunk) {
      if (finished || !chunk) return;
      entry.output = (entry.output + String(chunk)).slice(-MAX_OUTPUT);
      entry.revision += 1;
    },
    finish() {
      finished = true;
      entry.output = '';
      const commands = sessions.get(sessionId);
      if (commands?.delete(id)) {
        if (!commands.size) sessions.delete(sessionId);
        notify(sessionId);
      }
    },
  };
}

export function listAgentTerminals(sessionId) {
  return Array.from(sessions.get(sessionId)?.values() || [], ({ output, revision, ...entry }) => entry);
}

export function getAgentTerminal(sessionId, id) {
  const entry = sessions.get(sessionId)?.get(id);
  if (!entry) return null;
  return { ...entry, output: stripAnsi(entry.output).replace(/\r\n?/g, '\n') };
}
