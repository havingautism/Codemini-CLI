import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebConfigReadOnly, validateWebConfigValue } from '../codemini-web/shared/web-config-policy.js';
import { assertWebConfigWritable } from '../codemini-web/lib/web-security.js';
import { getDecisionProviderStatus } from '../codemini-web/client/src/lib/decision-provider-status.js';

test('task decisions require the selected external provider to be configured', () => {
  assert.equal(getDecisionProviderStatus({ provider: 'rules' }).ready, true);
  assert.deepEqual(getDecisionProviderStatus({ provider: 'jev' }), { ready: false, reason: 'missing_url' });
  assert.deepEqual(getDecisionProviderStatus({ provider: 'jev', baseUrl: 'https://example.test/decisions' }), { ready: false, reason: 'missing_key' });
  assert.equal(getDecisionProviderStatus({ provider: 'jev', baseUrl: 'https://example.test/decisions', hasApiKey: true }).ready, true);
  assert.equal(getDecisionProviderStatus({ provider: 'laya', baseUrl: 'http://127.0.0.1:8765' }).ready, true);
  assert.equal(getDecisionProviderStatus({ provider: 'laya', baseUrl: 'file:///tmp/decide' }).reason, 'invalid_url');
});

test('execution limits are editable only at exact keys with bounded integer values', () => {
  for (const [key, min, max] of [['execution.max_steps', 1, 1000], ['execution.incomplete_retries', 0, 10]]) {
    assert.equal(isWebConfigReadOnly(key), false);
    assert.doesNotThrow(() => assertWebConfigWritable(key));
    for (const value of [min, max]) assert.doesNotThrow(() => validateWebConfigValue(key, value));
    for (const value of [min - 1, max + 1, 1.5, null, '', '500', {}, Infinity]) assert.throws(() => validateWebConfigValue(key, value));
  }
  for (const key of ['execution', 'execution.approval_mode', 'execution.max_steps.value', 'sandbox.network', 'webui.terminal_enabled', 'policy.safe_mode', 'execution.__proto__.max_steps']) {
    assert.throws(() => assertWebConfigWritable(key), undefined, key);
  }
});

test('settings show new limits and security status with matching defaults and ranges in both languages', async t => {
  const previousStorage = globalThis.localStorage;
  const previousDocument = globalThis.document;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.document = { documentElement: {} };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
  const { buildSettingsFields } = await import('../codemini-web/client/src/lib/settings-config.js');
  const { setLocale } = await import('../codemini-web/client/i18n/index.js');
  for (const locale of ['zh', 'en']) {
    setLocale(locale);
    const fields = buildSettingsFields();
    const steps = fields.find(f => f.path === 'execution.max_steps');
    assert.equal(steps.tab, 'execution'); assert.equal(steps.min, 1); assert.equal(steps.max, 1000); assert.equal(steps.placeholder, '500');
    const retries = fields.find(f => f.path === 'execution.incomplete_retries');
    assert.equal(retries.min, 0); assert.equal(retries.max, 10); assert.equal(retries.placeholder, '3');
    for (const key of ['sandbox.network', 'webui.terminal_enabled']) {
      const field = fields.find(f => f.path === key);
      assert.equal(field.tab, 'execution'); assert.equal(isWebConfigReadOnly(key), true);
      assert.match(field.cliExample, /^codemini config set /);
      assert.ok(field.help.length > 20);
    }
    assert.ok(fields.some(f => f.path === 'model.fast_name'));
    for (const key of [
      'harness.provider',
      'harness.providers.jev.base_url',
      'harness.providers.jev.api_key', 'harness.providers.jev.model',
      'harness.providers.laya.base_url', 'harness.providers.laya.model',
      'jev.enabled', 'jev.api_key', 'jev.model',
    ]) {
      assert.equal(fields.find(f => f.path === key)?.tab, 'model', key);
    }
    for (const key of ['harness.enabled', 'harness.decision_mode', 'harness.rollout.enabled']) {
      assert.equal(fields.find(f => f.path === key)?.tab, 'harness', key);
    }
    assert.notEqual(fields.find(f => f.path === 'harness.providers.jev.api_key')?.label, fields.find(f => f.path === 'jev.api_key')?.label);
    assert.equal(fields.find(f => f.path === 'harness.provider')?.control, 'select');
    assert.equal(fields.some(f => f.path === 'harness.providers.jev.enabled' || f.path === 'harness.providers.laya.enabled'), false);
    for (const provider of ['rules', 'jev', 'laya']) {
      const getValue = (path) => path === 'harness.provider' ? provider : false;
      for (const name of ['jev', 'laya']) {
        for (const field of fields.filter(f => f.path.startsWith(`harness.providers.${name}.`))) {
          assert.equal(field.visibleWhen({ getValue }), provider === name, `${provider}: ${field.path}`);
        }
      }
    }
    for (const key of ['jev.api_key', 'jev.model']) {
      const field = fields.find(f => f.path === key);
      assert.equal(field.visibleWhen({ getValue: () => false }), false);
      assert.equal(field.visibleWhen({ getValue: () => true }), true);
    }
  }
});
