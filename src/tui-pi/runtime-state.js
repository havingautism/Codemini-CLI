function normalizeMessageContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);
  if (Array.isArray(content)) {
    return content
      .map((item) => normalizeMessageContent(item))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof content === 'object') {
    const keys = ['text', 'content', 'value'];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(content, key)) {
        const normalized = normalizeMessageContent(content[key]);
        if (normalized) return normalized;
      }
    }
  }
  return '';
}

function normalizeShellMessages(messages) {
  return Array.isArray(messages) ? [...messages] : [];
}

function normalizeToolName(name) {
  const text = String(name || '').trim();
  return text || 'tool';
}

function trimText(value) {
  return String(value || '').trim();
}

function ensureAssistantMessage(messages) {
  const rows = normalizeShellMessages(messages);
  const last = rows.at(-1);

  if (last?.role === 'coder') return rows;

  return [
    ...rows,
    {
      id: `msg-${rows.length + 1}`,
      role: 'coder',
      text: '',
      toolEntries: [],
      toolLines: []
    }
  ];
}

function updateLastAssistantMessage(messages, updater) {
  const rows = ensureAssistantMessage(messages);
  const next = [...rows];
  next[next.length - 1] = updater(next[next.length - 1]);
  return next;
}

function normalizeToolEntry(entry, index) {
  const lines = Array.isArray(entry?.lines) ? entry.lines.map((line) => String(line || '')) : [];
  return {
    id: String(entry?.id || `tool-entry-${index + 1}`),
    name: String(entry?.name || ''),
    lines
  };
}

function flattenToolEntryLines(entries) {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => normalizeToolEntry(entry).lines);
}

function upsertAssistantToolEntry(message, event) {
  const currentEntries = Array.isArray(message?.toolEntries) ? message.toolEntries.map(normalizeToolEntry) : [];
  const entryId = String(event?.id || normalizeToolName(event?.name));
  const entryIndex = currentEntries.findIndex((entry) => entry.id === entryId);
  const existing = entryIndex >= 0
    ? currentEntries[entryIndex]
    : {
        id: entryId,
        name: normalizeToolName(event?.name),
        lines: []
      };

  const nextEntry = {
    ...existing,
    name: normalizeToolName(event?.name),
    lines: [...existing.lines]
  };

  if (event?.type === 'tool:start') {
    nextEntry.lines[0] = `🔧 ${nextEntry.name}`;
  }

  if (event?.type === 'tool:end') {
    nextEntry.lines[1] = `📄 ${trimText(event?.summary) || `Completed ${nextEntry.name}`}`;
  }

  if (event?.type === 'tool:error') {
    nextEntry.lines[1] = `⚠️ ${trimText(event?.summary) || `Failed ${nextEntry.name}`}`;
  }

  if (event?.type === 'tool:blocked') {
    nextEntry.lines[1] = `⛔ ${nextEntry.name} blocked`;
  }

  if (event?.type === 'tool:result') {
    nextEntry.lines[2] = `└ ${trimText(event?.content) || `Result ready for ${nextEntry.name}`}`;
  }

  const mergedEntries =
    entryIndex >= 0
      ? currentEntries.map((entry, index) => (index === entryIndex ? nextEntry : entry))
      : [...currentEntries, nextEntry];

  return {
    ...message,
    toolEntries: mergedEntries,
    toolLines: flattenToolEntryLines(mergedEntries)
  };
}

function buildToolSummary(event) {
  const name = normalizeToolName(event?.name);

  if (event?.type === 'tool:start') return `${name} [running]`;
  if (event?.type === 'tool:end') return trimText(event?.summary) || `${name} [done]`;
  if (event?.type === 'tool:error') return trimText(event?.summary) || `${name} [error]`;
  if (event?.type === 'tool:blocked') return `${name} [blocked]`;
  if (event?.type === 'tool:result') return `${name} [result]`;
  return name;
}

function buildToolDetail(event) {
  const name = normalizeToolName(event?.name);

  if (event?.type === 'tool:start') return `running ${name}`;
  if (event?.type === 'tool:end') return trimText(event?.summary) || `completed ${name}`;
  if (event?.type === 'tool:error') return trimText(event?.summary) || `failed ${name}`;
  if (event?.type === 'tool:blocked') return `blocked ${name}`;
  if (event?.type === 'tool:result') return trimText(event?.content) || `result ready for ${name}`;
  return name;
}

function upsertToolItems(items, event) {
  const currentItems = Array.isArray(items) ? items : [];
  const eventId = String(event?.id || normalizeToolName(event?.name));
  const existingIndex = currentItems.findIndex((item) => item.id === eventId);
  const existing = existingIndex >= 0 ? currentItems[existingIndex] : null;

  const nextItem = normalizeToolItem(
    {
      ...(existing || {}),
      id: eventId,
      name: normalizeToolName(event?.name),
      summary: buildToolSummary(event),
      detail: buildToolDetail(event),
      done: event?.type === 'tool:end' || event?.type === 'tool:error' || event?.type === 'tool:blocked'
    },
    existingIndex >= 0 ? existingIndex : currentItems.length
  );

  // Preserve existing detail when new event lacks richer content, but still allow result content to win.
  const mergedItem = {
    ...nextItem,
    summary: event?.type === 'tool:result' && existing?.summary ? existing.summary : nextItem.summary,
    detail:
      event?.type === 'tool:result'
        ? buildToolDetail(event)
        : nextItem.detail || existing?.detail || nextItem.summary,
    done:
      event?.type === 'tool:result'
        ? Boolean(existing?.done)
        : nextItem.done
  };

  if (existingIndex >= 0) {
    const nextItems = [...currentItems];
    nextItems[existingIndex] = {
      ...currentItems[existingIndex],
      ...mergedItem
    };
    return nextItems;
  }

  return [...currentItems, mergedItem];
}

function hasActiveTool(items) {
  return (Array.isArray(items) ? items : []).some((item) => !item?.done);
}

function normalizeSessionMessages(sessionHistory) {
  if (Array.isArray(sessionHistory)) return sessionHistory;
  if (Array.isArray(sessionHistory?.messages)) return sessionHistory.messages;
  return [];
}

function normalizeToolItem(item, index) {
  return {
    id: String(item?.id || `tool-${index + 1}`),
    name: String(item?.name || ''),
    summary: String(item?.summary || item?.name || ''),
    done: Boolean(item?.done),
    detail: String(item?.detail || item?.summary || item?.name || '')
  };
}

export function buildPiMessagesFromSessionHistory(sessionHistory = []) {
  const rows = [];
  const messages = normalizeSessionMessages(sessionHistory);

  for (const message of messages) {
    const role = String(message?.role || '').trim();
    if (!role) continue;

    const normalizedRole =
      role === 'user'
        ? 'you'
        : role === 'assistant'
          ? 'coder'
          : role === 'tool'
            ? 'tool'
            : role === 'system'
              ? 'system'
              : null;

    if (!normalizedRole) continue;

    rows.push({
      id: String(message?.id || `msg-${rows.length + 1}`),
      role: normalizedRole,
      text: normalizeMessageContent(message?.content),
      toolEntries: [],
      toolLines: []
    });
  }

  return rows;
}

export function buildPiToolPanelState(items = [], expanded = false) {
  const normalizedItems = Array.isArray(items) ? items.map(normalizeToolItem) : [];

  return {
    expanded: Boolean(expanded),
    items: normalizedItems,
    summaryRows: normalizedItems.map((item) => item.summary),
    detailRows: expanded
      ? normalizedItems.map((item) => `${item.done ? '[done]' : '[run]'} ${item.detail}`)
      : []
  };
}

export function toggleToolDetails(panelState) {
  return buildPiToolPanelState(panelState?.items || [], !panelState?.expanded);
}

export function applyPiSubmitStart(shellState, value) {
  const text = trimText(value);
  if (!text) {
    return {
      status: 'waiting',
      messages: normalizeShellMessages(shellState?.messages),
      toolPanel: buildPiToolPanelState(shellState?.toolPanel?.items || [], shellState?.toolPanel?.expanded)
    };
  }

  return {
    status: 'thinking',
    messages: [
      ...normalizeShellMessages(shellState?.messages),
      {
        id: `msg-${normalizeShellMessages(shellState?.messages).length + 1}`,
        role: 'you',
        text
      }
    ],
    toolPanel: buildPiToolPanelState(shellState?.toolPanel?.items || [], shellState?.toolPanel?.expanded)
  };
}

export function applyPiRuntimeEvent(shellState, event) {
  const current = {
    status: String(shellState?.status || 'waiting'),
    messages: normalizeShellMessages(shellState?.messages),
    toolPanel: buildPiToolPanelState(shellState?.toolPanel?.items || [], shellState?.toolPanel?.expanded)
  };

  if (!event?.type) return current;

  if (event.type === 'assistant:start') {
    const hasRunningTool = hasActiveTool(current.toolPanel.items);
    return {
      ...current,
      status: hasRunningTool ? 'tooling' : 'thinking',
      messages: ensureAssistantMessage(current.messages)
    };
  }

  if (event.type === 'assistant:delta') {
    const hasRunningTool = hasActiveTool(current.toolPanel.items);
    return {
      ...current,
      status: hasRunningTool ? 'tooling' : 'streaming',
      messages: updateLastAssistantMessage(current.messages, (message) => ({
        ...message,
        toolEntries: Array.isArray(message?.toolEntries) ? message.toolEntries.map(normalizeToolEntry) : [],
        toolLines: Array.isArray(message?.toolLines) ? [...message.toolLines] : [],
        text: `${message.text || ''}${event.text || ''}`
      }))
    };
  }

  if (event.type === 'assistant:response') {
    const responseText = normalizeMessageContent(event?.assistantMessage?.content ?? event?.text);
    const hasToolCalls =
      Array.isArray(event?.assistantMessage?.tool_calls) && event.assistantMessage.tool_calls.length > 0;
    const hasRunningTool = hasActiveTool(current.toolPanel.items);

    return {
      ...current,
      status: hasToolCalls || hasRunningTool ? 'tooling' : 'waiting',
      messages: updateLastAssistantMessage(current.messages, (message) => ({
        ...message,
        toolEntries: Array.isArray(message?.toolEntries) ? message.toolEntries.map(normalizeToolEntry) : [],
        toolLines: Array.isArray(message?.toolLines) ? [...message.toolLines] : [],
        text: responseText || message.text || ''
      }))
    };
  }

  if (
    event.type === 'tool:start' ||
    event.type === 'tool:end' ||
    event.type === 'tool:error' ||
    event.type === 'tool:blocked' ||
    event.type === 'tool:result'
  ) {
    const nextItems = upsertToolItems(current.toolPanel.items, event);
    const nextStatus =
      event.type === 'tool:start'
        ? 'tooling'
        : event.type === 'tool:end' || event.type === 'tool:error' || event.type === 'tool:blocked' || event.type === 'tool:result'
          ? hasActiveTool(nextItems)
            ? 'tooling'
            : 'waiting'
          : current.status;

    return {
      ...current,
      status: nextStatus,
      messages: updateLastAssistantMessage(current.messages, (message) => upsertAssistantToolEntry(message, event)),
      toolPanel: buildPiToolPanelState(nextItems, current.toolPanel.expanded)
    };
  }

  return current;
}

export function buildInitialPiShellState({ runtimeState = {}, toolDetailsExpanded = false } = {}) {
  const sessionId = String(runtimeState?.sessionId || 'new-session');
  const model = String(runtimeState?.model || 'unknown-model');
  const sdkProvider = String(runtimeState?.sdkProvider || 'openai-compatible');
  const mode = String(runtimeState?.mode || 'auto');

  return {
    status: 'waiting',
    messages: buildPiMessagesFromSessionHistory([
      {
        role: 'system',
        content: `Session ${sessionId} is ready. Model: ${model}. Provider: ${sdkProvider}. Mode: ${mode}.`
      },
      {
        role: 'assistant',
        content: 'pi-tui shell is active. Enter a prompt to send it through the runtime.'
      }
    ]),
    toolPanel: buildPiToolPanelState([], toolDetailsExpanded)
  };
}
