import { fetchWithRetry } from './fetch-with-retry.js';
import { resolveAnthropicReasoning } from './reasoning-effort.js';
import { isCompletionTruncated } from './completion-status.js';
import { stringifyGatewayJson } from './json-body.js';
import { iterateSseJsonEvents } from '../sse.js';
import { gatewaySessionHeaders } from './gateway-session-headers.js';

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
    if (!thinking && !block.signature) return null;
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

function buildAssistantMessage({ text = '', toolCalls = [], content = [] }) {
  const assistantMessage = {
    role: 'assistant',
    content: text
  };
  const reasoningDetails = extractThinkingBlocks({ content });
  if (reasoningDetails.length > 0) assistantMessage.reasoning_details = reasoningDetails;
  // Arguments live in tool_calls so compaction can remove them without a
  // second copy in the saved native block sequence.
  assistantMessage.anthropic_content = content.map((block) => block.type === 'tool_use'
    ? { type: 'tool_use', id: block.id }
    : block);
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
          content: extractTextContent(toolMessage.content),
          ...(['error', 'blocked'].includes(String(toolMessage.tool_status || '').toLowerCase())
            ? { is_error: true }
            : {})
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

    if (message.role === 'assistant' && Array.isArray(message.anthropic_content)) {
      const calls = new Map((message.tool_calls || []).map((call) => [String(call.id), call]));
      const content = [];
      for (const block of message.anthropic_content) {
        if (block.type !== 'tool_use') {
          content.push(block);
          continue;
        }
        const call = calls.get(String(block.id));
        if (!call) continue;
        content.push({
          type: 'tool_use',
          id: String(block.id),
          name: call.function.name,
          input: tryParseJsonObject(call.function.arguments),
        });
      }
      if (content.length) out.push({ role: 'assistant', content });
      continue;
    }

    const contentBlocks = message.role === 'assistant' ? extractThinkingBlocks(message) : [];
    if (Array.isArray(message.content) && message.role === 'user') {
      for (const block of message.content) {
        if (block?.type === 'text' && block.text) {
          contentBlocks.push({ type: 'text', text: String(block.text) });
        }
        if (block?.type === 'image_url') {
          const url = String(block.image_url?.url || '');
          const match = url.match(/^data:([^;]+);base64,([\s\S]+)$/);
          if (match) {
            contentBlocks.push({
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] }
            });
          }
        }
      }
    } else {
      const text = extractTextContent(message.content);
      if (text) contentBlocks.push({ type: 'text', text });
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

    if (message.role !== 'assistant' || contentBlocks.length) {
      out.push({ role: message.role, content: contentBlocks });
    }
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

function normalizeToolChoice(toolChoice) {
  if (!toolChoice) return { type: 'auto' };
  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto' || toolChoice === 'none') return { type: toolChoice };
    return { type: 'tool', name: toolChoice };
  }
  if (toolChoice?.type === 'function' && toolChoice?.function?.name) {
    return { type: 'tool', name: String(toolChoice.function.name) };
  }
  if (toolChoice?.type === 'tool' && toolChoice?.name) return toolChoice;
  if (toolChoice?.type === 'none') return toolChoice;
  if (toolChoice?.name) return { type: 'tool', name: String(toolChoice.name) };
  return { type: 'auto' };
}

function supportsAutomaticCacheControl(baseUrl, model) {
  const endpoint = URL.parse(baseUrl);
  if (endpoint?.protocol !== 'https:') return false;
  return endpoint.hostname === 'api.anthropic.com'
    || (endpoint.hostname.endsWith('.maas.aliyuncs.com')
      && endpoint.pathname.replace(/\/$/, '').endsWith('/apps/anthropic')
      && model === 'qwen4-max');
}

function buildPayload({ baseUrl, model, temperature, messages, tools, stream = false, maxTokens = 16384, toolChoice, reasoningEffort }) {
  const normalized = normalizeMessages(messages);
  const reasoning = resolveAnthropicReasoning({ baseUrl, model, effort: reasoningEffort, maxTokens });
  const payload = {
    model,
    max_tokens: maxTokens,
    messages: normalized.messages
  };
  if (!reasoning.thinking) payload.temperature = temperature;
  Object.assign(payload, reasoning);
  if (normalized.system) payload.system = normalized.system;
  if (stream) payload.stream = true;

  const normalizedTools = normalizeTools(tools);
  if (normalizedTools.length > 0) {
    payload.tools = normalizedTools;
    payload.tool_choice = normalizeToolChoice(toolChoice);
    if (payload.tool_choice.type !== 'none' && supportsAutomaticCacheControl(baseUrl, model)) {
      payload.cache_control = { type: 'ephemeral' };
    }
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
  const text = content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text || '')
    .join('');
  const toolCalls = content
    .filter((block) => block?.type === 'tool_use')
    .map((block) => ({
      id: String(block.id || ''),
      name: String(block.name || ''),
      arguments: normalizeIncomingToolCallArguments(block.input),
      argumentsComplete: !isCompletionTruncated(data?.stop_reason)
    }))
    .filter((toolCall) => toolCall.name);
  const normalizedText = String(text || '').trim();

  const finishReason = String(data?.stop_reason || '');
  if (!normalizedText && toolCalls.length === 0) {
    if (hasTrailingToolContext(messages)) {
      return {
        text: '',
        toolCalls: [],
        usage: data?.usage || null,
        incomplete: true,
        finishReason,
        content,
        assistantMessage: buildAssistantMessage({ content: [] })
      };
    }
    throw new Error('Anthropic gateway returned empty assistant response');
  }

  return {
    text,
    toolCalls,
    usage: data?.usage || null,
    finishReason,
    content,
    assistantMessage: buildAssistantMessage({ text, toolCalls, content })
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

async function sendMessagesRequest({ baseUrl, apiKey, payload, signal, maxRetries, onPayloadPrepared }) {
  const url = buildMessagesUrl(baseUrl);
  const headers = { ...createHeaders(apiKey), ...gatewaySessionHeaders(baseUrl) };
  const send = (body, requestHeaders) => {
    onPayloadPrepared?.(body);
    return fetchWithRetry(url, {
      method: 'POST', headers: requestHeaders, body: stringifyGatewayJson(body), signal,
    }, { maxRetries });
  };
  const response = await send(payload, headers);
  if (response.status !== 400 || URL.parse(url)?.origin !== 'https://api.anthropic.com'
    || payload.thinking?.type === 'disabled') return response;
  const error = await response.clone().text().catch(() => '');
  if (!error.toLowerCase().includes('block is bound to a different conversation')) return response;
  // Let Claude drop only blocks invalidated by an earlier edit to the prefix.
  const thinking = {
    type: 'adaptive',
    ...payload.thinking,
    block_binding: { prefix_mismatch_behavior: 'drop_block' },
  };
  return send({ ...payload, thinking }, {
    ...headers,
    'anthropic-beta': 'thinking-binding-controls-2026-08-01',
  });
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

function buildFinalStreamResult(text, toolCallsByIndex, usage, messages, blocksByIndex, finishReason = '', messageStopped = false) {
  // A closed block alone is not authority to execute tools: EOF can precede
  // message completion. Gateways must also provide the Anthropic terminal events.
  const messageComplete = messageStopped && Boolean(finishReason.trim()) && !isCompletionTruncated(finishReason);
  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tc], i) => ({
      id: tc.id || `tc-${i + 1}`,
      name: tc.name,
      arguments: tc.arguments || '{}',
      argumentsComplete: tc.closed === true && messageComplete
    }))
    .filter((tc) => tc.name);
  const normalizedText = String(text || '').trim();
  const contentByIndex = new Map(blocksByIndex);
  let toolCallIndex = 0;
  for (const [index, call] of [...toolCallsByIndex].sort((a, b) => a[0] - b[0])) {
    if (!call.name) continue;
    const toolCall = toolCalls[toolCallIndex++];
    contentByIndex.set(index, {
      type: 'tool_use', id: toolCall.id, name: toolCall.name, input: tryParseJsonObject(toolCall.arguments),
    });
  }
  const content = [...contentByIndex].sort((a, b) => a[0] - b[0])
    .map(([, block]) => cloneAnthropicContentBlock(block)).filter(Boolean);

  if (!normalizedText && toolCalls.length === 0) {
    if (hasTrailingToolContext(messages)) {
      return {
        text: '',
        toolCalls: [],
        usage,
        incomplete: true,
        finishReason: finishReason || '',
        content: [],
        assistantMessage: buildAssistantMessage({})
      };
    }
    throw new Error('Anthropic gateway stream returned empty assistant response');
  }

  return {
    text,
    toolCalls,
    usage,
    incomplete: false,
    finishReason: finishReason || '',
    content,
    assistantMessage: buildAssistantMessage({ text, toolCalls, content })
  };
}

export async function createChatCompletion({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  tools,
  toolChoice,
  reasoningEffort,
  onPayloadPrepared,
  timeoutMs = 1800000,
  maxTokens = 16384,
  maxRetries = 2,
  signal: externalSignal
}) {
  const payload = buildPayload({ baseUrl, model, temperature, messages, tools, maxTokens, toolChoice, reasoningEffort });
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([timeoutSignal, externalSignal])
    : timeoutSignal;
  const response = await sendMessagesRequest({ baseUrl, apiKey, payload, signal, maxRetries, onPayloadPrepared });
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
  toolChoice,
  reasoningEffort,
  onPayloadPrepared,
  onTextDelta,
  onReasoningDelta,
  onToolCallDelta,
  timeoutMs = 1800000,
  maxTokens = 16384,
  maxRetries = 2,
  signal: externalSignal,
}) {
  // 合并超时信号与外部中止信号
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const onTimeoutAbort = () => {
    controller.abort(
      new Error(`Gateway request timed out after ${timeoutMs}ms`)
    );
  };
  timeoutSignal.addEventListener('abort', onTimeoutAbort, { once: true });
  const onExternalAbort = () => {
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  try {
    const payload = buildPayload({ baseUrl, model, temperature, messages, tools, stream: true, maxTokens, toolChoice, reasoningEffort });
    const response = await sendMessagesRequest({
      baseUrl, apiKey, payload, signal: controller.signal, maxRetries, onPayloadPrepared,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`Anthropic gateway error ${response.status}: ${text || response.statusText}`);
    }

    let text = '';
    let usage = null;
    let finishReason = '';
    let messageStopped = false;
    const toolCallsByIndex = new Map();
    const blocksByIndex = new Map();

    for await (const chunk of iterateSseJsonEvents(response.body)) {
      if (chunk.done) continue;
      usage = mergeUsage(usage, chunk?.data?.usage);
      usage = mergeUsage(usage, chunk?.data?.message?.usage);

      if (chunk.event === 'message_stop' && chunk?.data?.type === 'message_stop') {
        messageStopped = true;
        break;
      }

      if (chunk.event === 'message_delta') {
        const stopReason = chunk?.data?.delta?.stop_reason || chunk?.data?.stop_reason;
        if (stopReason) finishReason = String(stopReason);
        continue;
      }

      if (chunk.event === 'content_block_start') {
        const index = Number(chunk?.data?.index ?? 0);
        const contentBlock = chunk?.data?.content_block || {};
        if (contentBlock.type === 'tool_use') {
          const current = toolCallsByIndex.get(index) || emptyToolCall(index);
          current.id = String(contentBlock.id || current.id || '');
          current.name = String(contentBlock.name || current.name || '');
          current.closed = false;
          const initialInput = contentBlock.input && Object.keys(contentBlock.input).length > 0
            ? normalizeIncomingToolCallArguments(contentBlock.input)
            : '';
          current.arguments = current.arguments || initialInput;
          toolCallsByIndex.set(index, current);
          if (onToolCallDelta) {
            onToolCallDelta({
              index,
              id: current.id || `tc-${index + 1}`,
              name: current.name,
              arguments: current.arguments || '{}'
            });
          }
        } else if (contentBlock.type === 'thinking' || contentBlock.type === 'redacted_thinking') {
          const current = cloneAnthropicContentBlock(contentBlock) || { type: contentBlock.type };
          if (current.type === 'thinking' && current.thinking == null) current.thinking = '';
          blocksByIndex.set(index, current);
        } else if (contentBlock.type === 'text') {
          const initialText = String(contentBlock.text || '');
          blocksByIndex.set(index, { type: 'text', text: initialText });
          text += initialText;
          if (initialText) onTextDelta?.(initialText);
        }
        continue;
      }

      if (chunk.event === 'content_block_stop') {
        const index = Number(chunk?.data?.index ?? 0);
        const current = toolCallsByIndex.get(index);
        if (current) {
          current.closed = true;
          toolCallsByIndex.set(index, current);
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
        const current = blocksByIndex.get(index) || { type: 'text', text: '' };
        current.text += delta.text;
        blocksByIndex.set(index, current);
        if (onTextDelta) onTextDelta(delta.text);
        continue;
      }

      if (delta.type === 'thinking_delta') {
        const current = blocksByIndex.get(index) || { type: 'thinking', thinking: '' };
        const thinkingDelta = String(delta.thinking || '');
        current.thinking = `${current.thinking || ''}${thinkingDelta}`;
        blocksByIndex.set(index, current);
        if (thinkingDelta && onReasoningDelta) onReasoningDelta(thinkingDelta);
        continue;
      }

      if (delta.type === 'signature_delta') {
        const current = blocksByIndex.get(index) || { type: 'thinking', thinking: '' };
        current.signature = String(delta.signature || '');
        blocksByIndex.set(index, current);
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

    return buildFinalStreamResult(text, toolCallsByIndex, usage, messages, blocksByIndex, finishReason, messageStopped);
  } finally {
    timeoutSignal.removeEventListener('abort', onTimeoutAbort);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}
