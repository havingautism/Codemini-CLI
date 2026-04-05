import Anthropic from '@anthropic-ai/sdk';

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

function normalizeAssistantContentBlocks(message) {
  if (Array.isArray(message?.content) && message.content.length > 0) {
    return message.content.map((block) => ({ ...block }));
  }

  const contentBlocks = [];
  const text = extractTextContent(message?.content);
  if (text) {
    contentBlocks.push({ type: 'text', text });
  }

  if (Array.isArray(message?.tool_calls)) {
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

  return contentBlocks;
}

function normalizeMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const systemParts = [];
  const out = [];

  for (const message of source) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system') {
      const text = extractTextContent(message.content);
      if (text) systemParts.push(text);
      continue;
    }

    if (message.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: String(message.tool_call_id || ''),
            content: extractTextContent(message.content)
          }
        ]
      });
      continue;
    }

    if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: normalizeAssistantContentBlocks(message)
      });
      continue;
    }

    out.push({
      role: message.role,
      content: [{ type: 'text', text: extractTextContent(message.content) }]
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

function buildAssistantMessage(content) {
  return {
    role: 'assistant',
    content
  };
}

function extractAssistantResult(data, messages) {
  const content = Array.isArray(data?.content) ? data.content.map((block) => ({ ...block })) : [];
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
        content
      };
    }
    throw new Error('Anthropic gateway returned empty assistant response');
  }

  return {
    text,
    toolCalls,
    usage: data?.usage || null,
    content,
    assistantMessage: buildAssistantMessage(content)
  };
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

function buildFinalStreamResult(text, toolCallsByIndex, usage, messages, contentBlocksByIndex) {
  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tc], i) => ({
      id: tc.id || `tc-${i + 1}`,
      name: tc.name,
      arguments: tc.arguments || '{}'
    }))
    .filter((tc) => tc.name);
  const normalizedText = String(text || '').trim();
  const content = Array.from(contentBlocksByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => {
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: tryParseJsonObject(block.arguments)
        };
      }
      if (block.type === 'thinking') {
        return {
          type: 'thinking',
          thinking: block.thinking || '',
          ...(block.signature ? { signature: block.signature } : {})
        };
      }
      return {
        type: 'text',
        text: block.text || ''
      };
    })
    .filter((block) => {
      if (block.type === 'tool_use') return Boolean(block.name);
      if (block.type === 'thinking') return Boolean(block.thinking);
      return Boolean(block.text);
    });

  if (!normalizedText && toolCalls.length === 0) {
    if (hasTrailingToolContext(messages)) {
      return {
        text: '',
        toolCalls: [],
        usage,
        incomplete: true,
        content: []
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
    assistantMessage: buildAssistantMessage(content)
  };
}

function createClient({ baseUrl, apiKey, timeoutMs = 90000, maxRetries = 2 }) {
  return new Anthropic({
    apiKey,
    baseURL: String(baseUrl || '').replace(/\/$/, ''),
    timeout: timeoutMs,
    maxRetries
  });
}

function inferEventType(event) {
  const explicit = String(event?.type || event?.event || '').trim();
  if (explicit) return explicit;
  if (event?.content_block && typeof event?.index === 'number') return 'content_block_start';
  if (event?.delta && typeof event?.index === 'number') return 'content_block_delta';
  if (event?.message) return 'message_start';
  if (event?.usage) return 'message_delta';
  if (event && typeof event === 'object' && Object.keys(event).length === 0) return 'message_stop';
  return '';
}

export async function createChatCompletion({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  tools,
  timeoutMs = 90000,
  maxTokens = 4096,
  maxRetries = 2
}) {
  const client = createClient({ baseUrl, apiKey, timeoutMs, maxRetries });
  const response = await client.messages.create(buildPayload({ model, temperature, messages, tools, maxTokens }));
  return extractAssistantResult(response, messages);
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
  maxTokens = 4096,
  maxRetries = 2
}) {
  const client = createClient({ baseUrl, apiKey, timeoutMs, maxRetries });
  const stream = await client.messages.create(buildPayload({ model, temperature, messages, tools, stream: true, maxTokens }));

  let text = '';
  let usage = null;
  const toolCallsByIndex = new Map();
  const contentBlocksByIndex = new Map();

  for await (const event of stream) {
    const eventType = inferEventType(event);
    usage = mergeUsage(usage, event?.usage);
    usage = mergeUsage(usage, event?.message?.usage);

    if (eventType === 'content_block_start') {
      const index = Number(event?.index ?? 0);
      const contentBlock = event?.content_block || {};
      if (contentBlock.type === 'tool_use') {
        const current = toolCallsByIndex.get(index) || emptyToolCall(index);
        current.id = String(contentBlock.id || current.id || '');
        current.name = String(contentBlock.name || current.name || '');
        const initialInput = contentBlock.input && Object.keys(contentBlock.input).length > 0
          ? normalizeIncomingToolCallArguments(contentBlock.input)
          : '';
        current.arguments = current.arguments || initialInput;
        toolCallsByIndex.set(index, current);
        contentBlocksByIndex.set(index, {
          type: 'tool_use',
          id: current.id,
          name: current.name,
          arguments: current.arguments
        });
      } else if (contentBlock.type === 'thinking') {
        contentBlocksByIndex.set(index, {
          type: 'thinking',
          thinking: String(contentBlock.thinking || ''),
          signature: String(contentBlock.signature || '')
        });
      } else {
        contentBlocksByIndex.set(index, {
          type: 'text',
          text: String(contentBlock.text || '')
        });
      }
      continue;
    }

    if (eventType === 'content_block_delta') {
      const index = Number(event?.index ?? 0);
      const delta = event?.delta || {};
      if (delta.type === 'text_delta' && delta.text) {
        text += delta.text;
        const current = contentBlocksByIndex.get(index) || { type: 'text', text: '' };
        current.text = `${current.text || ''}${delta.text}`;
        contentBlocksByIndex.set(index, current);
        if (onTextDelta) onTextDelta(delta.text);
        continue;
      }

      if (delta.type === 'thinking_delta' && delta.thinking) {
        const current = contentBlocksByIndex.get(index) || { type: 'thinking', thinking: '', signature: '' };
        current.thinking = `${current.thinking || ''}${delta.thinking}`;
        contentBlocksByIndex.set(index, current);
        continue;
      }

      if (delta.type === 'signature_delta') {
        const current = contentBlocksByIndex.get(index) || { type: 'thinking', thinking: '', signature: '' };
        current.signature = `${current.signature || ''}${String(delta.signature || '')}`;
        contentBlocksByIndex.set(index, current);
        continue;
      }

      if (delta.type === 'input_json_delta') {
        const current = toolCallsByIndex.get(index) || emptyToolCall(index);
        current.arguments = `${current.arguments || ''}${String(delta.partial_json || '')}`;
        toolCallsByIndex.set(index, current);
        contentBlocksByIndex.set(index, {
          type: 'tool_use',
          id: current.id,
          name: current.name,
          arguments: current.arguments
        });
        if (onToolCallDelta) {
          onToolCallDelta({
            index,
            id: current.id || `tc-${index + 1}`,
            name: current.name,
            arguments: current.arguments || '{}'
          });
        }
      }
      continue;
    }

    if (eventType === 'message_delta') {
      usage = mergeUsage(usage, event?.delta?.usage);
      continue;
    }

    if (eventType === 'message_stop') {
      break;
    }
  }

  return buildFinalStreamResult(text, toolCallsByIndex, usage, messages, contentBlocksByIndex);
}
