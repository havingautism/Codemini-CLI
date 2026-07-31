import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { deterministicResearchReadiness } from '../src/core/research-investigation.js';
import {
  applyResearchCommit,
  buildResearchDbSummary,
  buildResearchWritingPack,
  confirmResearchPlan,
  createResearchScoutRun,
  createResearchSession,
  createResearchWave,
  ensureResearchSessionBudget,
  getResearchSessionDetail,
  inferResearchPlanDepth,
  listResearchEvidence,
  listResearchQuestions,
  planResearchBudget,
  reserveResearchBudget,
  updateResearchScoutRun,
  updateResearchRunState,
  updateResearchWave,
  updateResearchSession,
  validateResearchPlanByDepth,
} from '../src/core/research-store.js';

async function withGlobalDir(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-research-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  closeSqliteDatabasesForTests();
  try {
    return await task(dir);
  } finally {
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('research session create confirm commit and summaries', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({
      question: 'What is company A 2023 revenue?',
      preferences: { constraints: 'Prefer SEC filings' },
      seed: [{ label: 'note', text: 'User heard about 12B' }],
    });
    assert.equal(session.phase, 'planning');
    assert.equal(session.budget.maxParallelScouts, 3);
    assert.equal(session.seed.length, 1);

    updateResearchSession(session.id, {
      phase: 'awaiting_plan_confirm',
      plan: {
        goal: 'Determine audited revenue figure',
        coverageChecklist: [{ id: 'c1', text: 'Primary filing', met: false }],
        questions: [
          {
            tempId: 'q1',
            text: 'What revenue did A report for 2023?',
            successCriteria: ['Have a primary-source figure'],
            dependsOn: [],
          },
          {
            tempId: 'q2',
            text: 'Is the figure in USD?',
            successCriteria: ['Currency confirmed'],
            dependsOn: ['q1'],
          },
        ],
      },
    });

    const confirmed = confirmResearchPlan(session.id);
    assert.equal(confirmed.phase, 'investigating');
    assert.equal(confirmed.preferences.goal, 'Determine audited revenue figure');
    assert.equal(confirmed.questions.length, 2);
    assert.equal(confirmed.questions[0].status, 'pending');
    assert.match(confirmed.questions[1].dependsOn[0], /^rq_/);

    const q1 = confirmed.questions[0].id;
    const commit = applyResearchCommit(session.id, {
      acceptEvidence: [
        {
          questionId: q1,
          claim: 'Revenue was $12.0 billion',
          snippet: 'Revenue reached $12.0 billion in 2023',
          url: 'https://sec.example/a-10k',
          confidence: 'high',
          createdFrom: 'scout_handoff',
        },
        {
          questionId: q1,
          claim: 'Media estimate ~$12B',
          snippet: 'about $12 billion',
          url: 'https://news.example/a',
          confidence: 'medium',
        },
      ],
      questionUpdates: [
        {
          questionId: q1,
          status: 'partial',
          gaps: ['Need page number in 10-K'],
        },
      ],
      checklistUpdates: [{ id: 'c1', met: true }],
    });
    assert.equal(commit.ok, true);
    assert.equal(commit.insertedEvidenceIds.length, 2);

    const detail = getResearchSessionDetail(session.id);
    assert.equal(listResearchEvidence(session.id, { status: 'accepted' }).length, 2);
    assert.equal(listResearchQuestions(session.id)[0].status, 'partial');
    assert.equal(detail.plan.coverageChecklist[0].met, true);

    const summary = buildResearchDbSummary(detail);
    assert.match(summary, /Main question/);
    assert.match(summary, /Need page number/);
    assert.match(summary, /ev_/);

    const pack = buildResearchWritingPack(detail);
    assert.match(pack, /Accepted evidence/);
    assert.match(pack, /\$12\.0 billion/);
  });
});

test('research run state persists the failed or paused phase independently', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: 'Recoverable research?' });
    assert.equal(session.runState, 'idle');
    assert.equal(session.lastRunPhase, '');
    assert.equal(session.lastError, '');

    const running = updateResearchRunState(session.id, {
      state: 'running',
      phase: 'planning',
      error: '',
    });
    assert.equal(running.phase, 'planning');
    assert.equal(running.runState, 'running');
    assert.equal(running.lastRunPhase, 'planning');

    const failed = updateResearchRunState(session.id, {
      state: 'failed',
      phase: 'planning',
      error: 'planner unavailable',
    });
    assert.equal(failed.phase, 'planning');
    assert.equal(failed.runState, 'failed');
    assert.equal(failed.lastRunPhase, 'planning');
    assert.equal(failed.lastError, 'planner unavailable');
  });
});

test('research commit rejects unknown questionId', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: 'Q?' });
    updateResearchSession(session.id, {
      plan: {
        questions: [{ tempId: 'q1', text: 'Only one', successCriteria: [], dependsOn: [] }],
      },
    });
    confirmResearchPlan(session.id);
    assert.throws(
      () => applyResearchCommit(session.id, {
        acceptEvidence: [{ questionId: 'rq_missing', claim: 'x', snippet: 'y' }],
      }),
      /unknown questionId/,
    );
  });
});

test('research budget reservation is atomic and never exceeds its limit', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({
      question: 'Budget test',
      budget: { maxSearches: 2, maxFetches: 1, maxWaves: 1 },
    });
    const reservations = await Promise.all(
      Array.from({ length: 8 }, async () => reserveResearchBudget(session.id, 'searches')),
    );
    assert.equal(reservations.filter((result) => result.ok).length, 2);
    assert.equal(reservations.filter((result) => result.reason === 'exhausted').length, 6);
    assert.equal(getResearchSessionDetail(session.id).budgetUsed.searches, 2);
  });
});

test('research budget scales with criterion count and expands under-provisioned sessions', async () => {
  await withGlobalDir(async () => {
    const small = planResearchBudget(2);
    assert.equal(small.maxSearches, 50);
    assert.equal(small.maxFetches, 400);
    assert.equal(small.pools, undefined);

    const large = planResearchBudget(18);
    assert.equal(large.maxSearches, 450);
    assert.equal(large.maxFetches, 3600);

    const session = createResearchSession({
      question: 'Six-question front-end study',
    });
    updateResearchSession(session.id, {
      plan: {
        depth: 'deep',
        questions: Array.from({ length: 6 }, (_, index) => ({
          tempId: `q${index + 1}`,
          text: `Sub-question ${index + 1}`,
          successCriteria: [
            { text: 'c1', priority: 'high' },
            { text: 'c2', priority: 'normal' },
            { text: 'c3', priority: 'low' },
          ],
          dependsOn: [],
        })),
      },
    });
    const confirmed = confirmResearchPlan(session.id);
    assert.equal(confirmed.plan.depth, 'deep');
    assert.equal(confirmed.questions.length, 6);
    assert.equal(confirmed.budget.maxSearches, 450);
    assert.equal(confirmed.budget.maxFetches, 3600);
    assert.equal(confirmed.budget.pools, undefined);
    assert.equal(confirmed.questions[0].successCriteria[0].priority, 'high');
    assert.equal(confirmed.questions[0].successCriteria[2].priority, 'low');

    updateResearchSession(session.id, {
      budget: {
        maxWaves: confirmed.budget.maxWaves,
        maxParallelScouts: confirmed.budget.maxParallelScouts,
        maxSearches: 40,
        maxFetches: 40,
      },
    });
    const expanded = ensureResearchSessionBudget(session.id);
    assert.equal(expanded.budget.maxSearches, 450);
    assert.equal(expanded.budget.maxFetches, 3600);

    const tight = createResearchSession({
      question: 'Tight budget stays tight',
      budget: { maxSearches: 2, maxFetches: 1, maxWaves: 1 },
    });
    updateResearchSession(tight.id, {
      plan: {
        questions: [{
          tempId: 'q1',
          text: 'One question',
          successCriteria: ['a', 'b', 'c'],
          dependsOn: [],
        }],
      },
    });
    confirmResearchPlan(tight.id);
    const stillTight = ensureResearchSessionBudget(tight.id);
    assert.equal(stillTight.budget.maxSearches, 2);
    assert.equal(stillTight.budget.maxFetches, 1);
    assert.equal(stillTight.questions[0].successCriteria[0].text, 'a');
    assert.equal(stillTight.questions[0].successCriteria[0].priority, 'normal');

    const firstReserve = reserveResearchBudget(tight.id, 'searches', 1);
    assert.equal(firstReserve.ok, true);
    const secondReserve = reserveResearchBudget(tight.id, 'searches', 1);
    assert.equal(secondReserve.ok, true);
    const thirdReserve = reserveResearchBudget(tight.id, 'searches', 1);
    assert.equal(thirdReserve.ok, false);
    assert.equal(thirdReserve.reason, 'exhausted');
  });
});

test('legacy dual-pool budgets migrate to flat totals', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({
      question: 'Legacy pools',
      budget: {
        maxWaves: 5,
        pools: {
          base: { maxSearches: 10, maxFetches: 20 },
          followup: { maxSearches: 5, maxFetches: 10 },
        },
      },
    });
    const detail = getResearchSessionDetail(session.id);
    assert.equal(detail.budget.maxSearches, 15);
    assert.equal(detail.budget.maxFetches, 30);
    assert.equal(detail.budget.pools, undefined);
  });
});
test('research waves and scout ledgers persist and link committed candidates', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: 'Can Product X work offline?' });
    updateResearchSession(session.id, {
      plan: {
        questions: [{
          tempId: 'q1',
          text: 'What works offline?',
          successCriteria: ['Offline editing confirmed'],
          dependsOn: [],
        }],
      },
    });
    const confirmed = confirmResearchPlan(session.id);
    const questionId = confirmed.questions[0].id;
    const wave = createResearchWave(session.id, {
      wave: 1,
      targets: [{ questionId, gap: 'Initial coverage' }],
    });
    const scout = createResearchScoutRun({
      sessionId: session.id,
      waveId: wave.id,
      questionId,
      ledger: {
        criteria: [{ id: 'c1', text: 'Offline editing confirmed', status: 'covered' }],
        candidates: [{
          id: 'cand_offline',
          criterionIds: ['c1'],
          claim: 'Product X supports offline editing',
          confidence: 'high',
          sources: [{ url: 'https://example.com/offline', snippet: 'Edit while offline.' }],
        }],
      },
    });
    updateResearchScoutRun(scout.id, {
      status: 'done',
      decision: { decision: 'done' },
      handoffMarkdown: 'Self-status: done',
      searchCount: 2,
    });
    updateResearchWave(wave.id, {
      status: 'completed',
      evaluation: { decision: 'ready_for_report' },
    });
    const commit = applyResearchCommit(session.id, {
      acceptEvidence: [{
        candidateId: 'cand_offline',
        questionId,
        claim: 'Product X supports offline editing',
        url: 'https://example.com/offline',
        confidence: 'high',
      }],
    });
    assert.equal(commit.insertedEvidenceIds.length, 1);

    // Candidate identity makes commit idempotent.
    const repeated = applyResearchCommit(session.id, {
      acceptEvidence: [{
        candidateId: 'cand_offline',
        questionId,
        claim: 'Product X supports offline editing',
      }],
    });
    assert.deepEqual(repeated.insertedEvidenceIds, []);
    assert.deepEqual(repeated.reusedEvidenceIds, commit.insertedEvidenceIds);

    const detail = getResearchSessionDetail(session.id);
    assert.equal(detail.waves.length, 1);
    assert.equal(detail.waves[0].status, 'completed');
    assert.equal(detail.waves[0].scouts[0].ledger.candidates[0].id, 'cand_offline');
    assert.equal(detail.evidence[0].originCandidateId, 'cand_offline');
  });
});

test('report readiness exposes optional follow-ups without blocking a caveated report', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: 'Compare offline and export support' });
    updateResearchSession(session.id, {
      plan: {
        questions: [{
          tempId: 'q1',
          text: 'What does Product X support?',
          successCriteria: ['Offline support', 'Export support'],
          dependsOn: [],
        }],
      },
    });
    const confirmed = confirmResearchPlan(session.id);
    const questionId = confirmed.questions[0].id;
    const wave = createResearchWave(session.id, {
      wave: 1,
      targets: [{ questionId, gap: 'Initial coverage' }],
    });
    const candidates = [
      {
        id: 'cand_offline',
        criterionIds: ['c1'],
        claim: 'Offline works',
        confidence: 'high',
        sources: [{ url: 'https://example.com/offline', snippet: 'Offline' }],
      },
      {
        id: 'cand_export',
        criterionIds: ['c2'],
        claim: 'Export works',
        confidence: 'high',
        sources: [{ url: 'https://example.com/export', snippet: 'Export' }],
      },
    ];
    const scout = createResearchScoutRun({
      sessionId: session.id,
      waveId: wave.id,
      questionId,
      ledger: {
        criteria: [
          { id: 'c1', text: 'Offline support', status: 'covered', candidateIds: ['cand_offline'] },
          { id: 'c2', text: 'Export support', status: 'covered', candidateIds: ['cand_export'] },
        ],
        candidates,
      },
    });
    updateResearchScoutRun(scout.id, { status: 'done' });
    applyResearchCommit(session.id, {
      acceptEvidence: [{
        candidateId: 'cand_offline',
        questionId,
        claim: 'Offline works',
        url: 'https://example.com/offline',
      }],
    });

    const caveated = deterministicResearchReadiness(getResearchSessionDetail(session.id));
    assert.equal(caveated.ready, true);
    assert.equal(caveated.eligibleTargets.some((target) => target.criterionId === 'c2'), true);
    assert.equal(caveated.limitations.some((target) => target.criterionId === 'c2'), true);

    applyResearchCommit(session.id, {
      acceptEvidence: [{
        candidateId: 'cand_export',
        questionId,
        claim: 'Export works',
        url: 'https://example.com/export',
      }],
    });
    const complete = deterministicResearchReadiness(getResearchSessionDetail(session.id));
    assert.equal(complete.ready, true);
    assert.equal(complete.eligibleTargets.length, 0);
  });
});

test('research plan depth inference rejects oversized plans instead of truncating', () => {
  assert.equal(inferResearchPlanDepth({ question: '简短研究一下前端演进' }), 'brief');
  assert.equal(inferResearchPlanDepth({ question: '深入全面调研前端演进并给出决策建议' }), 'deep');
  assert.equal(inferResearchPlanDepth({ question: '前端开发有哪些方向' }), 'standard');

  const oversized = validateResearchPlanByDepth({
    depth: 'deep',
    questions: Array.from({ length: 8 }, (_, index) => ({
      tempId: `q${index + 1}`,
      text: `Question ${index + 1}`,
      successCriteria: [
        { text: 'a', priority: 'high' },
        { text: 'b', priority: 'normal' },
        { text: 'c', priority: 'low' },
        { text: 'd', priority: 'low' },
      ],
    })),
  }, { depth: 'brief' });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.depth, 'brief');
  assert.match(oversized.error, /at most 2 sub-questions/);
  assert.equal(oversized.plan.questions.length, 8);

  const tooManyCriteria = validateResearchPlanByDepth({
    depth: 'brief',
    questions: [{
      tempId: 'q1',
      text: 'Only question',
      successCriteria: [
        { text: 'a', priority: 'high' },
        { text: 'b', priority: 'normal' },
        { text: 'c', priority: 'low' },
      ],
    }],
  }, { depth: 'brief' });
  assert.equal(tooManyCriteria.ok, false);
  assert.match(tooManyCriteria.error, /at most 2 success criteria/);

  const ok = validateResearchPlanByDepth({
    depth: 'brief',
    questions: [
      { tempId: 'q1', text: 'Q1', successCriteria: [{ text: 'a' }, { text: 'b' }] },
      { tempId: 'q2', text: 'Q2', successCriteria: [{ text: 'c' }] },
    ],
  }, { depth: 'brief' });
  assert.equal(ok.ok, true);
  assert.equal(ok.plan.questions.length, 2);
});

test('confirmResearchPlan rejects oversized brief plans instead of clamping', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({
      question: '简短研究一下：ai时代下，前端开发的演进方向',
    });
    updateResearchSession(session.id, {
      plan: {
        depth: 'deep',
        questions: Array.from({ length: 6 }, (_, index) => ({
          tempId: `q${index + 1}`,
          text: `Sub-question ${index + 1}`,
          successCriteria: ['a', 'b', 'c'],
          dependsOn: [],
        })),
      },
    });
    assert.throws(
      () => confirmResearchPlan(session.id),
      /at most 2 sub-questions/,
    );
    const detail = getResearchSessionDetail(session.id);
    assert.equal(detail.phase, 'planning');
    assert.equal(detail.questions.length, 0);
  });
});

test('confirmResearchPlan accepts a brief-sized plan when main question asks for a short study', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({
      question: '简短研究一下：ai时代下，前端开发的演进方向',
    });
    updateResearchSession(session.id, {
      plan: {
        depth: 'deep',
        questions: [
          {
            tempId: 'q1',
            text: 'Core direction',
            successCriteria: ['a', 'b'],
            dependsOn: [],
          },
          {
            tempId: 'q2',
            text: 'Secondary angle',
            successCriteria: ['c'],
            dependsOn: [],
          },
        ],
      },
    });
    const confirmed = confirmResearchPlan(session.id);
    assert.equal(confirmed.plan.depth, 'brief');
    assert.equal(confirmed.questions.length, 2);
    assert.equal(confirmed.questions[0].successCriteria.length, 2);
  });
});
