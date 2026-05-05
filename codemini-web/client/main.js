import { createStore } from './store.js';
import { setLocale, t } from './i18n/index.js';
import { createChatPanel } from './components/chat-panel.js';
import { createMessageBubble, startTextSegment, appendDelta, finishStreaming, addToolCard, updateToolInMessage, addSkillBadge, addFileChanges } from './components/message-bubble.js';
import { createStatusBar } from './components/status-bar.js';
import { createInputBar } from './components/input-bar.js';
import { createAutocomplete } from './components/autocomplete.js';
import { createApprovalDialog } from './components/approval-dialog.js';
import { createPlanProgress } from './components/plan-progress.js';
import { renderTodos } from './components/todo-list.js';
import { renderStreamdown } from './components/streamdown-renderer.jsx';
import { createSessionPanel, renderSessions } from './components/session-panel.js';
import { createConfigPanel, renderConfigPanel } from './components/config-panel.js';
import { initProjectSelector, updateProjectDisplay, openProjectModal } from './components/project-selector.js';
import { icon } from './utils/icons.js';

// ── DOM refs ──
const statusBarEl = document.getElementById('status-bar');
const chatPanelEl = document.getElementById('chat-panel');
const planProgressEl = document.getElementById('plan-progress');
const approvalOverlay = document.getElementById('approval-overlay');
const backToTopEl = document.getElementById('back-to-top');
const inputAreaEl = document.getElementById('input-area');
const inputBarEl = document.getElementById('input-bar');
const autocompleteEl = document.getElementById('autocomplete');
const viewSessionsEl = document.getElementById('view-sessions');
const configOverlayEl = document.getElementById('config-overlay');
const themeToggleEl = document.getElementById('theme-toggle');
const settingsToggleEl = document.getElementById('settings-toggle');
const projectSessionListEl = document.getElementById('project-session-list');
const conversationSessionListEl = document.getElementById('conversation-session-list');
const sidebarSessionLimits = { project: 20, conversation: 20 };
const projectSessionLimits = new Map();
const expandedProjectKeys = new Set();
let creatingSession = false;

// ── Store ──
const store = createStore({
  stage: 'idle',
  busy: false,
  currentView: 'chat',
  runtimeState: null
});

// ── View Navigation ──
const views = { chat: document.getElementById('view-chat'), sessions: viewSessionsEl };
const navItems = document.querySelectorAll('.nav-item');

function parseRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const chatMatch = path.match(/^\/chat\/([^/]+)$/);
  if (chatMatch) return { view: 'chat', sessionId: decodeURIComponent(chatMatch[1]) };
  if (path === '/sessions') return { view: 'sessions' };
  if (path === '/settings' || path === '/config') return { view: 'config' };
  return { view: 'chat' };
}

function routeFor(view, sessionId = store.get('runtimeState')?.sessionId) {
  if (view === 'sessions') return '/sessions';
  if (view === 'config') return '/settings';
  return sessionId ? `/chat/${encodeURIComponent(sessionId)}` : '/';
}

function updateRoute(view, sessionId, { replace = false } = {}) {
  const next = routeFor(view, sessionId);
  if (window.location.pathname === next) return;
  const state = { view, sessionId: sessionId || null };
  if (replace) window.history.replaceState(state, '', next);
  else window.history.pushState(state, '', next);
}

function switchView(name, { updateUrl = true, replace = false } = {}) {
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle('hidden', key !== name);
  }
  navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
  store.set({ currentView: name });
  if (updateUrl) updateRoute(name, undefined, { replace });
  if (name === 'sessions') loadSessions();
}
navItems.forEach(btn => btn.addEventListener('click', () => {
  if (btn.dataset.view) {
    switchView(btn.dataset.view);
    return;
  }
  if (btn.dataset.action === 'new-session') handleSessionNew();
}));
document.querySelectorAll('[data-action="open-project"]').forEach((btn) => {
  btn.addEventListener('click', () => openProjectModal());
});
settingsToggleEl?.addEventListener('click', () => { loadConfig(); configOverlayEl.classList.remove('hidden'); });
document.querySelectorAll('.collapsible-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.collapseTarget);
    if (!target) return;
    const collapsed = target.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.classList.toggle('collapsed', collapsed);
  });
});

window.addEventListener('popstate', async () => {
  const route = parseRoute();
  if (route.sessionId) {
    await restoreRouteSession();
    await loadStateQuiet();
    await loadSessionMessages({ replace: true });
    loadSidebarSessionsQuiet();
  }
  switchView(route.view, { updateUrl: false });
});

// ── Theme ──
function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('codemini-theme', next);
  if (themeToggleEl) {
    themeToggleEl.querySelector('.theme-label').textContent = next === 'dark' ? '浅色' : '深色';
    themeToggleEl.title = next === 'dark' ? '切换到浅色模式' : '切换到深色模式';
  }
}

applyTheme(document.documentElement.dataset.theme || 'light');
themeToggleEl?.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

// ── Chat Components ──
const chatPanel = createChatPanel(chatPanelEl);
const statusBar = createStatusBar(statusBarEl);
const inputBar = createInputBar(inputBarEl || inputAreaEl, {
  onSubmit: handleSubmit,
  onAbort: handleAbort,
  onCompletionRequest: handleCompletionRequest
});
const autocomplete = createAutocomplete(autocompleteEl, {
  onSelect: (opt) => { inputBar.textarea.value = (opt.value || opt.name) + ' '; autocomplete.hide(); inputBar.focus(); }
});
const approvalDialog = createApprovalDialog(approvalOverlay, { onDecision: handleApprovalDecision });
const planProgress = createPlanProgress(planProgressEl);

// ── Session & Config Panels ──
const sessionPanel = createSessionPanel(viewSessionsEl, { onSwitch: handleSessionSwitch, onNew: handleSessionNew });
const configPanel = createConfigPanel(configOverlayEl, { onSave: handleConfigSave, onClose: () => configOverlayEl.classList.add('hidden') });

// ── Project Selector (sidebar footer click → modal) ──
initProjectSelector(handleProjectOpen);

// ── SSE ──
let es = null;
let reconnectTimer = null;
function connectSSE() {
  es = new EventSource('/api/events');
  es.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch (err) { console.error('SSE:', err); } };
  es.onerror = () => { es.close(); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connectSSE, 3000); };
}

// ── Init ──
async function init() {
  await restoreRouteSession();
  try { const res = await fetch('/api/startup-events'); for (const ev of await res.json()) renderStartupEvent(ev); } catch {}
  try {
    const res = await fetch('/api/state');
    const state = await res.json();
    store.set({ runtimeState: state });
    statusBar.updateRuntimeState(state);
    inputBar.setRuntimeState(state);
    updateProjectDisplay(state.cwd);
    updateRoute(parseRoute().view, state.sessionId, { replace: true });
  } catch {}
  if (parseRoute().view === 'chat') await loadSessionMessages({ replace: true });
  switchView(parseRoute().view, { updateUrl: false });
  try { inputBar.setHistory(await (await fetch('/api/history')).json()); } catch {}
  loadSidebarSessionsQuiet();
  connectSSE();
  inputBar.focus();
  statusBar.setLive(false);
}

async function restoreRouteSession() {
  const route = parseRoute();
  if (!route.sessionId) return;
  try {
    const state = await (await fetch('/api/state')).json();
    if (state.sessionId === route.sessionId) return;
    await fetch('/api/sessions/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: route.sessionId })
    });
  } catch {}
}

// ── Event Dispatcher ──
let activeMsg = null;
let pendingToolChanges = [];

function setMessageText(wrapper, text) {
  if (!wrapper) return;
  wrapper._currentText = text || '';
  renderStreamdown(wrapper._body, wrapper._currentText);
}

function ensureTextTarget(wrapper) {
  if (!wrapper) return;
  if (!wrapper._body || wrapper._bubble.lastElementChild !== wrapper._body) {
    startTextSegment(wrapper);
  }
}

function handleEvent(event) {
  if (!event?.type) return;
  if (isProjectIndexEvent(event)) return;
  switch (event.type) {
    case 'connected': break;
    case 'assistant:start':
      if (store.get('currentView') !== 'chat') switchView('chat');
      if (!activeMsg) {
        activeMsg = createMessageBubble({ role: 'general', timestamp: new Date().toISOString() });
        chatPanel.append(activeMsg);
      }
      store.set({ stage: 'thinking', busy: true });
      statusBar.setLive(true, t('thinking'));
      inputBar.setBusy(true);
      break;
    case 'assistant:delta':
      if (activeMsg && event.text) { ensureTextTarget(activeMsg); appendDelta(activeMsg, event.text); chatPanel.scrollToBottom(); }
      store.set({ stage: 'streaming' }); statusBar.setLive(true, t('streaming'));
      break;
    case 'assistant:tool_call_delta': break;
    case 'assistant:response':
      if (activeMsg) {
        if (event.text) { ensureTextTarget(activeMsg); setMessageText(activeMsg, event.text); }
        finishStreaming(activeMsg); chatPanel.scrollToBottom();
      }
      break;
    case 'tool:start':
      store.set({ stage: 'tooling' }); statusBar.setLive(true, t('tooling'));
      if (activeMsg) { addToolCard(activeMsg, event); chatPanel.scrollToBottom(); }
      break;
    case 'tool:end':
      if (activeMsg) { updateToolInMessage(activeMsg, event); if (event.fileChange) pendingToolChanges.push(event.fileChange); }
      break;
    case 'tool:result':
      if (activeMsg) updateToolInMessage(activeMsg, event);
      break;
    case 'tool:error': if (activeMsg) updateToolInMessage(activeMsg, event); break;
    case 'tool:blocked': if (activeMsg) updateToolInMessage(activeMsg, event); break;
    case 'system_tool:start':
      chatPanel.append(createMessageBubble({ role: 'system', text: `${event.name || 'System'}: ${event.summary || ''}`, timestamp: new Date().toISOString() }));
      break;
    case 'plan:steps': planProgress.setSteps(event.steps || []); break;
    case 'plan:progress': planProgress.updateProgress(event); break;
    case 'skill:start': if (activeMsg) addSkillBadge(activeMsg, event.name, 'running'); break;
    case 'skill:end': if (activeMsg) addSkillBadge(activeMsg, event.name, 'done'); break;
    case 'skill:error': if (activeMsg) addSkillBadge(activeMsg, event.name, 'error'); break;
    case 'skill:auto': if (activeMsg) addSkillBadge(activeMsg, (event.names || []).join(', '), 'auto'); break;
    case 'compact:auto':
      chatPanel.append(createMessageBubble({ role: 'system', text: `Context auto-compacted (${event.mode || ''}, ${event.threshold || ''}%)`, timestamp: new Date().toISOString() }));
      break;
    case 'dream:auto': chatPanel.append(createMessageBubble({ role: 'system', text: 'Dream triggered...', timestamp: new Date().toISOString() })); break;
    case 'dream:complete': chatPanel.append(createMessageBubble({ role: 'system', text: 'Dream complete', timestamp: new Date().toISOString() })); break;
    case 'approval:request': approvalDialog.show(event); break;
    case 'submit:done': {
      const result = event.result || {};
      if (activeMsg && pendingToolChanges.length) { addFileChanges(activeMsg, pendingToolChanges); pendingToolChanges = []; }
      if (activeMsg) finishStreaming(activeMsg);
      if (result.type === 'system' && result.text) chatPanel.append(createMessageBubble({ role: 'system', text: result.text, timestamp: new Date().toISOString() }));
      activeMsg = null; store.set({ stage: 'idle', busy: false }); statusBar.setLive(false); inputBar.setBusy(false); inputBar.focus();
      loadHistoryQuiet(); loadSidebarSessionsQuiet();
      break;
    }
    case 'runtime:switched':
      chatPanel.clear(); activeMsg = null; pendingToolChanges = []; planProgress.hide();
      updateRoute('chat', event.sessionId, { replace: false });
      loadStateQuiet().then(() => loadSidebarSessionsQuiet()); loadHistoryQuiet();
      loadSessionMessages({ replace: true });
      break;
  }
}

// ── Chat Actions ──
async function handleSubmit(line) {
  if (!line.trim()) return;
  if (store.get('currentView') !== 'chat') switchView('chat');
  chatPanel.append(createMessageBubble({ role: 'you', text: line, timestamp: new Date().toISOString() }));
  autocomplete.hide(); inputBar.setHint('');
  try {
    await fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line }) });
  } catch (err) {
    chatPanel.append(createMessageBubble({ role: 'error', text: `Failed: ${err.message}`, timestamp: new Date().toISOString() }));
    inputBar.setBusy(false); statusBar.setLive(false);
  }
}
async function handleAbort() { try { await fetch('/api/abort', { method: 'POST' }); } catch {} }
async function handleApprovalDecision(id, approved) {
  approvalDialog.hide();
  try { await fetch('/api/approval', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, approved }) }); } catch {}
}
async function handleCompletionRequest(input) {
  try {
    const opts = await (await fetch(`/api/completions?q=${encodeURIComponent(input)}`)).json();
    Array.isArray(opts) && opts.length ? autocomplete.show(opts) : autocomplete.hide();
  } catch { autocomplete.hide(); }
}

// ── Sessions ──
async function loadSessions() {
  try {
    const sessions = await (await fetch('/api/sessions')).json();
    const currentId = store.get('runtimeState')?.sessionId;
    renderSessions(sessionPanel, sessions, currentId);
    renderSidebarSessions(sessions, currentId);
  } catch (err) { console.error('loadSessions:', err); }
}
async function handleSessionSwitch(sessionId) {
  try {
    const res = await fetch('/api/sessions/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
    const result = await res.json();
    if (result.ok) {
      switchView('chat', { updateUrl: false });
      updateRoute('chat', sessionId);
      updateProjectDisplay(result.cwd);
      await loadStateQuiet();
      await loadSessionMessages({ replace: true });
      loadSidebarSessionsQuiet();
    }
    else alert(result.message || 'Switch failed');
  } catch (err) { alert('Switch failed: ' + err.message); }
}
async function handleSessionNew() {
  if (creatingSession) return;
  creatingSession = true;
  try {
    const res = await fetch('/api/sessions/new', { method: 'POST' });
    const result = await res.json();
    if (result.ok) {
      switchView('chat', { updateUrl: false });
      updateRoute('chat', result.sessionId);
      updateProjectDisplay(result.cwd);
      await loadStateQuiet();
      chatPanel.clear();
      loadSidebarSessionsQuiet();
    }
    else alert(result.message || 'Failed');
  } catch (err) { alert('Failed: ' + err.message); }
  finally { creatingSession = false; }
}

// ── Config ──
async function loadConfig() {
  try {
    const config = await (await fetch('/api/config')).json();
    renderConfigPanel(configPanel, config);
  } catch (err) { console.error('loadConfig:', err); }
}
async function handleConfigSave(changes) {
  if (!changes?.length) return;
  try {
    for (const { path: p, value } of changes) {
      await fetch('/api/config/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: p, value }) });
    }
    alert('Settings saved. Some changes apply on next session.');
  } catch (err) { alert('Save failed: ' + err.message); }
}

// ── Project ──
async function handleProjectOpen(projectPath) {
  try {
    const res = await fetch('/api/project/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: projectPath }) });
    const result = await res.json();
    if (result.ok) {
      updateProjectDisplay(result.cwd);
      switchView('chat', { updateUrl: false });
      updateRoute('chat', result.sessionId);
      await loadStateQuiet();
      chatPanel.clear();
      loadSidebarSessionsQuiet();
    }
    else alert(result.message || 'Failed');
  } catch (err) { alert('Failed: ' + err.message); }
}

// ── Quiet loaders ──
async function loadStateQuiet() {
  try {
    const state = await (await fetch('/api/state')).json();
    store.set({ runtimeState: state }); statusBar.updateRuntimeState(state); inputBar.setRuntimeState(state); updateProjectDisplay(state.cwd);
  } catch {}
}
async function loadStartupQuiet() {
  try { for (const ev of await (await fetch('/api/startup-events')).json()) renderStartupEvent(ev); } catch {}
}
async function loadHistoryQuiet() {
  try { inputBar.setHistory(await (await fetch('/api/history')).json()); } catch {}
}
async function loadSidebarSessionsQuiet() {
  try {
    const sessions = await (await fetch('/api/sessions')).json();
    renderSidebarSessions(sessions, store.get('runtimeState')?.sessionId);
  } catch {}
}
function renderSidebarSessions(sessions, currentId) {
  renderSidebarProjectGroups(projectSessionListEl, sessions, currentId);
  renderSidebarSessionList(conversationSessionListEl, sessions, currentId, 'conversation');
}
function getProjectKey(session) {
  return session?.projectDir || 'unknown';
}
function getProjectName(projectDir) {
  if (!projectDir || projectDir === 'unknown') return '未知项目';
  return String(projectDir).split(/[/\\]/).filter(Boolean).pop() || projectDir;
}
function renderSidebarProjectGroups(container, sessions, currentId) {
  if (!container) return;
  container.textContent = '';
  const allSessions = Array.isArray(sessions) ? sessions : [];
  if (!allSessions.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-row';
    empty.textContent = '暂无对话';
    container.appendChild(empty);
    return;
  }

  const groups = new Map();
  for (const session of allSessions) {
    const key = getProjectKey(session);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }

  for (const [projectKey, projectSessions] of groups) {
    const isExpanded = expandedProjectKeys.has(projectKey);
    const projectButton = document.createElement('button');
    projectButton.type = 'button';
    projectButton.className = `project-row project-history-row ${isExpanded ? 'expanded' : ''}`;
    projectButton.title = projectKey === 'unknown' ? '' : projectKey;
    const name = document.createElement('span');
    name.textContent = getProjectName(projectKey);
    const count = document.createElement('span');
    count.className = 'project-count';
    count.textContent = String(projectSessions.length);
    projectButton.append(icon('Folder'), name, count, icon('ChevronDown', { className: 'collapse-chevron' }));
    projectButton.addEventListener('click', () => {
      if (expandedProjectKeys.has(projectKey)) expandedProjectKeys.delete(projectKey);
      else expandedProjectKeys.add(projectKey);
      renderSidebarProjectGroups(container, allSessions, currentId);
    });
    container.appendChild(projectButton);

    if (!isExpanded) continue;
    const childList = document.createElement('div');
    childList.className = 'sidebar-session-list project-child-session-list';
    container.appendChild(childList);
    renderProjectSessionList(childList, projectSessions, currentId, projectKey);
  }
}
function renderProjectSessionList(container, sessions, currentId, projectKey) {
  container.textContent = '';
  const limit = projectSessionLimits.get(projectKey) || 20;
  const visible = sessions.slice(0, limit);
  for (const session of visible) appendSidebarSessionButton(container, session, currentId);
  if (sessions.length > visible.length) {
    appendLoadMoreButton(container, Math.min(20, sessions.length - visible.length), () => {
      projectSessionLimits.set(projectKey, limit + 20);
      renderProjectSessionList(container, sessions, currentId, projectKey);
    });
  }
}
function renderSidebarSessionList(container, sessions, currentId, kind) {
  if (!container) return;
  container.textContent = '';
  const allSessions = Array.isArray(sessions) ? sessions : [];
  const limit = sidebarSessionLimits[kind] || 20;
  const visible = allSessions.slice(0, limit);
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-row';
    empty.textContent = container === projectSessionListEl ? '暂无对话' : '暂无聊天';
    container.appendChild(empty);
    return;
  }
  for (const session of visible) appendSidebarSessionButton(container, session, currentId);
  if (allSessions.length > visible.length) {
    appendLoadMoreButton(container, Math.min(20, allSessions.length - visible.length), () => {
      sidebarSessionLimits[kind] = limit + 20;
      renderSidebarSessionList(container, allSessions, currentId, kind);
    });
  }
}
function appendSidebarSessionButton(container, session, currentId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `sidebar-session ${session.id === currentId ? 'active' : ''}`;
  button.title = session.preview || session.id || '';
  const label = document.createElement('span');
  label.className = 'sidebar-session-title';
  label.textContent = session.title || session.preview || (session.messageCount > 0 ? `${session.messageCount} messages` : '空对话');
  const meta = document.createElement('span');
  meta.className = 'sidebar-session-meta';
  meta.textContent = session.updatedAt ? new Date(session.updatedAt).toLocaleDateString() : '';
  button.append(label, meta);
  if (session.id !== currentId) button.addEventListener('click', () => handleSessionSwitch(session.id));
  container.appendChild(button);
}
function appendLoadMoreButton(container, count, onClick) {
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'sidebar-load-more';
  more.textContent = `继续加载 ${count} 条`;
  more.addEventListener('click', onClick);
  container.appendChild(more);
}
async function loadSessionMessages({ replace = false } = {}) {
  try {
    const messages = await (await fetch('/api/session/messages')).json();
    if (replace) {
      chatPanel.clear();
      activeMsg = null;
      pendingToolChanges = [];
    }
    if (!Array.isArray(messages) || !messages.length) return;
    let assistantGroup = null;
    for (const msg of messages) {
      if (msg.role === 'user') {
        chatPanel.append(createMessageBubble({ role: 'you', text: msg.content || '', timestamp: msg.at || new Date().toISOString() }));
        assistantGroup = null;
      } else if (msg.role === 'assistant') {
        if (!assistantGroup) {
          assistantGroup = createMessageBubble({ role: 'general', timestamp: msg.at || new Date().toISOString() });
          chatPanel.append(assistantGroup);
        }
        if (msg.content) {
          ensureTextTarget(assistantGroup);
          setMessageText(assistantGroup, msg.content);
        }
        if (msg.toolCalls && msg.toolCalls.length) {
          for (const tc of msg.toolCalls) {
            addToolCard(assistantGroup, { id: tc.id, name: tc.function?.name || tc.name || 'tool', arguments: tc.function?.arguments || tc.arguments || {} });
            updateToolInMessage(assistantGroup, {
              id: tc.id,
              name: tc.function?.name || tc.name || 'tool',
              type: 'tool:end',
              arguments: tc.function?.arguments || tc.arguments || {},
              durationMs: tc.durationMs,
              summary: tc.summary || '',
              status: tc.status || 'done'
            });
          }
        }
      } else if (msg.role === 'tool' && assistantGroup) {
        const toolId = msg.toolCallId || msg.tool_call_id;
        if (msg.toolSummary || Number.isFinite(Number(msg.toolDurationMs)) || msg.toolStatus) {
          updateToolInMessage(assistantGroup, {
            id: toolId,
            name: 'tool',
            type: msg.toolStatus === 'error' ? 'tool:error' : msg.toolStatus === 'blocked' ? 'tool:blocked' : 'tool:end',
            durationMs: msg.toolDurationMs,
            summary: msg.toolSummary || ''
          });
        }
        updateToolInMessage(assistantGroup, {
          id: toolId,
          name: 'tool',
          type: 'tool:result',
          content: msg.content || ''
        });
      }
    }
    chatPanel.scrollToBottom();
  } catch {}
}

// ── UI ──
chatPanelEl.addEventListener('scroll', () => backToTopEl.classList.toggle('hidden', chatPanelEl.scrollTop <= 400));
backToTopEl.addEventListener('click', () => chatPanelEl.scrollTo({ top: 0, behavior: 'smooth' }));

function isProjectIndexEvent(event) {
  const name = String(event?.name || '').toLowerCase();
  const summary = String(event?.summary || '').toLowerCase();
  return name.includes('project_index')
    || name.includes('initializeprojectindex')
    || summary.includes('project_index(')
    || summary.includes('initialized ') && summary.includes('/.codemini');
}

function renderStartupEvent(event) {
  if (!event) return;
  const name = event.name || '';
  if (isProjectIndexEvent(event)) return;
  if (event.type === 'system_tool' || event.type === 'tool') {
    const summary = event.summary || '';
    if (summary || name) chatPanel.append(createMessageBubble({ role: 'system', text: summary ? `${name}: ${summary}` : name, timestamp: new Date().toISOString() }));
    if (event.arguments?.todos) { const last = chatPanelEl.lastElementChild; if (last) renderTodos(last._bubble || last, event.arguments.todos); }
  }
}

init();
