import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig, setConfigValue } from '../src/core/config-store.js';

async function withTempConfigDir(run) {
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-global-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.CODEMINI_GLOBAL_DIR;
    } else {
      process.env.CODEMINI_GLOBAL_DIR = prev;
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

test('loadConfig creates the default global config file on first initialization', async () => {
  await withTempConfigDir(async (dir) => {
    const configPath = path.join(dir, 'config.json');

    await assert.rejects(() => fs.access(configPath));

    const initial = await loadConfig();
    assert.equal(initial.ui.reply_language, 'zh');
    assert.equal(initial.gateway.timeout_ms, 1800000);
    assert.equal(initial.shell.timeout_ms, 1800000);

    const raw = await fs.readFile(configPath, 'utf8');
    const persisted = JSON.parse(raw);
    assert.equal(persisted.ui.reply_language, 'zh');
    assert.equal(persisted.execution.mode, 'auto');
    assert.equal(persisted.gateway.timeout_ms, 1800000);
    assert.equal(persisted.shell.timeout_ms, 1800000);
  });
});

test('config defaults sdk provider to openai-compatible and persists anthropic override', async () => {
  await withTempConfigDir(async () => {
    const initial = await loadConfig();
    assert.equal(initial.sdk.provider, 'openai-compatible');
    assert.equal(initial.memory.enabled, true);
    assert.equal(initial.memory.auto_write, true);
    assert.equal(initial.memory.auto_capture, true);
    assert.equal(initial.memory.inject_on_session_start, true);

    await setConfigValue('sdk.provider', 'anthropic');
    const updated = await loadConfig();
    assert.equal(updated.sdk.provider, 'anthropic');
  });
});
