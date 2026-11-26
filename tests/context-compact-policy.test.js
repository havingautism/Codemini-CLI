import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactInFlightMessages,
  estimateMessagesTokens,
  estimatePromptUsage,
  isContextOverflowError,
  pruneToolPayloads,
  resolveCompactBudget,
  SHRINK_STEPS,
} from '../src/core/context-compact.js';
import { recordCompactContextEstimate } from '../src/core/chat-runtime.js';
import { runAgentLoop } from '../src/core/agent-loop.js';

const wide = {
  memory: { enabled: false },
  model: { max_context_tokens: 100_000 },
  context: {
    hard_limit_pct: 98,
    microcompact_enabled: true,
    prune_minimum: 20_000,
    prune_minimum_pct: 0.1,
    prune_protect_tokens: 40_000,
    prune_protect_turns: 2,
    compact_target_ratio: 0.6,
  },
};

function pair(id, content, args = '{}') {
  return [
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id, type: 'function', function: { name: 'read', arguments: args } }],
    },
    { role: 'tool', tool_call_id: id, content },
  ];
}

function userTurn(text, tools) {
  return [{ role: 'user', content: text }, ...tools];
}

test('estimate counts tool call arguments and reasoning', () => {
  const plain = [{ role: 'assistant', content: 'ok' }];
  const withArgs = [{
    role: 'assistant',
    content: 'ok',
    reasoning_content: 'think'.repeat(400),
    tool_calls: [{ id: 'a', type: 'function', function: { name: 'read', arguments: 'x'.repeat(4000) } }],
  }];
  assert.ok(estimateMessagesTokens(withArgs) > estimateMessagesTokens(plain) + 500);
});

test('usage is the last provider input plus a calibrated delta, and overhead is counted once', () => {
  const messages = [
    { role: 'system', content: 's'.repeat(400) },
    { role: 'user', content: 'do it' },
    ...pair('a', 'y'.repeat(400)),
  ];
  const measuredIndex = 2;
  const usage = estimatePromptUsage({
    messages,
    measuredTokens: 1000,
    measuredIndex,
    overheadTokens: 500,
    calibrationRatio: 2,
  });
  const delta = estimateMessagesTokens(messages.slice(measuredIndex));
  assert.equal(usage, Math.round(1000 + delta * 2));
  const unmeasured = estimatePromptUsage({ messages, overheadTokens: 500 });
  assert.equal(unmeasured, estimateMessagesTokens(messages) + 500);

  const session = { compact: {} };
  const once = recordCompactContextEstimate(session, {
    messages,
    estimatedTokens: 1200,
    config: wide,
    executionMode: 'normal',
  });
  const twice = recordCompactContextEstimate(session, {
    messages,
    estimatedTokens: once,
    config: wide,
    executionMode: 'normal',
  });
  assert.equal(once, 1200);
  assert.equal(twice, once);
});

test('ceiling reserves max(16k, 15% of the window) and a legacy preflight percent is ignored', () => {
  const automatic = resolveCompactBudget({ model: { max_context_tokens: 200_000 }, context: {} });
  assert.equal(automatic.ceiling, 200_000 - 30_000);
  assert.equal(automatic.trigger, automatic.ceiling);
  assert.ok(automatic.target < automatic.trigger * 0.7);

  const outputLimited = resolveCompactBudget({
    model: { max_context_tokens: 200_000, max_output_tokens: 64_000 },
    context: {},
  });
  assert.equal(outputLimited.ceiling, 200_000 - 64_000);

  const configured = resolveCompactBudget({
    model: { max_context_tokens: 200_000 },
    context: { preflight_trigger_pct: 60 },
  });
  assert.equal(configured.trigger, automatic.ceiling);
  assert.equal(configured.trigger, 200_000 - 30_000);
});

test('buffer accepts a percentage or a token count, and ignores a buffer as large as the window', () => {
  const percent = resolveCompactBudget({
    model: { max_context_tokens: 200_000 },
    context: { buffer: '20%' },
  });
  assert.equal(percent.trigger, 200_000 - 40_000);

  const decimal = resolveCompactBudget({
    model: { max_context_tokens: 128_000 },
    context: { buffer: '12.5%' },
  });
  assert.equal(decimal.trigger, 128_000 - 16_000);

  const tokens = resolveCompactBudget({
    model: { max_context_tokens: 200_000 },
    context: { buffer: 20_000 },
  });
  assert.equal(tokens.trigger, 200_000 - 20_000);

  const asString = resolveCompactBudget({
    model: { max_context_tokens: 200_000 },
    context: { buffer: '20000' },
  });
  assert.equal(asString.trigger, 200_000 - 20_000);

  const ignored = resolveCompactBudget({
    model: { max_context_tokens: 200_000 },
    context: { buffer: 200_000 },
  });
  assert.equal(ignored.trigger, 200_000 - 30_000);

  const outputWins = resolveCompactBudget({
    model: { max_context_tokens: 200_000, max_output_tokens: 64_000 },
    context: { buffer: '15%' },
  });
  assert.equal(outputWins.trigger, 200_000 - 64_000);
});

test('auto_compact=false skips automatic compaction and overflow recovery, not a forced manual compact', async () => {
  const config = {
    memory: { enabled: false },
    model: { max_context_tokens: 1000 },
    context: { auto_compact: false, microcompact_enabled: true },
  };
  const messages = [
    { role: 'system', content: 'system stays' },
    { role: 'user', content: 'do the task' },
    ...Array.from({ length: 8 }, (_, index) => pair(`old-${index}`, `OLD_${index}_${'x'.repeat(800)}`)).flat(),
  ];
  const auto = await compactInFlightMessages(messages, config, 900);
  assert.equal(auto.changed, false);
  assert.equal(auto.skipped, 'auto-off');
  assert.equal(auto.messages, messages);

  const overflow = await compactInFlightMessages(messages, config, 900, { force: true });
  assert.equal(overflow.changed, false);
  assert.equal(overflow.skipped, 'auto-off');

  const manual = await compactInFlightMessages(messages, config, 900, {
    force: true,
    manual: true,
    generateSummary: async () => 'MANUAL_SUMMARY',
  });
  assert.equal(manual.changed, true);
  assert.match(manual.messages.find((message) => message.compaction?.kind === 'summary').content, /MANUAL_SUMMARY/);

  const overflowError = new Error('Gateway error 413: Request Entity Too Large');
  let requests = 0;
  const events = [];
  await assert.rejects(runAgentLoop({
    config: { ...config, model: { max_context_tokens: 8000 } },
    model: 'test-model',
    initialMessages: [
      { role: 'user', content: 'current request' },
      { role: 'assistant', content: 'x '.repeat(500) },
    ],
    skipAnalysisNudge: true,
    requestCompletion: async () => {
      requests += 1;
      throw overflowError;
    },
    generateSummary: async () => 'summary',
    onEvent: (event) => events.push(event),
  }), (error) => error === overflowError);
  assert.equal(requests, 1);
  assert.equal(events.filter((event) => event.type === 'compact:auto' || event.type === 'compact:start').length, 0);
});

test('prune keeps the recent token budget and only applies when savings clear the minimum', () => {
  const recent = userTurn('latest', pair('new', 'n'.repeat(1000)));
  const bulky = userTurn('older', Array.from({ length: 6 }, (_, index) => pair(`old-${index}`, 'o'.repeat(20_000))).flat());
  const messages = [...bulky, { role: 'user', content: 'middle' }, ...pair('mid', 'm'.repeat(1000)), ...recent];
  const saved = pruneToolPayloads(messages, {
    protectTurns: 2,
    protectTokens: 4_000,
    minimumSavings: 5_000,
  });
  assert.equal(saved.changed, true);
  assert.ok(saved.tokensSaved >= 5_000);
  assert.equal(saved.messages.some((message) => message.tool_call_id === 'new' && message.content.includes('nnnn')), true);
  assert.equal(saved.messages.some((message) => message.tool_call_id === 'old-0' && message.content === '[Old tool result cleared]'), true);

  const tiny = pruneToolPayloads(messages, { protectTurns: 2, protectTokens: 4_000, minimumSavings: 1_000_000 });
  assert.equal(tiny.changed, false);
});

test('prune keeps a bounded receipt with the actual read range and changed paths', () => {
  const messages = [
    { role: 'assistant', tool_calls: [
      { id: 'read-1', function: { name: 'read', arguments: '{"path":"src/tool.js"}' } },
      { id: 'edit-1', function: { name: 'edit', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'read-1', content: '[File: src/tool.js, lines 40-75 of 420, truncated]\n' + 'x'.repeat(2000) },
    { role: 'tool', tool_call_id: 'edit-1', content: 'y'.repeat(2000), tool_file_change: { path: 'src/tool.js' } },
  ];
  const options = { protectTokens: 0, minimumSavings: 1 };
  const result = pruneToolPayloads(messages, options);
  assert.match(result.messages[1].content, /Read src\/tool\.js L40-75/);
  assert.match(result.messages[2].content, /Changed src\/tool\.js/);
  assert.equal(pruneToolPayloads(result.messages, options).changed, false);
});

test('prune that cannot reach the target escalates to one summary', async () => {
  const calls = [];
  const tools = Array.from({ length: 8 }, (_, index) => pair(`t-${index}`, `BODY_${index}_${'x'.repeat(8000)}`)).flat();
  const messages = [
    { role: 'user', content: 'first turn' },
    ...tools,
    { role: 'user', content: 'second turn' },
    ...pair('keep', 'KEEP_ME_' + 'k'.repeat(2000)),
  ];
  const result = await compactInFlightMessages(messages, wide, 90_000, {
    generateSummary: async () => {
      calls.push('summary');
      return 'MODEL_SUMMARY of the older work';
    },
  });
  assert.equal(result.changed, true);
  assert.equal(result.mode, 'summary');
  assert.equal(calls.length, 1);
  assert.match(result.messages.find((message) => message.compaction?.kind === 'summary').content, /MODEL_SUMMARY/);
  assert.ok(result.estimatedTokens < 90_000);
  assert.ok(result.afterPct < 60);
});

test('a summary does not retrigger compaction from the stale measurement', async () => {
  const messages = [
    { role: 'user', content: 'goal' },
    ...Array.from({ length: 6 }, (_, index) => pair(`old-${index}`, `OLD_${index}_${'x'.repeat(4000)}`)).flat(),
  ];
  const first = await compactInFlightMessages(messages, wide, 90_000, {
    generateSummary: async () => 'SUMMARY_ONCE',
  });
  assert.equal(first.changed, true);
  assert.equal(first.messages.some((message) => message.compaction?.kind === 'summary'), true);
  const second = await compactInFlightMessages(first.messages, wide, 90_000, {
    generateSummary: async () => {
      throw new Error('summary must not run again');
    },
  });
  assert.equal(second.changed, false);
  assert.equal(second.skipped, 'summary');
});

test('overflow shrink retries with strictly smaller requests and summarizes each prefix once', async () => {
  const calls = [];
  const messages = [
    { role: 'system', content: 'system stays' },
    { role: 'user', content: 'keep going' },
    ...Array.from({ length: 4 }, (_, index) => pair(`old-${index}`, 'x'.repeat(8000), 'y'.repeat(2000))).flat(),
  ];
  const sent = [];
  const events = [];
  const result = await runAgentLoop({
    systemPrompt: '',
    userPrompt: '',
    model: 'test-model',
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: wide,
    initialMessages: messages,
    toolHandlers: { read: async () => ({ text: 'ok' }) },
    requestCompletion: async ({ messages: request }) => {
      sent.push(estimateMessagesTokens(request));
      assert.ok(request.some((message) => message.role === 'user' && message.content === 'keep going'));
      if (sent.length < 3) {
        const error = new Error('This model\'s maximum context length was exceeded');
        error.code = 'context_length_exceeded';
        throw error;
      }
      return { text: 'done', usage: { prompt_tokens: 1000 }, toolCalls: [] };
    },
    generateSummary: async (prefix) => {
      calls.push(prefix.length);
      return 'OVERFLOW_SUMMARY';
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.text, 'done');
  assert.equal(sent.length, 3);
  assert.ok(sent[0] > sent[1] && sent[1] > sent[2]);
  assert.deepEqual(calls, [...new Set(calls)]);
  assert.equal(events.filter((event) => event.type === 'compact:auto').length, 1);
  assert.ok(isContextOverflowError(Object.assign(new Error('maximum context length'), { code: 'context_length_exceeded' })));
  assert.deepEqual(SHRINK_STEPS.slice(0, 2), [0.85, 0.7]);
  assert.equal(result.messages.some((message) => String(message.content || '').includes('OVERFLOW_SUMMARY')), true);
});

test('a checkpoint covers what it removes and keeps the active user request verbatim', async () => {
  const source = [
    { role: 'user', content: 'old ' + 'a'.repeat(2800) },
    { role: 'assistant', content: 'b'.repeat(2200) },
    { role: 'user', content: 'constraint ' + 'c'.repeat(2500) },
    { role: 'assistant', content: 'd'.repeat(1000) },
    { role: 'user', content: 'current request ' + 'e'.repeat(1000) },
  ];
  let summarized;
  const result = await compactInFlightMessages(source, { model: { max_context_tokens: 8000 } }, estimateMessagesTokens(source), {
    force: true,
    targetTokens: 500,
    generateSummary: async (prefix) => {
      summarized = prefix;
      return 'summary '.repeat(350);
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.summaryCalls, 1);
  assert.equal(result.messages[0].compaction.kind, 'summary');
  assert.equal(result.messages.find((message) => message.content === source.at(-1).content)?.role, 'user');
  assert.deepEqual(summarized, source.slice(0, result.boundaryIndex));
  for (const message of source) {
    assert.ok(summarized.includes(message) || result.messages.some((entry) => entry.content === message.content));
  }
});

test('preflight keeps pending input in the projected prompt even when it exceeds the trigger', async () => {
  const config = { model: { max_context_tokens: 8000 } };
  const pending = 7500;
  const source = [
    { role: 'user', content: 'a'.repeat(5000) },
    { role: 'assistant', content: 'b'.repeat(5000) },
    { role: 'user', content: 'recent' },
    { role: 'assistant', content: 'yes' },
  ];
  const result = await compactInFlightMessages(source, config, 0, {
    extraTokens: pending,
    generateSummary: async () => 'summary',
  });
  assert.ok(result.changed);
  assert.equal(result.estimatedTokens, pending + estimateMessagesTokens(result.messages));
  assert.ok(result.estimatedTokens > resolveCompactBudget(config).trigger);
});

test('an oversized or unchanged checkpoint never retries the rejected prompt', async () => {
  const input = [
    { role: 'user', content: 'current request' },
    { role: 'assistant', content: 'x '.repeat(500) },
  ];
  const overflow = new Error('Gateway error 413: Request Entity Too Large');
  let requests = 0;
  const events = [];
  await assert.rejects(runAgentLoop({
    config: { memory: { enabled: false }, model: { max_context_tokens: 8000 } },
    model: 'test-model',
    initialMessages: input,
    skipAnalysisNudge: true,
    requestCompletion: async () => {
      requests += 1;
      throw overflow;
    },
    generateSummary: async () => 'too large '.repeat(3000),
    onEvent: (event) => events.push(event),
  }), (error) => error === overflow);
  assert.equal(requests, 1);
  assert.equal(events.filter((event) => event.type === 'compact:auto').length, 0);
  assert.equal(events.filter((event) => event.type === 'compact:skipped').length, 1);
});

test('a long turn compacts at most twice and then stays under the target', async () => {
  const budget = resolveCompactBudget(wide);
  const bulky = Array.from({ length: 10 }, (_, index) => pair(`seed-${index}`, 's'.repeat(12_000))).flat();
  const compacts = [];
  const captured = [];
  let steps = 0;
  const result = await runAgentLoop({
    systemPrompt: 'system',
    userPrompt: 'work',
    model: 'test-model',
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: wide,
    initialMessages: bulky,
    toolHandlers: { read: async () => ({ text: 'step-output-' + 'z'.repeat(4000) }) },
    requestCompletion: async ({ messages }) => {
      steps += 1;
      const estimated = estimateMessagesTokens(messages);
      if (steps < 7) {
        return {
          text: '',
          usage: { prompt_tokens: steps === 1 ? 90_000 : estimated },
          toolCalls: [{ id: `live-${steps}`, name: 'read', arguments: '{}' }],
        };
      }
      return { text: 'done', usage: { prompt_tokens: estimated }, toolCalls: [] };
    },
    onEvent: (event) => {
      if (event.type === 'compact:start' || event.type === 'compact:auto') captured.push(event);
    },
  });
  assert.equal(result.text, 'done');
  assert.equal(steps, 7);
  for (const event of captured) {
    if (event.type === 'compact:auto') compacts.push(event);
  }
  for (let index = 0; index < captured.length; index += 1) {
    if (captured[index].type !== 'compact:auto') continue;
    assert.equal(captured[index - 1]?.type, 'compact:start');
  }
  assert.ok(compacts.length >= 1 && compacts.length <= 2, `compacted ${compacts.length} times`);
  assert.equal(captured.filter((event) => event.type === 'compact:start').length, compacts.length);
  const last = compacts[compacts.length - 1];
  assert.ok(last.afterPct < last.beforePct);
  assert.ok(last.estimatedTokens < budget.trigger);
  assert.match(last.summary, /已压缩上下文/);
  assert.match(last.summaryEn, /Context compacted/);
});
