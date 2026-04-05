import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { loadConfig } from '../src/core/config-store.js';
import { listMemories, rememberMemory } from '../src/core/memory-store.js';
import { saveSession } from '../src/core/session-store.js';

async function withTempConfigDir(run) {
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-global-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.CODEMINI_GLOBAL_DIR;
    } else {
      process.env.CODEMINI_GLOBAL_DIR = prev;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function withMockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return async () => {
    globalThis.fetch = originalFetch;
  };
}

function makeJsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function makeSseResponse(events) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

test('chat runtime reflects config and mode changes immediately for TUI refresh', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const config = await loadConfig();
    const now = new Date().toISOString();
    const runtime = await createChatRuntime({
      session: {
        id: 'session-config-refresh',
        createdAt: now,
        updatedAt: now,
        messages: []
      },
      config,
      systemPrompt: 'You are a test assistant.'
    });

    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'auto',
      sdkProvider: 'openai-compatible',
      model: 'gpt-4.1-mini',
      maxContextTokens: 202752
    });

    await runtime.submit('/config set model.name minimax');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'auto',
      sdkProvider: 'openai-compatible',
      model: 'minimax',
      maxContextTokens: 202752
    });

    await runtime.submit('/config set model.max_context_tokens 12345');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'auto',
      sdkProvider: 'openai-compatible',
      model: 'minimax',
      maxContextTokens: 12345
    });

    await runtime.submit('/config set sdk.provider anthropic');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'auto',
      sdkProvider: 'anthropic',
      model: 'minimax',
      maxContextTokens: 12345
    });

    await runtime.submit('/mode plan');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'plan',
      sdkProvider: 'anthropic',
      model: 'minimax',
      maxContextTokens: 12345
    });
  });
});

test('chat runtime prioritizes important config completions near the top', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const config = await loadConfig();
    const now = new Date().toISOString();
    const runtime = await createChatRuntime({
      session: {
        id: 'session-config-completions',
        createdAt: now,
        updatedAt: now,
        messages: []
      },
      config,
      systemPrompt: 'You are a test assistant.'
    });

    const setSuggestions = runtime.getCompletionOptions('/config set ');
    assert.deepEqual(setSuggestions.slice(0, 6).map((item) => item.value), [
      '/config set gateway.base_url ',
      '/config set gateway.api_key ',
      '/config set model.name ',
      '/config set ui.language ',
      '/config set ui.reply_language ',
      '/config set execution.mode '
    ]);
    assert.equal(setSuggestions[0].description, '设置网关基础 URL');
    assert.equal(
      setSuggestions.find((item) => item.value === '/config set sdk.provider ')?.description,
      '设置SDK provider（可选：openai-compatible | anthropic）'
    );
    assert.ok(setSuggestions.some((item) => item.value === '/config set soul.preset '));
    assert.ok(setSuggestions.some((item) => item.value === '/config set soul.custom_path '));

    const setNoSpaceSuggestions = runtime.getCompletionOptions('/config set');
    assert.ok(setNoSpaceSuggestions.some((item) => item.value === '/config set soul.preset '));
    assert.ok(setNoSpaceSuggestions.some((item) => item.value === '/config set soul.custom_path '));

    const getSuggestions = runtime.getCompletionOptions('/config get ');
    assert.deepEqual(getSuggestions.slice(0, 6).map((item) => item.value), [
      '/config get gateway.base_url',
      '/config get gateway.api_key',
      '/config get model.name',
      '/config get ui.language',
      '/config get ui.reply_language',
      '/config get execution.mode'
    ]);
    assert.equal(getSuggestions[0].description, '查看网关基础 URL');
    assert.ok(getSuggestions.some((item) => item.value === '/config get soul.preset'));
    assert.ok(getSuggestions.some((item) => item.value === '/config get soul.custom_path'));

    const getNoSpaceSuggestions = runtime.getCompletionOptions('/config get');
    assert.ok(getNoSpaceSuggestions.some((item) => item.value === '/config get soul.preset'));
    assert.ok(getNoSpaceSuggestions.some((item) => item.value === '/config get soul.custom_path'));

    assert.ok(runtime.getCompletionOptions('/mode').some((item) => item.value === '/mode auto'));
    assert.ok(runtime.getCompletionOptions('/plan').some((item) => item.value === '/plan auto'));
    assert.ok(runtime.getCompletionOptions('/plan').some((item) => item.value === '/plan approve'));
    assert.ok(!runtime.getCompletionOptions('/plan').some((item) => item.value === '/plan stay'));
    assert.ok(runtime.getCompletionOptions('/plan auto').some((item) => item.value === '/plan auto run '));
    assert.equal(
      runtime.getCompletionOptions('/plan').find((item) => item.value === '/plan auto')?.description,
      '自动生成计划并等待你确认执行'
    );
    assert.equal(
      runtime.getCompletionOptions('/plan').find((item) => item.value === '/plan approve')?.description,
      '批准当前待确认的计划并开始执行'
    );
    assert.equal(
      runtime.getCompletionOptions('/plan auto').find((item) => item.value === '/plan auto run ')?.description,
      '自动生成计划后立即继续执行'
    );
    assert.equal(runtime.getCompletionOptions('/tasks').length, 0);
    assert.ok(runtime.getCompletionOptions('/agents').some((item) => item.value === '/agents run'));
    assert.ok(runtime.getCompletionOptions('/agents run').some((item) => item.value === '/agents run planner '));
    assert.ok(runtime.getCompletionOptions('/checkpoint').some((item) => item.value === '/checkpoint create'));
    assert.ok(runtime.getCompletionOptions('/checkpoint list').some((item) => item.value === '/checkpoint list --all'));
    assert.ok(runtime.getCompletionOptions('/history').some((item) => item.value === '/history resume'));
    assert.ok(
      runtime
        .getCompletionOptions('/history resume')
        .some((item) => item.value.includes('session-config-completions'))
    );
    assert.ok(runtime.getCompletionOptions('/debug').some((item) => item.value === '/debug keys'));
    assert.ok(runtime.getCompletionOptions('/debug keys').some((item) => item.value === '/debug keys on'));
    assert.ok(runtime.getCompletionOptions('/compact').some((item) => item.value === '/compact --preview'));
  });
});

test('chat runtime localizes completion descriptions using UI language', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const config = await loadConfig();
    config.ui.language = 'en';
    const now = new Date().toISOString();
    const runtime = await createChatRuntime({
      session: {
        id: 'session-config-completions-en',
        createdAt: now,
        updatedAt: now,
        messages: []
      },
      config,
      systemPrompt: 'You are a test assistant.'
    });

    const setSuggestions = runtime.getCompletionOptions('/config set ');
    assert.equal(setSuggestions[0].description, 'set the gateway base URL');
    assert.equal(
      setSuggestions.find((item) => item.value === '/config set sdk.provider ')?.description,
      'set the SDK provider (options: openai-compatible | anthropic)'
    );
    assert.equal(
      runtime.getCompletionOptions('/history resume')[0]?.description,
      'resume a saved session'
    );
  });
});

test('history resume completions preload saved sessions sorted by recency', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    await saveSession({
      id: 'session-older',
      createdAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T10:05:00.000Z',
      messages: [{ role: 'user', content: 'older session message' }]
    });
    await saveSession({
      id: 'session-newer',
      createdAt: '2026-04-02T10:00:00.000Z',
      updatedAt: '2026-04-02T10:05:00.000Z',
      messages: [{ role: 'user', content: 'newer session message' }]
    });

    const config = await loadConfig();
    const now = new Date().toISOString();
    const runtime = await createChatRuntime({
      session: {
        id: 'session-current',
        createdAt: now,
        updatedAt: now,
        messages: []
      },
      config,
      systemPrompt: 'You are a test assistant.'
    });

    const suggestions = runtime
      .getCompletionOptions('/history resume')
      .filter((item) => item.value.startsWith('/history resume session-') && !item.value.includes('session-current'));

    assert.deepEqual(
      suggestions.slice(0, 2).map((item) => item.value),
      ['/history resume session-newer', '/history resume session-older']
    );
  });
});

test('history resume returns loaded session messages for UI restore', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    await saveSession({
      id: 'session-restore-target',
      createdAt: '2026-04-02T10:00:00.000Z',
      updatedAt: '2026-04-02T10:05:00.000Z',
      messages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好，请问我可以帮你做什么？' }
      ]
    });

    const config = await loadConfig();
    const now = new Date().toISOString();
    const runtime = await createChatRuntime({
      session: {
        id: 'session-current',
        createdAt: now,
        updatedAt: now,
        messages: []
      },
      config,
      systemPrompt: 'You are a test assistant.'
    });

    const result = await runtime.submit('/history resume session-restore-target');

    assert.equal(result.type, 'system');
    assert.match(result.text, /Switched to session: session-restore-target/);
    assert.deepEqual(result.restoredMessages, [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，请问我可以帮你做什么？' }
    ]);
  });
});

test('chat runtime injects reply language instructions and updates them after config changes', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      const systemText = String(body.messages?.[0]?.content || '');

      if (callIndex === 1) {
        assert.match(systemText, /Respond in Simplified Chinese/i);
      }

      if (callIndex === 2) {
        assert.match(systemText, /Respond in English/i);
      }

      return makeSseResponse([
        { choices: [{ delta: { content: `reply-${callIndex}` } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ]);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-reply-language',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const first = await runtime.submit('你好');
      assert.equal(first.text, 'reply-1');

      await runtime.submit('/config set ui.reply_language en');

      const second = await runtime.submit('hello');
      assert.equal(second.text, 'reply-2');
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});

test('chat runtime injects lightweight project index context into the system prompt', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-project-context-'));
    const previousCwd = process.cwd();
    const restoreFetch = withMockFetch(async (_url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      const systemText = String(body.messages?.[0]?.content || '');
      assert.match(systemText, /Project Context:/);
      assert.match(systemText, /project_root:/);
      assert.match(systemText, /languages: ts/);
      assert.match(systemText, /src\/auth\.ts/);
      return makeSseResponse([
        { choices: [{ delta: { content: 'ok' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ]);
    });

    try {
      process.chdir(cwd);
      await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
      await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
      await fs.writeFile(path.join(cwd, 'src', 'auth.ts'), 'export function loginUser(name) { return name; }\n', 'utf8');

      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-project-context',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('update loginUser in src/auth.ts');
      assert.equal(result.text, 'ok');
    } finally {
      process.chdir(previousCwd);
      await restoreFetch();
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('chat runtime injects persistent memory into the system prompt', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-context-'));
    const previousCwd = process.cwd();
    const restoreFetch = withMockFetch(async (_url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      const systemText = String(body.messages?.[0]?.content || '');
      assert.match(systemText, /Persistent Memory:/);
      assert.match(systemText, /User Memory:/);
      assert.match(systemText, /Global Memory:/);
      assert.match(systemText, /Project Memory:/);
      assert.match(systemText, /Persistent memory stores durable preferences and stable workflow knowledge/i);
      assert.match(systemText, /Verify changeable details from files/i);
      assert.match(systemText, /only write memory for future-useful, non-sensitive facts/i);
      assert.match(systemText, /preserve command names, file paths, identifiers, and punctuation exactly/i);
      assert.match(systemText, /exact_text=/);
      assert.match(systemText, /用户偏好中文回复/);
      assert.match(systemText, /优先使用 rg 搜索代码/);
      assert.match(systemText, /src\/auth\.ts 是登录核心模块/);
      return makeSseResponse([
        { choices: [{ delta: { content: 'ok' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ]);
    });

    try {
      process.chdir(cwd);
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';
      await rememberMemory({ scope: 'user', content: '用户偏好中文回复。', kind: 'preference', workspaceRoot: cwd, config });
      await rememberMemory({ scope: 'global', content: '优先使用 rg 搜索代码。', kind: 'workflow', workspaceRoot: cwd, config });
      await rememberMemory({ scope: 'project', content: 'src/auth.ts 是登录核心模块。', kind: 'module', workspaceRoot: cwd, config });

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-memory-context',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('查看当前约定');
      assert.equal(result.text, 'ok');
    } finally {
      process.chdir(previousCwd);
      await restoreFetch();
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('config preference changes do not auto-write durable memories', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-config-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(cwd);
      const config = await loadConfig();
      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-memory-auto-write',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      await runtime.submit('/config set ui.reply_language en');
      await runtime.submit('/config set sdk.provider anthropic');

      const userMemories = await listMemories({ scope: 'user', workspaceRoot: cwd });
      assert.equal(userMemories.length, 0);
    } finally {
      process.chdir(previousCwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('memory slash commands list search and forget stored memories', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-memory-command-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(cwd);
      const config = await loadConfig();
      await rememberMemory({
        scope: 'project',
        content: 'src/auth.ts 是登录核心模块。',
        kind: 'module',
        workspaceRoot: cwd,
        config
      });

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-memory-commands',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const listResult = await runtime.submit('/memory list project');
      assert.match(listResult.text, /src\/auth\.ts 是登录核心模块/);

      const searchResult = await runtime.submit('/memory search project 登录');
      assert.match(searchResult.text, /src\/auth\.ts 是登录核心模块/);

      const beforeForget = await listMemories({ scope: 'project', workspaceRoot: cwd });
      const forgetResult = await runtime.submit(`/memory forget project ${beforeForget[0].id}`);
      assert.match(forgetResult.text, /Removed 1|removed 1/i);

      const afterForget = await listMemories({ scope: 'project', workspaceRoot: cwd });
      assert.equal(afterForget.length, 0);
      assert.ok(runtime.getCompletionOptions('/memory').some((item) => item.value === '/memory list'));
    } finally {
      process.chdir(previousCwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('chat runtime emits skill lifecycle events for explicit skill commands', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const restoreFetch = withMockFetch(async () =>
      makeSseResponse([
        { choices: [{ delta: { content: 'skill output' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ])
    );

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-skill-events',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const events = [];
      const result = await runtime.submit('/superpowers-lite', (event) => events.push(event));

      assert.equal(result.type, 'assistant');
      assert.equal(result.text, 'skill output');
      assert.ok(events.some((event) => event?.type === 'skill:start' && event?.name === 'superpowers-lite'));
      assert.ok(events.some((event) => event?.type === 'skill:end' && event?.name === 'superpowers-lite'));
    } finally {
      await restoreFetch();
    }
  });
});

test('chat runtime auto-injects brainstorm for ambiguous feature requests', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let inspected = false;
    const events = [];
    const restoreFetch = withMockFetch(async (_url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      const systemText = String(body.messages?.[0]?.content || '');
      inspected = true;
      assert.match(systemText, /\[Auto skill: superpowers-lite\]/);
      assert.match(systemText, /\[Auto skill: brainstorm\]/);
      return makeSseResponse([
        { choices: [{ delta: { content: '先收敛需求，再决定实现方式。' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ]);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-auto-brainstorm',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit(
        'Add login retry support, but I am not sure whether it should stay local or become a shared helper.',
        (event) => events.push(event)
      );
      assert.equal(result.text, '先收敛需求，再决定实现方式。');
      assert.equal(inspected, true);
      assert.ok(events.some((event) => event?.type === 'skill:auto'));
      assert.deepEqual(
        events.find((event) => event?.type === 'skill:auto')?.names,
        ['superpowers-lite', 'brainstorm']
      );
    } finally {
      await restoreFetch();
    }
  });
});

test('chat runtime auto-injects brainstorm for greenfield generation requests', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let inspected = false;
    const restoreFetch = withMockFetch(async (_url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      const systemText = String(body.messages?.[0]?.content || '');
      inspected = true;
      assert.match(systemText, /\[Auto skill: brainstorm\]/);
      return makeSseResponse([
        { choices: [{ delta: { content: 'Question:\n- ask: 这个页面需要静态展示还是需要可编辑功能？\n- why this matters: 它会决定结构和交互范围。' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ]);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-greenfield-brainstorm',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('帮我生成一个日记 HTML 网页。');
      assert.match(result.text, /Question:/);
      assert.equal(inspected, true);
    } finally {
      await restoreFetch();
    }
  });
});

test('slash brainstorm includes the user question in the rendered prompt', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let inspected = false;
    const restoreFetch = withMockFetch(async (_url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      const userText = String(body.messages?.[1]?.content || '');
      inspected = true;
      assert.match(userText, /\[Executing skill: \/brainstorm\]/);
      assert.match(userText, /Explicit brainstorm mode:/);
      assert.match(userText, /Suggested decision:/);
      assert.match(userText, /recommended:/);
      assert.match(userText, /Current question:\nShould login retry stay local or become a shared helper\?/);
      return makeSseResponse([
        { choices: [{ delta: { content: '先比较方案。' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ]);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-brainstorm-command',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('/brainstorm Should login retry stay local or become a shared helper?');
      assert.equal(result.text, '先比较方案。');
      assert.equal(inspected, true);
    } finally {
      await restoreFetch();
    }
  });
});

test('chat runtime does not auto-inject executing-plan-lite for ordinary implementation prompts', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let inspected = false;
    const restoreFetch = withMockFetch(async (_url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      const systemText = String(body.messages?.[0]?.content || '');
      inspected = true;
      assert.match(systemText, /\[Auto skill: superpowers-lite\]/);
      assert.doesNotMatch(systemText, /\[Auto skill: executing-plan-lite\]/);
      return makeSseResponse([
        { choices: [{ delta: { content: 'Implemented.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ]);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-no-auto-executing-plan',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('Implement trimName(name) in src/user.js and verify it.');
      assert.equal(result.text, 'Implemented.');
      assert.equal(inspected, true);
    } finally {
      await restoreFetch();
    }
  });
});

test('chat runtime adds execution guidance for medium tasks without entering plan mode', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let inspected = false;
    const restoreFetch = withMockFetch(async (_url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      const systemText = String(body.messages?.[0]?.content || '');
      inspected = true;
      assert.match(systemText, /Task Mode: medium/i);
      assert.match(systemText, /Execution guidance:/i);
      assert.match(systemText, /Give a brief execution outline before coding/i);
      return makeSseResponse([
        { choices: [{ delta: { content: '先说明执行要点，再修改代码并验证。' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ]);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-medium-task-guidance',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('Update login flow across src/auth.ts and src/session.ts, then add focused tests.');
      assert.equal(result.type, 'assistant');
      assert.match(result.text, /执行要点/);
      assert.equal(inspected, true);
    } finally {
      await restoreFetch();
    }
  });
});

test('chat runtime auto-plans complex tasks from ordinary chat input', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Coordinate a broad auth workflow update.',
                  steps: [
                    {
                      title: 'Implement auth workflow update',
                      role: 'coder',
                      task: 'Update the auth workflow across server, client, and tests.'
                    },
                    {
                      title: 'Review auth workflow update',
                      role: 'reviewer',
                      task: 'Review the auth workflow changes.'
                    },
                    {
                      title: 'Verify auth workflow update',
                      role: 'tester',
                      task: 'Verify the auth workflow changes.'
                    }
                  ]
                })
              }
            }
          ]
        });
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-auto-plan-complex-chat',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('Refactor authentication workflow across API handlers, session state, error recovery, and tests.');
      assert.equal(result.type, 'system');
      assert.match(result.text, /Approval: pending/i);
      assert.match(result.text, /Auto plan finished.*waiting for \/plan approve/i);
      assert.match(result.text, /Next: review the plan summary, then use \/plan approve/i);
      assert.doesNotMatch(result.text, /Steps:\s+\d+\s+total/i);
      assert.match(result.text, /Plan File:/i);
      assert.equal(callIndex, 1);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto keeps advisory plans lean instead of forcing reviewer and tester steps', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const restoreFetch = withMockFetch(async (_url, init) => {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
      assert.equal(body.stream, undefined);
      assert.match(String(body.messages?.[1]?.content || ''), /Task class: advisory/i);
      return makeJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Analyze the project and summarize optimization ideas.',
                steps: [
                  {
                    title: 'Inspect project structure',
                    role: 'planner',
                    task: 'Inspect the project layout and identify likely hot spots.'
                  },
                  {
                    title: 'Summarize optimization ideas',
                    role: 'coder',
                    task: 'Summarize the highest-value optimization opportunities.'
                  }
                ]
              })
            }
          }
        ]
      });
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-advisory-plan-role-selection',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('/plan auto 帮我看看目前项目有什么可以优化的点');
      assert.equal(result.type, 'system');
      assert.match(result.text, /Approval: pending/i);
      assert.doesNotMatch(result.text, /reviewer/i);
      assert.doesNotMatch(result.text, /tester/i);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto run immediately executes the generated plan without pending approval', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        assert.equal(body.stream, undefined);
        assert.match(String(body.messages?.[0]?.content || ''), /Planning policy:/i);
        assert.match(String(body.messages?.[1]?.content || ''), /Task class: advisory/i);
        assert.match(String(body.messages?.[1]?.content || ''), /usually limit it to planner\/coder/i);
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Inspect and improve project structure.',
                  steps: [
                    {
                      title: 'Inspect project structure',
                      role: 'planner',
                      task: 'Inspect the main modules and identify likely optimization areas.'
                    },
                    {
                      title: 'Summarize optimization ideas',
                      role: 'coder',
                      task: 'Summarize the most valuable optimization opportunities.'
                    },
                    {
                      title: 'Review recommendations',
                      role: 'reviewer',
                      task: 'Review the recommendations for completeness and risk.'
                    },
                    {
                      title: 'Verify recommendations',
                      role: 'tester',
                      task: 'Verify that the recommendations are grounded in the repository.'
                    }
                  ]
                })
              }
            }
          ]
        });
      }

      if (callIndex === 2) {
        assert.equal(body.stream, true);
        assert.match(String(body.messages?.[1]?.content || ''), /User approval: \/plan auto run/i);
        assert.match(String(body.messages?.[1]?.content || ''), /Plan file:/i);
        assert.doesNotMatch(String(body.messages?.[1]?.content || ''), /\[tester\]/i);
        assert.doesNotMatch(String(body.messages?.[1]?.content || ''), /reviewer/i);
        assert.doesNotMatch(String(body.messages?.[1]?.content || ''), /tester/i);
        return makeSseResponse([
          { choices: [{ delta: { content: 'Here is the completed optimization review.' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-plan-auto-run',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('/plan auto run review the current project and recommend optimizations');

      assert.equal(result.type, 'assistant');
      assert.match(result.text, /completed optimization review/i);
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto run executes the approved plan prompt immediately', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        assert.equal(body.stream, undefined);
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Build and verify a login test plan.',
                  steps: [
                    {
                      title: 'Implement login test cases',
                      role: 'coder',
                      task: 'Create the login test plan and supporting notes.'
                    },
                    {
                      title: 'Review the test plan',
                      role: 'reviewer',
                      task: 'Review the plan for gaps and risky assumptions.'
                    },
                    {
                      title: 'Verify test coverage',
                      role: 'tester',
                      task: 'Check whether the plan covers the critical login flows.'
                    }
                  ]
                })
              }
            }
          ]
        });
      }

      if (callIndex === 2) {
        assert.equal(body.stream, true);
        assert.match(String(body.messages?.[1]?.content || ''), /Acceptance checklist:/i);
        assert.match(String(body.messages?.[1]?.content || ''), /Plan summary: Build and verify a login test plan\./i);
        return makeSseResponse([
          { choices: [{ delta: { content: 'Status: done\nVerified: reviewed the login plan structure\nNext: none' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-plan-summary',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const events = [];
      const result = await runtime.submit('/plan auto run create a login test plan', (event) => events.push(event));

      assert.equal(result.type, 'assistant');
      assert.match(result.text, /Status: done/i);
      assert.ok(
        events.some(
          (event) =>
            event?.type === 'assistant:delta' && String(event.text || '').includes('[plan] Step 1/3 -> coder: Implement login test cases')
        )
      );
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto run appends a valid tester step instead of emitting undefined metadata', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        assert.equal(body.stream, undefined);
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Refactor the auth flow and then review it.',
                  steps: [
                    {
                      title: 'Refactor the auth flow',
                      role: 'coder',
                      task: 'Refactor the auth flow across the target files.'
                    },
                    {
                      title: 'Review the auth refactor',
                      role: 'reviewer',
                      task: 'Review the refactor for regressions and gaps.'
                    }
                  ]
                })
              }
            }
          ]
        });
      }

      if (callIndex === 2) {
        assert.equal(body.stream, true);
        return makeSseResponse([
          { choices: [{ delta: { content: 'Status: done\nVerified: exercised the refactor flow\nNext: none' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-plan-auto-run-tester-fallback',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const events = [];
      const result = await runtime.submit('/plan auto run refactor the auth flow and verify it', (event) => events.push(event));

      assert.equal(result.type, 'assistant');
      assert.match(result.text, /Status: done/i);
      assert.ok(
        events.some(
          (event) =>
            event?.type === 'assistant:delta' && String(event.text || '').includes('[plan] Step 3/3 -> tester: Test and verify')
        )
      );
      assert.ok(
        events.every(
          (event) => event?.type !== 'assistant:delta' || !/\bundefined\b/i.test(String(event.text || ''))
        )
      );
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});

test('chat runtime sends prior assistant reasoning_content back on the post-tool follow-up request', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        assert.equal(body.stream, true);
        return makeSseResponse([
          {
            choices: [
              {
                delta: {
                  reasoning_content: '先分析工具边界',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_list_reasoning',
                      function: { name: 'list', arguments: '{"path":"src/core"}' }
                    }
                  ]
                }
              }
            ]
          },
          {
            choices: [
              {
                delta: {},
                finish_reason: 'tool_calls'
              }
            ]
          }
        ]);
      }

      if (callIndex === 2) {
        assert.equal(body.stream, true);
        const assistantWithReasoning = (body.messages || []).find(
          (message) => message?.role === 'assistant' && message?.reasoning_content === '先分析工具边界'
        );
        assert.ok(assistantWithReasoning);
        assert.equal(assistantWithReasoning.reasoning_content, '先分析工具边界');
        assert.deepEqual(assistantWithReasoning.tool_calls, [
          {
            id: 'call_list_reasoning',
            type: 'function',
            function: {
              name: 'list',
              arguments: '{"path":"src/core"}'
            }
          }
        ]);
        return makeSseResponse([
          {
            choices: [
              {
                delta: { content: '不能直接嵌到 read 里。' }
              }
            ]
          },
          {
            choices: [
              {
                delta: {},
                finish_reason: 'stop'
              }
            ]
          }
        ]);
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-reasoning-content-roundtrip',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('现在我的工具暴露是把query ast作为单独工具，能不能直接嵌入到read文件里');
      assert.equal(result.type, 'assistant');
      assert.match(result.text, /不能直接嵌到 read 里/);
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto run sends the approved plan prompt with the generated plan details', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Update auth helpers safely.',
                  steps: [
                    {
                      title: 'Implement helper changes',
                      role: 'coder',
                      task: 'Modify the helper implementation.'
                    },
                    {
                      title: 'Review implementation',
                      role: 'reviewer',
                      task: 'Review the helper changes against the goal.'
                    },
                    {
                      title: 'Test implementation',
                      role: 'tester',
                      task: 'Verify the helper changes against the goal.'
                    }
                  ]
                })
              }
            }
          ]
        });
      }

      if (callIndex === 2) {
        assert.match(String(body.messages?.[1]?.content || ''), /Original goal:/i);
        assert.match(String(body.messages?.[1]?.content || ''), /Acceptance checklist:/i);
        assert.match(String(body.messages?.[1]?.content || ''), /trim/i);
        return makeSseResponse([
          { choices: [{ delta: { content: 'Status: partial\nVerified: reviewed helper file\nNext: run focused tests' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-plan-fallback',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('/plan auto run update auth helper and ensure names are trimmed');

      assert.equal(result.type, 'assistant');
      assert.match(result.text, /Status: partial/i);
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan from-spec includes project implementation constraints in the model prompt', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const originalCwd = process.cwd();
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-plan-from-spec-'));
    process.chdir(cwd);
    try {
      await fs.mkdir(path.join(cwd, '.codemini', 'specs'), { recursive: true });
      await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({ name: 'demo', type: 'module' }, null, 2),
        'utf8'
      );
      await fs.writeFile(path.join(cwd, 'src', 'math.js'), 'export function add(a, b) { return a + b; }\n', 'utf8');
      await fs.writeFile(path.join(cwd, 'src', 'user.js'), 'export function getUserName(user) { return user?.name || "Guest"; }\n', 'utf8');
      const specPath = path.join(cwd, '.codemini', 'specs', 'demo-spec.md');
      await fs.writeFile(
        specPath,
        ['# Spec: Demo feature', '', '## 1. Background', 'Need a JS feature extension.'].join('\n'),
        'utf8'
      );

      let capturedUserPrompt = '';
      const restoreFetch = withMockFetch(async (_url, init) => {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));
        capturedUserPrompt = String(body.messages?.[1]?.content || '');
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: '# Plan: Demo feature\n\n## Phase 1: Discovery\n1. Inspect files\n\n## Phase 2: Implementation\n1. Update src/demo.js\n\n## Phase 3: Verification\n1. Run npm test\n\n## Task Breakdown\n- [ ] Update JS files'
              }
            }
          ]
        });
      });

      try {
        const config = await loadConfig();
        config.gateway.base_url = 'https://gateway.example/v1';
        config.gateway.api_key = 'test-key';

        const now = new Date().toISOString();
        const runtime = await createChatRuntime({
          session: {
            id: 'session-plan-from-spec',
            createdAt: now,
            updatedAt: now,
            messages: []
          },
          config,
          systemPrompt: 'You are a test assistant.'
        });

        const result = await runtime.submit(`/plan from-spec ${specPath}`);

        assert.equal(result.type, 'system');
        assert.match(result.text, /Plan created from spec:/);
        assert.match(capturedUserPrompt, /Project implementation constraints:/);
        assert.match(capturedUserPrompt, /Prefer JavaScript\/TypeScript style paths and file names/i);
        assert.match(capturedUserPrompt, /Do not invent files in another language family/i);
        assert.match(capturedUserPrompt, /Likely existing implementation files to reuse first:/);
        assert.match(capturedUserPrompt, /src\/math\.js/);
        assert.match(capturedUserPrompt, /src\/user\.js/);
      } finally {
        await restoreFetch();
      }
    } finally {
      process.chdir(originalCwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('chat runtime bootstraps lightweight project index in .codemini', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const originalCwd = process.cwd();
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-index-bootstrap-'));
    process.chdir(cwd);
    try {
      await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
      await fs.mkdir(path.join(cwd, 'tests'), { recursive: true });
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test' } }, null, 2),
        'utf8'
      );
      await fs.writeFile(path.join(cwd, 'src', 'main.ts'), 'export function runApp() { return true; }\n', 'utf8');

      const config = await loadConfig();
      const now = new Date().toISOString();
      await createChatRuntime({
        session: {
          id: 'session-index-bootstrap',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const projectMap = JSON.parse(await fs.readFile(path.join(cwd, '.codemini-project', 'project-map.json'), 'utf8'));
      const fileIndex = JSON.parse(await fs.readFile(path.join(cwd, '.codemini-project', 'file-index.json'), 'utf8'));

      assert.equal(projectMap.projectRoot, cwd);
      assert.ok(projectMap.languages.includes('ts'));
      assert.ok(projectMap.importantFiles.includes('package.json'));
      assert.ok(projectMap.sourceRoots.includes('src'));
      assert.ok(Array.isArray(fileIndex.files));
      assert.ok(fileIndex.files.some((entry) => entry.file === 'src/main.ts'));
    } finally {
      process.chdir(originalCwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('chat runtime exposes startup system tool events for project indexing', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-runtime-index-events-'));
    const previousCwd = process.cwd();
    await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'src', 'main.ts'), 'export const value = 1;\n', 'utf8');

    try {
      process.chdir(cwd);
      const config = await loadConfig();
      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-startup-index-events',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const startupEvents = runtime.consumeStartupEvents();
      assert.equal(startupEvents.length, 1);
      assert.equal(startupEvents[0].type, 'system_tool');
      assert.equal(startupEvents[0].status, 'done');
      assert.match(String(startupEvents[0].summary || ''), /\.codemini-project/i);
      assert.deepEqual(runtime.consumeStartupEvents(), []);
    } finally {
      process.chdir(previousCwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('chat runtime skips project indexing in non-project directories', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-runtime-non-project-'));
    const previousCwd = process.cwd();

    try {
      process.chdir(cwd);
      const config = await loadConfig();
      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-non-project',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      assert.deepEqual(runtime.consumeStartupEvents(), []);
      const workspaceStat = await fs.stat(path.join(cwd, '.codemini'));
      assert.equal(workspaceStat.isDirectory(), true);
      await assert.rejects(fs.readFile(path.join(cwd, '.codemini-project', 'project-map.json'), 'utf8'));
      await assert.rejects(fs.readFile(path.join(cwd, '.codemini-project', 'file-index.json'), 'utf8'));
    } finally {
      process.chdir(previousCwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('chat runtime project index respects .gitignore for source files', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-runtime-gitignore-'));
    const previousCwd = process.cwd();

    try {
      process.chdir(cwd);
      await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
      await fs.writeFile(path.join(cwd, '.gitignore'), ['ignored/', 'src/secret.ts'].join('\n'), 'utf8');
      await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
      await fs.mkdir(path.join(cwd, 'ignored'), { recursive: true });
      await fs.writeFile(path.join(cwd, 'src', 'main.ts'), 'export const visible = true;\n', 'utf8');
      await fs.writeFile(path.join(cwd, 'src', 'secret.ts'), 'export const hidden = true;\n', 'utf8');
      await fs.writeFile(path.join(cwd, 'ignored', 'skip.ts'), 'export const skip = true;\n', 'utf8');

      const config = await loadConfig();
      const now = new Date().toISOString();
      await createChatRuntime({
        session: {
          id: 'session-gitignore',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const projectMap = JSON.parse(await fs.readFile(path.join(cwd, '.codemini-project', 'project-map.json'), 'utf8'));
      const fileIndex = JSON.parse(await fs.readFile(path.join(cwd, '.codemini-project', 'file-index.json'), 'utf8'));

      assert.equal(projectMap.gitignoreEnabled, true);
      assert.ok(fileIndex.files.some((entry) => entry.file === 'src/main.ts'));
      assert.ok(!fileIndex.files.some((entry) => entry.file === 'src/secret.ts'));
      assert.ok(!fileIndex.files.some((entry) => entry.file === 'ignored/skip.ts'));
    } finally {
      process.chdir(previousCwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('chat runtime project index skips default noise directories like sessions', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-runtime-default-ignore-'));
    const previousCwd = process.cwd();

    try {
      process.chdir(cwd);
      await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
      await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
      await fs.mkdir(path.join(cwd, 'sessions'), { recursive: true });
      await fs.writeFile(path.join(cwd, 'src', 'main.ts'), 'export const visible = true;\n', 'utf8');
      await fs.writeFile(path.join(cwd, 'sessions', 'chat.ts'), 'export const noisy = true;\n', 'utf8');

      const config = await loadConfig();
      const now = new Date().toISOString();
      await createChatRuntime({
        session: {
          id: 'session-default-ignore',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const fileIndex = JSON.parse(await fs.readFile(path.join(cwd, '.codemini-project', 'file-index.json'), 'utf8'));

      assert.ok(fileIndex.files.some((entry) => entry.file === 'src/main.ts'));
      assert.ok(!fileIndex.files.some((entry) => entry.file === 'sessions/chat.ts'));
    } finally {
      process.chdir(previousCwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('chat runtime project index respects .llmignore for source files', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-runtime-llmignore-'));
    const previousCwd = process.cwd();

    try {
      process.chdir(cwd);
      await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
      await fs.writeFile(path.join(cwd, '.llmignore'), ['artifacts/', 'src/generated.ts'].join('\n'), 'utf8');
      await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
      await fs.mkdir(path.join(cwd, 'artifacts'), { recursive: true });
      await fs.writeFile(path.join(cwd, 'src', 'main.ts'), 'export const visible = true;\n', 'utf8');
      await fs.writeFile(path.join(cwd, 'src', 'generated.ts'), 'export const hidden = true;\n', 'utf8');
      await fs.writeFile(path.join(cwd, 'artifacts', 'report.ts'), 'export const artifact = true;\n', 'utf8');

      const config = await loadConfig();
      const now = new Date().toISOString();
      await createChatRuntime({
        session: {
          id: 'session-llmignore',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const projectMap = JSON.parse(await fs.readFile(path.join(cwd, '.codemini-project', 'project-map.json'), 'utf8'));
      const fileIndex = JSON.parse(await fs.readFile(path.join(cwd, '.codemini-project', 'file-index.json'), 'utf8'));

      assert.equal(projectMap.gitignoreEnabled, false);
      assert.ok(fileIndex.files.some((entry) => entry.file === 'src/main.ts'));
      assert.ok(!fileIndex.files.some((entry) => entry.file === 'src/generated.ts'));
      assert.ok(!fileIndex.files.some((entry) => entry.file === 'artifacts/report.ts'));
    } finally {
      process.chdir(previousCwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

test('plan auto run includes acceptance checklist for lightweight goals', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Add one tiny helper change.',
                  steps: [
                    {
                      title: 'Implement helper change',
                      role: 'coder',
                      task: 'Add trimName(name) in src/user.js and export it.'
                    },
                    {
                      title: 'Review helper change',
                      role: 'reviewer',
                      task: 'Review the helper implementation.'
                    },
                    {
                      title: 'Verify helper change',
                      role: 'tester',
                      task: 'Verify the helper implementation.'
                    }
                  ]
                })
              }
            }
          ]
        });
      }

      if (callIndex === 2) {
        assert.match(body.messages[1].content, /Acceptance checklist:/i);
        assert.match(body.messages[1].content, /Add trimName\(name\) helper in src\/user\.js/i);
        return makeSseResponse([
          {
            choices: [{ delta: { content: 'Status: done\nVerified: confirmed trimName(name) is exported\nNext: none' } }]
          },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-plan-lightweight',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('/plan auto run add trimName(name) helper in src/user.js');

      assert.equal(result.type, 'assistant');
      assert.match(result.text, /Status: done/i);
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto run forwards checklist-style acceptance guidance into execution', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Implement two auth updates.',
                  steps: [
                    {
                      title: 'Implement auth updates',
                      role: 'coder',
                      task: 'Add greetUser(name) and update the login helper.'
                    },
                    {
                      title: 'Review auth updates',
                      role: 'reviewer',
                      task: 'Review the auth changes against the goal.'
                    },
                    {
                      title: 'Verify auth updates',
                      role: 'tester',
                      task: 'Verify the auth changes against the goal.'
                    }
                  ]
                })
              }
            }
          ]
        });
      }

      if (callIndex === 2) {
        const scopedTask = String(body.messages[1].content || '');
        assert.match(scopedTask, /Acceptance checklist:/i);
        assert.match(scopedTask, /Add greetUser\(name\)/i);
        assert.match(scopedTask, /trim whitespace/i);
        assert.match(scopedTask, /preserve the exclamation mark/i);
        return makeSseResponse([
          { choices: [{ delta: { content: 'Status: done\nVerified: aligned with the checklist in the approved plan prompt\nNext: none' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-plan-checklist',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit(
        '/plan auto run add greetUser(name), trim whitespace in the returned greeting, and preserve the exclamation mark'
      );

      assert.equal(result.type, 'assistant');
      assert.match(result.text, /Status: done/i);
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto run carries acceptance checklist into the approved execution prompt', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Implement auth greeting update.',
                  steps: [
                    {
                      title: 'Implement auth greeting update',
                      role: 'coder',
                      task: 'Update greetUser(name).'
                    },
                    {
                      title: 'Review auth greeting update',
                      role: 'reviewer',
                      task: 'Review greetUser(name) against the goal.'
                    },
                    {
                      title: 'Verify auth greeting update',
                      role: 'tester',
                      task: 'Verify greetUser(name) against the goal.'
                    }
                  ]
                })
              }
            }
          ]
        });
      }

      if (callIndex === 2) {
        const scopedTask = String(body.messages[1].content || '');
        assert.match(scopedTask, /Acceptance checklist:/i);
        assert.match(scopedTask, /Add greetUser\(name\)/i);
        assert.match(scopedTask, /Trim whitespace/i);
        return makeSseResponse([
          {
            choices: [
              {
                delta: {
                  content: 'Status: partial\nVerified: checklist was included in the approved execution prompt\nNext: run focused verification'
                }
              }
            ]
          },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-plan-acceptance-format',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit(
        '/plan auto run add greetUser(name) and trim whitespace in the returned greeting'
      );

      assert.equal(result.type, 'assistant');
      assert.match(result.text, /Status: partial/i);
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto run preserves the approved plan summary and goal in the execution prompt', { concurrency: false }, async () => {
  await withTempConfigDir(async () => {
    let callIndex = 0;
    const restoreFetch = withMockFetch(async (_url, init) => {
      callIndex += 1;
      const body = JSON.parse(typeof init.body === 'string' ? init.body : String(init.body));

      if (callIndex === 1) {
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Update auth helper safely.',
                  steps: [
                    {
                      title: 'Implement auth helper update',
                      role: 'coder',
                      task: 'Update greetUser(name).'
                    },
                    {
                      title: 'Review auth helper update',
                      role: 'reviewer',
                      task: 'Review greetUser(name) against the goal.'
                    },
                    {
                      title: 'Verify auth helper update',
                      role: 'tester',
                      task: 'Verify greetUser(name) against the goal.'
                    }
                  ]
                })
              }
            }
          ]
        });
      }

      if (callIndex === 2) {
        const scopedTask = String(body.messages[1].content || '');
        assert.match(scopedTask, /Original goal:/i);
        assert.match(scopedTask, /Plan summary: Update auth helper safely\./i);
        assert.match(scopedTask, /Preserve the exclamation mark/i);
        return makeSseResponse([
          {
            choices: [
              {
                delta: {
                  content: 'Status: blocked\nVerified: approved prompt preserved the requested punctuation requirement\nNext: implement the actual code path'
                }
              }
            ]
          },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      throw new Error(`unexpected fetch call ${callIndex}`);
    });

    try {
      const config = await loadConfig();
      config.gateway.base_url = 'https://gateway.example/v1';
      config.gateway.api_key = 'test-key';

      const now = new Date().toISOString();
      const runtime = await createChatRuntime({
        session: {
          id: 'session-plan-acceptance-failure',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit(
        '/plan auto run add greetUser(name) and preserve the exclamation mark'
      );

      assert.equal(result.type, 'assistant');
      assert.match(result.text, /Status: blocked/i);
      assert.equal(callIndex, 2);
    } finally {
      await restoreFetch();
    }
  });
});
