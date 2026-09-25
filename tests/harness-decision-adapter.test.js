import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredDecisionProviders, createDecisionAdapter } from '../src/core/harness/decision-adapter.js';

test('adapter falls back to rules when provider is unavailable', async () => {
  const adapter = createDecisionAdapter({ provider: 'missing' });
  const result = await adapter.ask({ state: {} });
  assert.equal(result.provider, 'rules');
  assert.ok(Array.isArray(result.answers));
});

test('selected decision provider works without a second enable switch', () => {
  const config = {
    jev: { enabled: false, baseUrl: 'https://example.test/jev' },
    laya: { enabled: false, baseUrl: 'http://127.0.0.1:8765' },
  };
  const jev = createConfiguredDecisionProviders(config, 'jev');
  assert.equal(jev.jev?.name, 'jev');
  assert.equal(jev.laya, null);
  const laya = createConfiguredDecisionProviders(config, 'laya');
  assert.equal(laya.jev, null);
  assert.equal(laya.laya?.name, 'laya');
});
