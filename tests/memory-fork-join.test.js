import test from 'node:test';
import assert from 'node:assert/strict';

import { commitForkMemoryCandidates, listInbox } from '../src/core/memory-store.js';
import { withMemoryEnv } from './helpers/memory-env.js';

test('parent join deduplicates branch candidates and merges provenance', async () => {
  await withMemoryEnv(async (dir) => {
    const result = await commitForkMemoryCandidates({
      sessionId: 'parent-session',
      workspaceRoot: dir,
      candidates: [
        {
          scope: 'project', kind: 'convention', family: 'repo',
          summary: 'Run npm test before handoff', content: 'Run npm test before handoff.',
          sourceBranchId: 'fork-a', agentRole: 'reviewer'
        },
        {
          scope: 'project', kind: 'convention', family: 'repo',
          summary: 'Run npm test before handoff', content: 'Run npm test before handoff.',
          sourceBranchId: 'fork-b', agentRole: 'tester'
        }
      ]
    });
    assert.equal(result.joined, 1);
    const inbox = await listInbox();
    assert.equal(inbox.length, 1);
    assert.deepEqual(inbox[0].evidence.sourceBranchIds, ['fork-a', 'fork-b']);
    assert.deepEqual(inbox[0].evidence.agentRoles, ['reviewer', 'tester']);
    assert.equal(inbox[0].evidence.sessionId, 'parent-session');
  });
});
