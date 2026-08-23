import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { SETTINGS_TABS } = await import(
  '../codemini-web/client/src/lib/settings-options.js'
);
const { buildSettingsFields } = await import(
  '../codemini-web/client/src/lib/settings-config.js'
);

test('settings do not expose a Memory embedding tab or fields', async () => {
  assert.equal(SETTINGS_TABS.some((tab) => tab.id === 'memory'), false);
  const fields = buildSettingsFields();
  assert.equal(fields.some((field) => field.tab === 'memory' || String(field.path || '').startsWith('memory.embedding.')), false);
  const en = await fs.readFile('codemini-web/client/i18n/en.js', 'utf8');
  const zh = await fs.readFile('codemini-web/client/i18n/zh.js', 'utf8');
  for (const source of [en, zh]) {
    assert.doesNotMatch(source, /memoryEmbeddingEnabled:/);
    assert.doesNotMatch(source, /memoryEmbeddingModel:/);
    assert.doesNotMatch(source, /memoryEmbeddingBaseUrl:/);
    assert.doesNotMatch(source, /memoryEmbeddingApiKey:/);
  }
});
