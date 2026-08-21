import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinTools } from '../src/core/tools.js';
import {
  FORK_FORBIDDEN_TOOLS,
  SUBAGENT_FORBIDDEN_TOOLS,
  compactForkResultForParent,
  collectPlanImplementationFileChanges,
} from '../src/core/chat-runtime.js';
import { createToolRegistry } from '../src/core/tool-registry.js';

test('coding tools expose fork_task when onForkTask is provided (and not run_subagent)', () => {
  const { definitions, handlers } = getBuiltinTools({
    onForkTask: async () => ({ ok: true, text: 'done' }),
  });
  const names = definitions.map((item) => item.function?.name || item.name);
  assert.equal(names.includes('fork_task'), true);
  assert.equal(names.includes('run_subagent'), false);
  assert.equal(typeof handlers.fork_task, 'function');
});

test('fork_task stays hidden when no onForkTask handler is wired', () => {
  const { definitions } = getBuiltinTools({});
  const names = definitions.map((item) => item.function?.name || item.name);
  assert.equal(names.includes('fork_task'), false);
});

test('fork_task requires a prompt or tasks', async () => {
  const { handlers } = getBuiltinTools({
    onForkTask: async () => ({ ok: true, text: 'done' }),
  });
  const empty = await handlers.fork_task({});
  assert.equal(empty.ok, false);
  assert.match(empty.error, /prompt or tasks/i);
});

test('fork_task schema exposes prompt/tasks/summary/name and explains fork-vs-subagent', () => {
  const { definitions } = getBuiltinTools({
    onForkTask: async () => ({ ok: true, text: 'done' }),
  });
  const def = definitions.find((item) => item.function?.name === 'fork_task');
  const props = def?.function?.parameters?.properties || {};
  assert.equal(Boolean(props.prompt), true);
  assert.equal(Boolean(props.tasks), true);
  assert.equal(Boolean(props.summary), true);
  assert.equal(Boolean(props.name), true);
  assert.match(String(def?.function?.description || ''), /run_subagent/);
  assert.match(String(def?.function?.description || ''), /prefix/);
});

test('fork_task forwards prompt/tasks/summary/name and the fork point to the handler', async () => {
  let seen = null;
  const { handlers } = getBuiltinTools({
    onForkTask: async (args) => {
      seen = args;
      return { ok: true, text: 'done' };
    },
  });
  const forkPoint = {
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    toolDefinitions: [],
    parentNote: 'checking in parallel',
  };
  await handlers.fork_task(
    {
      prompt: 'Inspect the frontend entrypoint',
      summary: 'Frontend audit.',
      name: 'frontend',
      tasks: [{ content: 'Find the entrypoint', status: 'pending' }],
    },
    { toolCallId: 'fork-1', orchestrationId: 'turn-1', forkPoint }
  );
  assert.equal(seen.prompt, 'Inspect the frontend entrypoint');
  assert.equal(seen.summary, 'Frontend audit.');
  assert.equal(seen.name, 'frontend');
  assert.equal(seen.toolCallId, 'fork-1');
  assert.equal(seen.orchestrationId, 'turn-1');
  assert.equal(seen.forkPoint, forkPoint);
  assert.deepEqual(seen.tasks, [
    { content: 'Find the entrypoint', status: 'pending', activeForm: '' },
  ]);
});

test('fork_task preserves tasks-only calls without replacing the missing prompt', async () => {
  let seen = null;
  const { handlers } = getBuiltinTools({
    onForkTask: async (args) => {
      seen = args;
      return { ok: true, text: 'done' };
    },
  });
  await handlers.fork_task({ tasks: [{ content: 'Check tests', status: 'pending' }] });
  assert.equal(seen.prompt, '');
  assert.equal(seen.tasks[0].content, 'Check tests');
});

test('fork_task is concurrency-safe so same-response branches run in parallel', () => {
  const registry = createToolRegistry({
    definitions: [
      {
        type: 'function',
        function: {
          name: 'fork_task',
          parameters: { type: 'object', properties: { prompt: { type: 'string' } } },
        },
      },
    ],
    handlers: { fork_task: async () => ({ ok: true }) },
  });
  assert.equal(registry.isConcurrencySafe('fork_task', { prompt: 'a' }), true);
});

test('parallel fork_task handlers actually overlap in wall time and receive the fork point', async () => {
  const { runAgentLoop } = await import('../src/core/agent-loop.js');
  const active = new Set();
  let maxConcurrent = 0;
  let n = 0;
  let seenForkPoint = null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  await runAgentLoop({
    systemPrompt: 'sys',
    userPrompt: 'parallel',
    model: 'test',
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: { memory: { enabled: false } },
    requestCompletion: async () => {
      n += 1;
      if (n === 1) {
        return {
          text: 'splitting now',
          toolCalls: [
            { id: 'a', name: 'fork_task', arguments: JSON.stringify({ prompt: 'A', name: 'A' }) },
            { id: 'b', name: 'fork_task', arguments: JSON.stringify({ prompt: 'B', name: 'B' }) },
          ],
        };
      }
      return { text: 'done', toolCalls: [] };
    },
    toolHandlers: {
      fork_task: async (args, ctx) => {
        seenForkPoint = ctx?.forkPoint || null;
        const id = String(args?.name || args?.prompt || '');
        active.add(id);
        maxConcurrent = Math.max(maxConcurrent, active.size);
        await sleep(40);
        active.delete(id);
        return { ok: true, text: id };
      },
    },
  });

  assert.equal(maxConcurrent, 2);
  assert.ok(seenForkPoint, 'fork point must be captured at dispatch');
  assert.deepEqual(
    seenForkPoint.messages.map((m) => ({ role: m.role, content: m.content })),
    [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'parallel' },
    ],
  );
  // The fork prefix must exclude the assistant message carrying the fork calls.
  assert.equal(
    seenForkPoint.messages.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls)),
    false,
  );
  assert.equal(seenForkPoint.parentNote, 'splitting now');
});

test('fork branches forbid spawn/interactive/plan tools at execution time', () => {
  for (const name of ['fork_task', 'run_subagent', 'request_user_input', 'update_plan']) {
    assert.ok(FORK_FORBIDDEN_TOOLS.includes(name), `${name} must be fork-forbidden`);
  }
  assert.ok(SUBAGENT_FORBIDDEN_TOOLS.includes('fork_task'), 'subagents must not fork');
});

test('fork execution policy blocks a visible forbidden tool without invoking its handler', async () => {
  const { runAgentLoop } = await import('../src/core/agent-loop.js');
  let requests = 0;
  let handlerCalls = 0;
  let blockedContent = '';
  await runAgentLoop({
    systemPrompt: 'sys',
    userPrompt: 'branch task',
    model: 'test',
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    forbiddenTools: ['fork_task'],
    config: { memory: { enabled: false } },
    toolDefinitions: [{
      type: 'function',
      function: { name: 'fork_task', parameters: { type: 'object', properties: {} } },
    }],
    toolHandlers: {
      fork_task: async () => {
        handlerCalls += 1;
        return { ok: true };
      },
    },
    requestCompletion: async () => {
      requests += 1;
      return requests === 1
        ? { text: '', toolCalls: [{ id: 'nested', name: 'fork_task', arguments: '{}' }] }
        : { text: 'stopped', toolCalls: [] };
    },
    onEvent: (event) => {
      if (event?.type === 'tool:result') blockedContent = String(event.content || '');
    },
  });

  assert.equal(handlerCalls, 0);
  assert.match(blockedContent, /FORK_TOOL_FORBIDDEN/);
});

test('parent-facing fork results stay compact and list changed files', () => {
  const longText = `${'finding\n'.repeat(600)}entrypoint loads config twice`;
  const compact = compactForkResultForParent({
    name: 'frontend',
    text: longText,
    summary: 'Entrypoint double-loads config',
    status: 'done',
    fileChanges: [
      { path: 'src/frontend/main.ts', action: 'edit' },
      { path: 'src/frontend/main.ts', action: 'edit' },
      { path: 'src/shared/config.ts', action: 'edit' },
    ],
  });
  assert.match(compact, /Fork branch "frontend" finished with status done/);
  assert.match(compact, /Entrypoint double-loads config/);
  assert.match(compact, /\[truncated\]/);
  assert.ok(compact.length < 4500);
  assert.equal(compact.includes(longText), false);
  // Duplicate paths collapse into one line.
  assert.match(compact, /src\/frontend\/main\.ts[\s\S]*src\/shared\/config\.ts/);
  assert.equal((compact.match(/src\/frontend\/main\.ts/g) || []).length, 1);
});

test('collectPlanImplementationFileChanges picks up fork-role branch changes', () => {
  const changes = collectPlanImplementationFileChanges([
    {
      role: 'fork',
      messages: [
        {
          role: 'assistant',
          tool_calls: [{ id: 't1', function: { name: 'edit' } }],
          tool_file_changes: [
            { path: 'src/a.ts', action: 'edit', linesAdded: 2, linesRemoved: 0 },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 't1',
          content: 'ok',
          tool_file_change: { path: 'src/b.ts', action: 'edit', linesAdded: 1, linesRemoved: 1 },
        },
      ],
    },
  ]);
  const paths = changes.map((change) => change.path).sort();
  assert.deepEqual(paths, ['src/a.ts', 'src/b.ts']);
});

test('fork_task formatter returns the clean TaskResult message, not the raw usage-bearing result', () => {
  const { formatters } = getBuiltinTools({
    onForkTask: async () => ({ ok: true }),
  });
  const formatted = formatters.fork_task({
    ok: true,
    name: 'frontend',
    text: 'branch conclusion',
    usage: { inputTokens: 999, outputTokens: 999 },
    fileChanges: [{ path: 'src/x.ts', action: 'edit' }],
    message: 'Fork branch "frontend" finished with status done.\nSummary: found the bug.',
  });
  assert.equal(formatted, 'Fork branch "frontend" finished with status done.\nSummary: found the bug.');
  assert.equal(formatted.includes('usage'), false);
  assert.equal(formatted.includes('999'), false);
});

test('main loop tool:result content for fork_task is the formatter output, never the raw usage JSON', async () => {
  const { runAgentLoop } = await import('../src/core/agent-loop.js');
  let n = 0;
  let capturedContent = '';
  await runAgentLoop({
    systemPrompt: 'sys',
    userPrompt: 'parallel',
    model: 'test',
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: { memory: { enabled: false } },
    requestCompletion: async () => {
      n += 1;
      if (n === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'a', name: 'fork_task', arguments: JSON.stringify({ prompt: 'A' }) }],
        };
      }
      return { text: 'done', toolCalls: [] };
    },
    toolHandlers: {
      fork_task: async () => ({
        ok: true,
        name: 'frontend',
        text: 'branch conclusion',
        usage: { inputTokens: 999, outputTokens: 999 },
        fileChanges: [{ path: 'src/x.ts', action: 'edit' }],
        message: 'Fork branch "frontend" finished with status done.',
      }),
    },
    toolFormatters: {
      fork_task: (result) => (result && typeof result === 'object' && result.message
        ? String(result.message)
        : String(result?.text || '')),
    },
    onEvent: (evt) => {
      if (evt?.type === 'tool:result') capturedContent = String(evt.content || '');
    },
  });

  assert.equal(capturedContent, 'Fork branch "frontend" finished with status done.');
  assert.equal(capturedContent.includes('usage'), false);
  assert.equal(capturedContent.includes('999'), false);
});
