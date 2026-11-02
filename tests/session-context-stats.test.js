import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionContextStats, tokenSegments } from '../codemini-web/client/src/lib/session-context-stats.js';

test('token breakdown counts cache as input subsets, preserves total-only reports and handles empty data', () => {
  const segments = tokenSegments({ inputTokens: 100, cachedInputTokens: 60, cacheWriteInputTokens: 10, outputTokens: 20, totalTokens: 120 });
  assert.deepEqual(segments.map((s) => s.value), [30, 60, 10, 20, 0]);
  assert.equal(segments.reduce((sum, s) => sum + s.value, 0), 120);
  assert.equal(tokenSegments({ totalTokens: 50 })[4].value, 50);
  assert.ok(tokenSegments({ inputTokens: 10, cachedInputTokens: 100, cacheWriteInputTokens: 100 }).every((s) => s.value >= 0));
  assert.ok(tokenSegments({}).every((s) => s.value === 0));
});

test('transcript statistics count tools and distinguish missing, running, and zero durations', () => {
  const stats = buildSessionContextStats([
    { id: 'u', role: 'you', text: 'hello' },
    { id: 'a', role: 'agent', segments: [
      { type: 'tools', cards: [
        { id: '1', name: 'read', status: 'done', durationMs: 0 },
        { id: '2', name: 'read', status: 'done', durationMs: 100 },
        { id: '3', name: 'run', status: 'running', durationMs: 500 },
        { id: '4', name: 'run', status: 'done' },
      ] },
      { type: 'skill', name: 'explore' },
    ] },
  ]);
  assert.equal(stats.turns, 1);
  assert.equal(stats.calls, 4);
  assert.equal(stats.skills, 1);
  assert.equal(stats.timedTools, 2);
  assert.equal(stats.toolDurationMs, 100);
  assert.deepEqual(stats.tools, [{ name: 'read', count: 2 }, { name: 'run', count: 2 }]);
  assert.equal(buildSessionContextStats([]).toolDurationMs, null);
});
