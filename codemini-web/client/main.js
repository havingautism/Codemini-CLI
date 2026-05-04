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
import { renderMarkdown } from './components/markdown-renderer.js';
import { highlightCodeBlocks } from './components/code-block.js';
import { createSessionPanel, renderSessions } from './components/session-panel.js';
import { createConfigPanel, renderConfigPanel } from './components/config-panel.js';
import { initProjectSelector, updateProjectDisplay } from './components/project-selector.js';

// ── DOM refs ──
const statusBarEl = document.getElementById('status-bar');
const chatPanelEl = document.getElementById('chat-panel');
const planProgressEl = document.getElementById('plan-progress');
const approvalOverlay = document.getElementById('approval-overlay');
const backToTopEl = document.getElementById('back-to-top');
const inputAreaEl = document.getElementById('input-area');
const autocompleteEl = document.getElementById('autocomplete');
const viewSessionsEl = document.getElementById('view-sessions');
const viewConfigEl = document.getElementById('view-config');

// ── Store ──
const store = createStore({
  stage: 'idle',
  busy: false,
  currentView: 'chat',
  runtimeState: null
});

// ── View Navigation ──
const views = { chat: document.getElementById('view-chat'), sessions: viewSessionsEl, config: viewConfigEl };
const navItems = document.querySelectorAll('.nav-item');

function switchView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle('hidden', key !== name);
  }
  navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
  store.set({ currentView: name });
  if (name === 'sessions') loadSessions();
  if (name === 'config') loadConfig();
}
navItems.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

// ── Chat Components ──
const chatPanel = createChatPanel(chatPanelEl);
const statusBar = createStatusBar(statusBarEl);
const inputBar = createInputBar(inputAreaEl, {
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
const configPanel = createConfigPanel(viewConfigEl, { onSave: handleConfigSave });

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
  try { const res = await fetch('/api/startup-events'); for (const ev of await res.json()) renderStartupEvent(ev); } catch {}
  try {
    const res = await fetch('/api/state');
    const state = await res.json();
    store.set({ runtimeState: state });
    statusBar.updateRuntimeState(state);
    updateProjectDisplay(state.cwd);
  } catch {}
  try { inputBar.setHistory(await (await fetch('/api/history')).json()); } catch {}
  connectSSE();
  inputBar.focus();
  statusBar.setLive(false);
}

// ── Event Dispatcher ──
let activeMsg = null;
let pendingToolChanges = [];

function setMessageText(wrapper, text) {
  if (!wrapper) return;
  wrapper._currentText = text || '';
  wrapper._body.innerHTML = renderMarkdown(wrapper._currentText);
  highlightCodeBlocks(wrapper._body);
}

function ensureTextTarget(wrapper) {
  if (!wrapper) return;
  if (!wrapper._body || wrapper._bubble.lastElementChild !== wrapper._body) {
    startTextSegment(wrapper);
  }
}

function handleEvent(event) {
  if (!event?.type) return;
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
      loadHistoryQuiet();
      break;
    }
    case 'runtime:switched':
      chatPanel.clear(); activeMsg = null; pendingToolChanges = []; planProgress.hide();
      loadStateQuiet(); loadHistoryQuiet();
      loadSessionMessages();
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
  } catch (err) { console.error('loadSessions:', err); }
}
async function handleSessionSwitch(sessionId) {
  try {
    const res = await fetch('/api/sessions/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
    const result = await res.json();
    if (result.ok) { switchView('chat'); updateProjectDisplay(result.cwd); }
    else alert(result.message || 'Switch failed');
  } catch (err) { alert('Switch failed: ' + err.message); }
}
async function handleSessionNew() {
  try {
    const res = await fetch('/api/sessions/new', { method: 'POST' });
    const result = await res.json();
    if (result.ok) { switchView('chat'); updateProjectDisplay(result.cwd); }
    else alert(result.message || 'Failed');
  } catch (err) { alert('Failed: ' + err.message); }
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
    if (result.ok) { updateProjectDisplay(result.cwd); switchView('chat'); }
    else alert(result.message || 'Failed');
  } catch (err) { alert('Failed: ' + err.message); }
}

// ── Quiet loaders ──
async function loadStateQuiet() {
  try {
    const state = await (await fetch('/api/state')).json();
    store.set({ runtimeState: state }); statusBar.updateRuntimeState(state); updateProjectDisplay(state.cwd);
  } catch {}
}
async function loadStartupQuiet() {
  try { for (const ev of await (await fetch('/api/startup-events')).json()) renderStartupEvent(ev); } catch {}
}
async function loadHistoryQuiet() {
  try { inputBar.setHistory(await (await fetch('/api/history')).json()); } catch {}
}
async function loadSessionMessages() {
  try {
    const messages = await (await fetch('/api/session/messages')).json();
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
              durationMs: 0,
              summary: ''
            });
          }
        }
      } else if (msg.role === 'tool' && assistantGroup) {
        updateToolInMessage(assistantGroup, {
          id: msg.toolCallId || msg.tool_call_id,
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

function renderStartupEvent(event) {
  if (!event) return;
  const name = event.name || '';
  if (name === 'project_index' || name === 'initializeProjectIndex') return;
  if (event.type === 'system_tool' || event.type === 'tool') {
    const summary = event.summary || '';
    if (summary || name) chatPanel.append(createMessageBubble({ role: 'system', text: summary ? `${name}: ${summary}` : name, timestamp: new Date().toISOString() }));
    if (event.arguments?.todos) { const last = chatPanelEl.lastElementChild; if (last) renderTodos(last._bubble || last, event.arguments.todos); }
  }
}

init();
