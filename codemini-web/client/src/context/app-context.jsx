import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/index.js';
import * as api from '../hooks/use-api.js';

const AppContext = createContext(null);

function isProjectIndexEvent(event) {
  const name = String(event?.name || '').toLowerCase();
  const summary = String(event?.summary || '').toLowerCase();
  return name.includes('project_index')
    || name.includes('initializeprojectindex')
    || summary.includes('project_index(')
    || summary.includes('initialized ') && summary.includes('/.codemini');
}

function parseRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const chatMatch = path.match(/^\/chat\/([^/]+)$/);
  if (chatMatch) return { view: 'chat', sessionId: decodeURIComponent(chatMatch[1]) };
  if (path === '/sessions') return { view: 'sessions' };
  return { view: 'chat' };
}

function routeFor(view, sessionId) {
  if (view === 'sessions') return '/sessions';
  return sessionId ? `/chat/${encodeURIComponent(sessionId)}` : '/';
}

function updateRoute(view, sessionId, { replace = false } = {}) {
  const next = routeFor(view, sessionId);
  if (window.location.pathname === next) return;
  const st = { view, sessionId: sessionId || null };
  if (replace) window.history.replaceState(st, '', next);
  else window.history.pushState(st, '', next);
}

const initialState = {
  stage: 'idle', busy: false, currentView: 'chat', runtimeState: null,
  live: false, stageLabel: '', messages: [], activeMsgId: null,
  pendingToolChanges: [], planSteps: [], approvalRequest: null,
  config: null, configOpen: false, projectOpen: false,
  sessions: [], projectCwd: null, history: [],
};

function updateToolInSegments(segments, toolId, updater) {
  return segments.map(seg => {
    if (seg.type !== 'tools') return seg;
    const idx = seg.cards.findIndex(c => c.id === toolId);
    if (idx === -1) return seg;
    const newCards = [...seg.cards];
    newCards[idx] = updater(newCards[idx]);
    return { ...seg, cards: newCards };
  });
}

function addToolToSegments(segments, toolCard) {
  if (segments.length === 0) return [{ type: 'tools', cards: [toolCard] }];
  const last = segments[segments.length - 1];
  if (last.type === 'tools') return [...segments.slice(0, -1), { ...last, cards: [...last.cards, toolCard] }];
  return [...segments, { type: 'tools', cards: [toolCard] }];
}

function ensureTextSegment(segments) {
  if (segments.length === 0) return [{ type: 'text', text: '', isStreaming: false }];
  const last = segments[segments.length - 1];
  if (last.type === 'text') return segments;
  return [...segments, { type: 'text', text: '', isStreaming: false }];
}

function appendDeltaToSegments(segments, delta) {
  const segs = ensureTextSegment(segments);
  const last = segs[segs.length - 1];
  return [...segs.slice(0, -1), { ...last, text: (last.text || '') + delta, isStreaming: true }];
}

// Helper to update messages immutably while preserving all other state
function mapMessages(prev, activeId, mapper) {
  return { ...prev, messages: prev.messages.map(m => m.id === activeId ? mapper(m) : m) };
}

export function AppProvider({ children }) {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeMsgRef = useRef(null);
  const pendingChangesRef = useRef([]);
  const sseRef = useRef(null);
  const reconnectRef = useRef(null);

  const update = useCallback((updates) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const addMessage = useCallback((msg) => {
    const id = msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const segments = [];
    if (msg.text) segments.push({ type: 'text', text: msg.text, isStreaming: msg.isStreaming || false });
    const newMsg = { ...msg, id, segments, skillBadges: [], fileChanges: [] };
    setState(prev => ({ ...prev, messages: [...prev.messages, newMsg] }));
    return id;
  }, []);

  const setActiveMsg = useCallback((id) => {
    activeMsgRef.current = id;
    update({ activeMsgId: id });
  }, [update]);

  const loadState = useCallback(async () => {
    try {
      const rs = await api.fetchState();
      const projectName = rs.cwd?.split(/[/\\]/).pop() || rs.cwd || '...';
      update({ runtimeState: rs, projectCwd: projectName });
      return rs;
    } catch { return null; }
  }, [update]);

  const loadHistory = useCallback(async () => {
    try {
      const history = await api.fetchHistory();
      update({ history: Array.isArray(history) ? history : [] });
    } catch {}
  }, [update]);

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await api.fetchSessions();
      update({ sessions: Array.isArray(sessions) ? sessions : [] });
    } catch {}
  }, [update]);

  const loadSessionMessages = useCallback(async () => {
    try {
      const messages = await api.fetchSessionMessages();
      if (!Array.isArray(messages) || !messages.length) return;
      const processed = [];
      let assistantGroup = null;
      for (const msg of messages) {
        if (msg.role === 'user') {
          assistantGroup = null;
          processed.push({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-u${processed.length}`,
            role: 'you', segments: [{ type: 'text', text: msg.content || '', isStreaming: false }],
            skillBadges: [], fileChanges: [],
          });
        } else if (msg.role === 'assistant') {
          if (!assistantGroup) {
            assistantGroup = {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-a${processed.length}`,
              role: 'general', segments: [], skillBadges: [], fileChanges: [],
            };
            processed.push(assistantGroup);
          }
          if (msg.content) assistantGroup.segments.push({ type: 'text', text: msg.content, isStreaming: false });
          if (msg.toolCalls && msg.toolCalls.length) {
            assistantGroup.segments.push({
              type: 'tools',
              cards: msg.toolCalls.map(tc => ({
                id: tc.id, name: tc.function?.name || tc.name || 'tool',
                arguments: tc.function?.arguments || tc.arguments || {},
                status: tc.status || 'done', durationMs: tc.durationMs, summary: tc.summary || '', result: '',
              })),
            });
          }
        } else if (msg.role === 'tool' && assistantGroup) {
          const toolId = msg.toolCallId || msg.tool_call_id;
          if (!toolId) continue;
          for (const seg of assistantGroup.segments) {
            if (seg.type !== 'tools') continue;
            const card = seg.cards.find(c => c.id === toolId);
            if (!card) continue;
            if (msg.toolSummary) card.summary = msg.toolSummary;
            if (msg.toolDurationMs != null) card.durationMs = msg.toolDurationMs;
            if (msg.toolStatus === 'error') card.status = 'error';
            if (msg.toolStatus === 'blocked') card.status = 'blocked';
            if (msg.content) card.result = msg.content;
            break;
          }
        }
      }
      update({ messages: processed });
    } catch {}
  }, [update]);

  const handleEvent = useCallback((event) => {
    if (!event?.type) return;
    if (isProjectIndexEvent(event)) return;
    const s = stateRef.current;
    const activeId = activeMsgRef.current;

    switch (event.type) {
      case 'connected': break;

      case 'assistant:start': {
        if (s.currentView !== 'chat') update({ currentView: 'chat' });
        let msgId = activeId;
        if (!msgId) {
          msgId = addMessage({ role: 'general', timestamp: new Date().toISOString(), text: '', isStreaming: false });
          setActiveMsg(msgId);
        }
        update({ stage: 'thinking', busy: true, live: true, stageLabel: t('thinking') });
        break;
      }

      case 'assistant:delta': {
        if (activeId && event.text) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m =>
            m.id === activeId ? { ...m, segments: appendDeltaToSegments(m.segments, event.text) } : m
          ) }));
        }
        update({ stage: 'streaming', live: true, stageLabel: t('streaming') });
        break;
      }

      case 'assistant:tool_call_delta': break;

      case 'assistant:response': {
        if (activeId) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m => {
            if (m.id !== activeId) return m;
            if (event.text) {
              const segs = ensureTextSegment(m.segments);
              const lastIdx = segs.length - 1;
              return { ...m, segments: segs.map((seg, i) => i === lastIdx && seg.type === 'text' ? { ...seg, text: event.text, isStreaming: false } : seg) };
            }
            return { ...m, segments: m.segments.map(seg => seg.type === 'text' ? { ...seg, isStreaming: false } : seg) };
          }) }));
        }
        break;
      }

      case 'tool:start': {
        update({ stage: 'tooling', live: true, stageLabel: t('tooling') });
        if (activeId) {
          const toolCard = { id: event.id, name: event.name, arguments: event.arguments, status: 'running', durationMs: null, summary: '', result: '' };
          setState(prev => ({ ...prev, messages: prev.messages.map(m => m.id === activeId ? { ...m, segments: addToolToSegments(m.segments, toolCard) } : m) }));
        }
        break;
      }

      case 'tool:end': {
        if (activeId) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m => {
            if (m.id !== activeId) return m;
            if (event.fileChange) pendingChangesRef.current = [...pendingChangesRef.current, event.fileChange];
            return {
              ...m, segments: updateToolInSegments(m.segments, event.id, tc => {
                const u = { ...tc, status: 'done', durationMs: event.durationMs };
                if (event.summary) u.summary = event.summary;
                return u;
              })
            };
          }) }));
        }
        break;
      }

      case 'tool:result': {
        if (activeId) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m =>
            m.id !== activeId ? m : { ...m, segments: updateToolInSegments(m.segments, event.id, tc => ({ ...tc, result: event.content || '' })) }
          ) }));
        }
        break;
      }

      case 'tool:error': {
        if (activeId) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m =>
            m.id !== activeId ? m : { ...m, segments: updateToolInSegments(m.segments, event.id, tc => ({ ...tc, status: 'error', durationMs: event.durationMs, summary: event.summary || tc.summary })) }
          ) }));
        }
        break;
      }

      case 'tool:blocked': {
        if (activeId) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m =>
            m.id !== activeId ? m : { ...m, segments: updateToolInSegments(m.segments, event.id, tc => ({ ...tc, status: 'blocked', summary: t('toolBlocked') })) }
          ) }));
        }
        break;
      }

      case 'system_tool:start': {
        addMessage({ role: 'system', text: `${event.name || 'System'}: ${event.summary || ''}`, timestamp: new Date().toISOString() });
        break;
      }

      case 'plan:steps': {
        const steps = (event.steps || []).map((s, i) => ({ index: s.index ?? i, title: s.title, role: s.role, status: 'pending' }));
        update({ planSteps: steps });
        break;
      }

      case 'plan:progress': {
        const { step, status } = event;
        setState(prev => ({ ...prev, planSteps: prev.planSteps.map((s, i) => i === step - 1 ? { ...s, status } : s) }));
        break;
      }

      case 'skill:start': {
        if (activeId) setState(prev => ({ ...prev, messages: prev.messages.map(m => m.id === activeId ? { ...m, skillBadges: [...m.skillBadges, { name: event.name, status: 'running' }] } : m) }));
        break;
      }
      case 'skill:end': {
        if (activeId) setState(prev => ({ ...prev, messages: prev.messages.map(m => m.id === activeId ? { ...m, skillBadges: m.skillBadges.map(b => b.name === event.name ? { ...b, status: 'done' } : b) } : m) }));
        break;
      }
      case 'skill:error': {
        if (activeId) setState(prev => ({ ...prev, messages: prev.messages.map(m => m.id === activeId ? { ...m, skillBadges: m.skillBadges.map(b => b.name === event.name ? { ...b, status: 'error' } : b) } : m) }));
        break;
      }
      case 'skill:auto': {
        if (activeId) {
          const names = (event.names || []).join(', ');
          setState(prev => ({ ...prev, messages: prev.messages.map(m => m.id === activeId ? { ...m, skillBadges: [...m.skillBadges, { name: names, status: 'auto' }] } : m) }));
        }
        break;
      }

      case 'compact:auto':
        addMessage({ role: 'system', text: `Context auto-compacted (${event.mode || ''}, ${event.threshold || ''}%)`, timestamp: new Date().toISOString() });
        break;

      case 'dream:auto':
        addMessage({ role: 'system', text: 'Dream triggered...', timestamp: new Date().toISOString() });
        break;
      case 'dream:complete':
        addMessage({ role: 'system', text: 'Dream complete', timestamp: new Date().toISOString() });
        break;

      case 'approval:request':
        update({ approvalRequest: event });
        break;

      case 'submit:done': {
        const result = event.result || {};
        if (activeId && pendingChangesRef.current.length) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m => m.id === activeId ? { ...m, fileChanges: [...m.fileChanges, ...pendingChangesRef.current] } : m) }));
          pendingChangesRef.current = [];
        }
        if (activeId) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m => m.id === activeId ? { ...m, segments: m.segments.map(seg => seg.type === 'text' ? { ...seg, isStreaming: false } : seg) } : m) }));
        }
        if (result.type === 'system' && result.text) {
          addMessage({ role: 'system', text: result.text, timestamp: new Date().toISOString() });
        }
        setActiveMsg(null);
        update({ stage: 'idle', busy: false, live: false, stageLabel: '' });
        loadHistory();
        loadSessions();
        const rs = stateRef.current.runtimeState;
        if (rs?.sessionId) updateRoute('chat', rs.sessionId, { replace: true });
        break;
      }

      case 'runtime:switched': {
        setState(prev => ({ ...prev, messages: [], planSteps: [] }));
        activeMsgRef.current = null;
        pendingChangesRef.current = [];
        loadState();
        loadHistory();
        loadSessionMessages();
        loadSessions();
        updateRoute('chat', event.sessionId);
        break;
      }
    }
  }, [addMessage, update, loadHistory, loadSessions, loadState, loadSessionMessages]);

  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try { handleEvent(JSON.parse(e.data)); } catch (err) { console.error('SSE:', err); }
    };
    es.onerror = () => {
      es.close();
      clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(connectSSE, 3000);
    };
    sseRef.current = es;
  }, [handleEvent]);

  useEffect(() => {
    (async () => {
      const route = parseRoute();
      if (route.sessionId) {
        try {
          const currentState = await api.fetchState();
          if (currentState.sessionId !== route.sessionId) {
            await api.switchSession(route.sessionId);
          }
        } catch {}
      }

      try {
        const startupEvents = await api.fetchStartupEvents();
        for (const ev of startupEvents) {
          if (!ev || isProjectIndexEvent(ev)) continue;
          if (ev.type === 'system_tool' || ev.type === 'tool') {
            const summary = ev.summary || '';
            if (summary || ev.name) {
              addMessage({ role: 'system', text: summary ? `${ev.name}: ${summary}` : ev.name, timestamp: new Date().toISOString(), startupTodos: ev.arguments?.todos });
            }
          }
        }
      } catch {}

      const rs = await loadState();
      if (rs?.sessionId) updateRoute('chat', rs.sessionId, { replace: true });
      await loadSessionMessages();
      loadHistory();
      loadSessions();
      connectSSE();
    })();

    const handlePopState = async () => {
      const route = parseRoute();
      if (route.sessionId) {
        try {
          const currentState = await api.fetchState();
          if (currentState.sessionId !== route.sessionId) {
            await api.switchSession(route.sessionId);
            setState(prev => ({ ...prev, messages: [] }));
            await loadState();
            await loadSessionMessages();
            loadSessions();
          }
        } catch {}
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      if (sseRef.current) sseRef.current.close();
      clearTimeout(reconnectRef.current);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const actions = {
    submit: async (line) => {
      if (!line.trim()) return;
      if (stateRef.current.currentView !== 'chat') update({ currentView: 'chat' });
      addMessage({ role: 'you', text: line, timestamp: new Date().toISOString() });
      try {
        await api.submitLine(line);
      } catch (err) {
        addMessage({ role: 'error', text: `Failed: ${err.message}`, timestamp: new Date().toISOString() });
        update({ busy: false, live: false });
      }
    },

    abort: async () => {
      try { await api.abortRequest(); } catch {}
    },

    approve: async (id, approved) => {
      update({ approvalRequest: null });
      try { await api.submitApproval(id, approved); } catch {}
    },

    switchSession: async (sessionId) => {
      try {
        const result = await api.switchSession(sessionId);
        if (result.ok) {
          update({ currentView: 'chat' });
          updateRoute('chat', sessionId);
          await loadState();
          setState(prev => ({ ...prev, messages: [] }));
          await loadSessionMessages();
          loadSessions();
        }
      } catch {}
    },

    newSession: async () => {
      try {
        const result = await api.newSession();
        if (result.ok) {
          update({ currentView: 'chat' });
          if (result.sessionId) updateRoute('chat', result.sessionId);
          await loadState();
          setState(prev => ({ ...prev, messages: [] }));
          loadSessions();
        }
      } catch {}
    },

    openProject: async (projectPath) => {
      try {
        const result = await api.openProject(projectPath);
        if (result.ok) {
          update({ currentView: 'chat', projectOpen: false });
          if (result.sessionId) updateRoute('chat', result.sessionId);
          await loadState();
          setState(prev => ({ ...prev, messages: [] }));
          loadSessions();
        }
      } catch {}
    },

    switchView: (view) => {
      update({ currentView: view });
      if (view === 'sessions') updateRoute('sessions');
    },

    toggleTheme: () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('codemini-theme', next);
    },

    setConfigOpen: (open) => update({ configOpen: open }),
    setProjectOpen: (open) => update({ projectOpen: open }),
  };

  const value = { state, actions };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
