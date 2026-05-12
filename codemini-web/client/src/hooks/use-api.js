import { t } from '../../i18n/index.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  return res;
}

export async function fetchVersion() {
  const res = await api('/api/version');
  return res.json();
}

export async function runUpdate() {
  const res = await api('/api/update', { method: 'POST' });
  return res.json();
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

export async function fetchSessionUiMessages() {
  const res = await api('/api/session/ui-messages');
  return res.json();
}

export async function submitLine(line, options = {}) {
  const res = await api('/api/submit', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      line,
      ...(options.readOnlyCodeWiki ? { readOnlyCodeWiki: true } : {})
    })
  });
  return res;
}

export async function abortRequest() {
  await api('/api/abort', { method: 'POST' });
}

export async function setExecutionMode(mode) {
  const res = await api('/api/execution-mode', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ mode })
  });
  return res.json();
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

export async function deleteSession(sessionId) {
  const res = await api(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
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

export async function fetchConfigStatus() {
  const res = await api('/api/config/status');
  return res.json();
}

export async function setConfig(key, value) {
  const res = await api('/api/config/set', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ key, value })
  });
  return res.json().catch(() => ({}));
}

export async function fetchProject() {
  const res = await api('/api/project');
  return res.json();
}

export async function fetchGitInfo() {
  const res = await api('/api/git');
  return res.json();
}

export async function fetchGitDiff() {
  const res = await api('/api/git-diff');
  return res.json();
}

export async function fetchGitBatch(dirs) {
  const res = await api('/api/git-batch', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ dirs })
  });
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

// ── Skills ──
export async function fetchSkills() {
  const res = await api('/api/skills');
  return res.json();
}

export async function fetchSkillContent(name) {
  const res = await api(`/api/skills/${encodeURIComponent(name)}/content`);
  return res.json();
}

export async function createSkill({ name, description, content }) {
  const res = await api('/api/skills/create', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, description, content })
  });
  return res.json();
}

export async function updateSkillContent(name, content) {
  const res = await api(`/api/skills/${encodeURIComponent(name)}/content`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content })
  });
  return res.json();
}

export async function deleteSkill(name) {
  const res = await api(`/api/skills/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  });
  return res.json();
}

export async function toggleSkill(name, enabled) {
  const res = await api(`/api/skills/${encodeURIComponent(name)}/toggle`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled })
  });
  return res.json();
}

// ── Souls ──
export async function fetchSouls() {
  const res = await api('/api/souls');
  return res.json();
}

export async function fetchSoulContent(name) {
  const res = await api(`/api/souls/${encodeURIComponent(name)}/content`);
  return res.json();
}

export async function createSoul({ name, content }) {
  const res = await api('/api/souls/create', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, content })
  });
  return res.json();
}

export async function updateSoulContent(name, content) {
  const res = await api(`/api/souls/${encodeURIComponent(name)}/content`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content })
  });
  return res.json();
}

export async function deleteSoul(name) {
  const res = await api(`/api/souls/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  });
  return res.json();
}

export async function activateSoul(name) {
  const res = await api('/api/souls/activate', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name })
  });
  return res.json();
}

// ── CodeWiki ──
export async function fetchCodeWikiReports() {
  const res = await api('/api/codewiki/reports');
  return res.json();
}

export async function generateCodeWikiReport(depth = 'standard') {
  const res = await api('/api/codewiki/generate', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ depth })
  });
  return res.json();
}

export async function streamCodeWikiAsk({ question, reportFile = '', onEvent } = {}) {
  const res = await api('/api/codewiki/ask', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ question, reportFile })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || 'CodeWiki 问答失败');
  }
  if (!res.body) throw new Error('当前浏览器不支持流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) onEvent?.(JSON.parse(line));
      newlineIndex = buffer.indexOf('\n');
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) onEvent?.(JSON.parse(tail));
}

export async function deleteCodeWikiReport(file) {
  const res = await api(`/api/codewiki/report/${encodeURIComponent(file)}`, { method: 'DELETE' });
  return res.json();
}
