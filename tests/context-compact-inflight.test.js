import test from 'node:test';
import assert from 'node:assert/strict';
import { compactInFlightMessages } from '../src/core/context-compact.js';
import { runAgentLoop } from '../src/core/agent-loop.js';

const config = {
  memory: { enabled: false },
  model: { max_context_tokens: 1000 },
  context: {
    preflight_trigger_pct: 60,
    hard_limit_pct: 98,
    microcompact_enabled: true,
    microcompact_keep_recent: 1,
  },
};

function pair(id, content) {
  return [
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id, type: 'function', function: { name: 'read', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: id, content },
  ];
}

function assertToolPairs(messages) {
  const open = [];
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) open.push(call.id);
    }
    if (message.role === 'tool') {
      assert.equal(open.shift(), message.tool_call_id);
    }
  }
  assert.deepEqual(open, []);
}

test('in-flight compact waits until real input usage crosses the trigger', async () => {
  const messages = [
    { role: 'system', content: 'system stays' },
    { role: 'user', content: 'do the task' },
    ...pair('only', 'x'.repeat(2000)),
  ];
  const below = await compactInFlightMessages(messages, config, 500);
  assert.equal(below.changed, false);
  assert.equal(below.messages, messages);
});

test('in-flight compact clears old tool results before summarizing the turn', async () => {
  const messages = [
    { role: 'system', content: 'system stays' },
    { role: 'user', content: 'do the task' },
    ...Array.from({ length: 8 }, (_, index) => pair(`old-${index}`, `OLD_${index}_${'x'.repeat(800)}`)).flat(),
  ];

  const micro = await compactInFlightMessages(messages, config, 900);
  assert.equal(micro.changed, true);
  assert.equal(micro.mode, 'micro');
  assert.equal(micro.threshold, 90);
  assert.equal(micro.messages[0].content, 'system stays');
  assert.match(micro.messages.find((message) => message.tool_call_id === 'old-0').content, /Old tool result cleared/);
  assert.match(micro.messages.find((message) => message.tool_call_id === 'old-7').content, /^OLD_7_/);
  assertToolPairs(micro.messages);

  const macro = await compactInFlightMessages(micro.messages, config, 900);
  assert.equal(macro.mode, 'conservative');
  assert.ok(macro.messages.length < micro.messages.length);
  assert.equal(macro.messages[0].content, 'system stays');
  assert.match(macro.messages[1].content, /Context Summary/);
  assert.match(macro.messages.map((message) => message.content).join('\n'), /OLD_7_/);
  assertToolPairs(macro.messages);
});

test('in-flight compact does not split an assistant tool call from missing results', async () => {
  const messages = [
    { role: 'system', content: 'system stays' },
    { role: 'user', content: 'do the task' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'open', type: 'function', function: { name: 'read', arguments: '{}' } }],
    },
  ];
  const result = await compactInFlightMessages(messages, config, 990);
  assert.equal(result.changed, false);
  assert.equal(result.messages, messages);
});

test('the agent loop compacts after a high-usage step and leaves a mid-turn marker', async () => {
  const seen = [];
  const events = [];
  let calls = 0;
  const result = await runAgentLoop({
    systemPrompt: 'system stays',
    userPrompt: 'continue',
    model: 'test-model',
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config,
    initialMessages: Array.from({ length: 6 }, (_, index) => pair(`old-${index}`, `OLD_${index}_${'y'.repeat(600)}`)).flat(),
    toolHandlers: {
      read: async () => ({ text: 'LIVE_TOOL_RESULT' }),
    },
    requestCompletion: async ({ messages }) => {
      calls += 1;
      seen.push(messages.map((message) => String(message.content || '')));
      if (calls === 1) {
        return {
          text: '',
          usage: { prompt_tokens: 900 },
          toolCalls: [{ id: 'live', name: 'read', arguments: '{}' }],
        };
      }
      return { text: 'done', usage: { prompt_tokens: 200 }, toolCalls: [] };
    },
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.text, 'done');
  assert.equal(calls, 2);
  assert.equal(events.filter((event) => event.type === 'compact:auto').length, 1);
  const marker = events.find((event) => event.type === 'compact:auto');
  assert.equal(marker.duringTurn, true);
  assert.equal(marker.mode, 'micro');
  assert.equal(marker.threshold, 90);
  assert.match(marker.summary, /本轮中已压缩/);
  assert.equal(seen[1][0], 'system stays');
  assert.equal(seen[1].some((content) => content.includes('OLD_0_')), false);
  assert.equal(seen[1].some((content) => content.includes('LIVE_TOOL_RESULT')), true);
});
