const MESSAGE_COLORS = {
  you: 'white',
  coder: 'greenBright',
  planner: 'magentaBright',
  reviewer: 'yellowBright',
  tester: 'blueBright',
  summarizer: 'cyanBright',
  system: 'yellowBright',
  error: 'redBright',
  pending: 'cyanBright'
};

function colorForLabel(label) {
  return MESSAGE_COLORS[String(label || '').trim()] || 'white';
}

function updateMessage(messages, messageId, updater) {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    return updater(message);
  });
}

function isReadActivityName(name) {
  const raw = String(name || '');
  return /^read\b/i.test(raw);
}

function isIgnorableSegmentAfterRead(item, activityType, activityName) {
  if (!item) return true;
  if (item.type === 'text') return String(item.text || '').trim() === '';
  return (item.type || 'tool') === activityType && item.name === activityName;
}

function findActivityUpdateIndex(source, toolEvent) {
  const items = Array.isArray(source) ? source : [];
  const activityType = toolEvent?.type || 'tool';
  const byId = toolEvent?.id
    ? items.findIndex((item) => item.type === activityType && item.id && item.id === toolEvent.id)
    : -1;
  if (byId !== -1) return byId;

  const byNameRunning = items.findIndex(
    (item) => (item.type || 'tool') === activityType && item.name === toolEvent?.name && item.status !== 'done'
  );
  if (byNameRunning !== -1) return byNameRunning;

  if (isReadActivityName(toolEvent?.name)) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if ((item?.type || 'tool') !== activityType || item?.name !== toolEvent?.name) continue;
      const trailing = items.slice(index + 1);
      if (trailing.every((entry) => isIgnorableSegmentAfterRead(entry, activityType, toolEvent?.name))) {
        return index;
      }
    }
  }

  return -1;
}

function mergeActivitySummary(previousSummary, nextSummary, activityName) {
  const prev = String(previousSummary || '').trim();
  const next = String(nextSummary || '').trim();
  if (!next) return prev;
  if (!prev) return next;
  if (!isReadActivityName(activityName) || prev === next) return next;

  const lines = [];
  for (const line of `${prev}\n${next}`.split('\n')) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    if (!lines.includes(trimmed)) lines.push(trimmed);
  }
  return lines.join('\n');
}

export function createBridgeState() {
  return {
    messages: [],
    activeAssistantId: null
  };
}

export function startAssistantMessage(state, { messageId, label = 'coder', planStep = '', autoSkillNames = [] } = {}) {
  const nextMessage = {
    id: messageId,
    label,
    text: '',
    color: colorForLabel(label),
    ...(planStep ? { planStep } : {}),
    segments: [],
    toolCalls: [],
    pendingToolCalls: [],
    autoSkillNames: Array.isArray(autoSkillNames) ? autoSkillNames : []
  };

  return {
    ...state,
    activeAssistantId: messageId,
    messages: [...(Array.isArray(state?.messages) ? state.messages : []), nextMessage]
  };
}

export function appendAssistantDelta(state, chunk = '') {
  const targetId = state?.activeAssistantId;
  if (!targetId || !chunk) return state;

  return {
    ...state,
    messages: updateMessage(state.messages, targetId, (message) => {
      const segments = Array.isArray(message.segments) ? [...message.segments] : [];
      const last = segments.at(-1);
      if (last?.type === 'text') {
        segments[segments.length - 1] = { ...last, text: `${last.text || ''}${chunk}` };
      } else {
        segments.push({ type: 'text', text: chunk });
      }
      return {
        ...message,
        text: `${message.text || ''}${chunk}`,
        segments
      };
    })
  };
}

export function updateActivityOnAssistant(state, toolEvent) {
  const targetId = state?.activeAssistantId;
  if (!targetId || !toolEvent?.name) return state;

  const activityType = toolEvent.type || 'tool';
  const patch = {
    type: activityType,
    id: toolEvent.id || '',
    name: toolEvent.name,
    status: toolEvent.status,
    ...(toolEvent.arguments !== undefined ? { arguments: toolEvent.arguments } : {}),
    ...(toolEvent.summary ? { summary: toolEvent.summary } : {}),
    ...(toolEvent.durationMs !== undefined ? { durationMs: toolEvent.durationMs } : {}),
    ...(toolEvent.fileChange ? { fileChange: toolEvent.fileChange } : {})
  };

  return {
    ...state,
    messages: updateMessage(state.messages, targetId, (message) => {
      const toolCalls = Array.isArray(message.toolCalls) ? [...message.toolCalls] : [];
      const segments = Array.isArray(message.segments) ? [...message.segments] : [];
      const toolIndex = findActivityUpdateIndex(toolCalls, toolEvent);
      const segmentIndex = findActivityUpdateIndex(segments, toolEvent);

      if (toolIndex === -1) {
        toolCalls.push(patch);
      } else {
        toolCalls[toolIndex] = {
          ...toolCalls[toolIndex],
          ...patch,
          ...(toolEvent.summary
            ? { summary: mergeActivitySummary(toolCalls[toolIndex].summary, toolEvent.summary, toolEvent.name) }
            : {})
        };
      }

      if (segmentIndex === -1) {
        segments.push(patch);
      } else {
        segments[segmentIndex] = {
          ...segments[segmentIndex],
          ...patch,
          ...(toolEvent.summary
            ? { summary: mergeActivitySummary(segments[segmentIndex].summary, toolEvent.summary, toolEvent.name) }
            : {})
        };
      }

      return {
        ...message,
        toolCalls,
        segments
      };
    })
  };
}
