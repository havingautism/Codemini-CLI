import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig, setConfigValue } from '../src/core/config-store.js';

async function withTempConfigDir(run) {
  const prev = process.env.CODEMINI_CONFIG_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-config-'));
  process.env.CODEMINI_CONFIG_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.CODEMINI_CONFIG_DIR;
    } else {
      process.env.CODEMINI_CONFIG_DIR = prev;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('config defaults reply language to zh and normalizes supported values', async () => {
  await withTempConfigDir(async () => {
    const initial = await loadConfig();
    assert.equal(initial.ui.reply_language, 'zh');

    await setConfigValue('ui.reply_language', 'english');
    const englishConfig = await loadConfig();
    assert.equal(englishConfig.ui.reply_language, 'en');

    await setConfigValue('ui.reply_language', '中文');
    const chineseConfig = await loadConfig();
    assert.equal(chineseConfig.ui.reply_language, 'zh');
  });
});
