import test from 'node:test';
import assert from 'node:assert/strict';

import { parseChatArgs, submitAndPrint } from '../src/commands/chat.js';
import { parseRunArgs } from '../src/commands/run.js';
import { parseScopeArgs } from '../src/commands/skill.js';
import { parseArgs as parseWebArgs } from '../codemini-web/server.js';

test('CLI parsers preserve aliases, repeated skills, and positionals', () => {
  assert.deepEqual(parseChatArgs(['--lite', '--model', 'gpt', 'hello', 'world']), {
    prompt: 'hello world', sessionId: undefined, model: 'gpt', fast: true, system: undefined, plain: false,
  });
  assert.deepEqual(parseRunArgs(['--skill', 'one', '--skill=two', '--pipeline', 'do', 'it']), {
    task: 'do it', model: undefined, fast: false, harness: null, pipeline: true, skillNames: ['one', 'two'],
  });
  assert.deepEqual(parseScopeArgs(['install', '--scope=all', '--force'], { allowAll: true }), {
    scope: 'all', rest: ['install', '--force'],
  });
  assert.deepEqual(parseWebArgs(['node', 'server.js', '-p', '4567', '--no-open']), {
    port: 4567, session: undefined, model: undefined, project: undefined, open: false, host: '127.0.0.1',
  });
  assert.deepEqual(parseWebArgs(['node', 'server.js', '--host', '0.0.0.0']), {
    port: 3210, session: undefined, model: undefined, project: undefined, open: true, host: '0.0.0.0',
  });
});

test('终端在流式目标回复后显示验收状态，只收到工具事件时显示完整结果', async () => {
  async function render(events, result) {
    let shown = '';
    const output = { write(text) { shown += text; } };
    const runtime = {
      async submitMessage(_input, onEvent) {
        for (const event of events) onEvent(event);
        return result;
      },
    };
    await submitAndPrint(runtime, '/goal 数到三', { output });
    return shown;
  }

  const answer = '一、二、三';
  const delta = { type: 'assistant:delta', text: answer };
  const tool = { type: 'tool:start', name: 'read' };
  const goalSummary = '目标已暂停，轮次 1/5。';
  const result = { type: 'system', text: `${goalSummary}\n${answer}`, goalSummary };

  assert.equal(await render([delta], result), `${answer}\n${goalSummary}\n`);
  assert.equal(await render([tool], result), `[tool:start] read\n${result.text}\n`);
  assert.equal(await render([], result), `${result.text}\n`);
  assert.equal(await render([delta, { type: 'assistant:start' }], result), `${answer}\n${result.text}\n`);
  assert.equal(await render([delta], { type: 'assistant', text: answer }), `${answer}\n`);
});
