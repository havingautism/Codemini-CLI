import test from 'node:test';
import assert from 'node:assert/strict';
import { publicConfig } from '../codemini-web/lib/web-security.js';
import { hasConfiguredSecret, secretSettingWrite } from '../codemini-web/client/src/lib/secret-settings.js';

test('secret fields read only presence flags across gateway and search providers', () => {
  const raw = { gateway: { api_key: 'test-key' }, web: { tavily_api_key: 'test-key', exa_api_key: '', firecrawl_api_key: 'test-key', search_api_key: 'test-key' } };
  const config = publicConfig(raw);
  for (const path of ['gateway.api_key', 'web.tavily_api_key', 'web.firecrawl_api_key', 'web.search_api_key']) assert.equal(hasConfiguredSecret(config, path), true);
  assert.equal(hasConfiguredSecret(config, 'web.exa_api_key'), false);
  assert.equal(hasConfiguredSecret({}, 'gateway.api_key'), false);
  assert.equal(hasConfiguredSecret(raw, 'gateway.api_key'), false);
  assert.ok(!JSON.stringify(config).includes('test-key'));
});

test('blank drafts preserve secrets while explicit removal and replacement are distinct', () => {
  for (const value of [undefined, '', '  ', '\n']) assert.equal(secretSettingWrite(value), undefined);
  assert.equal(secretSettingWrite(null), '');
  assert.equal(secretSettingWrite(' new-key '), 'new-key');
});
