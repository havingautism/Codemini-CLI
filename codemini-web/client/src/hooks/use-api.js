import { t } from '../../i18n/index.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  return res;
}

export async function fetchState() {
  const res = await api('/api/state');
  return res.json();
}

export async function fetchStartupEvents() {
  const res = await api('/api/startup-events');
  return res.json();
}

export async function fetchHistory() {
  const res = await api('/api/history');
  return res.json();
}

export async function fetchSessions() {
  const res = await api('/api/sessions');
  return res.json();
}

export async function fetchSessionMessages() {
  const res = await api('/api/session/messages');
  return res.json();
}

export async function submitLine(line) {
  const res = await api('/api/submit', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ line })
  });
  return res;
}

export async function abortRequest() {
  await api('/api/abort', { method: 'POST' });
}

export async function submitApproval(id, approved) {
  await api('/api/approval', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, approved })
  });
}

export async function fetchCompletions(query) {
  const res = await api(`/api/completions?q=${encodeURIComponent(query)}`);
  return res.json();
}

export async function switchSession(sessionId) {
  const res = await api('/api/sessions/switch', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId })
  });
  return res.json();
}

export async function newSession() {
  const res = await api('/api/sessions/new', { method: 'POST' });
  return res.json();
}

export async function fetchConfig() {
  const res = await api('/api/config');
  return res.json();
}

export async function setConfig(key, value) {
  await api('/api/config/set', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ key, value })
  });
}

export async function fetchProject() {
  const res = await api('/api/project');
  return res.json();
}

export async function openProject(path) {
  const res = await api('/api/project/open', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ path })
  });
  return res.json();
}

export async function browseDir(dir) {
  const res = await api('/api/project/browse', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ dir })
  });
  return res.json();
}
