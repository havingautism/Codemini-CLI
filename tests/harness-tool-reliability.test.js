import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolReliabilityStore, rankToolDefinitions } from '../src/core/harness/tool-reliability.js';

test('tool reliability learns failures by category and smooths probability', () => {
  const calls = [];
  const db = { prepare(sql) {
    return { run(...args) { calls.push({ sql, args }); }, get() { return { tool_name: 'run', successes: 0, failures: 2, timeouts: 1, permission_errors: 0, last_error: 'timeout', updated_at: '' }; }, all() { return []; } };
  } };
  const store = createToolReliabilityStore({ db });
  const row = store.record({ toolName: 'run', ok: false, error: 'timeout' });
  assert.equal(row.reliability, 0.2);
  assert.match(calls[0].sql, /timeouts/);
});

test('tool definitions expose learned reliability to the model', () => {
  const defs = [{ type: 'function', function: { name: 'run', description: 'run command' } }];
  const ranked = rankToolDefinitions(defs, [{ tool_name: 'run', reliability: 0.2, successes: 1, failures: 4, timeouts: 0, permission_errors: 0, last_error: 'timeout' }]);
  assert.match(ranked[0].function.description, /可靠性 20%/);
  assert.match(ranked[0].function.description, /最近原因：timeout/);
});
