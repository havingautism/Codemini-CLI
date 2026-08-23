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

test('settings expose a Memory tab with embedding fields', async () => {
  assert.ok(SETTINGS_TABS.some((tab) => tab.id === 'memory'));
  const fields = buildSettingsFields();
  const paths = fields.filter((field) => field.tab === 'memory').map((field) => field.path);
  assert.deepEqual(paths, [
    'memory.embedding.enabled',
    'memory.embedding.model',
    'memory.embedding.base_url',
  ]);
  const en = await fs.readFile('codemini-web/client/i18n/en.js', 'utf8');
  const zh = await fs.readFile('codemini-web/client/i18n/zh.js', 'utf8');
  for (const source of [en, zh]) {
    assert.match(source, /memoryEmbeddingEnabled:/);
    assert.match(source, /memoryEmbeddingModel:/);
    assert.match(source, /memoryEmbeddingBaseUrl:/);
  }
});
