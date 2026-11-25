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

test('in-flight compact runs micro then macro in one cycle when occupancy stays over the trigger', async () => {
  const messages = [
    { role: 'system', content: 'system stays' },
    { role: 'user', content: 'do the task' },
    ...Array.from({ length: 8 }, (_, index) => pair(`old-${index}`, `OLD_${index}_${'x'.repeat(800)}`)).flat(),
  ];

  const result = await compactInFlightMessages(messages, config, 900);
  assert.equal(result.changed, true);
  assert.equal(result.mode, 'conservative');
  assert.equal(result.threshold, 90);
  assert.equal(result.messages[0].content, 'system stays');
  assert.match(result.messages[1].content, /Context Summary|OLD_/);
  assert.match(result.messages.map((message) => message.content).join('\n'), /OLD_7_/);
  assert.equal(result.messages.some((message) => message.tool_call_id === 'old-0' && /OLD_0_/.test(message.content)), false);
  assertToolPairs(result.messages);
});

test('in-flight macro uses a model summary and falls back locally when it fails', async () => {
  const messages = [
    { role: 'system', content: 'system stays' },
    { role: 'user', content: 'do the task' },
    ...Array.from({ length: 8 }, (_, index) => pair(`old-${index}`, `OLD_${index}_${'x'.repeat(800)}`)).flat(),
  ];

  const summarized = await compactInFlightMessages(messages, config, 900, {
    generateSummary: async () => 'MODEL_SUMMARY of the older turn',
  });
  assert.equal(summarized.changed, true);
  assert.equal(summarized.mode, 'conservative');
  assert.match(summarized.messages[1].content, /MODEL_SUMMARY/);

  const fallback = await compactInFlightMessages(messages, config, 900, {
    generateSummary: async () => {
      throw new Error('fast model failed');
    },
  });
  assert.equal(fallback.changed, true);
  assert.match(fallback.messages[1].content, /Context Summary/);
});

test('in-flight macro uses the hard limit to choose conservative vs aggressive keep', async () => {
  const messages = [
    { role: 'system', content: 'system stays' },
    { role: 'user', content: 'do the task' },
    ...Array.from({ length: 12 }, (_, index) => pair(`old-${index}`, `OLD_${index}_${'x'.repeat(400)}`)).flat(),
  ];

  const conservative = await compactInFlightMessages(messages, config, 900);
  assert.equal(conservative.mode, 'conservative');

  const aggressive = await compactInFlightMessages(messages, config, 990);
  assert.equal(aggressive.mode, 'aggressive');
  assert.ok(aggressive.messages.length <= conservative.messages.length);
});

test('in-flight compact does not split an assistant tool call from missing results', async () => {
  const messages = [
    { role: 'system', content: 'system stays' },
    { role: 'user', content: 'do the task' },
    ...Array.from({ length: 8 }, (_, index) => pair(`old-${index}`, `OLD_${index}_${'x'.repeat(800)}`)).flat(),
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'open', type: 'function', function: { name: 'read', arguments: '{}' } }],
    },
  ];
  const result = await compactInFlightMessages(messages, config, 990);
  assert.equal(result.changed, false);
  assert.equal(result.messages, messages);
  assert.equal(result.messages.at(-1).tool_calls[0].id, 'open');
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
  const start = events.find((event) => event.type === 'compact:start');
  assert.ok(start);
  assert.equal(start.duringTurn, true);
  assert.match(start.summary, /上下文压缩中/);
  assert.match(start.summaryEn, /Compressing context/);
  assert.doesNotMatch(start.summary, /micro|macro|conservative|aggressive|\d+%/i);
  assert.equal(events.filter((event) => event.type === 'compact:auto').length, 1);
  const marker = events.find((event) => event.type === 'compact:auto');
  assert.equal(marker.duringTurn, true);
  assert.equal(marker.mode, 'conservative');
  assert.equal(marker.threshold, 90);
  assert.match(marker.summary, /以上内容已压缩/);
  assert.doesNotMatch(marker.summary, /micro|macro|conservative|aggressive|\d+%/i);
  assert.ok(marker.estimatedTokens > 0);
  assert.ok(marker.estimatedTokens < 900);
  assert.equal(seen[1][0], 'system stays');
  assert.equal(seen[1].some((content) => content.includes('OLD_0_')), false);
  assert.equal(seen[1].some((content) => content.includes('LIVE_TOOL_RESULT')), true);
});
