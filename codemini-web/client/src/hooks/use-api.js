const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  return res;
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) {
    return res.ok ? {} : { error: true, message: `Request failed (${res.status})` };
  }
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: true,
      message: text.trim() || `Request failed (${res.status})`,
    };
  }
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

function withSessionQuery(path, sessionId) {
  const params = new URLSearchParams({ sessionId });
  return `${path}?${params.toString()}`;
}

export async function fetchRuntimeSessions() {
  const res = await api('/api/runtime/sessions');
  return res.json();
}

export async function fetchState(sessionId) {
  const res = await api(withSessionQuery('/api/state', sessionId));
  return res.json();
}

export async function fetchStartupEvents(sessionId) {
  const res = await api(withSessionQuery('/api/startup-events', sessionId));
  return res.json();
}

export async function fetchHistory(sessionId) {
  const res = await api(withSessionQuery('/api/history', sessionId));
  return res.json();
}

export async function fetchSessions(limit = 200) {
  const params = new URLSearchParams();
  const numericLimit = Number(limit);
  if (Number.isFinite(numericLimit) && numericLimit > 0) params.set('limit', String(Math.round(numericLimit)));
  const res = await api(params.size ? `/api/sessions?${params.toString()}` : '/api/sessions');
  return res.json();
}

export async function fetchSessionMessages(sessionId) {
  const res = await api(withSessionQuery('/api/session/messages', sessionId));
  return res.json();
}

export async function fetchSessionUiMessages(sessionId) {
  const res = await api(withSessionQuery('/api/session/ui-messages', sessionId));
  return res.json();
}

export async function fetchSpecs(sessionId) {
  const res = await api(withSessionQuery('/api/specs', sessionId));
  return res.json();
}

export async function openSpecReview(sessionId, path) {
  const res = await api('/api/specs/open', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, path })
  });
  return res.json();
}

export async function submitLine(sessionId, line, options = {}) {
  const res = await api('/api/submit', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      sessionId,
      line,
      ...(options.readOnlyCodeWiki ? { readOnlyCodeWiki: true } : {}),
      ...(Array.isArray(options.attachmentIds) && options.attachmentIds.length
        ? { attachmentIds: options.attachmentIds }
        : {})
    })
  });
  return res;
}

export async function submitMessage(sessionId, body = {}) {
  return api('/api/chat/message', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, ...body })
  });
}

export async function submitChatAction(sessionId, name, payload = {}) {
  const res = await api('/api/chat/action', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, name, payload })
  });
  return res.json();
}

export async function uploadAttachments(sessionId, files = []) {
  const form = new FormData();
  for (const file of files) {
    form.append('files', file);
  }
  const res = await api(withSessionQuery('/api/attachments', sessionId), {
    method: 'POST',
    body: form
  });
  return res.json();
}

export async function abortRequest(sessionId) {
  const res = await api('/api/abort', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId })
  });
  if (res.ok) return;

  let message = '';
  try {
    const body = await res.clone().json();
    message = String(body?.message || body?.error || '').trim();
  } catch {
    try {
      message = String(await res.text()).trim();
    } catch {}
  }
  throw new Error(message || `Abort request failed (${res.status})`);
}

export async function setExecutionMode(sessionId, mode) {
  const res = await api('/api/execution-mode', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, mode })
  });
  return res.json();
}

export async function setApprovalMode(sessionId, mode) {
  const res = await api('/api/approval-mode', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, mode })
  });
  return res.json();
}

export async function updatePendingReflect(sessionId, draft) {
  const res = await api('/api/pending-reflect', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, ...(draft || {}) })
  });
  return res.json();
}

export async function updatePendingSpec(sessionId, spec) {
  const res = await api('/api/pending-spec', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, ...(spec || {}) })
  });
  return res.json();
}

export async function deletePendingSpec(sessionId) {
  const res = await api(withSessionQuery('/api/pending-spec', sessionId), { method: 'DELETE' });
  return res.json();
}

export async function submitApproval(sessionId, id, approved) {
  await api('/api/approval', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, id, approved })
  });
}

export async function submitUserInput(sessionId, id, response = {}) {
  const res = await api('/api/user-input', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, id, ...response })
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

export async function newSession(projectDir) {
  const res = await api('/api/sessions/new', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ projectDir })
  });
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

export async function fetchGitInfo(sessionId) {
  const path = sessionId ? withSessionQuery('/api/git', sessionId) : '/api/git';
  const res = await api(path);
  return res.json();
}

export async function fetchGitDiff(sessionId) {
  const path = sessionId ? withSessionQuery('/api/git-diff', sessionId) : '/api/git-diff';
  const res = await api(path);
  return res.json();
}

export async function undoSessionChange(sessionId, id) {
  const res = await api(withSessionQuery(`/api/session-changes/${encodeURIComponent(id)}/undo`, sessionId), { method: 'POST' });
  return res.json();
}

export async function fetchSessionChanges(sessionId) {
  const res = await api(withSessionQuery('/api/session-changes', sessionId));
  return res.json();
}

export async function undoSessionChanges(sessionId, ids) {
  const res = await api('/api/session-changes/undo', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, ids })
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
  return readJsonResponse(res);
}

export async function createSkill({ name, description, content, scope, projectDir, contexts }) {
  const res = await api('/api/skills/create', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, description, content, scope, projectDir, contexts })
  });
  return readJsonResponse(res);
}

export async function installSkill({ source, scope, projectDir, contexts }) {
  const res = await api('/api/skills/install', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ source, scope, projectDir, contexts })
  });
  return readJsonResponse(res);
}

export async function updateSkillPackage({ name, projectDir }) {
  const res = await api('/api/skills/update', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, projectDir })
  });
  return readJsonResponse(res);
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

export async function deleteSkill(name, projectDir, projectDirs = []) {
  const params = new URLSearchParams();
  if (projectDir) params.set('projectDir', projectDir);
  if (projectDirs.length > 0) params.set('projects', JSON.stringify(projectDirs));
  const query = params.toString();
  const res = await api(`/api/skills/${encodeURIComponent(name)}${query ? `?${query}` : ''}`, {
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

export async function fetchInbox({ scope = 'all', query = '', projectDirs = [] } = {}) {
  const params = new URLSearchParams();
  if (scope && scope !== 'all') params.set('scope', scope);
  if (query.trim()) params.set('q', query.trim());
  appendProjectDirs(params, projectDirs);
  const queryString = params.toString();
  const res = await api(`/api/memory/inbox${queryString ? `?${queryString}` : ''}`);
  return res.json();
}

export async function discardInboxEntry(id) {
  const res = await api(`/api/memory/inbox/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  return res.json();
}

export async function runInboxDream(scope = 'all') {
  const res = await api('/api/memory/inbox/dream', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ scope: scope === 'all' ? null : scope })
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
