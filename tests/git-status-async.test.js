import test from 'node:test';
import assert from 'node:assert/strict';

import { createGitInfoReader } from '../codemini-web/lib/git-status.js';

test('concurrent git status reads for the same project share one in-flight request', async () => {
  let calls = 0;
  let release;
  const loader = async (cwd, options) => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
    return { isGit: true, branch: 'main', cwd, includeCounts: options.includeCounts };
  };
  const read = createGitInfoReader({ loader, ttlMs: 1000 });

  const first = read('E:\\repo', { includeCounts: true });
  const second = read('E:\\repo', { includeCounts: true });
  assert.equal(calls, 1);
  release();

  assert.deepEqual(await first, await second);
  await read('E:\\repo', { includeCounts: true });
  assert.equal(calls, 1);
});

test('git status cache separates detailed and branch-only reads', async () => {
  let calls = 0;
  const read = createGitInfoReader({
    loader: async (_cwd, options) => ({ call: ++calls, includeCounts: options.includeCounts }),
    ttlMs: 1000,
  });

  const detailed = await read('E:\\repo', { includeCounts: true });
  const branchOnly = await read('E:\\repo', { includeCounts: false });
  assert.equal(detailed.call, 1);
  assert.equal(branchOnly.call, 2);
});
