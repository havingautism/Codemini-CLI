import { t } from '../../i18n/index.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  return res;
}

export async function fetchEmbed(url) {
  const target = String(url || '').trim();
  if (!target) return { error: true, message: 'Missing url' };
  const res = await api(`/api/embed?url=${encodeURIComponent(target)}`);
  return res.json();
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

export async function fetchSessions(limit = 200) {
  const params = new URLSearchParams();
  const numericLimit = Number(limit);
  if (Number.isFinite(numericLimit) && numericLimit > 0) params.set('limit', String(Math.round(numericLimit)));
  const res = await api(params.size ? `/api/sessions?${params.toString()}` : '/api/sessions');
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

export async function fetchSpecs() {
  const res = await api('/api/specs');
  return res.json();
}

export async function openSpecReview(path) {
  const res = await api('/api/specs/open', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ path })
  });
  return res.json();
}

export async function submitLine(line, options = {}) {
  const res = await api('/api/submit', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      line,
      ...(options.readOnlyCodeWiki ? { readOnlyCodeWiki: true } : {}),
      ...(Array.isArray(options.attachmentIds) && options.attachmentIds.length
        ? { attachmentIds: options.attachmentIds }
        : {})
    })
  });
  return res;
}

export async function submitMessage(body = {}) {
  return api('/api/chat/message', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  });
}

export async function submitChatAction(name, payload = {}) {
  const res = await api('/api/chat/action', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, payload })
  });
  return res.json();
}

export async function uploadAttachments(files = []) {
  const form = new FormData();
  for (const file of files) {
    form.append('files', file);
  }
  const res = await api('/api/attachments', {
    method: 'POST',
    body: form
  });
  return res.json();
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

export async function setApprovalMode(mode) {
  const res = await api('/api/approval-mode', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ mode })
  });
  return res.json();
}

export async function updatePendingReflect(draft) {
  const res = await api('/api/pending-reflect', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(draft || {})
  });
  return res.json();
}

export async function updatePendingSpec(spec) {
  const res = await api('/api/pending-spec', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(spec || {})
  });
  return res.json();
}

export async function deletePendingSpec() {
  const res = await api('/api/pending-spec', { method: 'DELETE' });
  return res.json();
}

export async function submitApproval(id, approved) {
  await api('/api/approval', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, approved })
  });
}

export async function submitUserInput(id, response = {}) {
  const res = await api('/api/user-input', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, ...response })
  });
  return res.json().catch(() => ({}));
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

export async function fetchPlaywrightStatus() {
  const res = await api('/api/playwright/status');
  return res.json();
}

export async function setConfig(key, value) {
  const res = await api('/api/config/set', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ key, value })
  });
  const result = await res.json().catch(() => ({}));
  if (result?.error) {
    throw new Error(result.message || `Failed to save config: ${key}`);
  }
  return result;
}

export async function fetchWebuiActiveProjects() {
  const res = await api('/api/webui/active-projects');
  return res.json();
}

export async function patchWebuiActiveProject(action, projectDir) {
  const res = await api('/api/webui/active-projects', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ action, projectDir })
  });
  return res.json();
}

export async function replaceWebuiActiveProjects(active) {
  const res = await api('/api/webui/active-projects', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ active })
  });
  return res.json();
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

export async function undoSessionChange(id) {
  const res = await api(`/api/session-changes/${encodeURIComponent(id)}/undo`, { method: 'POST' });
  return res.json();
}

export async function fetchSessionChanges() {
  const res = await api('/api/session-changes');
  return res.json();
}

export async function undoSessionChanges(ids) {
  const res = await api('/api/session-changes/undo', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ids })
  });
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

export async function openProject(path, { newSession = false } = {}) {
  const res = await api('/api/project/open', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ path, newSession: Boolean(newSession) })
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
function appendProjectDirs(params, projectDirs = []) {
  const dirs = Array.isArray(projectDirs)
    ? projectDirs.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (dirs.length > 0) params.set('projects', JSON.stringify(dirs));
}

function withProjectDirQuery(path, projectDir) {
  const dir = String(projectDir || '').trim();
  if (!dir) return path;
  const params = new URLSearchParams({ projectDir: dir });
  return `${path}?${params.toString()}`;
}

export async function fetchSkills(projectDirs = []) {
  const params = new URLSearchParams();
  appendProjectDirs(params, projectDirs);
  const query = params.toString();
  const res = await api(query ? `/api/skills?${query}` : '/api/skills');
  return res.json();
}

export async function fetchSkillContent(name, projectDir) {
  const res = await api(withProjectDirQuery(`/api/skills/${encodeURIComponent(name)}/content`, projectDir));
  return res.json();
}

export async function createSkill({ name, description, content, scope, projectDir }) {
  const res = await api('/api/skills/create', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, description, content, scope, projectDir })
  });
  return res.json();
}

export async function installSkill({ source, scope, projectDir }) {
  const res = await api('/api/skills/install', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ source, scope, projectDir })
  });
  return res.json();
}

export async function updateSkillContent(name, content, projectDir) {
  const res = await api(`/api/skills/${encodeURIComponent(name)}/content`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content, projectDir })
  });
  return res.json();
}

export async function updateSkillMetadata(name, metadata, projectDir) {
  const res = await api(`/api/skills/${encodeURIComponent(name)}/metadata`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...(metadata || {}), projectDir })
  });
  return res.json();
}

export async function deleteSkill(name, projectDir) {
  const res = await api(withProjectDirQuery(`/api/skills/${encodeURIComponent(name)}`, projectDir), {
    method: 'DELETE'
  });
  return res.json();
}

export async function toggleSkill(name, enabled, projectDir) {
  const res = await api(`/api/skills/${encodeURIComponent(name)}/toggle`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled, projectDir })
  });
  return res.json();
}

// ── Memory ──
export async function fetchMemories({ scope = 'user', query = '', projectDirs = [] } = {}) {
  const params = new URLSearchParams({ scope });
  if (query.trim()) params.set('q', query.trim());
  appendProjectDirs(params, projectDirs);
  const res = await api(`/api/memory?${params.toString()}`);
  return res.json();
}

export async function forgetMemory(scope, id, projectDir) {
  const params = new URLSearchParams({ scope });
  if (projectDir) params.set('projectDir', projectDir);
  const res = await api(`/api/memory/${encodeURIComponent(id)}?${params.toString()}`, {
    method: 'DELETE'
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
function codeWikiProjectQuery(project = '') {
  return project ? `?project=${encodeURIComponent(project)}` : '';
}

export async function fetchCodeWikiReports(project = '') {
  const res = await api(`/api/codewiki/reports${codeWikiProjectQuery(project)}`);
  return res.json();
}

export async function fetchCodeWikiSymbolGraph(project = '') {
  const res = await api(`/api/codewiki/symbol-graph${codeWikiProjectQuery(project)}`);
  return res.json();
}

export async function fetchCodeWikiReportText(file, project = '') {
  const res = await api(`/api/codewiki/report/${encodeURIComponent(file)}${codeWikiProjectQuery(project)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || 'CodeWiki 文档加载失败');
  }
  return res.text();
}

export async function generateCodeWikiReport(depth = 'standard', project = '', format = 'html') {
  const res = await api(`/api/codewiki/generate${codeWikiProjectQuery(project)}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ depth, format })
  });
  return res.json();
}

export async function streamCodeWikiAsk({ question, reportFile = '', project = '', history = [], onEvent } = {}) {
  const res = await api(`/api/codewiki/ask${codeWikiProjectQuery(project)}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ question, reportFile, history: Array.isArray(history) ? history : [] })
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

export async function deleteCodeWikiReport(file, project = '') {
  const res = await api(`/api/codewiki/report/${encodeURIComponent(file)}${codeWikiProjectQuery(project)}`, { method: 'DELETE' });
  return res.json();
}
