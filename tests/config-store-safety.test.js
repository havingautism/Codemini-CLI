import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig, saveConfig, setConfigValue } from '../src/core/config-store.js';

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
    assert.equal(config.memory.bootstrap.max_tokens, 600);
    assert.equal(config.memory.retrieval.max_tokens, 1000);
    assert.equal(config.memory.recovery.max_tokens, 500);
    assert.equal(config.memory.retrieval.query_expansion, true);
    assert.deepEqual(config.harness.distillation, {
      memory_enabled: false, skill_enabled: false, mode: 'shadow', confidence_threshold: 0.8, max_candidates: 8,
    });
  });
});

test('distillation settings survive config reload and malformed limits fall back safely', async () => {
  await withConfigDir(async () => {
    const config = await loadConfig();
    config.harness.distillation = { memory_enabled: true, skill_enabled: true, mode: 'filter', confidence_threshold: 0.9, max_candidates: 12 };
    await saveConfig(config);
    assert.deepEqual((await loadConfig()).harness.distillation, config.harness.distillation);
    config.harness.distillation = { memory_enabled: 'true', mode: 'invalid', confidence_threshold: 'NaN', max_candidates: -3 };
    await saveConfig(config);
    const reloaded = (await loadConfig()).harness.distillation;
    assert.equal(reloaded.memory_enabled, false);
    assert.equal(reloaded.mode, 'shadow');
    assert.equal(reloaded.confidence_threshold, 0.8);
    assert.equal(reloaded.max_candidates, 1);
  });
});

test('paused task assistant stays disabled for existing configs and config updates', async () => {
  await withConfigDir(async ({ configPath }) => {
    const raw = JSON.stringify({ harness: { enabled: true, provider: 'jev',
      providers: { jev: { base_url: 'https://example.com', api_key: 'test-key' } },
      distillation: { memory_enabled: true, skill_enabled: true } } });
    await fs.writeFile(configPath, raw, 'utf8');
    const config = await loadConfig();
    assert.equal(config.harness.enabled, false);
    assert.equal(config.harness.providers.jev.api_key, 'test-key');
    assert.equal(config.harness.distillation.memory_enabled, true);
    assert.equal(await fs.readFile(configPath, 'utf8'), raw);
    await setConfigValue('harness.enabled', true);
    assert.equal((await loadConfig()).harness.enabled, false);
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

test('a skill named prototype survives loading and config updates without rewriting the original', async () => {
  await withConfigDir(async ({ configPath }) => {
    const raw = JSON.stringify({ skills: { enabled: { prototype: true }, contexts: { prototype: ['coding'] } } });
    await fs.writeFile(configPath, raw, 'utf8');
    const config = await loadConfig();
    assert.equal(config.skills.enabled.prototype, true);
    assert.deepEqual(config.skills.contexts.prototype, ['coding']);
    assert.equal(await fs.readFile(configPath, 'utf8'), raw);

    await setConfigValue('skills.enabled.prototype', false);
    await setConfigValue('skills.contexts.prototype', '["daily"]');
    await setConfigValue('skills.enabled', '{"prototype":true}');
    const updated = await loadConfig();
    assert.equal(updated.skills.enabled.prototype, true);
    assert.deepEqual(updated.skills.contexts.prototype, ['daily']);
  });
});

test('skill name exception does not permit prototype pollution or nested unsafe keys', async () => {
  await withConfigDir(async ({ configPath }) => {
    for (const raw of [
      '{"skills":{"enabled":{"__proto__":{"polluted":true}}}}',
      '{"skills":{"enabled":{"constructor":{"prototype":{"polluted":true}}}}}',
      '{"skills":{"contexts":{"prototype":{"__proto__":{"polluted":true}}}}}',
      '{"gateway":{"prototype":true}}',
    ]) {
      await fs.writeFile(configPath, raw, 'utf8');
      await assert.rejects(loadConfig(), /Invalid configuration key:/);
      assert.equal(await fs.readFile(configPath, 'utf8'), raw);
    }
    await fs.writeFile(configPath, '{}', 'utf8');
    await assert.rejects(setConfigValue('skills.contexts.prototype', '{"__proto__":{"polluted":true}}'), /Invalid configuration/);
    await assert.rejects(setConfigValue('skills.enabled.prototype.constructor', true), /Invalid configuration/);
    assert.equal(Object.prototype.polluted, undefined);
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

test('creating defaults stays in its original directory when the environment changes during IO', async () => {
  await withConfigDir(async ({ dir }) => {
    const a = path.join(dir, 'missing');
    const b = path.join(dir, 'configured');
    await fs.mkdir(a);
    await fs.mkdir(b);
    const protectedConfig = { gateway: { base_url: 'https://provider.example', api_key: 'keep-secret' } };
    await fs.writeFile(path.join(b, 'config.json'), JSON.stringify(protectedConfig));
    const read = fs.readFile;
    fs.readFile = async (file, ...args) => {
      if (file === path.join(a, 'config.json')) {
        process.env.CODEMINI_GLOBAL_DIR = b;
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      return read(file, ...args);
    };
    try {
      process.env.CODEMINI_GLOBAL_DIR = a;
      await loadConfig();
      assert.deepEqual(JSON.parse(await read(path.join(b, 'config.json'), 'utf8')), protectedConfig);
      assert.ok(JSON.parse(await read(path.join(a, 'config.json'), 'utf8')).gateway);
    } finally { fs.readFile = read; }
  });
});

test('config cache is keyed by path even when files have equal size and modification time', async () => {
  await withConfigDir(async ({ dir }) => {
    const timestamp = new Date('2026-01-01T00:00:00Z');
    for (const name of ['a', 'b']) {
      const target = path.join(dir, name);
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, 'config.json'), JSON.stringify({ gateway: { api_key: `secret-${name}` } }));
      await fs.utimes(path.join(target, 'config.json'), timestamp, timestamp);
    }
    process.env.CODEMINI_GLOBAL_DIR = path.join(dir, 'a');
    assert.equal((await loadConfig()).gateway.api_key, 'secret-a');
    process.env.CODEMINI_GLOBAL_DIR = path.join(dir, 'b');
    assert.equal((await loadConfig()).gateway.api_key, 'secret-b');
  });
});

test('read-modify-write config updates cannot cross directories during an environment change', async () => {
  await withConfigDir(async ({ dir }) => {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    for (const target of [a, b]) {
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, 'config.json'), JSON.stringify({ gateway: { api_key: target === a ? 'a-secret' : 'b-secret' } }));
    }
    const read = fs.readFile;
    fs.readFile = async (file, ...args) => {
      const result = await read(file, ...args);
      if (file === path.join(a, 'config.json')) process.env.CODEMINI_GLOBAL_DIR = b;
      return result;
    };
    try {
      process.env.CODEMINI_GLOBAL_DIR = a;
      await setConfigValue('model.name', 'selected-model');
      assert.equal(JSON.parse(await read(path.join(a, 'config.json'), 'utf8')).model.name, 'selected-model');
      assert.deepEqual(JSON.parse(await read(path.join(b, 'config.json'), 'utf8')), { gateway: { api_key: 'b-secret' } });
    } finally { fs.readFile = read; }
  });
});
