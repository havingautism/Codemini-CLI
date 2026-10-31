import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildLandMergeConflict,
  buildMainWorktreeDirty,
} from '../src/core/crew-land.js';

const worker = { id: 'wkr_test', missionId: 'm2' };

test('buildMainWorktreeDirty tells coordinator to ask the user, not resume', () => {
  const result = buildMainWorktreeDirty(worker, { missionId: 'm2' });
  assert.equal(result.code, 'MAIN_WORKTREE_DIRTY');
  assert.match(result.error, /user/i);
  assert.match(result.error, /Do not resume/i);
  assert.equal(result.onto, undefined);
});

test('buildLandMergeConflict forbids crew_rebase and does not set onto', () => {
  const result = buildLandMergeConflict(worker, ['README.md'], { missionId: 'm2' });
  assert.equal(result.code, 'LAND_MERGE_CONFLICT');
  assert.match(result.error, /Do not call crew_rebase/i);
  assert.match(result.error, /main checkout/i);
  assert.deepEqual(result.files, ['README.md']);
  assert.equal(result.onto, undefined);
});
