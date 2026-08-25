import { createContinuationSession } from './session-store.js';
import { saveUiTranscriptToSqlite } from './session-sqlite-store.js';

const BUSY_STATUSES = new Set(['queued', 'running', 'waiting_approval', 'waiting_input']);

export function sessionForkBlockedReason({ busy, status } = {}) {
  if (busy === true || BUSY_STATUSES.has(String(status || ''))) {
    return 'Session is still running';
  }
  return '';
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function forkSessionTitle(title) {
  const base = String(title || '').trim() || '新会话';
  return base.endsWith('-fork') ? base : `${base}-fork`;
}

function isUserUi(message) {
  return message?.role === 'you' && !message?.transientKey;
}

export function sliceUiMessagesThrough(uiMessages, messageId) {
  const id = String(messageId || '').trim();
  const list = Array.isArray(uiMessages) ? uiMessages : [];
  const index = list.findIndex((message) => String(message?.id || '') === id);
  if (!id || index < 0) return null;
  return list.slice(0, index + 1);
}

function prefixEndedOnUser(uiPrefix) {
  for (let index = uiPrefix.length - 1; index >= 0; index -= 1) {
    const message = uiPrefix[index];
    if (isUserUi(message)) return true;
    const role = String(message?.role || '');
    if (role === 'divider' || role === 'system' || message?.transientKey) continue;
    return false;
  }
  return false;
}

export function sliceCoreMessagesThroughUi(coreMessages, uiPrefix) {
  const core = Array.isArray(coreMessages) ? coreMessages : [];
  const prefix = Array.isArray(uiPrefix) ? uiPrefix : [];
  const userCount = prefix.filter(isUserUi).length;
  if (userCount <= 0) return [];
  let seen = 0;
  let userIndex = -1;
  for (let index = 0; index < core.length; index += 1) {
    if (core[index]?.role !== 'user') continue;
    seen += 1;
    if (seen === userCount) {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return core.slice();
  if (prefixEndedOnUser(prefix)) return core.slice(0, userIndex + 1);
  let end = core.length;
  for (let index = userIndex + 1; index < core.length; index += 1) {
    if (core[index]?.role === 'user') {
      end = index;
      break;
    }
  }
  return core.slice(0, end);
}

/** Snapshot an idle session into a new independent session, including the Web UI transcript. */
export async function forkIdleSession(source, { uiMessages = [], messageId } = {}) {
  const ui = sliceUiMessagesThrough(uiMessages, messageId);
  if (!ui) throw new Error('Message not found');
  const snapshot = cloneJson(source || {});
  const messages = sliceCoreMessagesThroughUi(snapshot.messages, ui);
  const full = messages.length === (Array.isArray(snapshot.messages) ? snapshot.messages.length : 0);
  snapshot.title = forkSessionTitle(snapshot.title);
  if (!full) {
    snapshot.planState = undefined;
    snapshot.specState = undefined;
  }
  const created = await createContinuationSession(snapshot, {
    messages,
    compactView: full && Array.isArray(snapshot.compact?.view) ? snapshot.compact.view : null
  });
  saveUiTranscriptToSqlite(created.id, cloneJson(ui));
  return created;
}
