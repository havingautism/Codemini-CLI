import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  confirmResearchPlanForApi,
  getResearchSessionForApi,
  isResearchReportComplete,
  shouldAutoWriteResearchResult,
  startResearchRunForApi,
  updateResearchPlanForApi,
} from '../codemini-web/lib/research-service.js';
import { runResearchLeadTurn } from '../src/core/research-runtime.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createResearchSession, updateResearchRunState } from '../src/core/research-store.js';

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
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
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

test('plan approval is idempotent after investigation has started', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: 'Compare two products' });
    const plan = {
      goal: 'Produce a decision memo',
      questions: [{
        tempId: 'q1',
        text: 'How do the products differ?',
        successCriteria: ['Use attributable evidence'],
        dependsOn: [],
      }],
    };
    updateResearchPlanForApi(session.id, { plan });
    const first = confirmResearchPlanForApi(session.id, { plan });
    const questionIds = first.session.questions.map((question) => question.id);

    const second = confirmResearchPlanForApi(session.id, { plan });
    assert.equal(second.alreadyConfirmed, true);
    assert.deepEqual(
      second.session.questions.map((question) => question.id),
      questionIds,
    );
  });
});

test('stale running sessions recover as paused after a process interruption', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: 'Long-running research' });
    updateResearchRunState(session.id, {
      state: 'running',
      phase: 'writing',
      error: '',
    });

    const payload = getResearchSessionForApi(session.id);
    assert.equal(payload.running, false);
    assert.equal(payload.session.runState, 'paused');
    assert.equal(payload.session.lastRunPhase, 'writing');
    assert.match(payload.session.lastError, /interrupted/i);
  });
});
