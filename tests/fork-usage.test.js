import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runForkTask } from '../src/core/chat-runtime.js';

const SSE = (chunks) => `${chunks.join('\n\n')}\n`;

function mockStreamingGateway(t, responses) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  const requests = [];
  globalThis.fetch = async (_url, init = {}) => {
    requests.push(JSON.parse(String(init.body || '{}')));
    const next = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return new Response(SSE(next), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const countCalls = () => calls;
  countCalls.requests = requests;
  return countCalls;
}

function isolateGlobalDir(t) {
  const tmp = path.join(os.tmpdir(), `codemini-fork-usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  t.after(async () => {
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });
  return tmp;
}

function baseConfig(gatewayUrl) {
  return {
    gateway: { base_url: gatewayUrl, api_key: 'test-key', timeout_ms: 5000, max_retries: 0 },
    model: { name: 'mock-model' },
    sdk: { provider: 'openai-compatible' },
    memory: { enabled: false },
    context: { project_context_enabled: false },
    runtime: { project_is_git: false },
  };
}

test('fork branch usage flows from the branch loop into onUsage', async (t) => {
  isolateGlobalDir(t);
  const countCalls = mockStreamingGateway(t, [
    [
      'data: {"choices":[{"delta":{"content":"found it"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop","usage":{"prompt_tokens":19,"completion_tokens":13,"total_tokens":32,"cached_tokens":10}}]}',
      'data: [DONE]',
    ],
  ]);

  const usageEvents = [];
  const output = await runForkTask({
    task: 'Inspect the entrypoint',
    forkPointMessages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'parent request' },
    ],
    toolDefinitions: [],
    systemPrompt: 'sys',
    config: baseConfig('https://mock.invalid/v1'),
    model: 'mock-model',
    onAgentEvent: () => {},
    onUsage: (usage) => usageEvents.push(usage),
    projectIsGit: false,
    workspaceRoot: process.cwd(),
  });

  assert.equal(countCalls(), 1, 'single text completion needs exactly one request');
  assert.equal(output.hasErrorLine, false);
  assert.ok(output.text.length > 0);
  assert.equal(usageEvents.length, 1, 'one assistant:response must yield one usage event');
  assert.equal(usageEvents[0].inputTokens, 19);
  assert.equal(usageEvents[0].outputTokens, 13);
  assert.equal(usageEvents[0].cachedInputTokens, 10);
  assert.equal(usageEvents[0].requests, 1);
  assert.equal(usageEvents[0].totalTokens, 32);
});

test('multi-step fork branch accumulates usage across every request', async (t) => {
  isolateGlobalDir(t);
  // Request 1: model calls the tasks tool. Request 2: model answers in text.
  const countCalls = mockStreamingGateway(t, [
    [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"tasks","arguments":"{}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop","usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}]}',
      'data: [DONE]',
    ],
    [
      'data: {"choices":[{"delta":{"content":"done"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop","usage":{"prompt_tokens":130,"completion_tokens":30,"total_tokens":160}}]}',
      'data: [DONE]',
    ],
  ]);

  const usageEvents = [];
  const output = await runForkTask({
    task: 'Check the module',
    forkPointMessages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'parent request' },
    ],
    toolDefinitions: [{
      type: 'function',
      function: { name: 'tasks', parameters: { type: 'object', properties: {} } },
    }],
    systemPrompt: 'sys',
    config: baseConfig('https://mock.invalid/v1'),
    model: 'mock-model',
    onAgentEvent: () => {},
    onUsage: (usage) => usageEvents.push(usage),
    projectIsGit: false,
    workspaceRoot: process.cwd(),
  });

  assert.equal(countCalls(), 2, 'tool round-trip needs two requests');
  assert.equal(usageEvents.length, 2, 'each assistant:response must yield one usage event');
  assert.equal(output.hasErrorLine, false);

  const merged = usageEvents.reduce((acc, usage) => ({
    inputTokens: acc.inputTokens + usage.inputTokens,
    outputTokens: acc.outputTokens + usage.outputTokens,
    totalTokens: acc.totalTokens + usage.totalTokens,
    requests: acc.requests + usage.requests,
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 });

  assert.deepEqual(merged, { inputTokens: 230, outputTokens: 50, totalTokens: 280, requests: 2 });
});

test('fork first request preserves the parent message prefix and frozen tool schemas exactly', async (t) => {
  isolateGlobalDir(t);
  const countCalls = mockStreamingGateway(t, [[
    'data: {"choices":[{"delta":{"content":"done"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
  ]]);
  const parentPrefix = [
    { role: 'system', content: 'stable system' },
    { role: 'user', content: 'parent request' },
    { role: 'assistant', content: 'prior observation' },
  ];
  const frozenTools = [
    {
      type: 'function',
      function: { name: 'tasks', description: 'stable tasks schema', parameters: { type: 'object', properties: {} } },
    },
    {
      type: 'function',
      function: { name: 'fork_task', description: 'stable fork schema', parameters: { type: 'object', properties: {} } },
    },
  ];

  await runForkTask({
    task: 'Inspect frontend',
    forkPointMessages: parentPrefix,
    toolDefinitions: frozenTools,
    systemPrompt: 'stable system',
    config: baseConfig('https://mock.invalid/v1'),
    model: 'mock-model',
    onAgentEvent: () => {},
    projectIsGit: false,
    workspaceRoot: process.cwd(),
  });

  assert.equal(countCalls(), 1);
  const payload = countCalls.requests[0];
  assert.deepEqual(payload.messages.slice(0, parentPrefix.length), parentPrefix);
  assert.equal(payload.messages.filter((message) => message.role === 'system').length, 1);
  assert.deepEqual(payload.tools, frozenTools);
});

test('tasks-only fork serializes the assigned checklist into the branch instruction', async (t) => {
  isolateGlobalDir(t);
  const countCalls = mockStreamingGateway(t, [[
    'data: {"choices":[{"delta":{"content":"done"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
  ]]);

  await runForkTask({
    task: '',
    tasks: [
      { content: 'Check frontend tests', status: 'pending' },
      { content: 'Report missing coverage', status: 'pending' },
    ],
    forkPointMessages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'parent request' },
    ],
    toolDefinitions: [],
    systemPrompt: 'sys',
    config: baseConfig('https://mock.invalid/v1'),
    model: 'mock-model',
    onAgentEvent: () => {},
    projectIsGit: false,
    workspaceRoot: process.cwd(),
  });

  const branchInstruction = String(countCalls.requests[0].messages.at(-1)?.content || '');
  assert.match(branchInstruction, /Assigned checklist:/);
  assert.match(branchInstruction, /1\. Check frontend tests/);
  assert.match(branchInstruction, /2\. Report missing coverage/);
});
