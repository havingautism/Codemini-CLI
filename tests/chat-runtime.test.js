import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { loadConfig } from '../src/core/config-store.js';

async function withTempConfigDir(run) {
  const prev = process.env.CODEMINI_CONFIG_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-config-'));
  process.env.CODEMINI_CONFIG_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.CODEMINI_CONFIG_DIR;
    } else {
      process.env.CODEMINI_CONFIG_DIR = prev;
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
      model: 'gpt-4.1-mini',
      maxContextTokens: 202752
    });

    await runtime.submit('/config set model.name minimax');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'auto',
      model: 'minimax',
      maxContextTokens: 202752
    });

    await runtime.submit('/config set model.max_context_tokens 12345');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'auto',
      model: 'minimax',
      maxContextTokens: 12345
    });

    await runtime.submit('/mode plan');
    assert.deepEqual(runtime.getRuntimeState(), {
      sessionId: 'session-config-refresh',
      mode: 'plan',
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
      '/config set ui.reply_language ',
      '/config set execution.mode ',
      '/config set shell.default '
    ]);
    assert.equal(setSuggestions[0].description, 'set the gateway base URL');

    const getSuggestions = runtime.getCompletionOptions('/config get ');
    assert.deepEqual(getSuggestions.slice(0, 6).map((item) => item.value), [
      '/config get gateway.base_url',
      '/config get gateway.api_key',
      '/config get model.name',
      '/config get ui.reply_language',
      '/config get execution.mode',
      '/config get shell.default'
    ]);
    assert.equal(getSuggestions[0].description, 'show the gateway base URL');
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

      const result = await runtime.submit('Add login retry support, but I am not sure whether it should stay local or become a shared helper.');
      assert.equal(result.text, '先收敛需求，再决定实现方式。');
      assert.equal(inspected, true);
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

test('plan auto appends a final summary step and returns summarized feedback', { concurrency: false }, async () => {
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

      if (callIndex >= 2 && callIndex <= 4) {
        assert.equal(body.stream, true);
        const responses = [
          'Implemented the requested login test plan with edge cases.',
          'Findings:\n- none\nVerified:\n- reviewed login flow coverage\nNot Verified:\n- real backend execution\nNext Action:\n- run manual smoke tests',
          'Verified:\n- inspected the test checklist\nNot Verified:\n- end-to-end execution on staging\nFailures:\n- none\nNext Action:\n- run staging validation'
        ];
        return makeSseResponse([
          { choices: [{ delta: { content: responses[callIndex - 2] } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 5) {
        assert.equal(body.stream, undefined);
        assert.equal(body.tools, undefined);
        assert.match(body.messages[0].content, /final execution summary/i);
        assert.match(body.messages[1].content, /Implemented the requested login test plan/i);
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: 'The login test plan is drafted and reviewed, but staging validation is still pending.'
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
          id: 'session-plan-summary',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const events = [];
      const result = await runtime.submit('/plan auto create a login test plan', (event) => events.push(event));

      assert.equal(result.type, 'system');
      assert.match(result.text, /Final Summary: The login test plan is drafted and reviewed/i);
      assert.ok(
        events.some(
          (event) =>
            event?.type === 'assistant:delta' &&
            String(event.text || '').includes('[plan] Step 4/4 -> summarizer: Final summary')
        )
      );
      assert.equal(callIndex, 5);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto uses conservative fallback final summary when a verification step fails', { concurrency: false }, async () => {
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
        return makeSseResponse([
          { choices: [{ delta: { content: 'Implemented helper update.' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 3) {
        assert.match(body.messages[1].content, /Original goal:/i);
        return makeSseResponse([
          { choices: [{ delta: { content: 'Findings:\n- none\nVerified:\n- reviewed helper file\nNot Verified:\n- runtime behavior\nNext Action:\n- run tests' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 4) {
        assert.match(body.messages[1].content, /Original goal:/i);
        return makeSseResponse([
          { choices: [{ delta: { content: 'Verified:\n- attempted verification\nNot Verified:\n- goal requirement still unmet\nFailures:\n- command failed\nNext Action:\n- fix implementation' } }] },
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

      const result = await runtime.submit('/plan auto update auth helper and ensure names are trimmed');

      assert.equal(result.type, 'system');
      assert.match(result.text, /Auto plan finished with failures/);
      assert.match(result.text, /Execution finished with failed steps\./);
      assert.equal(callIndex, 4);
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
      await fs.mkdir(path.join(cwd, '.coder', 'specs'), { recursive: true });
      await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({ name: 'demo', type: 'module' }, null, 2),
        'utf8'
      );
      await fs.writeFile(path.join(cwd, 'src', 'math.js'), 'export function add(a, b) { return a + b; }\n', 'utf8');
      await fs.writeFile(path.join(cwd, 'src', 'user.js'), 'export function getUserName(user) { return user?.name || "Guest"; }\n', 'utf8');
      const specPath = path.join(cwd, '.coder', 'specs', 'demo-spec.md');
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

test('plan auto uses a lightweight execution chain for simple goals', { concurrency: false }, async () => {
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
        return makeSseResponse([
          { choices: [{ delta: { content: 'Implemented trimName(name) and exported it.' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 3) {
        assert.match(body.messages[1].content, /Acceptance checklist:/i);
        assert.doesNotMatch(body.messages[0].content, /review sub-agent/i);
        assert.match(body.messages[0].content, /testing sub-agent/i);
        return makeSseResponse([
          {
            choices: [
              {
                delta: {
                  content:
                    'Verified:\n- confirmed trimName(name) is exported\nNot Verified:\n- integration usage in callers\nFailures:\n- none\nNext Action:\n- none'
                }
              }
            ]
          },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 4) {
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: 'The helper change was implemented and directly verified, with only integration usage still unverified.'
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
          id: 'session-plan-lightweight',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit('/plan auto add trimName(name) helper in src/user.js');

      assert.equal(result.type, 'system');
      assert.match(result.text, /Steps: 2 total/);
      assert.match(result.text, /Final Summary: The helper change was implemented and directly verified/i);
      assert.equal(callIndex, 4);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto expands the original goal into checklist-style acceptance guidance', { concurrency: false }, async () => {
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
          { choices: [{ delta: { content: 'Implemented the requested auth updates.' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 3) {
        const scopedTask = String(body.messages[1].content || '');
        assert.match(scopedTask, /Acceptance checklist:/i);
        assert.match(scopedTask, /Add greetUser\(name\)/i);
        assert.match(scopedTask, /trim whitespace/i);
        assert.match(scopedTask, /preserve the exclamation mark/i);
        return makeSseResponse([
          { choices: [{ delta: { content: 'Findings:\n- none\nVerified:\n- reviewed auth helper logic against the checklist\nNot Verified:\n- runtime output\nNext Action:\n- run tests' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 4) {
        const scopedTask = String(body.messages[1].content || '');
        assert.match(scopedTask, /Acceptance checklist:/i);
        assert.match(scopedTask, /Add greetUser\(name\)/i);
        assert.match(scopedTask, /trim whitespace/i);
        assert.match(scopedTask, /preserve the exclamation mark/i);
        return makeSseResponse([
          { choices: [{ delta: { content: 'Verified:\n- checked the described auth behavior against the checklist\nNot Verified:\n- staging validation\nFailures:\n- none\nNext Action:\n- none' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 5) {
        return makeJsonResponse({
          choices: [
            {
              message: {
                content: 'The auth changes match the requested checklist, with staging validation still pending.'
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
          id: 'session-plan-checklist',
          createdAt: now,
          updatedAt: now,
          messages: []
        },
        config,
        systemPrompt: 'You are a test assistant.'
      });

      const result = await runtime.submit(
        '/plan auto add greetUser(name), trim whitespace in the returned greeting, and preserve the exclamation mark'
      );

      assert.equal(result.type, 'system');
      assert.match(result.text, /Final Summary: The auth changes match the requested checklist/i);
      assert.equal(callIndex, 5);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto asks reviewer and tester for structured acceptance status', { concurrency: false }, async () => {
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
        return makeSseResponse([
          { choices: [{ delta: { content: 'Implemented the auth greeting update.' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 3 || callIndex === 4) {
        const systemText = String(body.messages[0].content || '');
        const scopedTask = String(body.messages[1].content || '');
        assert.match(systemText, /Acceptance Status:/i);
        assert.match(scopedTask, /Acceptance checklist:/i);
        assert.match(scopedTask, /Add greetUser\(name\)/i);
        assert.match(scopedTask, /Trim whitespace/i);
        return makeSseResponse([
          {
            choices: [
              {
                delta: {
                  content:
                    callIndex === 3
                      ? 'Acceptance Status:\n- met :: Add greetUser(name)\n- unmet :: Trim whitespace in the returned greeting\nFindings:\n- greeting still keeps surrounding whitespace\nVerified:\n- reviewed greetUser implementation\nNot Verified:\n- runtime output\nNext Action:\n- fix trimming'
                      : 'Acceptance Status:\n- met :: Add greetUser(name)\n- unverified :: Trim whitespace in the returned greeting\nVerified:\n- inspected the greeting behavior request\nNot Verified:\n- trimming behavior remains unverified\nFailures:\n- none\nNext Action:\n- run focused verification after fixing trimming'
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
        '/plan auto add greetUser(name) and trim whitespace in the returned greeting'
      );

      assert.equal(result.type, 'system');
      assert.match(result.text, /Auto plan finished with failures/);
      assert.match(result.text, /Needs follow-up:/i);
      assert.equal(callIndex, 4);
    } finally {
      await restoreFetch();
    }
  });
});

test('plan auto treats unmet acceptance checklist items as failure signals', { concurrency: false }, async () => {
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
        return makeSseResponse([
          { choices: [{ delta: { content: 'Implemented the auth helper update.' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 3) {
        return makeSseResponse([
          {
            choices: [
              {
                delta: {
                  content:
                    'Acceptance Status:\n- met :: Add greetUser(name)\n- unmet :: Preserve the exclamation mark\nFindings:\n- exclamation mark is missing\nVerified:\n- reviewed greetUser implementation\nNot Verified:\n- runtime output\nNext Action:\n- fix greeting suffix'
                }
              }
            ]
          },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }
        ]);
      }

      if (callIndex === 4) {
        return makeSseResponse([
          {
            choices: [
              {
                delta: {
                  content:
                    'Acceptance Status:\n- met :: Add greetUser(name)\n- unmet :: Preserve the exclamation mark\nVerified:\n- attempted focused verification\nNot Verified:\n- final greeting punctuation remains wrong\nFailures:\n- none\nNext Action:\n- repair the greeting output'
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
        '/plan auto add greetUser(name) and preserve the exclamation mark'
      );

      assert.equal(result.type, 'system');
      assert.match(result.text, /Auto plan finished with failures/);
      assert.match(result.text, /Failed: 2/);
      assert.equal(callIndex, 4);
    } finally {
      await restoreFetch();
    }
  });
});
