import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { generateResearchConclusions } from '../src/core/research-investigation.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import {
  applyResearchCommit,
  confirmResearchPlan,
  createResearchSession,
  getResearchSessionDetail,
  updateResearchSession,
} from '../src/core/research-store.js';

async function withGlobalDir(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-research-conclusions-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    return await task();
  } finally {
    closeSqliteDatabasesForTests(dir);
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

test('generateResearchConclusions falls back without blocking writing', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: '简短研究一下：X' });
    updateResearchSession(session.id, {
      plan: {
        depth: 'brief',
        questions: [{
          tempId: 'q1',
          text: 'What changed?',
          successCriteria: ['direction'],
          dependsOn: [],
        }],
      },
    });
    const confirmed = confirmResearchPlan(session.id);
    const questionId = confirmed.questions[0].id;
    applyResearchCommit(session.id, {
      acceptEvidence: [{
        questionId,
        claim: 'Capability broadened',
        snippet: 'snippet',
        url: 'https://example.com/x',
        confidence: 'high',
      }],
    });

    const result = await generateResearchConclusions({
      sessionId: session.id,
      config: {
        model: { name: 'dummy' },
        gateway: { base_url: 'http://127.0.0.1:9', api_key: 'x', timeout_ms: 50, max_retries: 0 },
        sdk: {},
      },
      model: 'dummy',
    });

    assert.equal(result.ok, true);
    assert.equal(result.fallback, true);
    assert.equal(result.conclusions.length, 1);
    assert.equal(result.conclusions[0].questionId, questionId);
    assert.equal(result.conclusions[0].evidenceIds.length, 1);

    const detail = getResearchSessionDetail(session.id);
    assert.equal(detail.conclusions.length, 1);
    assert.match(detail.conclusions[0].summary, /Accepted evidence|evidence/i);
  });
});

test('generateResearchConclusions reuses stored conclusions', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: 'Reuse conclusions' });
    updateResearchSession(session.id, {
      conclusions: [{
        questionId: 'q1',
        completeness: 'complete',
        summary: 'Already written',
        limitations: '',
        evidenceIds: [],
      }],
    });
    const result = await generateResearchConclusions({
      sessionId: session.id,
      config: {},
    });
    assert.equal(result.reused, true);
    assert.equal(result.conclusions[0].summary, 'Already written');
  });
});
