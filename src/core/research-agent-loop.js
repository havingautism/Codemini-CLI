/**
 * Slim agent loop for Deep Research only.
 *
 * Intentionally does NOT reuse chat runAgentLoop post-processing:
 * no tool-result disk persistence / 2KB preview, no aggressive prune,
 * no skill hooks, no approval graph, no analysis nudge.
 *
 * Chat / CodeWiki keep using runAgentLoop unchanged.
 */

const DEFAULT_TOOL_RESULT_MAX_CHARS = 12000;
const DEFAULT_MAX_STEPS = 48;

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw || '{}'));
  } catch (error) {
    return {
      _invalid_json: true,
      _raw: String(raw || ''),
      _parseError: error?.message || 'Invalid JSON',
    };
  }
}

function formatResearchToolResult(toolResult, toolName, args, toolFormatters, maxChars) {
  let text = '';
  if (toolFormatters && typeof toolFormatters[toolName] === 'function' && toolResult && typeof toolResult === 'object') {
    const formatted = toolFormatters[toolName](toolResult, args);
    if (typeof formatted === 'string' && formatted.trim()) text = formatted;
  }
  if (!text) {
    if (toolResult == null) text = 'no output';
    else if (typeof toolResult === 'string') text = toolResult;
    else {
      try {
        // Prefer putting body text early so soft truncation keeps readable content.
        if (toolResult && typeof toolResult === 'object' && typeof toolResult.text === 'string') {
          const { text: body, ...rest } = toolResult;
          text = JSON.stringify({ text: body, ...rest });
        } else {
          text = JSON.stringify(toolResult);
        }
      } catch {
        text = String(toolResult);
      }
    }
  }
  const limit = Math.max(1000, Number(maxChars) || DEFAULT_TOOL_RESULT_MAX_CHARS);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n... [research tool result truncated ${text.length - limit} chars]`;
}

function displayNameFor(toolName, toolDisplayLabels = {}) {
  return toolDisplayLabels[toolName] || toolName;
}

/**
 * @returns {Promise<{ text: string, messages: object[], steps: number, checkpoint?: boolean }>}
 */
export async function runResearchAgentLoop({
  systemPrompt,
  userPrompt,
  model,
  requestCompletion,
  toolHandlers = {},
  toolDefinitions = [],
  initialMessages = [],
  onEvent = null,
  toolFormatters = {},
  toolDisplayLabels = {},
  toolResultMaxChars = DEFAULT_TOOL_RESULT_MAX_CHARS,
  signal = null,
  shouldCheckpoint = null,
  maxSteps = DEFAULT_MAX_STEPS,
} = {}) {
  if (typeof requestCompletion !== 'function') {
    throw new Error('runResearchAgentLoop requires requestCompletion');
  }

  const messages = [
    { role: 'system', content: String(systemPrompt || '') },
    ...(Array.isArray(initialMessages) ? initialMessages : []),
  ];
  if (userPrompt != null && String(userPrompt).trim()) {
    messages.push({ role: 'user', content: String(userPrompt) });
  }

  const activeTools = Array.isArray(toolDefinitions) ? toolDefinitions : [];
  let lastAssistantText = '';
  let step = 0;
  let stepStartedAt = 0;
  let stepOpen = false;
  const emitStepEnd = (reason) => {
    if (!stepOpen) return;
    stepOpen = false;
    onEvent?.({
      type: 'step:end',
      step,
      reason,
      durationMs: Math.max(0, Date.now() - stepStartedAt),
      endedAt: new Date().toISOString(),
    });
  };
  const stepCap = Math.max(1, Math.floor(Number(maxSteps) || DEFAULT_MAX_STEPS));

  while (step < stepCap) {
    step += 1;
    if (signal?.aborted) {
      onEvent?.({ type: 'aborted', step });
      break;
    }
    stepStartedAt = Date.now();
    stepOpen = true;
    onEvent?.({ type: 'step:start', step, startedAt: new Date(stepStartedAt).toISOString() });

    const completion = await requestCompletion({
      model,
      messages,
      tools: activeTools,
      signal,
    });

    if (signal?.aborted) {
      emitStepEnd('abort');
      onEvent?.({ type: 'aborted', step });
      break;
    }
    if (completion?.incomplete) {
      emitStepEnd('incomplete');
      continue;
    }

    const toolCalls = Array.isArray(completion?.toolCalls) ? completion.toolCalls : [];
    const assistantText = completion?.text || '';
    lastAssistantText = assistantText || lastAssistantText;

    const assistantMessage = completion?.assistantMessage
      ? {
        ...completion.assistantMessage,
        role: 'assistant',
        content: completion.assistantMessage.content ?? completion?.content ?? assistantText,
      }
      : { role: 'assistant', content: completion?.content ?? assistantText };

    if (!Array.isArray(assistantMessage.tool_calls) && toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments || '{}' },
      }));
    }
    messages.push(assistantMessage);
    onEvent?.({
      type: 'assistant:response',
      step,
      text: assistantText,
      toolCalls: toolCalls.map((tc) => tc.name),
      usage: completion?.usage || null,
      assistantMessage,
    });

    if (!toolCalls.length) {
      emitStepEnd('final');
      return { text: assistantText, messages, steps: step };
    }

    for (const call of toolCalls) {
      const toolName = String(call?.name || '').trim();
      const displayName = displayNameFor(toolName, toolDisplayLabels);
      const args = safeJsonParse(call?.arguments);
      const startedAt = Date.now();

      onEvent?.({
        type: 'tool:start',
        name: toolName,
        displayName,
        id: call.id,
        arguments: args,
      });

      if (args?._invalid_json) {
        const content = `error: invalid tool arguments (${args._parseError || 'JSON parse failed'})`;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content,
          tool_status: 'error',
        });
        onEvent?.({
          type: 'tool:error',
          name: toolName,
          displayName,
          id: call.id,
          arguments: args,
          durationMs: Date.now() - startedAt,
          summary: content,
        });
        onEvent?.({
          type: 'tool:result',
          name: toolName,
          displayName,
          id: call.id,
          arguments: args,
          content,
          error: true,
        });
        continue;
      }

      const handler = toolHandlers[toolName];
      if (typeof handler !== 'function') {
        const content = `error: unknown tool ${toolName}`;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content,
          tool_status: 'error',
        });
        onEvent?.({
          type: 'tool:error',
          name: toolName,
          displayName,
          id: call.id,
          arguments: args,
          durationMs: Date.now() - startedAt,
          summary: content,
        });
        onEvent?.({
          type: 'tool:result',
          name: toolName,
          displayName,
          id: call.id,
          arguments: args,
          content,
          error: true,
        });
        continue;
      }

      try {
        const toolResult = await handler(args, { signal, messages, model });
        const durationMs = Date.now() - startedAt;
        const content = formatResearchToolResult(
          toolResult,
          toolName,
          args,
          toolFormatters,
          toolResultMaxChars,
        );
        const summary = typeof toolResult === 'string'
          ? toolResult.slice(0, 120)
          : (toolResult?.message || toolResult?.title || toolName);

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content,
          tool_duration_ms: durationMs,
          tool_summary: String(summary || '').slice(0, 200),
          tool_status: 'done',
        });
        onEvent?.({
          type: 'tool:end',
          name: toolName,
          displayName,
          id: call.id,
          arguments: args,
          durationMs,
          summary: String(summary || '').slice(0, 200),
        });
        onEvent?.({
          type: 'tool:result',
          name: toolName,
          displayName,
          id: call.id,
          arguments: args,
          content,
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        const content = `error: ${message}`;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content,
          tool_duration_ms: durationMs,
          tool_summary: message.slice(0, 200),
          tool_status: 'error',
        });
        onEvent?.({
          type: 'tool:error',
          name: toolName,
          displayName,
          id: call.id,
          arguments: args,
          durationMs,
          summary: message.slice(0, 200),
        });
        onEvent?.({
          type: 'tool:result',
          name: toolName,
          displayName,
          id: call.id,
          arguments: args,
          content,
          error: true,
        });
      }
    }

    if (typeof shouldCheckpoint === 'function') {
      const checkpoint = await shouldCheckpoint({
        step,
        messages,
        toolCalls,
      });
      if (checkpoint) {
        onEvent?.({ type: 'checkpoint', step });
        emitStepEnd('checkpoint');
        return {
          text: lastAssistantText || '',
          messages,
          steps: step,
          checkpoint: true,
        };
      }
    }
    emitStepEnd('tools');
  }

  emitStepEnd('abort');
  if (signal?.aborted) {
    return {
      text: lastAssistantText || '',
      messages,
      steps: step,
      aborted: true,
    };
  }

  return {
    text: lastAssistantText || '',
    messages,
    steps: step,
  };
}

export {
  formatResearchToolResult,
};
