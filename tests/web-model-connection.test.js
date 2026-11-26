import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../codemini-web/shared/gateway-provider-catalog.json' with { type: 'json' };
import { modelConnectionChanged, validateModelConnection, validatePresetConnection } from '../codemini-web/shared/web-config-policy.js';
import { gatewaySessionHeaders } from '../src/core/provider/gateway-session-headers.js';
import { withTokenUsageSession } from '../src/core/token-usage-context.js';

test('a provider preset locks the protocol and endpoint while allowing a custom model ID', () => {
  const preset = catalog.providers.find(({ id }) => id === 'deepseek');
  const config = { gateway: { preset: preset.id, base_url: preset.baseUrl }, sdk: { provider: preset.protocol } };
  const manualModel = { 'model.name': 'new-model-id' };
  assert.doesNotThrow(() => validatePresetConnection(config, manualModel, catalog.providers));
  assert.throws(() => validatePresetConnection(config, { 'gateway.base_url': 'https://example.invalid/v1' }, catalog.providers), /Custom connection/);
  assert.throws(() => validatePresetConnection(config, { 'sdk.provider': 'anthropic' }, catalog.providers), /Custom connection/);
  assert.doesNotThrow(() => validatePresetConnection(config, {
    'gateway.preset': 'custom', 'gateway.base_url': 'https://example.invalid/v1',
  }, catalog.providers));
  assert.equal(modelConnectionChanged(config, { 'gateway.base_url': `${preset.baseUrl}/` }), false);
  assert.equal(modelConnectionChanged(config, { 'sdk.provider': 'anthropic' }), true);
});

test('connection updates disallow unrelated settings and URLs with embedded credentials', () => {
  assert.throws(() => validateModelConnection({ 'policy.safe_mode': 'false' }));
  assert.throws(() => validateModelConnection({ 'gateway.base_url': 'https://key@example.invalid' }));
  assert.throws(() => validateModelConnection({ 'sdk.provider': 'responses' }));
  assert.deepEqual(validateModelConnection({ 'gateway.api_key': '' }), [['gateway.api_key', '']]);
});

test('OpenCode Go receives a stable session header without forwarding it to other gateways', () => {
  withTokenUsageSession('test-session', () => {
    assert.deepEqual(gatewaySessionHeaders('https://opencode.ai/inference/go/openai/v1'), { 'x-opencode-session': 'test-session' });
    assert.deepEqual(gatewaySessionHeaders('https://opencode.ai/inference/go/anthropic'), { 'x-opencode-session': 'test-session' });
    assert.deepEqual(gatewaySessionHeaders('https://opencode.ai/inference/openai/v1'), {});
    assert.deepEqual(gatewaySessionHeaders('https://opencode.ai.example.invalid/inference/go/openai/v1'), {});
  });
});
