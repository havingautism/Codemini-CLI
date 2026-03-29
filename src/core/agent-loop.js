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
      const suffix =
        action === 'delete'
          ? 'deleted'
          : action === 'create'
            ? 'created'
            : action === 'patch'
              ? 'patched'
              : action === 'replace_block' || action === 'replace_text'
                ? 'edited'
                : action === 'append'
                  ? 'appended'
                  : 'updated';
      return p ? `${suffix} ${p}${line > 0 ? ` @L${line}` : ''}` : suffix;
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
    if ('task_id' in obj && 'startup_confirmed' in obj) {
      const status = trimInline(obj.status || 'unknown', 32);
      const taskId = trimInline(obj.task_id || '', 24);
      const source = trimInline(obj.startup_source || '', 24);
      const logs = Array.isArray(obj.recent_logs) ? trimInline(obj.recent_logs.slice(-1)[0] || '', 96) : '';
      return `${taskId || 'service'} ${status}${source ? ` (${source})` : ''}${logs ? `\n${logs}` : ''}`;
    }
    if ('services' in obj && Array.isArray(obj.services)) {
      const count = obj.services.length;
      const first = obj.services[0];
      const lead = first?.task_id ? `${trimInline(first.task_id, 24)} ${trimInline(first.status || 'unknown', 24)}` : '';
      return `services(${count})${lead ? `\n${lead}` : ''}`;
    }
    if ('task_id' in obj && 'recent_logs' in obj) {
      const taskId = trimInline(obj.task_id || '', 24);
      const logs = Array.isArray(obj.recent_logs) ? trimInline(obj.recent_logs.slice(-1)[0] || '', 96) : '';
      return `${taskId || 'service logs'}${logs ? `\n${logs}` : ''}`;
    }
    if ('files' in obj && Array.isArray(obj.files)) {
      return `patched ${obj.files.length} file(s)`;
    }
    if ('diff' in obj && 'new_hash' in obj && 'path' in obj) {
      const p = String(obj.path || '');
      return p ? `diff preview for ${p}` : 'diff preview';
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

function normalizeToolCallName(name) {
  return String(name || '').trim();
}

function formatToolDisplayName(name, args) {
  if (name === 'grep') {
    const query = trimInline(args?.pattern || args?.query || args?.symbol || '', 96);
    return query ? `grep("${query}")` : 'grep';
  }
  if (name === 'glob') {
    const pattern = trimInline(args?.pattern || '', 96);
    return pattern ? `glob("${pattern}")` : 'glob';
  }
  if (name === 'list') {
    const target = trimInline(args?.path || '.', 96) || '.';
    return `list(${target})`;
  }
  if (name === 'read' || name === 'write') {
    const target = trimInline(args?.path || '.', 96) || '.';
    if (name === 'read') {
      const start = Number(args?.start_line);
      const end = Number(args?.end_line);
      const hasRange = Number.isFinite(start) && start > 0;
      const suffix = hasRange ? `:${start}-${Number.isFinite(end) && end >= start ? end : start}` : '';
      return `read(${target}${suffix})`;
    }
    return `write(${target})`;
  }
  if (name === 'run') {
    const command = trimInline(args?.command || '', 96);
    return command ? `run(${command})` : name;
  }
  if (name === 'edit') {
    const target = trimInline(args?.path || args?.file || '.', 96) || '.';
    return `edit(${target})`;
  }
  if (name === 'patch') {
    const target = trimInline(args?.path || args?.file || args?.patch || '', 96) || '.';
    return `patch(${target})`;
  }
  if (name === 'start_service') {
    const command = trimInline(args?.command || args?.cmd || '', 96);
    return command ? `${name}(${command})` : name;
  }
  if (name === 'list_services') {
    return name;
  }
  if (name === 'get_service_status' || name === 'get_service_logs' || name === 'stop_service') {
    const taskId = trimInline(args?.task_id || args?.taskId || '', 96);
    return taskId ? `${name}(${taskId})` : name;
  }
  if (name === 'read' || name === 'write' || name === 'run' || name === 'grep' || name === 'glob' || name === 'list' || name === 'edit' || name === 'patch' || name === 'generate_diff') {
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
      const toolName = normalizeToolCallName(call.name);
      const displayName = formatToolDisplayName(toolName, args);
      const startedAt = Date.now();
      let approved = true;
      if (executionMode === 'normal' && !alwaysAllowSet.has(toolName)) {
        approved = false;
        if (typeof requestToolApproval === 'function') {
          const decision = await requestToolApproval({
            id: call.id,
            name: toolName,
            displayName,
            arguments: args
          });
          approved = Boolean(decision?.approved);
        }
      }

      if (!approved) {
        if (onEvent) onEvent({ type: 'tool:blocked', name: displayName, id: call.id, arguments: args });
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
            arguments: args,
            content: blockedMessage.content,
            blocked: true
          });
        }
        continue;
      }

      if (onEvent) onEvent({ type: 'tool:start', name: displayName, id: call.id, arguments: args });
      const handler = toolHandlers[toolName];
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
            arguments: args,
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
            arguments: args,
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
          arguments: args,
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
          arguments: args,
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
