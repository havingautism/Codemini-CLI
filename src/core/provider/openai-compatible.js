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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeoutAbort(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);
  return { controller, timer };
}

function shouldRetry(err, statusCode) {
  if (statusCode && statusCode >= 500) return true;
  const message = String(err?.message || err || '').toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('aborted')
  );
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
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const payload = {
    model,
    temperature,
    messages
  };
  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const { controller, timer } = withTimeoutAbort(timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        const body = await response.text();
        const err = new Error(`Gateway request failed (${response.status}): ${body}`);
        if (attempt < maxRetries && shouldRetry(err, response.status)) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw err;
      }

      const data = await response.json();
      const message = data?.choices?.[0]?.message || {};
      const text = extractTextContent(message.content);
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
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < maxRetries && shouldRetry(err)) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Gateway request failed');
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
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const payload = {
    model,
    temperature,
    messages,
    stream: true
  };
  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  let response;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const { controller, timer } = withTimeoutAbort(timeoutMs);
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) {
        const body = await response.text();
        const err = new Error(`Gateway stream request failed (${response.status}): ${body}`);
        if (attempt < maxRetries && shouldRetry(err, response.status)) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw err;
      }
      break;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < maxRetries && shouldRetry(err)) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  if (!response) {
    throw lastErr || new Error('Gateway stream request failed');
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gateway stream request failed (${response.status}): ${body}`);
  }

  if (!response.body) {
    return createChatCompletion({ baseUrl, apiKey, model, messages, temperature, tools });
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let text = '';
  const toolCallsByIndex = new Map();
  let usage = null;
  let buffer = '';

  const processEvent = (eventChunk) => {
    const lines = eventChunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    if (lines.length === 0) return false;
    const dataText = lines.join('\n');
    if (dataText === '[DONE]') return true;

    let payloadObj;
    try {
      payloadObj = JSON.parse(dataText);
    } catch {
      return false;
    }

    usage = payloadObj.usage || usage;
    const choice0 = payloadObj?.choices?.[0] || {};
    const finishReason = choice0?.finish_reason;
    const delta = choice0?.delta || {};
    const content = delta.content;
    if (typeof content === 'string' && content.length > 0) {
      text += content;
      if (onTextDelta) onTextDelta(content);
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
    if (finishReason) return true;
    return false;
  };

  let finished = false;
  while (!finished) {
    let readResult;
    try {
      readResult = await Promise.race([
        reader.read(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Stream inactivity timeout after ${timeoutMs}ms`)),
            timeoutMs
          )
        )
      ]);
    } catch (err) {
      // If we already received meaningful content, return partial result instead of hanging forever.
      if (text || toolCallsByIndex.size > 0) {
        return buildFinalStreamResult(text, toolCallsByIndex, usage);
      }
      throw err;
    }

    const { value, done } = readResult;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const eventChunk of events) {
      const shouldStop = processEvent(eventChunk);
      if (shouldStop) {
        finished = true;
        try {
          await reader.cancel();
        } catch {
          // ignore cancel errors
        }
        break;
      }
    }
  }

  if (buffer.trim() && !finished) {
    processEvent(buffer);
  }

  return buildFinalStreamResult(text, toolCallsByIndex, usage);
}
