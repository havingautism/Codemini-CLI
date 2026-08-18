import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  ProcessTerminal,
  ScrollView,
  TuiAltScreen,
  VStack,
  isKeyRelease,
  matchesKey
} from '@earendil-works/pi-tui';

import {
  ActivityBar,
  ApprovalDialog,
  Footer,
  HelpDialog,
  QueuePanel,
  SessionPicker,
  SettingsDialog,
  TopBar
} from './components/chrome.js';
import {
  PlanProgress,
  ProcessedFold,
  ReasoningBlock,
  SurfaceSpacer,
  TodoProgress,
  ToolCallGroup,
  appendHistory,
  createAssistantMessage,
  createSystemMessage,
  createUserMessage,
  oneLine,
  paintBackground,
  toolEventKey
} from './components/messages.js';
import { ModeHome } from './components/mode-home.js';
import { createTuiCopy } from './copy.js';
import { color, editorTheme } from './theme.js';

/** Editor variant that paints every rendered line with the dark surface color. */
class SurfaceEditor extends Editor {
  render(width) {
    return super.render(width).map((line) => paintBackground(line, width));
  }
}

const TUI_COMMANDS = [
  { name: 'compact', description: 'compact', action: 'compact' },
  { name: 'dream', description: 'dream', action: 'dream' },
  { name: 'reflect', description: 'reflect', action: 'reflect' },
  { name: 'inbox', description: 'inbox', action: 'inbox' },
  { name: 'coding', description: 'codingMode', mode: 'coding' },
  { name: 'daily', description: 'dailyMode', mode: 'daily' },
  { name: 'tools', description: 'tools', local: 'tools' },
  { name: 'history', description: 'history', local: 'history' },
  { name: 'help', description: 'help', local: 'help' }
];

export function buildSlashCommands(runtime, copy = createTuiCopy('en')) {
  const skills = (runtime.getAvailableSkills?.() || []).map((skill) => ({
    value: String(skill?.name || skill),
    label: `${copy.skillGroup}  ${String(skill?.name || skill)}`,
    description: String(skill?.description || 'Use skill')
  }));
  return [
    ...TUI_COMMANDS.map(({ name, description }) => ({
      value: name,
      label: `${copy.commandGroup}  ${name}`,
      description: copy[description]
    })),
    ...skills
  ];
}

export async function runOpenCodeTui({ runtime, sessionId, model, safeMode = true, version = '', language = 'en', terminal: suppliedTerminal, workspaceDir = '', currentDirectory = process.cwd() }) {
  const terminal = suppliedTerminal || new ProcessTerminal();
  const copy = createTuiCopy(language);
  let activeSessionId = sessionId;
  const defaultWorkspaceDir = workspaceDir || runtime.getRuntimeState?.().workspaceRoot || currentDirectory;
  const tui = new TuiAltScreen(terminal, true, undefined, { mouse: true, wheelScrollLines: 6 });
  const transcript = new Container();
  const scroll = new ScrollView(transcript, {
    follow: 'end',
    primary: true,
    overscroll: 'chain',
    scrollbar: 'always',
    scrollbarStyle: color.dim
  });
  const editor = new SurfaceEditor(tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 8 });
  const header = new TopBar({ version });
  const activity = new ActivityBar({ tui, copy });
  const queuePanel = new QueuePanel(copy);
  const footer = new Footer({ runtime, model, sessionId: activeSessionId, safeMode });
  const bottom = new VStack([queuePanel, editor, activity, footer], { gap: 0 });
  const chatLayout = new VStack([
    { component: header, basis: 'auto', shrink: 0, minSize: 1 },
    { component: scroll, basis: 0, grow: 1, minSize: 1 },
    { component: bottom, basis: 'auto', shrink: 1, minSize: 3 }
  ]);

  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(buildSlashCommands(runtime, copy), process.cwd()));
  editor.borderColor = color.dim;

  let phase = 'home';
  let busy = false;
  let activeAssistant = null;
  let activeAssistantSpacer = null;
  let activeReasoning = null;
  let activeToolGroup = null;
  let activeTodo = null;
  let activePlan = null;
  let activeProcessFold = null;
  let activeText = '';
  let lastCtrlC = 0;
  let toolsExpanded = false;
  let bodyOnlyView = true;
  let chatInitialized = false;
  let stopped = false;
  const queue = [];
  const toolRows = new Map();
  const toolGroups = [];
  const reasoningBlocks = [];
  const processFolds = [];
  let helpHandle = null;
  let historyHandle = null;
  let historyPicker = null;
  let settingsHandle = null;
  let approvalCancel = null;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const requestRender = () => {
    header.invalidate();
    footer.invalidate();
    tui.requestRender();
  };

  const setActivity = (kind, message, queueCount = queue.length) => {
    activity.set({ kind, message, queueCount });
    queuePanel.setItems(queue);
    requestRender();
  };

  const stop = (result) => {
    if (stopped) return;
    stopped = true;
    runtime.setRequestToolApproval?.(null);
    activity.dispose();
    void (async () => {
      await terminal.drainInput?.(200, 20).catch?.(() => {});
      tui.stop(result?.sessionId || result?.newSession ? { preserveScreen: true } : undefined);
      resolveDone(result);
    })();
  };

  const showApproval = (request) => new Promise((resolve) => {
    let handle;
    const finish = (approved) => {
      handle?.hide();
      approvalCancel = null;
      tui.setFocus(editor);
      resolve({ approved });
      requestRender();
    };
    const dialog = new ApprovalDialog(request, finish, copy);
    handle = tui.showOverlay(dialog, { width: '72%', minWidth: 44, maxHeight: 10, anchor: 'center', margin: 2 });
    approvalCancel = () => finish(false);
    requestRender();
  });
  runtime.setRequestToolApproval?.(showApproval);

  const ensureAssistant = () => {
    if (activeAssistant) return activeAssistant;
    activeAssistantSpacer = new SurfaceSpacer(1);
    activeAssistant = createAssistantMessage('');
    transcript.addChild(activeAssistantSpacer);
    transcript.addChild(activeAssistant);
    return activeAssistant;
  };

  const moveAssistantToEnd = () => {
    if (!activeAssistant || !activeAssistantSpacer) return;
    transcript.removeChild(activeAssistantSpacer);
    transcript.removeChild(activeAssistant);
    transcript.addChild(activeAssistantSpacer);
    transcript.addChild(activeAssistant);
  };

  const ensureProcessFold = () => {
    if (activeProcessFold) return activeProcessFold;
    activeProcessFold = new ProcessedFold(copy);
    activeProcessFold.setBodyOnly(bodyOnlyView);
    processFolds.push(activeProcessFold);
    transcript.addChild(new SurfaceSpacer(1));
    transcript.addChild(activeProcessFold);
    return activeProcessFold;
  };

  const moveAssistantIntoProcess = () => {
    if (!activeAssistant || !activeAssistantSpacer) return;
    transcript.removeChild(activeAssistantSpacer);
    transcript.removeChild(activeAssistant);
    ensureProcessFold().addChild(activeAssistantSpacer);
    ensureProcessFold().addChild(activeAssistant);
    activeAssistant = null;
    activeAssistantSpacer = null;
    activeText = '';
  };

  const finishReasoning = () => {
    activeReasoning?.finish();
  };

  const ensureToolGroup = () => {
    finishReasoning();
    if (activeToolGroup) return activeToolGroup;
    activeToolGroup = new ToolCallGroup(copy);
    activeToolGroup.setExpanded(toolsExpanded);
    toolGroups.push(activeToolGroup);
    ensureProcessFold().addChild(activeToolGroup);
    return activeToolGroup;
  };

  const updateTodo = (event) => {
    finishReasoning();
    if (!activeTodo) {
      activeTodo = new TodoProgress(event.arguments || event.result || event.content, copy);
      ensureProcessFold().addPinnedChild(activeTodo);
    } else {
      activeTodo.update(event);
    }
    return activeTodo;
  };

  const handleEvent = (event) => {
    const type = String(event?.type || '');
    if (type === 'assistant:start') {
      moveAssistantIntoProcess();
      finishReasoning();
      activeReasoning = null;
      editor.borderColor = color.purple;
      setActivity('thinking', copy.thinking);
    } else if (type === 'assistant:reasoning_delta') {
      if (!activeReasoning) {
        activeReasoning = new ReasoningBlock(copy);
        activeReasoning.setExpanded(toolsExpanded);
        reasoningBlocks.push(activeReasoning);
        ensureProcessFold().addChild(activeReasoning);
      }
      activeReasoning.append(event.text);
      setActivity('thinking', copy.thinking);
    } else if (type === 'assistant:delta') {
      finishReasoning();
      activeText += String(event.text || '');
      ensureAssistant().setText(activeText);
      moveAssistantToEnd();
      editor.borderColor = color.accent;
      setActivity('generating', copy.generating);
    } else if (type === 'assistant:response') {
      finishReasoning();
      if (event.text) {
        activeText = String(event.text);
        ensureAssistant().setText(activeText);
        moveAssistantToEnd();
      }
      if (event.toolCalls?.length || event.assistantMessage?.tool_calls?.length) moveAssistantIntoProcess();
    } else if (type === 'tool:start' || type === 'system_tool:start' || type === 'skill:start') {
      const id = toolEventKey(event, type);
      if (type === 'tool:start' && ['tasks', 'update_todos'].includes(String(event.name || '').toLowerCase())) {
        const todo = updateTodo(event);
        toolRows.set(id, todo);
        editor.borderColor = color.warning;
        setActivity('tool', `${event.displayName || event.name || 'tool'}…`);
        requestRender();
        return;
      }
      const row = ensureToolGroup().add(event);
      toolRows.set(id, row);
      editor.borderColor = color.warning;
      setActivity('tool', `${event.displayName || event.name || 'tool'}…`);
    } else if (type === 'tool:end' || type === 'system_tool:end' || type === 'skill:end') {
      toolRows.get(toolEventKey(event, type))?.update(event, 'success');
      setActivity('tool', copy.working);
    } else if (type === 'tool:result' || type === 'system_tool:result') {
      const row = toolRows.get(toolEventKey(event, type));
      if (row) row.update({ ...event, summary: event.summary || oneLine(event.content, 160) }, row.state === 'error' ? 'error' : 'success');
    } else if (type === 'tool:error' || type === 'system_tool:error' || type === 'skill:error' || type === 'tool:blocked') {
      const id = toolEventKey(event, type);
      let row = toolRows.get(id);
      if (!row) {
        row = ensureToolGroup().add(event);
        toolRows.set(id, row);
      }
      row.update(event, 'error');
      setActivity('error', event.summary || copy.actionFailed);
    } else if (type === 'hook:start') {
      const hookEvent = { ...event, displayName: `Hook · ${event.event || event.name || 'hook'}` };
      const row = ensureToolGroup().add(hookEvent);
      toolRows.set(toolEventKey(hookEvent, type), row);
      setActivity('tool', hookEvent.displayName);
    } else if (type === 'hook:end' || type === 'hook:error') {
      const id = toolEventKey(event, type);
      let row = toolRows.get(id);
      if (!row) {
        row = ensureToolGroup().add({ ...event, displayName: `Hook · ${event.event || event.name || 'hook'}` });
        toolRows.set(id, row);
      }
      row.update(event, type === 'hook:error' || event.ok === false || event.decision === 'deny' ? 'error' : 'success');
    } else if (type === 'plan:steps') {
      finishReasoning();
      activePlan = new PlanProgress(copy, event);
      ensureProcessFold().addChild(new SurfaceSpacer(1));
      ensureProcessFold().addChild(activePlan);
      setActivity('tool', copy.working);
    } else if (type === 'plan:step_start' || type === 'plan:progress' || type === 'plan:step_done') {
      activePlan?.update(event);
      setActivity(type === 'plan:step_done' ? 'tool' : 'thinking', event.title || copy.working);
    } else if (type === 'compact:auto' || type === 'dream:auto' || type === 'dream:complete') {
      transcript.addChild(createSystemMessage(event.summary || type.replace(':', ' '), color.warning));
    }
    requestRender();
  };

  const appendResult = (result) => {
    if (!result || result.type === 'noop') return;
    if (result.type === 'exit') return stop();
    const text = String(result.text || '').trim();
    if (!text) return;
    if (result.type === 'assistant') {
      if (!activeText) {
        ensureAssistant().setText(text);
        moveAssistantToEnd();
      }
      return;
    }
    transcript.addChild(new SurfaceSpacer(1));
    transcript.addChild(createSystemMessage(text, result.type === 'error' ? color.error : color.muted));
  };

  const switchMode = async (mode) => {
    await runtime.setExecutionMode?.(mode);
    transcript.addChild(new SurfaceSpacer(1));
    transcript.addChild(createSystemMessage(copy.switchedMode(mode), color.accent));
    requestRender();
  };

  const resetTranscriptForContinuation = () => {
    for (const child of [...(transcript.children || [])]) transcript.removeChild(child);
    processFolds.length = 0;
    reasoningBlocks.length = 0;
    toolGroups.length = 0;
    toolRows.clear();
    activeAssistant = null;
    activeAssistantSpacer = null;
    activeReasoning = null;
    activeToolGroup = null;
    activeTodo = null;
    activePlan = null;
    activeProcessFold = null;
    activeText = '';
    const history = runtime.getSessionMessages?.() || [];
    const restored = appendHistory(transcript, history, copy, {
      bodyOnly: bodyOnlyView,
      expanded: toolsExpanded
    });
    processFolds.push(...restored.processFolds);
    reasoningBlocks.push(...restored.reasoningBlocks);
    toolGroups.push(...restored.toolGroups);
    transcript.addChild(new SurfaceSpacer(1));
    transcript.addChild(createSystemMessage(copy.continuedInNewSession, color.warning));
    if (!history.length) transcript.addChild(createSystemMessage(copy.emptyHint));
    requestRender();
  };

  const submit = async (text, alreadyShown = false, priority = false) => {
    const value = String(text || '').trim();
    if (!value) return;
    const commandName = value.match(/^\/([A-Za-z0-9_-]+)\s*$/)?.[1]?.toLowerCase();
    const command = TUI_COMMANDS.find((item) => item.name === commandName);
    if (!alreadyShown) {
      editor.addToHistory(value);
      editor.setText('');
    }
    if (command?.local) {
      if (command.local === 'help') showHelp();
      else if (command.local === 'history') {
        await showSessionHistory().catch((error) => {
          transcript.addChild(createSystemMessage(error?.message || String(error), color.error));
          requestRender();
        });
      }
      else toggleProcessDetails();
      return;
    }
    if (!alreadyShown) {
      transcript.addChild(new SurfaceSpacer(1));
      transcript.addChild(createUserMessage(value));
    }
    if (busy) {
      // Enter: append to the end of the queue. Ctrl+Enter (priority): jump the
      // queue — the next free slot is taken by this prompt instead.
      if (priority) queue.unshift(value);
      else queue.push(value);
      setActivity('tool', copy.queued(queue.length));
      return;
    }

    busy = true;
    activeAssistant = null;
    activeAssistantSpacer = null;
    activeReasoning = null;
    activeToolGroup = null;
    activeTodo = null;
    activePlan = null;
    activeProcessFold = null;
    activeText = '';
    editor.borderColor = color.purple;
    setActivity('sending', copy.sending);
    try {
      if (command?.mode) {
        await switchMode(command.mode);
        return;
      }
      const result = command?.action
        ? await runtime.dispatchAction({ name: command.action, payload: {} }, { onAgentEvent: handleEvent })
        : await runtime.submitMessage({ text: value }, handleEvent);
      appendResult(result);
    } catch (error) {
      if (error?.name !== 'AbortError') transcript.addChild(createSystemMessage(error?.message || String(error), color.error));
    } finally {
      finishReasoning();
      activeProcessFold?.finish();
      activeProcessFold?.setBodyOnly(bodyOnlyView);
      busy = false;
      activeAssistant = null;
      activeAssistantSpacer = null;
      activeReasoning = null;
      activeText = '';
      editor.borderColor = color.dim;
      const nextSessionId = runtime.getCurrentSessionId?.() || activeSessionId;
      const continuedInNewSession = nextSessionId !== activeSessionId;
      if (continuedInNewSession) {
        activeSessionId = nextSessionId;
        footer.sessionId = nextSessionId;
        resetTranscriptForContinuation();
      }
      setActivity('idle', queue.length ? copy.queued(queue.length) : copy.ready);
      if (queue.length) {
        const next = queue.shift();
        queuePanel.setItems(queue);
        // After a fork the queued prompt was painted on the old transcript, so
        // show it again on the continuation session.
        submit(next, !continuedInNewSession);
      }
    }
  };
  editor.onSubmit = submit;

  const closeHelp = () => {
    helpHandle?.hide();
    helpHandle = null;
    tui.setFocus(phase === 'home' ? home : editor);
    requestRender();
  };

  const showHelp = () => {
    const dialog = new HelpDialog({ copy, onClose: closeHelp });
    helpHandle = tui.showOverlay(dialog, { width: '64%', minWidth: 46, maxHeight: 14, anchor: 'center', margin: 2 });
    requestRender();
  };

  const closeSessionHistory = () => {
    historyHandle?.hide();
    historyHandle = null;
    historyPicker = null;
    home.loading = false;
    tui.setFocus(phase === 'home' ? home : editor);
    requestRender();
  };

  const showSessionHistory = async () => {
    if (historyHandle) return closeSessionHistory();
    const sessions = await runtime.getSessionHistory?.(30) || [];
    const picker = new SessionPicker(sessions, {
      copy,
      currentSessionId: activeSessionId,
      onCancel: closeSessionHistory,
      onSelect: (nextSessionId) => {
        closeSessionHistory();
        if (nextSessionId !== activeSessionId) stop({ sessionId: nextSessionId });
        else if (phase === 'home') enterMode(home.mode);
      }
    });
    historyPicker = picker;
    historyHandle = tui.showOverlay(picker, { width: '72%', minWidth: 48, maxHeight: 14, anchor: 'center', margin: 2 });
    requestRender();
  };

  const closeSettingsDialog = () => {
    settingsHandle?.hide();
    settingsHandle = null;
    tui.setFocus(home);
    requestRender();
  };

  const showSettingsDialog = async () => {
    const state = runtime.getRuntimeState?.() || {};
    const souls = await runtime.getAvailableSouls?.() || [];
    const dialog = new SettingsDialog({
      copy,
      values: {
        mode: home.mode,
        reasoning: state.reasoningEnabled === false ? 'off' : state.reasoningEffort || 'auto',
        approval: state.approvalMode || 'auto',
        sandbox: state.sandboxMode || 'workspace-write',
        soul: state.activeSoul || souls.find((soul) => soul.category === home.mode && soul.active)?.name || '-'
      },
      souls,
      onChange: async (key, value) => {
        if (key === 'mode') home.mode = value;
        else if (key === 'reasoning') await runtime.setReasoningEffort?.(value);
        else if (key === 'approval') await runtime.setApprovalMode?.(value);
        else if (key === 'sandbox') await runtime.setSandboxMode?.(value);
        else if (key === 'soul') await runtime.setSoul?.(value, home.mode);
        home.syncSession(runtime.getRuntimeState?.());
        requestRender();
      },
      onClose: closeSettingsDialog
    });
    settingsHandle = tui.showOverlay(dialog, { width: '70%', minWidth: 48, maxHeight: 11, anchor: 'center', margin: 2 });
    requestRender();
  };

  const revealLatestProcess = () => {
    const target = processFolds.at(-1);
    if (!target) return;
    tui.renderNow();
    const width = scroll.getContentWidth(terminal.columns);
    let top = 0;
    for (const child of transcript.children) {
      if (child === target) break;
      top += child.render(width).length;
    }
    scroll.scrollTo(top);
    requestRender();
  };

  const toggleProcessDetails = () => {
    toolsExpanded = !toolsExpanded;
    if (toolsExpanded && bodyOnlyView) {
      bodyOnlyView = false;
      for (const fold of processFolds) fold.setBodyOnly(false);
    }
    for (const group of toolGroups) group.setExpanded(toolsExpanded);
    for (const block of reasoningBlocks) block.setExpanded(toolsExpanded);
    transcript.invalidate();
    setActivity('idle', toolsExpanded ? copy.processExpanded : copy.processCollapsed);
    revealLatestProcess();
  };

  const toggleBodyOnlyView = () => {
    bodyOnlyView = !bodyOnlyView;
    if (bodyOnlyView) {
      toolsExpanded = false;
      for (const group of toolGroups) group.setExpanded(false);
      for (const block of reasoningBlocks) block.setExpanded(false);
    }
    for (const fold of processFolds) fold.setBodyOnly(bodyOnlyView);
    transcript.invalidate();
    setActivity('idle', bodyOnlyView ? copy.bodyOnlyView : copy.fullView);
    if (bodyOnlyView) {
      tui.renderNow();
      scroll.scrollToEnd();
      requestRender();
    } else revealLatestProcess();
  };

  const enterMode = async (mode) => {
    phase = 'chat';
    tui.setLayoutRoot(chatLayout);
    tui.setFocus(editor);
    requestRender();
    try {
      await runtime.setExecutionMode?.(mode);
      if (!chatInitialized) {
        const history = runtime.getSessionMessages?.() || [];
        const restored = appendHistory(transcript, history, copy, {
          bodyOnly: bodyOnlyView,
          expanded: toolsExpanded
        });
        processFolds.push(...restored.processFolds);
        reasoningBlocks.push(...restored.reasoningBlocks);
        toolGroups.push(...restored.toolGroups);
        if (history.length === 0) {
          transcript.addChild(createSystemMessage(copy.emptyHint));
          transcript.addChild(createSystemMessage(copy.shortcutHint));
        }
        const inputHistory = await runtime.getInputHistory?.().catch?.(() => []) || [];
        for (const item of inputHistory) editor.addToHistory(String(item));
        chatInitialized = true;
      }
    } catch (error) {
      transcript.addChild(createSystemMessage(error?.message || String(error), color.error));
    }
    requestRender();
  };

  const state = runtime.getRuntimeState?.() || {};
  const home = new ModeHome({
    state,
    model,
    version,
    safeMode,
    location: 'workspace',
    locationPath: defaultWorkspaceDir,
    copy,
    getHeight: () => terminal.rows,
    onAction: (action) => {
      if (action === 'sessions') return showSessionHistory();
      if (action === 'settings') return showSettingsDialog();
      if (action === 'help') return showHelp();
      if (action === 'location') {
        home.location = home.location === 'workspace' ? 'cwd' : 'workspace';
        home.locationPath = home.location === 'cwd' ? currentDirectory : defaultWorkspaceDir;
        return requestRender();
      }
      if (action === 'new') {
        const projectDir = home.location === 'cwd' ? currentDirectory : defaultWorkspaceDir;
        const runtimeState = runtime.getRuntimeState?.() || {};
        if (Number(runtimeState.messageCount || 0) > 0 || String(runtimeState.workspaceRoot || '') !== String(projectDir || '')) {
          return stop({ newSession: true, projectDir });
        }
      }
      return enterMode(home.mode);
    }
  });
  tui.setLayoutRoot(home);
  tui.setFocus(home);

  tui.addInputListener((data) => {
    if (isKeyRelease(data)) return { consume: true };
    if (phase === 'home' && matchesKey(data, 'ctrl+c')) {
      stop();
      return { consume: true };
    }
    if (phase !== 'chat') return undefined;
    if (approvalCancel && (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c'))) {
      approvalCancel();
      return { consume: true };
    }
    if (historyHandle && matchesKey(data, 'escape')) {
      if (historyPicker?.back()) requestRender();
      else closeSessionHistory();
      return { consume: true };
    }
    if ((helpHandle || historyHandle || settingsHandle) && (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c'))) {
      if (helpHandle) closeHelp();
      if (historyHandle) closeSessionHistory();
      if (settingsHandle) closeSettingsDialog();
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+enter')) {
      const text = editor.getText();
      if (text.trim()) submit(text, false, true);
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+o')) {
      toggleProcessDetails();
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+t')) {
      toggleBodyOnlyView();
      return { consume: true };
    }
    if (matchesKey(data, 'shift+up')) {
      scroll.scrollBy(-3);
      requestRender();
      return { consume: true };
    }
    if (matchesKey(data, 'shift+down')) {
      scroll.scrollBy(3);
      requestRender();
      return { consume: true };
    }
    if (matchesKey(data, 'escape') && busy) {
      runtime.abort?.();
      setActivity('stopping', copy.stopping);
      return { consume: true };
    }
    if (matchesKey(data, 'escape') && !editor.getText()) {
      phase = 'home';
      home.loading = false;
      home.syncSession(runtime.getRuntimeState?.());
      tui.setLayoutRoot(home);
      tui.setFocus(home);
      requestRender();
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+c')) {
      if (busy) {
        runtime.abort?.();
        setActivity('stopping', copy.stopping);
        return { consume: true };
      }
      if (editor.getText()) {
        editor.setText('');
        requestRender();
        return { consume: true };
      }
      const now = Date.now();
      if (now - lastCtrlC < 1200) stop();
      else {
        lastCtrlC = now;
        setActivity('idle', copy.exitAgain);
      }
      return { consume: true };
    }
    return undefined;
  });

  tui.start();
  requestRender();
  return await done;
}
