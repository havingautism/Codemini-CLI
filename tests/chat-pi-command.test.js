import test from 'node:test';
import assert from 'node:assert/strict';

import { cliHandlers, runCli } from '../src/cli.js';
import { chatPiDeps, handleChatPi } from '../src/commands/chat-pi.js';
import { parseChatArgs } from '../src/commands/chat.js';
import { runPiChatApp } from '../src/tui-pi/app.js';

test('parseChatArgs is shared by chat entrypoints', () => {
  assert.equal(typeof parseChatArgs, 'function');

  const parsed = parseChatArgs([
    '--session',
    'sess-42',
    '--model',
    'gpt-4.1',
    '--system',
    'custom prompt',
    '--plain',
    'hello',
    'world'
  ]);

  assert.deepEqual(parsed, {
    prompt: 'hello world',
    sessionId: 'sess-42',
    model: 'gpt-4.1',
    system: 'custom prompt',
    plain: true
  });
});

test('handleChatPi reuses shared chat args and boots the pi-tui app', async () => {
  const calls = [];
  const originalDeps = {
    loadConfig: chatPiDeps.loadConfig,
    createChatRuntime: chatPiDeps.createChatRuntime,
    buildDefaultSystemPrompt: chatPiDeps.buildDefaultSystemPrompt,
    resolveSession: chatPiDeps.resolveSession,
    runPiChatApp: chatPiDeps.runPiChatApp
  };

  try {
    chatPiDeps.loadConfig = async () => ({
      model: { name: 'fallback-model' },
      sdk: { provider: 'mock-provider' },
      ui: { language: 'en' },
      shell: { default: 'bash' },
      policy: { safe_mode: true }
    });
    chatPiDeps.resolveSession = async (sessionId) => ({ id: sessionId || 'session-1' });
    chatPiDeps.buildDefaultSystemPrompt = () => 'default-system';
    chatPiDeps.createChatRuntime = async (options) => {
      calls.push(['runtime', options]);
      return { dispose: async () => calls.push(['dispose']) };
    };
    chatPiDeps.runPiChatApp = async (options) => {
      calls.push(['app', options]);
    };

    await handleChatPi(['--session', 'abc', '--model', 'gpt-5', '--system', 'override', 'hi']);
  } finally {
    Object.assign(chatPiDeps, originalDeps);
  }

  assert.deepEqual(calls[0], [
    'runtime',
    {
      session: { id: 'abc' },
      config: {
        model: { name: 'fallback-model' },
        sdk: { provider: 'mock-provider' },
        ui: { language: 'en' },
        shell: { default: 'bash' },
        policy: { safe_mode: true }
      },
      model: 'gpt-5',
      systemPrompt: 'override'
    }
  ]);
  assert.equal(calls[1][0], 'app');
  assert.equal(calls[1][1].sessionId, 'abc');
  assert.equal(calls[1][1].model, 'gpt-5');
  assert.equal(calls[1][1].sdkProvider, 'mock-provider');
  assert.equal(calls[2][0], 'dispose');
});

test('runCli dispatches chat-pi to the standalone handler', async () => {
  const calls = [];
  const originalHandlers = {
    chat: cliHandlers.chat,
    'chat-pi': cliHandlers['chat-pi']
  };

  try {
    cliHandlers.chat = async () => {
      calls.push('chat');
    };
    cliHandlers['chat-pi'] = async (args) => {
      calls.push(['chat-pi', args]);
    };

    await runCli(['chat-pi', 'hello']);
  } finally {
    Object.assign(cliHandlers, originalHandlers);
  }

  assert.deepEqual(calls, [['chat-pi', ['hello']]]);
});

test('runPiChatApp shell entrypoint is available without module resolution errors', async () => {
  assert.equal(typeof runPiChatApp, 'function');
  await assert.doesNotReject(async () => runPiChatApp);
});

test('handleChatPi rejects --plain for chat-pi', async () => {
  await assert.rejects(() => handleChatPi(['--plain']), /chat-pi does not support --plain yet/);
});
