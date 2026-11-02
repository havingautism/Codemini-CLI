import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BUNDLED_SOULS_DIR,
  buildSystemPromptWithSoul,
  getActiveSoulName,
  listSouls,
  loadSoulPrompt,
  readSoulContent,
  soulContextFromExecutionMode,
} from '../src/core/soul.js';

test('soulContextFromExecutionMode maps plan/code to coding', () => {
  assert.equal(soulContextFromExecutionMode('plan'), 'coding');
  assert.equal(soulContextFromExecutionMode('code'), 'coding');
  assert.equal(soulContextFromExecutionMode('normal'), 'daily');
  assert.equal(soulContextFromExecutionMode('crew'), 'coding');
});

test('getActiveSoulName prefers category then legacy preset', () => {
  assert.equal(getActiveSoulName({ soul: { coding: 'Ponytail', daily: 'Anime' } }, 'coding'), 'Ponytail');
  assert.equal(getActiveSoulName({ soul: { coding: 'Ponytail', daily: 'Anime' } }, 'daily'), 'Anime');
  assert.equal(getActiveSoulName({ soul: { preset: 'CEO' } }, 'coding'), 'CEO');
  assert.equal(getActiveSoulName({ soul: {} }, 'daily'), 'Default');
  assert.equal(getActiveSoulName({ soul: { daily: 'Playful' } }, 'daily'), 'Playful');
});

test('bundled souls live under coding/ and daily/', async () => {
  const coding = await fs.readdir(path.join(BUNDLED_SOULS_DIR, 'coding'));
  const daily = await fs.readdir(path.join(BUNDLED_SOULS_DIR, 'daily'));
  assert.ok(coding.includes('Ponytail.md'));
  assert.ok(coding.includes('Caveman.md'));
  assert.ok(daily.includes('Tsundere.md'));
  assert.ok(daily.includes('Chaos.md'));
  assert.ok(daily.includes('Default.md'));
});

test('Default resolves in each category and daily fallback keeps the daily guard', async () => {
  for (const category of ['daily', 'coding']) {
    const content = await readSoulContent('Default', { preferCategory: category });
    assert.equal(content.category, category);
    const loaded = await loadSoulPrompt({ soul: { [category]: 'Default' } }, { context: category });
    assert.equal(loaded.category, category);
    assert.equal(loaded.name, 'Default');
  }
  const prompt = await buildSystemPromptWithSoul('BASE', { soul: { daily: 'missing-preset' } }, { context: 'daily' });
  assert.match(prompt, /Soul preset: Default · daily/);
  assert.match(prompt, /tone and personality only/);
  assert.doesNotMatch(prompt, /coding approach/);
});

test('every bundled Soul loads with exactly one guard for its own category', async () => {
  const presets = (await listSouls()).filter(item => item.scope === 'builtin');
  for (const { name, category } of presets) {
    const prompt = await buildSystemPromptWithSoul('BASE', { soul: { [category]: name } }, { context: category });
    assert.equal(prompt.split('[Soul guard]').length - 1, 1, `${category}/${name}`);
    assert.ok(prompt.includes(`[Soul preset: ${name} · ${category}]`), `${category}/${name}`);
    assert.match(prompt, category === 'daily' ? /tone and personality only/ : /coding approach/);
  }
});

test('listSouls tags categories and active flags', async () => {
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-souls-'));
  process.env.CODEMINI_GLOBAL_DIR = tmp;
  try {
    const souls = await listSouls({
      soul: { coding: 'Ponytail', daily: 'Soft' },
    });
    const ponytail = souls.find((item) => item.name === 'Ponytail');
    const soft = souls.find((item) => item.name === 'Soft');
    assert.equal(ponytail?.category, 'coding');
    assert.equal(ponytail?.active, true);
    assert.equal(soft?.category, 'daily');
    assert.equal(soft?.active, true);
  } finally {
    if (prev === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('loadSoulPrompt + guard differ by category', async () => {
  const coding = await loadSoulPrompt(
    { soul: { coding: 'Caveman', daily: 'Playful' } },
    { context: 'coding' },
  );
  const daily = await loadSoulPrompt(
    { soul: { coding: 'Caveman', daily: 'Playful' } },
    { context: 'daily' },
  );
  assert.match(coding.prompt, /caveman/i);
  assert.equal(coding.category, 'coding');
  assert.match(daily.prompt, /witty|playful|cheeky/i);
  assert.equal(daily.category, 'daily');

  const codingPrompt = await buildSystemPromptWithSoul('BASE', {
    soul: { coding: 'Ponytail' },
  }, { context: 'coding' });
  const dailyPrompt = await buildSystemPromptWithSoul('BASE', {
    soul: { daily: 'Soft' },
  }, { context: 'daily' });
  assert.match(codingPrompt, /coding approach/i);
  assert.match(dailyPrompt, /tone and personality only/i);
});
