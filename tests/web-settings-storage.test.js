import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('settings exposes a lazy storage tab with folder-open actions', async () => {
  const [dialog, options, storage, api, server] = await Promise.all([
    fs.readFile('codemini-web/client/src/components/ConfigDialog.jsx', 'utf8'),
    fs.readFile('codemini-web/client/src/lib/settings-options.js', 'utf8'),
    fs.readFile('codemini-web/client/src/components/settings/SettingsStorage.jsx', 'utf8'),
    fs.readFile('codemini-web/client/src/hooks/use-api.js', 'utf8'),
    fs.readFile('codemini-web/server.js', 'utf8'),
  ]);

  assert.match(options, /id:\s*"storage"/);
  assert.match(dialog, /<SettingsStorage active=\{activeTab === "storage"\}/);
  assert.match(storage, /if \(!active\) return/);
  assert.match(storage, /api\.openStorageFolder\(target\)/);
  assert.match(api, /fetchStorageInfo/);
  assert.match(api, /openStorageFolder/);
  assert.match(server, /url\.pathname === ["']\/api\/storage["']/);
  assert.match(server, /url\.pathname === ["']\/api\/storage\/open["']/);
});
