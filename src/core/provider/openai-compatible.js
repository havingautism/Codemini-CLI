import OpenAI from 'openai';

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

function createClient({ baseUrl, apiKey, timeoutMs, maxRetries }) {
  return new OpenAI({
    apiKey,
    baseURL: baseUrl,
    timeout: timeoutMs,
    maxRetries
  });
}

function isMiniMaxModel(model) {
  return String(model || '').toLowerCase().includes('minimax');
}

function buildPayload({ model, temperature, messages, tools, stream = false }) {
  const payload = {
    model,
    temperature,
    messages
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

function buildFinalStreamResult(text, toolCallsByIndex, usage) {
  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tc], i) => ({
      id: tc.id || `tc-${i + 1}`,
      name: tc.name,
      arguments: tc.arguments || '{}'
    }))
    .filter((tc) => tc.name);

  if (!text && toolCalls.length === 0) {
    throw new Error('Gateway stream returned empty assistant response');
  }

  return {
    text,
    toolCalls,
    usage
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
  const client = createClient({ baseUrl, apiKey, timeoutMs, maxRetries });
  const payload = buildPayload({ model, temperature, messages, tools });

  const data = await client.chat.completions.create(payload);
  const message = data?.choices?.[0]?.message || {};
  const text = sanitizeMiniMaxText(model, extractTextContent(message.content));
  const toolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: tc.function?.arguments || '{}'
  }));

  if (!text && toolCalls.length === 0) {
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
  timeoutMs = 90000,
  maxRetries = 2
}) {
  const client = createClient({ baseUrl, apiKey, timeoutMs, maxRetries });
  const payload = buildPayload({ model, temperature, messages, tools, stream: true });

  const stream = await client.chat.completions.create(payload);
  let text = '';
  const toolCallsByIndex = new Map();
  let usage = null;
  let miniMaxStreamState = { rawContent: '', visibleText: '' };

  for await (const chunk of stream) {
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
      if (td.function?.arguments) current.arguments = `${current.arguments}${td.function.arguments}`;
      toolCallsByIndex.set(idx, current);
    }
  }

  return buildFinalStreamResult(text, toolCallsByIndex, usage);
}
