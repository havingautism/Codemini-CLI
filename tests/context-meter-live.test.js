import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRuntimeStateSnapshot } from '../src/core/chat-runtime.js';

const config = { model: { name: 'm', max_context_tokens: 100000 }, context: {}, execution: {} };
const at = (s) => new Date(Date.UTC(2026, 10, 26, 0, 0, s)).toISOString();

test('CTX meter follows in-turn usage after a compact view exists', () => {
  const messages = [
    { role: 'user', content: 'old', at: at(0) },
    { role: 'assistant', content: 'old reply', at: at(1), usage: { inputTokens: 10000, outputTokens: 10 } },
    { role: 'user', content: 'new turn', at: at(2) },
  ];
  const session = {
    id: 's',
    messages,
    compact: {
      view: [
        { role: 'user', content: '<conversation-checkpoint>x</conversation-checkpoint>', compaction: { kind: 'summary' } },
        { ...messages[1], compact_source_index: 1 },
        { ...messages[2], compact_source_index: 2 },
      ],
      estimatedTokens: 8000,
      estimatedAt: Date.parse(at(1)) + 500,
    },
  };
  // The agent loop streams new steps into session.messages only; the view is rewritten at turn end.
  messages.push(
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }], at: at(3), usage: { inputTokens: 42000, outputTokens: 5 } },
    { role: 'tool', tool_call_id: 'c1', content: 'result', at: at(4) },
  );
  const state = buildRuntimeStateSnapshot({ currentSession: session, config, executionMode: 'normal', workspaceRoot: '/tmp' });
  assert.equal(state.currentContextTokens, 42000);
  assert.equal(Math.round(state.contextUsagePct), 42);
  assert.equal(state.contextUsageSource, 'actual');
});
