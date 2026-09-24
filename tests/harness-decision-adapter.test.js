import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionAdapter } from '../src/core/harness/decision-adapter.js';

test('adapter falls back to rules when provider is unavailable', async () => {
  const adapter = createDecisionAdapter({ provider: 'missing' });
  const result = await adapter.ask({ state: {} });
  assert.equal(result.provider, 'rules');
  assert.ok(Array.isArray(result.answers));
});
