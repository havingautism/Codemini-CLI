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
  const params = new URLSearchParams(window.location.search);
  const chatMatch = path.match(/^\/chat\/([^/]+)$/);
  if (chatMatch) return { view: 'chat', sessionId: decodeURIComponent(chatMatch[1]) };
  if (path === '/codewiki') return { view: 'codewiki', projectPath: params.get('project') || '' };
  return { view: 'chat' };
}

function routeFor(view, sessionId, options = {}) {
  if (view === 'codewiki') {
    const projectPath = String(options.projectPath || '').trim();
    return projectPath ? `/codewiki?project=${encodeURIComponent(projectPath)}` : '/codewiki';
  }
  return sessionId ? `/chat/${encodeURIComponent(sessionId)}` : '/';
}

function updateRoute(view, sessionId, { replace = false, projectPath = '' } = {}) {
  const next = routeFor(view, sessionId, { projectPath });
  if (`${window.location.pathname}${window.location.search}` === next) return;
  const st = { view, sessionId: sessionId || null, projectPath: projectPath || null };
  if (replace) window.history.replaceState(st, '', next);
  else window.history.pushState(st, '', next);
}

const initialState = {
  stage: 'idle', busy: false, currentView: 'chat', runtimeState: null,
  live: false, stageLabel: '', messages: [], activeMsgId: null,
  pendingToolChanges: [], planSteps: [], pendingPlanApproval: null, approvalRequest: null,
  config: null, configStatus: null, configOpen: false, projectOpen: false, skillsOpen: false, soulsOpen: false, aboutOpen: false, gitDiffOpen: false,
  sessions: [], projectCwd: null, isGeneral: false, history: [], skills: [], gitInfo: null, gitBatch: {},
  codewikiProjectPath: '',
  versionInfo: null, updateStatus: null,
  initialLoading: true, sessionsLoading: false, messagesLoading: false,
};

function collapseRenderedSkillPrompt(content) {
  const text = String(content || '');
  const match = text.match(/^\[Executing skill: \/([^\]\s]+)\]\n\n/);
  if (!match) return text;

  const skillName = match[1];
  const prefix = `/${skillName}`;
  const currentQuestion = text.match(/\nCurrent question:\n([\s\S]+)$/);
  if (currentQuestion?.[1]?.trim()) return `${prefix} ${currentQuestion[1].trim()}`;
  return prefix;
}

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

function stripPlanProgressText(text) {
  return String(text || '').replace(/(?:^|\n)\[plan\]\s+Step\s+\d+\/\d+\s+->[^\n]*\n?/g, '');
}

// Helper to update messages immutably while preserving all other state
function mapMessages(prev, activeId, mapper) {
  return { ...prev, messages: prev.messages.map(m => m.id === activeId ? mapper(m) : m) };
}

function removeTransientMessages(messages, keys) {
  const set = new Set(Array.isArray(keys) ? keys : [keys]);
  return messages.filter((m) => {
    if (set.has(m.transientKey)) return false;
    const text = String(m.text || '');
    if (set.has('plan-waiting-review') && (text.includes('等待计划审阅') || text.includes('Waiting for plan review'))) return false;
    if (set.has('waiting-response') && (text.includes('等待回复') || text.includes('Waiting for response'))) return false;
    return true;
  });
}

function isPlanSystemSummaryText(text) {
  const value = String(text || '');
  return value.includes('Auto plan finished')
    || value.includes('Plan created and waiting for approval')
    || value.includes('Pending plan approval')
    || (value.includes('Plan File:') && value.includes('/yes'));
}

function isPlanApprovalLine(line) {
  const value = String(line || '').trim().toLowerCase();
  return ['yes', 'y', '/yes', '/plan approve', 'approve', 'approved', 'no', 'n', '/no', '/reject'].includes(value)
    || value.startsWith('/edit ');
}

function isPlanApprovalCommandLine(line) {
  const value = String(line || '').trim().toLowerCase();
  return ['/yes', '/plan approve', '/no', '/reject'].includes(value)
    || value.startsWith('/edit ');
}

function createPlanStepMessage(event) {
  const id = `plan-step-${event.step}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    role: event.role || 'general',
    text: '',
    segments: [],
    skillBadges: [],
    fileChanges: [],
    timestamp: new Date().toISOString(),
    planStep: {
      step: event.step,
      total: event.total,
      role: event.role || 'general',
      title: event.title || '',
      status: 'running',
      summary: ''
    }
  };
}

function parseHistoricalPlanSummary(text) {
  const value = String(text || '');
  const pattern = /^\[(DONE|FAILED|RUNNING)\]\s+([A-Za-z0-9_-]+):\s*(.*)$/gm;
  const matches = [...value.matchAll(pattern)];
  if (!matches.length || matches[0].index > value.slice(0, matches[0].index).trim().length) {
    return null;
  }

  return matches.map((match, index) => {
    const next = matches[index + 1];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = next ? next.index : value.length;
    const tag = String(match[1] || '').toLowerCase();
    return {
      step: index + 1,
      total: matches.length,
      status: tag === 'failed' ? 'failed' : tag === 'done' ? 'done' : 'running',
      role: String(match[2] || 'general').toLowerCase(),
      title: String(match[3] || '').trim(),
      body: value.slice(bodyStart, bodyEnd).trim(),
    };
  });
}

function createHistoricalPlanStepMessage(block, suffix) {
  const shouldShowBody = block.role === 'summarizer';
  return {
    id: `plan-history-${Date.now()}-${suffix}-${block.step}`,
    role: block.role || 'general',
    segments: shouldShowBody && block.body
      ? [{ type: 'text', text: block.body, isStreaming: false }]
      : [],
    skillBadges: [],
    fileChanges: [],
    planStep: {
      step: block.step,
      total: block.total,
      role: block.role || 'general',
      title: block.title || '',
      status: block.status || 'done',
      summary: '',
    },
  };
}

function createPlanTranscriptMessage(block, suffix) {
  return {
    id: `plan-transcript-${Date.now()}-${suffix}-${block.step || 0}`,
    role: block.role || 'general',
    segments: Array.isArray(block.segments) ? block.segments : [],
    skillBadges: [],
    fileChanges: [],
    planStep: {
      step: block.step,
      total: block.total,
      role: block.role || 'general',
      title: block.title || '',
      status: block.status || 'done',
      summary: block.summary || '',
    },
  };
}

export function AppProvider({ children }) {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeMsgRef = useRef(null);
  const pendingChangesRef = useRef([]);
  const planRunPendingRef = useRef(false);
  const planStepMessagesRef = useRef(new Map());
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
      const projectName = rs.isGeneral
        ? '__codemini_general__'
        : (rs.cwd?.split(/[/\\]/).pop() || rs.cwd || '...');
      const busy = !!rs.busy;
      setState(prev => ({
        ...prev,
        runtimeState: rs,
        projectCwd: projectName,
        isGeneral: !!rs.isGeneral,
        pendingPlanApproval: rs?.pendingPlanApproval || null,
        busy,
        live: busy || prev.live,
        stage: busy ? 'thinking' : prev.stage,
        stageLabel: busy ? t('waitingResponse') : prev.stageLabel,
        messages: rs?.pendingPlanApproval
          ? prev.messages
          : removeTransientMessages(prev.messages, 'plan-waiting-review')
      }));
      return rs;
    } catch { return null; }
  }, [update]);

  const loadConfigStatus = useCallback(async ({ openIfRequired = false } = {}) => {
    try {
      const configStatus = await api.fetchConfigStatus();
      update({
        configStatus,
        configOpen: openIfRequired && configStatus?.setupRequired ? true : stateRef.current.configOpen
      });
      return configStatus;
    } catch {
      return null;
    }
  }, [update]);

  const loadGitInfo = useCallback(async () => {
    try {
      const info = await api.fetchGitInfo();
      update({ gitInfo: info });
    } catch {}
  }, [update]);

  const loadGitBatch = useCallback(async (sessions) => {
    const dirs = [...new Set((sessions || []).map(s => s.projectDir).filter(Boolean))];
    if (!dirs.length) return;
    try {
      const batch = await api.fetchGitBatch(dirs);
      update({ gitBatch: batch });
    } catch {}
  }, [update]);

  const loadHistory = useCallback(async () => {
    try {
      const history = await api.fetchHistory();
      update({ history: Array.isArray(history) ? history : [] });
    } catch {}
  }, [update]);

  const loadSessions = useCallback(async () => {
    update({ sessionsLoading: true });
    try {
      const sessions = await api.fetchSessions();
      const list = Array.isArray(sessions) ? sessions : [];
      update({ sessions: list });
      loadGitBatch(list);
    } catch {}
    finally { update({ sessionsLoading: false }); }
  }, [update, loadGitBatch]);

  const openCodeWikiProjectFromRoute = useCallback(async (projectPath) => {
    if (!projectPath) return null;
    try {
      const currentState = await api.fetchState();
      if (currentState?.cwd === projectPath) return currentState;
      const result = await api.openProject(projectPath);
      if (result?.error) return null;
      return result;
    } catch {
      return null;
    }
  }, []);

  const loadSkills = useCallback(async () => {
    try {
      const skills = await api.fetchSkills();
      update({ skills: Array.isArray(skills) ? skills : [] });
    } catch {}
  }, [update]);

  const loadSessionMessages = useCallback(async () => {
    update({ messagesLoading: true });
    try {
      const data = await api.fetchSessionMessages();
      const messages = Array.isArray(data) ? data : (data.messages || []);
      const compactMeta = data?.compact || null;
      if (!messages.length) {
        const uiMessages = await api.fetchSessionUiMessages();
        if (Array.isArray(uiMessages) && uiMessages.length) {
          update({ messages: uiMessages });
        }
        return;
      }
      const processed = [];
      let assistantGroup = null;
      const compactBoundary = compactMeta?.boundaryIndex;
      let dividerInserted = compactBoundary == null;
      for (let mi = 0; mi < messages.length; mi++) {
        const msg = messages[mi];
        // Insert compact divider at the boundary position
        if (!dividerInserted && mi >= compactBoundary) {
          processed.push({
            id: `msg-compact-divider-${Date.now()}`,
            role: 'divider', dividerType: 'compact',
            text: `以上内容已压缩 (${compactMeta.mode || ''})`,
            timestamp: compactMeta.timestamp || new Date().toISOString()
          });
          dividerInserted = true;
        }
        if (msg.role === 'user') {
          if (isPlanApprovalCommandLine(msg.content)) continue;
          assistantGroup = null;
          const visibleContent = collapseRenderedSkillPrompt(msg.content || '');
          processed.push({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-u${processed.length}`,
            role: 'you', segments: [{ type: 'text', text: visibleContent, isStreaming: false }],
            skillBadges: [], fileChanges: [],
          });
        } else if (msg.role === 'assistant') {
          if (Array.isArray(msg.planTranscript) && msg.planTranscript.length) {
            assistantGroup = null;
            for (const block of msg.planTranscript) {
              processed.push(createPlanTranscriptMessage(block, processed.length));
            }
            continue;
          }

          const planBlocks = parseHistoricalPlanSummary(msg.content);
          if (planBlocks?.length) {
            assistantGroup = null;
            const summaryBlock =
              [...planBlocks].reverse().find((block) => block.role === 'summarizer') ||
              planBlocks[planBlocks.length - 1];
            processed.push(createHistoricalPlanStepMessage(
              { ...summaryBlock, step: 1, total: 1, role: summaryBlock.role || 'summarizer' },
              processed.length
            ));
            continue;
          }

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
    finally { update({ messagesLoading: false }); }
  }, [update]);

  const handleEvent = useCallback((event) => {
    if (!event?.type) return;
    if (isProjectIndexEvent(event)) return;
    const s = stateRef.current;
    const activeId = activeMsgRef.current;

    switch (event.type) {
      case 'connected': break;

      case 'assistant:start': {
        if (s.currentView !== 'chat' && s.currentView !== 'codewiki') update({ currentView: 'chat' });
        setState(prev => ({ ...prev, messages: removeTransientMessages(prev.messages, 'waiting-response') }));
        if (planRunPendingRef.current) {
          update({ stage: 'thinking', busy: true, live: true, stageLabel: t('thinking') });
          break;
        }
        let msgId = activeId;
        if (!msgId) {
          msgId = addMessage({ role: 'general', timestamp: new Date().toISOString(), text: '', isStreaming: false });
          setActiveMsg(msgId);
        }
        update({ stage: 'thinking', busy: true, live: true, stageLabel: t('thinking') });
        break;
      }

      case 'assistant:delta': {
        const delta = stripPlanProgressText(event.text);
        if (activeId && delta) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m =>
            m.id === activeId ? { ...m, segments: appendDeltaToSegments(m.segments, delta) } : m
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
              const text = stripPlanProgressText(event.text);
              const segs = ensureTextSegment(m.segments);
              const lastIdx = segs.length - 1;
              return { ...m, segments: segs.map((seg, i) => i === lastIdx && seg.type === 'text' ? { ...seg, text, isStreaming: false } : seg) };
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
        planRunPendingRef.current = true;
        planStepMessagesRef.current = new Map();
        setActiveMsg(null);
        update({ planSteps: steps, pendingPlanApproval: null });
        break;
      }

      case 'plan:progress': {
        const { step, status } = event;
        setState(prev => ({ ...prev, planSteps: prev.planSteps.map((s, i) => i === step - 1 ? { ...s, status } : s) }));
        break;
      }

      case 'plan:step_start': {
        planRunPendingRef.current = true;
        if (stateRef.current.pendingPlanApproval) update({ pendingPlanApproval: null });
        const key = String(event.step);
        let msgId = planStepMessagesRef.current.get(key);
        if (!msgId) {
          const msg = createPlanStepMessage(event);
          msgId = msg.id;
          planStepMessagesRef.current.set(key, msgId);
          setState(prev => ({
            ...prev,
            messages: [
              ...removeTransientMessages(prev.messages, 'waiting-response'),
              msg
            ]
          }));
        } else {
          setState(prev => ({ ...prev, messages: prev.messages.map(m => m.id === msgId ? { ...m, planStep: { ...(m.planStep || {}), status: 'running' } } : m) }));
        }
        setActiveMsg(msgId);
        update({ stage: 'tooling', busy: true, live: true, stageLabel: `${event.role || 'agent'}: ${event.title || ''}`.trim() });
        break;
      }

      case 'plan:step_done': {
        const msgId = planStepMessagesRef.current.get(String(event.step));
        if (msgId) {
          setState(prev => ({ ...prev, messages: prev.messages.map(m => {
            if (m.id !== msgId) return m;
            return {
              ...m,
              segments: m.segments.map(seg => seg.type === 'text' ? { ...seg, isStreaming: false } : seg),
              planStep: {
                ...(m.planStep || {}),
                status: event.status || 'done',
                summary: event.summary || ''
              }
            };
          }) }));
        }
        break;
      }

      case 'plan:pending_approval': {
        setState(prev => ({
          ...prev,
          messages: [
            ...removeTransientMessages(prev.messages, ['plan-waiting-review', 'waiting-response'])
              .filter((m) => !isPlanSystemSummaryText(m.text)),
            {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'system',
              text: t('planWaitingReview'),
              segments: [{ type: 'text', text: t('planWaitingReview'), isStreaming: false }],
              skillBadges: [],
              fileChanges: [],
              transientKey: 'plan-waiting-review',
              timestamp: new Date().toISOString()
            }
          ],
          pendingPlanApproval: {
            goal: event.goal,
            summary: event.summary,
            filePath: event.filePath,
            steps: event.steps || []
          }
        }));
        break;
      }
      case 'plan:approval_cleared': {
        setState(prev => ({
          ...prev,
          pendingPlanApproval: null,
          messages: removeTransientMessages(prev.messages, 'plan-waiting-review')
        }));
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
        addMessage({ role: 'divider', dividerType: 'compact', text: `以上内容已压缩 (${event.mode || ''}, ${event.threshold || ''}%)`, timestamp: new Date().toISOString() });
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
          if (!stateRef.current.pendingPlanApproval && !isPlanSystemSummaryText(result.text)) {
            addMessage({ role: 'system', text: result.text, timestamp: new Date().toISOString() });
          }
        }
        setActiveMsg(null);
        planRunPendingRef.current = false;
        planStepMessagesRef.current = new Map();
        setState(prev => ({
          ...prev,
          stage: 'idle',
          busy: false,
          live: false,
          stageLabel: '',
          messages: removeTransientMessages(
            prev.messages,
            stateRef.current.pendingPlanApproval ? 'waiting-response' : ['waiting-response', 'plan-waiting-review']
          )
        }));
        loadHistory();
        loadSessions();
        const rs = stateRef.current.runtimeState;
        if (rs?.sessionId && stateRef.current.currentView === 'chat') {
          updateRoute('chat', rs.sessionId, { replace: true });
        }
        break;
      }

      case 'mode:changed': {
        const rs = event;
        update({ runtimeState: { ...stateRef.current.runtimeState, mode: rs.mode, ...rs } });
        break;
      }

      case 'runtime:state': {
        const rs = event.state || {};
        update({
          runtimeState: { ...stateRef.current.runtimeState, ...rs },
          pendingPlanApproval: rs?.pendingPlanApproval || null,
          busy: !!rs.busy,
          live: !!rs.busy,
          stage: rs.busy ? stateRef.current.stage : 'idle',
          stageLabel: rs.busy ? stateRef.current.stageLabel : ''
        });
        break;
      }

      case 'runtime:switched': {
        setState(prev => ({ ...prev, messages: [], planSteps: [], pendingPlanApproval: null }));
        activeMsgRef.current = null;
        pendingChangesRef.current = [];
        loadState();
        loadGitInfo();
        loadHistory();
        loadSessionMessages();
        loadSessions();
        if (stateRef.current.currentView !== 'codewiki') updateRoute('chat', event.sessionId);
        break;
      }

      case 'session:title': {
        if (event.sessionId && event.title) {
          setState(prev => ({
            ...prev,
            sessions: prev.sessions.map(s =>
              s.id === event.sessionId ? { ...s, title: event.title } : s
            )
          }));
        }
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
      update({
        currentView: route.view,
        codewikiProjectPath: route.view === 'codewiki' ? route.projectPath || '' : stateRef.current.codewikiProjectPath,
      });
      if (route.sessionId) {
        try {
          const currentState = await api.fetchState();
          if (currentState.sessionId !== route.sessionId) {
            await api.switchSession(route.sessionId);
          }
        } catch {}
      } else if (route.view === 'codewiki' && route.projectPath) {
        await openCodeWikiProjectFromRoute(route.projectPath);
      }

      await loadConfigStatus({ openIfRequired: true });

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
      if (route.view === 'chat' && rs?.sessionId) {
        updateRoute('chat', rs.sessionId, { replace: true });
      } else if (route.view === 'codewiki') {
        const projectPath = route.projectPath || rs?.cwd || '';
        update({ currentView: 'codewiki', codewikiProjectPath: projectPath });
        if (projectPath) updateRoute('codewiki', null, { replace: true, projectPath });
      }
      await loadSessionMessages();
      loadHistory();
      loadSessions();
      loadSkills();
      loadGitInfo();
      try {
        const vInfo = await api.fetchVersion();
        update({ versionInfo: vInfo });
      } catch {}
      update({ initialLoading: false });
      connectSSE();
    })();

    const handlePopState = async () => {
      const route = parseRoute();
      update({
        currentView: route.view,
        codewikiProjectPath: route.view === 'codewiki' ? route.projectPath || '' : stateRef.current.codewikiProjectPath,
      });
      if (route.sessionId) {
        try {
          const currentState = await api.fetchState();
          if (currentState.sessionId !== route.sessionId) {
            await api.switchSession(route.sessionId);
            update({ messagesLoading: true });
            setState(prev => ({ ...prev, messages: [] }));
            await loadState();
            await loadSessionMessages();
            loadSessions();
            loadGitInfo();
          }
        } catch {}
      } else if (route.view === 'codewiki') {
        if (route.projectPath) await openCodeWikiProjectFromRoute(route.projectPath);
        const rs = await loadState();
        const projectPath = route.projectPath || rs?.cwd || '';
        update({ currentView: 'codewiki', codewikiProjectPath: projectPath });
        loadSessions();
        loadGitInfo();
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      if (sseRef.current) sseRef.current.close();
      clearTimeout(reconnectRef.current);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [addMessage, connectSSE, loadConfigStatus, loadGitInfo, loadHistory, loadSessionMessages, loadSessions, loadSkills, loadState, openCodeWikiProjectFromRoute, update]);

  const actions = {
    submit: async (line, options = {}) => {
      if (!line.trim()) return;
      if (stateRef.current.currentView !== 'chat' && !options.stayInView) update({ currentView: 'chat' });
      const approvingPlan = !!stateRef.current.pendingPlanApproval && isPlanApprovalLine(line);
      if (approvingPlan) planRunPendingRef.current = true;
      if (!approvingPlan) addMessage({ role: 'you', text: line, timestamp: new Date().toISOString() });
      const waitingId = approvingPlan ? null : addMessage({
          role: 'system',
          text: t('waitingResponse'),
          timestamp: new Date().toISOString(),
          transientKey: 'waiting-response'
        });
      update({ busy: true, live: true, stage: 'thinking', stageLabel: t('waitingResponse') });
      try {
        const res = await api.submitLine(line, { readOnlyCodeWiki: options.readOnlyCodeWiki === true });
        const result = await res.json().catch(() => ({}));
        if (result?.code === 'CONFIG_REQUIRED') {
          update({ configOpen: true, configStatus: result.configStatus || stateRef.current.configStatus });
          throw new Error(t('configRequired'));
        }
        if (result?.error) throw new Error(result.message || 'Request failed');
      } catch (err) {
        if (approvingPlan) planRunPendingRef.current = false;
        if (waitingId) setState(prev => ({ ...prev, messages: prev.messages.filter(m => m.id !== waitingId) }));
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

    approvePlan: async (action, feedback) => {
      const plan = stateRef.current.pendingPlanApproval;
      if (!plan) return;
      planRunPendingRef.current = action === 'approve';
      if (action === 'reject') {
        update({ pendingPlanApproval: null });
      }
      update({ busy: true, live: true, stage: 'thinking', stageLabel: t('waitingResponse') });
      try {
        const command = action === 'approve'
          ? '/yes'
          : action === 'reject'
            ? '/reject'
            : feedback?.trim()
              ? `/edit ${feedback.trim()}`
              : '';
        if (!command) {
          update({ busy: false, live: false, stage: 'idle', stageLabel: '' });
          return;
        }
        const res = await api.submitLine(command);
        const result = await res.json().catch(() => ({}));
        if (result?.error) throw new Error(result.message || 'Request failed');
      } catch (err) {
        planRunPendingRef.current = false;
        addMessage({ role: 'error', text: `Failed: ${err.message}`, timestamp: new Date().toISOString() });
        update({ busy: false, live: false, stage: 'idle', stageLabel: '' });
      }
    },

    switchSession: async (sessionId) => {
      try {
        const result = await api.switchSession(sessionId);
        if (result.ok) {
          update({ currentView: 'chat', messagesLoading: true });
          updateRoute('chat', sessionId);
          await loadState();
          setState(prev => ({ ...prev, messages: [] }));
          await loadSessionMessages();
          loadSessions();
          loadGitInfo();
        }
      } catch {}
    },

    deleteSession: async (sessionId) => {
      try {
        const deletingCurrent = sessionId === stateRef.current.runtimeState?.sessionId;
        const result = await api.deleteSession(sessionId);
        if (result?.error) return result;
        setState(prev => ({
          ...prev,
          sessions: prev.sessions.filter((session) => session.id !== sessionId)
        }));
        if (deletingCurrent) {
          update({ currentView: 'chat', messagesLoading: true });
          if (result.sessionId) updateRoute('chat', result.sessionId, { replace: true });
          await loadState();
          setState(prev => ({ ...prev, messages: [] }));
          await loadSessionMessages();
          loadGitInfo();
        }
        await loadSessions();
        return result;
      } catch (err) {
        return { error: true, message: err.message };
      }
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

    openProject: async (projectPath, options = {}) => {
      try {
        const result = await api.openProject(projectPath);
        if (result.ok) {
          const nextView = options.view || 'chat';
          const nextCodeWikiProjectPath = nextView === 'codewiki'
            ? result.cwd || projectPath
            : stateRef.current.codewikiProjectPath;
          update({ currentView: nextView, projectOpen: false, codewikiProjectPath: nextCodeWikiProjectPath });
          if (nextView === 'codewiki') updateRoute('codewiki', null, { projectPath: nextCodeWikiProjectPath });
          else if (result.sessionId) updateRoute('chat', result.sessionId);
          await loadState();
          setState(prev => ({ ...prev, messages: [] }));
          loadSessions();
          loadGitInfo();
        }
      } catch {}
    },

    switchView: (view, options = {}) => {
      const codewikiProjectPath = view === 'codewiki'
        ? options.projectPath || stateRef.current.codewikiProjectPath || stateRef.current.runtimeState?.cwd || ''
        : stateRef.current.codewikiProjectPath;
      update({ currentView: view, codewikiProjectPath });
      if (view === 'codewiki') {
        updateRoute(view, null, { projectPath: codewikiProjectPath });
      }
      if (view === 'chat') {
        const rs = stateRef.current.runtimeState;
        updateRoute('chat', rs?.sessionId);
      }
    },

    toggleTheme: () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('codemini-theme', next);
    },

    setConfigOpen: (open) => update({ configOpen: open }),
    refreshConfigStatus: () => loadConfigStatus(),
    setProjectOpen: (open) => update({ projectOpen: open }),
    setSkillsOpen: (open) => update({ skillsOpen: open }),
    setSoulsOpen: (open) => update({ soulsOpen: open }),
    setAboutOpen: (open) => update({ aboutOpen: open }),
    setGitDiffOpen: (open) => update({ gitDiffOpen: open }),

    checkVersion: async () => {
      try {
        const info = await api.fetchVersion();
        update({ versionInfo: info });
      } catch {}
    },

    runUpdate: async () => {
      update({ updateStatus: 'updating' });
      try {
        const result = await api.runUpdate();
        if (result.ok) {
          update({ updateStatus: 'done' });
        } else {
          update({ updateStatus: 'error' });
        }
      } catch {
        update({ updateStatus: 'error' });
      }
    },
  };

  const value = { state, actions };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
