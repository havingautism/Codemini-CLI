import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig, saveConfig } from '../src/core/config-store.js';

async function withConfigDir(task) {
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-config-safety-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    await task({ dir, configPath: path.join(dir, 'config.json') });
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('new config defaults memory retrieval min score to 0.6', async () => {
  await withConfigDir(async () => {
    const config = await loadConfig();
    assert.equal(config.memory.retrieval.min_score, 0.6);
  });
});

test('malformed config is preserved instead of being replaced with defaults', async () => {
  await withConfigDir(async ({ configPath }) => {
    const malformed = '{"gateway":{"api_key":"keep-me"';
    await fs.writeFile(configPath, malformed, 'utf8');

    await assert.rejects(loadConfig(), /Failed to parse configuration/);
    assert.equal(await fs.readFile(configPath, 'utf8'), malformed);
  });
});

test('saving config atomically keeps the previous valid file as a backup', async () => {
  await withConfigDir(async ({ dir, configPath }) => {
    const previous = { gateway: { base_url: 'https://old.example/v1', api_key: 'old-secret' } };
    const next = { gateway: { base_url: 'https://new.example/v1', api_key: 'new-secret' } };
    await fs.writeFile(configPath, `${JSON.stringify(previous)}\n`, 'utf8');

    await saveConfig(next);

    assert.deepEqual(JSON.parse(await fs.readFile(configPath, 'utf8')), next);
    assert.deepEqual(JSON.parse(await fs.readFile(`${configPath}.bak`, 'utf8')), previous);
    assert.deepEqual((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp')), []);
  });
});
