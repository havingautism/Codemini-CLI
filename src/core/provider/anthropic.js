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

function cloneAnthropicContentBlock(block) {
  if (!block || typeof block !== 'object') return null;
  if (block.type === 'thinking') {
    const thinking = String(block.thinking || block.text || '');
    if (!thinking) return null;
    return {
      type: 'thinking',
      thinking,
      ...(block.signature ? { signature: String(block.signature) } : {})
    };
  }
  if (block.type === 'redacted_thinking') {
    const data = block.data != null ? String(block.data) : '';
    if (!data) return null;
    return { type: 'redacted_thinking', data };
  }
  if (block.type === 'text') {
    const text = String(block.text || '');
    return text ? { type: 'text', text } : null;
  }
  if (block.type === 'tool_use') {
    const name = String(block.name || '').trim();
    if (!name) return null;
    return {
      type: 'tool_use',
      id: String(block.id || ''),
      name,
      input: block.input && typeof block.input === 'object' && !Array.isArray(block.input) ? block.input : {}
    };
  }
  return null;
}

function extractThinkingBlocks(message) {
  const source = [
    ...(Array.isArray(message?.reasoning_details) ? message.reasoning_details : []),
    ...(Array.isArray(message?.content) ? message.content : [])
  ];
  return source
    .filter((block) => block?.type === 'thinking' || block?.type === 'redacted_thinking')
    .map(cloneAnthropicContentBlock)
    .filter(Boolean);
}

function buildAssistantMessage({ text = '', toolCalls = [], thinkingBlocks = [] }) {
  const assistantMessage = {
    role: 'assistant',
    content: text
  };
  const reasoningDetails = Array.isArray(thinkingBlocks)
    ? thinkingBlocks.map(cloneAnthropicContentBlock).filter(Boolean)
    : [];
  if (reasoningDetails.length > 0) assistantMessage.reasoning_details = reasoningDetails;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    assistantMessage.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: tc.arguments || '{}'
      }
    }));
  }
  return assistantMessage;
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

function tryParseJsonObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {}
  return {};
}

function normalizeMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const systemParts = [];
  const out = [];

  for (let i = 0; i < source.length; i += 1) {
    const message = source[i];
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system') {
      const text = extractTextContent(message.content);
      if (text) systemParts.push(text);
      continue;
    }

    if (message.role === 'tool') {
      const toolResults = [];
      while (i < source.length) {
        const toolMessage = source[i];
        if (!toolMessage || typeof toolMessage !== 'object' || toolMessage.role !== 'tool') break;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: String(toolMessage.tool_call_id || ''),
          content: extractTextContent(toolMessage.content)
        });
        i += 1;
      }
      i -= 1;
      out.push({
        role: 'user',
        content: toolResults
      });
      continue;
    }

    const contentBlocks = message.role === 'assistant' ? extractThinkingBlocks(message) : [];
    const text = extractTextContent(message.content);
    if (text) {
      contentBlocks.push({ type: 'text', text });
    }

    const hasContentToolUse = Array.isArray(message.content)
      && message.content.some((block) => block?.type === 'tool_use');
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      if (!hasContentToolUse) {
        for (const toolCall of message.tool_calls) {
          const name = String(toolCall?.function?.name || toolCall?.name || '').trim();
          if (!name) continue;
          contentBlocks.push({
            type: 'tool_use',
            id: String(toolCall?.id || ''),
            name,
            input: tryParseJsonObject(toolCall?.function?.arguments ?? toolCall?.arguments)
          });
        }
      }
    }

    out.push({
      role: message.role,
      content: contentBlocks
    });
  }

  return {
    system: systemParts.join('\n\n').trim() || undefined,
    messages: out
  };
}

function normalizeTools(tools) {
  const source = Array.isArray(tools) ? tools : [];
  return source
    .map((tool) => {
      const fn = tool?.function || {};
      const name = String(fn.name || '').trim();
      if (!name) return null;
      return {
        name,
        ...(fn.description ? { description: String(fn.description) } : {}),
        input_schema: fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object' }
      };
    })
    .filter(Boolean);
}

function buildPayload({ model, temperature, messages, tools, stream = false, maxTokens = 4096 }) {
  const normalized = normalizeMessages(messages);
  const payload = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: normalized.messages
  };
  if (normalized.system) payload.system = normalized.system;
  if (stream) payload.stream = true;

  const normalizedTools = normalizeTools(tools);
  if (normalizedTools.length > 0) {
    payload.tools = normalizedTools;
    payload.tool_choice = { type: 'auto' };
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

function extractAssistantResult(data, messages) {
  const content = Array.isArray(data?.content) ? data.content : [];
  const thinkingBlocks = content
    .filter((block) => block?.type === 'thinking' || block?.type === 'redacted_thinking')
    .map(cloneAnthropicContentBlock)
    .filter(Boolean);
  const text = content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text || '')
    .join('');
  const toolCalls = content
    .filter((block) => block?.type === 'tool_use')
    .map((block) => ({
      id: String(block.id || ''),
      name: String(block.name || ''),
      arguments: normalizeIncomingToolCallArguments(block.input)
    }))
    .filter((toolCall) => toolCall.name);
  const normalizedText = String(text || '').trim();

  if (!normalizedText && toolCalls.length === 0) {
    if (hasTrailingToolContext(messages)) {
      return {
        text: '',
        toolCalls: [],
        usage: data?.usage || null,
        incomplete: true,
        content,
        assistantMessage: buildAssistantMessage({ text: '', toolCalls: [], thinkingBlocks })
      };
    }
    throw new Error('Anthropic gateway returned empty assistant response');
  }

  return {
    text,
    toolCalls,
    usage: data?.usage || null,
    content,
    assistantMessage: buildAssistantMessage({ text, toolCalls, thinkingBlocks })
  };
}

function createHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };
}

function buildMessagesUrl(baseUrl) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/v1/messages`;
}

async function parseJsonResponse(response) {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic gateway error ${response.status}: ${text || response.statusText}`);
  }
  return response.json();
}

function mergeUsage(current, next) {
  if (!next || typeof next !== 'object') return current;
  return {
    ...(current || {}),
    ...next
  };
}

function emptyToolCall(index) {
  return {
    index,
    id: '',
    name: '',
    arguments: ''
  };
}

function buildFinalStreamResult(text, toolCallsByIndex, usage, messages, thinkingBlocks = []) {
  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tc], i) => ({
      id: tc.id || `tc-${i + 1}`,
      name: tc.name,
      arguments: tc.arguments || '{}'
    }))
    .filter((tc) => tc.name);
  const normalizedText = String(text || '').trim();
  const content = [];
  for (const block of thinkingBlocks) {
    const cloned = cloneAnthropicContentBlock(block);
    if (cloned) content.push(cloned);
  }
  if (text) content.push({ type: 'text', text });
  for (const toolCall of toolCalls) {
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: tryParseJsonObject(toolCall.arguments)
    });
  }

  if (!normalizedText && toolCalls.length === 0) {
    if (hasTrailingToolContext(messages)) {
      return {
        text: '',
        toolCalls: [],
        usage,
        incomplete: true,
        content: [],
        assistantMessage: buildAssistantMessage({ text: '', toolCalls: [], thinkingBlocks })
      };
    }
    throw new Error('Anthropic gateway stream returned empty assistant response');
  }

  return {
    text,
    toolCalls,
    usage,
    incomplete: false,
    content,
    assistantMessage: buildAssistantMessage({ text, toolCalls, thinkingBlocks })
  };
}

async function* iterateSseEvents(stream) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    while (buffer.includes('\n\n')) {
      const boundary = buffer.indexOf('\n\n');
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = rawEvent.split('\n');
      let event = 'message';
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      const dataText = dataLines.join('\n');
      if (!dataText || dataText === '[DONE]') continue;
      yield {
        event,
        data: JSON.parse(dataText)
      };
    }
  }
}

export async function createChatCompletion({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  tools,
  timeoutMs = 1800000,
  maxTokens = 4096
}) {
  const payload = buildPayload({ model, temperature, messages, tools, maxTokens });
  const response = await fetch(buildMessagesUrl(baseUrl), {
    method: 'POST',
    headers: createHeaders(apiKey),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await parseJsonResponse(response);
  return extractAssistantResult(data, messages);
}

export async function createChatCompletionStream({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  tools,
  onTextDelta,
  onReasoningDelta,
  onToolCallDelta,
  timeoutMs = 1800000,
  maxTokens = 4096,
  signal: externalSignal
}) {
  // 合并超时信号与外部中止信号
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  timeoutSignal.addEventListener('abort', onAbort, { once: true });
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }
  const payload = buildPayload({ model, temperature, messages, tools, stream: true, maxTokens });
  const response = await fetch(buildMessagesUrl(baseUrl), {
    method: 'POST',
    headers: createHeaders(apiKey),
    body: JSON.stringify(payload),
    signal: controller.signal
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic gateway error ${response.status}: ${text || response.statusText}`);
  }

  let text = '';
  let usage = null;
  const toolCallsByIndex = new Map();
  const thinkingBlocksByIndex = new Map();

  for await (const chunk of iterateSseEvents(response.body)) {
    usage = mergeUsage(usage, chunk?.data?.usage);
    usage = mergeUsage(usage, chunk?.data?.message?.usage);

    if (chunk.event === 'content_block_start') {
      const index = Number(chunk?.data?.index ?? 0);
      const contentBlock = chunk?.data?.content_block || {};
      if (contentBlock.type === 'tool_use') {
        const current = toolCallsByIndex.get(index) || emptyToolCall(index);
        current.id = String(contentBlock.id || current.id || '');
        current.name = String(contentBlock.name || current.name || '');
        const initialInput = contentBlock.input && Object.keys(contentBlock.input).length > 0
          ? normalizeIncomingToolCallArguments(contentBlock.input)
          : '';
        current.arguments = current.arguments || initialInput;
        toolCallsByIndex.set(index, current);
      } else if (contentBlock.type === 'thinking' || contentBlock.type === 'redacted_thinking') {
        const current = cloneAnthropicContentBlock(contentBlock) || { type: contentBlock.type };
        if (current.type === 'thinking' && current.thinking == null) current.thinking = '';
        thinkingBlocksByIndex.set(index, current);
      }
      continue;
    }

    if (chunk.event !== 'content_block_delta') {
      continue;
    }

    const index = Number(chunk?.data?.index ?? 0);
    const delta = chunk?.data?.delta || {};
    if (delta.type === 'text_delta' && delta.text) {
      text += delta.text;
      if (onTextDelta) onTextDelta(delta.text);
      continue;
    }

    if (delta.type === 'thinking_delta') {
      const current = thinkingBlocksByIndex.get(index) || { type: 'thinking', thinking: '' };
      const thinkingDelta = String(delta.thinking || '');
      current.thinking = `${current.thinking || ''}${thinkingDelta}`;
      thinkingBlocksByIndex.set(index, current);
      if (thinkingDelta && onReasoningDelta) onReasoningDelta(thinkingDelta);
      continue;
    }

    if (delta.type === 'signature_delta') {
      const current = thinkingBlocksByIndex.get(index) || { type: 'thinking', thinking: '' };
      current.signature = String(delta.signature || '');
      thinkingBlocksByIndex.set(index, current);
      continue;
    }

    if (delta.type === 'input_json_delta') {
      const current = toolCallsByIndex.get(index) || emptyToolCall(index);
      current.arguments = `${current.arguments || ''}${String(delta.partial_json || '')}`;
      toolCallsByIndex.set(index, current);
      if (onToolCallDelta) {
        onToolCallDelta({
          index,
          id: current.id || `tc-${index + 1}`,
          name: current.name,
          arguments: current.arguments || '{}'
        });
      }
    }
  }

  const thinkingBlocks = Array.from(thinkingBlocksByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => cloneAnthropicContentBlock(block))
    .filter(Boolean);

  return buildFinalStreamResult(text, toolCallsByIndex, usage, messages, thinkingBlocks);
}
