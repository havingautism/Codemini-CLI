import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadHarnessFixture } from '../src/core/harness/eval/fixture-loader.js';

test('fixture loader validates id and supplies stable defaults', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-fixture-'));
  const file = path.join(dir, 'fixture.json');
  try {
    await fs.writeFile(file, JSON.stringify({ id: 'f-1', state: { stage: 'act' } }), 'utf8');
    const fixture = await loadHarnessFixture(file);
    assert.equal(fixture.id, 'f-1');
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.expected, {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
