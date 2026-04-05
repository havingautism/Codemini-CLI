function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

function emptyToolCall(index) {
  return {
    index,
    id: '',
    name: '',
    arguments: ''
  };
}

function createHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`
  };
}

function buildChatCompletionsUrl(baseUrl) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/chat/completions`;
}

async function parseJsonResponse(response) {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Gateway error ${response.status}: ${text || response.statusText}`);
  }
  return response.json();
}

async function* iterateSseEvents(stream) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    while (true) {
      const lfBoundary = buffer.indexOf('\n\n');
      const crlfBoundary = buffer.indexOf('\r\n\r\n');
      if (lfBoundary === -1 && crlfBoundary === -1) break;
      const useCrlf = crlfBoundary !== -1 && (lfBoundary === -1 || crlfBoundary < lfBoundary);
      const boundary = useCrlf ? crlfBoundary : lfBoundary;
      const separatorLength = useCrlf ? 4 : 2;
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + separatorLength);
      const dataLines = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      const dataText = dataLines.join('\n');
      if (!dataText || dataText === '[DONE]') continue;
      yield JSON.parse(dataText);
    }
  }
}

function isMiniMaxModel(model) {
  return String(model || '').toLowerCase().includes('minimax');
}

function normalizeToolCallArguments(argumentsText) {
  const raw = typeof argumentsText === 'string' ? argumentsText : JSON.stringify(argumentsText ?? {});
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify(parsed);
    }
  } catch {}
  return '{}';
}

function normalizeIncomingToolCallArguments(argumentsValue) {
  if (typeof argumentsValue === 'string') return argumentsValue;
  if (argumentsValue == null) return '{}';
  try {
    return JSON.stringify(argumentsValue);
  } catch {
    return '{}';
  }
}

function sanitizeGatewayMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  return source
    .filter((message) => message && typeof message === 'object')
    .map((message) => {
      if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
        return message;
      }
      return {
        ...message,
        tool_calls: message.tool_calls.map((toolCall) => ({
          ...toolCall,
          function: {
            ...toolCall?.function,
            arguments: normalizeToolCallArguments(toolCall?.function?.arguments)
          }
        }))
      };
    });
}

function sanitizeMiniMaxMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const out = [];
  let seenNonSystem = false;
  let keptLeadingSystem = false;

  for (const message of source) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system') {
      if (!seenNonSystem && !keptLeadingSystem) {
        out.push(message);
        keptLeadingSystem = true;
      } else {
        out.push({
          role: 'user',
          content: `[system-note]\n${extractTextContent(message.content)}`
        });
      }
      continue;
    }
    seenNonSystem = true;
    out.push(message);
  }

  return out;
}

function buildPayload({ model, temperature, messages, tools, stream = false }) {
  const sanitizedMessages = sanitizeGatewayMessages(messages);
  const payload = {
    model,
    temperature,
    messages: isMiniMaxModel(model) ? sanitizeMiniMaxMessages(sanitizedMessages) : sanitizedMessages
  };
  if (stream) {
    payload.stream = true;
  }
  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }
  if (isMiniMaxModel(model)) {
    payload.extra_body = { reasoning_split: true };
  }
  return payload;
}

function hasTrailingToolContext(messages) {
  const source = Array.isArray(messages) ? messages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const message = source[index];
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'tool') return true;
    if (message.role === 'assistant' || message.role === 'user') return false;
  }
  return false;
}

function buildFinalStreamResult(text, toolCallsByIndex, usage, messages) {
  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tc], i) => ({
      id: tc.id || `tc-${i + 1}`,
      name: tc.name,
      arguments: tc.arguments || '{}'
    }))
    .filter((tc) => tc.name);
  const normalizedText = String(text || '').trim();

  if (!normalizedText && toolCalls.length === 0) {
    if (hasTrailingToolContext(messages)) {
      return {
        text: '',
        toolCalls: [],
        usage,
        incomplete: true
      };
    }
    throw new Error('Gateway stream returned empty assistant response');
  }

  return {
    text,
    toolCalls,
    usage,
    incomplete: false
  };
}

function stripMiniMaxThinkContent(text) {
  const input = String(text || '');
  if (!input) return '';

  let cursor = 0;
  let out = '';
  let removedThink = false;

  while (cursor < input.length) {
    const openIdx = input.indexOf('<think>', cursor);
    const closeIdx = input.indexOf('</think>', cursor);

    if (openIdx === -1 && closeIdx === -1) {
      out += input.slice(cursor);
      break;
    }

    if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
      removedThink = true;
      cursor = closeIdx + '</think>'.length;
      continue;
    }

    out += input.slice(cursor, openIdx);
    const closingTagIdx = input.indexOf('</think>', openIdx + '<think>'.length);
    removedThink = true;
    if (closingTagIdx === -1) {
      cursor = input.length;
      break;
    }
    cursor = closingTagIdx + '</think>'.length;
  }

  return removedThink ? out.trimStart() : out;
}

function sanitizeMiniMaxText(model, text) {
  return isMiniMaxModel(model) ? stripMiniMaxThinkContent(text) : text;
}

function nextMiniMaxVisibleChunk(state, content) {
  const rawChunk = extractTextContent(content);
  if (!rawChunk) {
    return { textDelta: '', nextState: state };
  }

  const nextRawContent = rawChunk.startsWith(state.rawContent) ? rawChunk : `${state.rawContent}${rawChunk}`;
  const nextVisibleText = stripMiniMaxThinkContent(nextRawContent);
  const textDelta = nextVisibleText.startsWith(state.visibleText)
    ? nextVisibleText.slice(state.visibleText.length)
    : nextVisibleText;

  return {
    textDelta,
    nextState: {
      rawContent: nextRawContent,
      visibleText: nextVisibleText
    }
  };
}

export async function createChatCompletion({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  tools,
  timeoutMs = 90000,
  maxRetries = 2
}) {
  const payload = buildPayload({ model, temperature, messages, tools });
  const response = await fetch(buildChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: createHeaders(apiKey),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await parseJsonResponse(response);
  const message = data?.choices?.[0]?.message || {};
  const text = sanitizeMiniMaxText(model, extractTextContent(message.content));
  const toolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: normalizeIncomingToolCallArguments(tc.function?.arguments)
  }));
  const normalizedText = String(text || '').trim();

  if (!normalizedText && toolCalls.length === 0) {
    if (hasTrailingToolContext(messages)) {
      return {
        text: '',
        toolCalls: [],
        usage: data?.usage || null,
        incomplete: true
      };
    }
    throw new Error('Gateway returned empty assistant response');
  }

  return {
    text,
    toolCalls,
    usage: data?.usage || null
  };
}

export async function createChatCompletionStream({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  tools,
  onTextDelta,
  onToolCallDelta,
  timeoutMs = 90000,
  maxRetries = 2
}) {
  const payload = buildPayload({ model, temperature, messages, tools, stream: true });
  const response = await fetch(buildChatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: createHeaders(apiKey),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Gateway error ${response.status}: ${text || response.statusText}`);
  }
  let text = '';
  const toolCallsByIndex = new Map();
  let usage = null;
  let miniMaxStreamState = { rawContent: '', visibleText: '' };

  for await (const chunk of iterateSseEvents(response.body)) {
    usage = chunk?.usage || usage;
    const choice0 = chunk?.choices?.[0] || {};
    const delta = choice0?.delta || {};
    const content = delta.content;
    if (isMiniMaxModel(model)) {
      const next = nextMiniMaxVisibleChunk(miniMaxStreamState, content);
      miniMaxStreamState = next.nextState;
      if (next.textDelta) {
        text += next.textDelta;
        if (onTextDelta) onTextDelta(next.textDelta);
      }
    } else if (typeof content === 'string' && content.length > 0) {
      text += content;
      if (onTextDelta) onTextDelta(content);
    } else if (Array.isArray(content) && content.length > 0) {
      const chunkText = extractTextContent(content);
      if (chunkText) {
        text += chunkText;
        if (onTextDelta) onTextDelta(chunkText);
      }
    }

    const toolDeltas = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const td of toolDeltas) {
      const idx = typeof td.index === 'number' ? td.index : 0;
      const current = toolCallsByIndex.get(idx) || emptyToolCall(idx);
      if (td.id) current.id = td.id;
      if (td.function?.name) current.name = `${current.name}${td.function.name}`;
      if (td.function?.arguments !== undefined) {
        current.arguments = `${current.arguments}${normalizeIncomingToolCallArguments(td.function.arguments)}`;
      }
      toolCallsByIndex.set(idx, current);
      if (onToolCallDelta) {
        onToolCallDelta({
          index: idx,
          id: current.id || `tc-${idx + 1}`,
          name: current.name,
          arguments: current.arguments || '{}'
        });
      }
    }
  }

  return buildFinalStreamResult(text, toolCallsByIndex, usage, messages);
}
