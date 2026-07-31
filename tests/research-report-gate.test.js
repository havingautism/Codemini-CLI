import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  isResearchReportComplete,
  shouldAutoWriteResearchResult,
  startResearchRunForApi,
} from '../codemini-web/lib/research-service.js';
import { runResearchLeadTurn } from '../src/core/research-runtime.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createResearchSession } from '../src/core/research-store.js';

async function withGlobalDir(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-research-gate-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  closeSqliteDatabasesForTests();
  try {
    return await task();
  } finally {
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('incomplete research cannot enter report generation through API or runtime', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({
      question: 'Unresolved research',
      phase: 'incomplete',
    });
    await assert.rejects(
      startResearchRunForApi(session.id, { phase: 'writing', config: {} }),
      /evidence is not ready/i,
    );
    await assert.rejects(
      runResearchLeadTurn({
        sessionId: session.id,
        phase: 'writing',
        config: {},
      }),
      /evidence is not ready/i,
    );
  });
});

test('successful investigation automatically continues into report writing', () => {
  assert.equal(
    shouldAutoWriteResearchResult('investigating', { readyForReport: true }),
    true,
  );
  assert.equal(
    shouldAutoWriteResearchResult('investigating', { readyForReport: false }),
    false,
  );
  assert.equal(
    shouldAutoWriteResearchResult('writing', { readyForReport: true }),
    false,
  );
  assert.equal(isResearchReportComplete({ phase: 'done', reportMarkdown: '# Report' }), true);
  assert.equal(isResearchReportComplete({ phase: 'done', reportMarkdown: '' }), false);
  assert.equal(isResearchReportComplete({ phase: 'writing', reportMarkdown: '# Draft' }), false);
});
