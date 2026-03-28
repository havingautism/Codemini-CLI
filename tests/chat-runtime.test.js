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

test('chat runtime reflects config and mode changes immediately for TUI refresh', async () => {
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

test('chat runtime emits skill lifecycle events for explicit skill commands', async () => {
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

test('plan auto appends a final summary step and returns summarized feedback', async () => {
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
