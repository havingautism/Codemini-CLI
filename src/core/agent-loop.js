function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function clipToolResult(result, maxChars = 12000) {
  const raw = typeof result === 'string' ? result : JSON.stringify(result);
  if (!maxChars || raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n... [tool result truncated ${raw.length - maxChars} chars]`;
}

function summarizeToolResult(result) {
  if (result === null || result === undefined) return 'no output';
  if (typeof result === 'string') {
    const oneLine = result.replace(/\s+/g, ' ').trim();
    return oneLine.length > 90 ? `${oneLine.slice(0, 87)}...` : oneLine || 'empty string';
  }
  if (typeof result === 'object') {
    const obj = result;
    if (Array.isArray(obj)) return `array(${obj.length})`;
    if ('path' in obj && 'action' in obj) {
      const p = String(obj.path || '');
      const action = String(obj.action || 'write');
      const line = Number(obj.changed_line || 1);
      const preview = String(obj.diff_preview || '')
        .split('\n')
        .slice(0, 3)
        .join('\n');
      return `${action} ${p} @L${line}${preview ? `\n${preview}` : ''}`;
    }
    if ('path' in obj && 'phase' in obj) {
      const phase = String(obj.phase || '');
      const p = String(obj.path || '');
      const total = Number(obj.total_lines);
      const start =
        Number(obj.suggested_start_line || obj.start_line) > 0
          ? Number(obj.suggested_start_line || obj.start_line)
          : 1;
      const end =
        Number(obj.suggested_end_line || obj.end_line) >= start
          ? Number(obj.suggested_end_line || obj.end_line)
          : start;
      const rangeText = start > 0 && end >= start ? ` lines ${start}-${end}` : '';
      const totalText = total > 0 ? ` of ${total}` : '';
      const errorText = obj.error ? ` (${trimInline(obj.error, 64)})` : '';
      const truncatedText = obj.truncated ? ' [truncated]' : '';
      return phase === 'metadata'
        ? `metadata for ${p}${rangeText}${totalText}${errorText}`
        : `content from ${p}${rangeText}${totalText}${truncatedText}`;
    }
    if ('stdout' in obj || 'stderr' in obj || 'code' in obj) {
      const stdout = trimInline(obj.stdout || '', 96);
      const stderr = trimInline(obj.stderr || '', 96);
      const command = trimInline(obj.command || '', 72);
      const lead = command ? `${command} -> ` : '';
      if (stdout) return `${lead}exit ${obj.code ?? 0}\nstdout: ${stdout}`;
      if (stderr) return `${lead}exit ${obj.code ?? 0}\nstderr: ${stderr}`;
      return `${lead}exit ${obj.code ?? 0}`;
    }
    if ('created' in obj && Array.isArray(obj.created)) {
      return `created ${obj.created.length} task(s)`;
    }
    if ('tasks' in obj && Array.isArray(obj.tasks)) {
      return `${obj.tasks.length} task(s)`;
    }
    const keys = Object.keys(obj);
    return keys.length > 0 ? `keys: ${keys.slice(0, 5).join(',')}` : 'object';
  }
  return String(result);
}

function trimInline(value, maxLen = 72) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 3)}...`;
}

function formatToolDisplayName(name, args) {
  if (name === 'read_file' || name === 'write_file') {
    const target = trimInline(args?.path || '.', 96) || '.';
    if (name === 'read_file') {
      const start = Number(args?.start_line);
      const end = Number(args?.end_line);
      const hasRange = Number.isFinite(start) && start > 0;
      const suffix = hasRange ? `:${start}-${Number.isFinite(end) && end >= start ? end : start}` : '';
      return `${name}(${target}${suffix})`;
    }
    return `${name}(${target})`;
  }
  if (name === 'run_command') {
    const command = trimInline(args?.command || '', 96);
    return command ? `${name}(${command})` : name;
  }
  if (
    name === 'locate' ||
    name === 'open_target' ||
    name === 'edit_target' ||
    name === 'search_code' ||
    name === 'read_block' ||
    name === 'read_symbol_context' ||
    name === 'validate_edit' ||
    name === 'replace_block' ||
    name === 'replace_text' ||
    name === 'insert_before' ||
    name === 'insert_after' ||
    name === 'generate_diff'
  ) {
    const target = trimInline(args?.path || args?.query || args?.symbol || '', 96);
    return target ? `${name}(${target})` : name;
  }
  return name;
}

export async function runAgentLoop({
  systemPrompt,
  userPrompt,
  model,
  requestCompletion,
  toolHandlers = {},
  toolDefinitions = [],
  maxSteps = 8,
  initialMessages = [],
  onEvent,
  executionMode = 'auto',
  alwaysAllowTools = [],
  requestToolApproval,
  toolResultMaxChars = 12000
}) {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  if (Array.isArray(initialMessages) && initialMessages.length > 0) {
    messages.push(...initialMessages);
  }
  if (userPrompt) {
    messages.push({ role: 'user', content: userPrompt });
  }

  let finalText = '';
  let lastAssistantText = '';
  const alwaysAllowSet = new Set((Array.isArray(alwaysAllowTools) ? alwaysAllowTools : []).map((t) => String(t)));

  for (let step = 0; step < maxSteps; step += 1) {
    if (onEvent) onEvent({ type: 'step:start', step: step + 1 });
    const completion = await requestCompletion({
      model,
      messages,
      tools: toolDefinitions
    });

    const toolCalls = Array.isArray(completion.toolCalls) ? completion.toolCalls : [];
    const assistantText = completion.text || '';
    lastAssistantText = assistantText || lastAssistantText;

    const assistantMessage = { role: 'assistant', content: assistantText };
    if (toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments || '{}' }
      }));
    }
    messages.push(assistantMessage);
    if (onEvent) {
      onEvent({
        type: 'assistant:response',
        step: step + 1,
        text: assistantText,
        toolCalls: toolCalls.map((tc) => tc.name),
        assistantMessage
      });
    }

    if (toolCalls.length === 0) {
      finalText = assistantText;
      return { text: finalText, messages, steps: step + 1 };
    }

    if (executionMode === 'plan') {
      finalText = `${assistantText || ''}\n\n[plan mode] ${toolCalls.length} tool call(s) were planned but not executed.`;
      return { text: finalText.trim(), messages, steps: step + 1 };
    }

    for (const call of toolCalls) {
      const args = safeJsonParse(call.arguments);
      const displayName = formatToolDisplayName(call.name, args);
      const startedAt = Date.now();
      let approved = true;
      if (executionMode === 'normal' && !alwaysAllowSet.has(call.name)) {
        approved = false;
        if (typeof requestToolApproval === 'function') {
          const decision = await requestToolApproval({
            id: call.id,
            name: call.name,
            displayName,
            arguments: args
          });
          approved = Boolean(decision?.approved);
        }
      }

      if (!approved) {
        if (onEvent) onEvent({ type: 'tool:blocked', name: displayName, id: call.id });
        const blockedMessage = {
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ blocked: true, reason: 'Tool call requires approval in normal mode' })
        };
        messages.push(blockedMessage);
        if (onEvent) {
          onEvent({
            type: 'tool:result',
            name: displayName,
            id: call.id,
            content: blockedMessage.content,
            blocked: true
          });
        }
        continue;
      }

      if (onEvent) onEvent({ type: 'tool:start', name: displayName, id: call.id });
      const handler = toolHandlers[call.name];
      if (!handler) {
        throw new Error(`Unknown tool: ${call.name}`);
      }
      let toolResult;
      try {
        toolResult = await handler(args);
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        if (onEvent) {
          onEvent({
            type: 'tool:error',
            name: displayName,
            id: call.id,
            durationMs,
            summary: trimInline(message, 120)
          });
        }
        const toolMessage = {
          role: 'tool',
          tool_call_id: call.id,
          content: clipToolResult({ error: message }, toolResultMaxChars)
        };
        messages.push(toolMessage);
        if (onEvent) {
          onEvent({
            type: 'tool:result',
            name: displayName,
            id: call.id,
            content: toolMessage.content,
            error: true
          });
        }
        continue;
      }
      const durationMs = Date.now() - startedAt;
      if (onEvent) {
        onEvent({
          type: 'tool:end',
          name: displayName,
          id: call.id,
          durationMs,
          summary: summarizeToolResult(toolResult)
        });
      }
      const toolMessage = {
        role: 'tool',
        tool_call_id: call.id,
        content: clipToolResult(toolResult, toolResultMaxChars)
      };
      messages.push(toolMessage);
      if (onEvent) {
        onEvent({
          type: 'tool:result',
          name: displayName,
          id: call.id,
          content: toolMessage.content
        });
      }
    }
  }

  const fallback = lastAssistantText || 'Stopped before final response.';
  return {
    text: `${fallback}\n\n[stopped] Reached max tool steps (${maxSteps}). Try a narrower prompt or increase execution.max_steps.`,
    messages,
    steps: maxSteps
  };
}
