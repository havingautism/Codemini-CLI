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
  buildDeterministicResearchConclusions,
  normalizeResearchConclusions,
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
  researchDepthRuntimeLimits,
  reserveResearchBudget,
  updateResearchScoutRun,
  updateResearchQuestion,
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
    assert.equal(small.maxSearches, 20);
    assert.equal(small.maxFetches, 20);
    assert.equal(small.maxWaves, 1);
    assert.equal(small.pools, undefined);

    const large = planResearchBudget(18);
    assert.equal(large.maxSearches, 180);
    assert.equal(large.maxFetches, 180);
    assert.equal(large.maxWaves, 1);

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
            { text: 'c1' },
            { text: 'c2' },
            { text: 'c3' },
          ],
          dependsOn: [],
        })),
      },
    });
    const confirmed = confirmResearchPlan(session.id);
    assert.equal(confirmed.plan.depth, 'deep');
    assert.equal(confirmed.questions.length, 6);
    assert.equal(confirmed.budget.maxSearches, 180);
    assert.equal(confirmed.budget.maxFetches, 180);
    assert.equal(confirmed.budget.maxWaves, 1);
    assert.equal(confirmed.budget.pools, undefined);
    assert.equal(confirmed.questions[0].successCriteria[0].text, 'c1');
    assert.equal(confirmed.questions[0].successCriteria[2].text, 'c3');
    assert.equal(confirmed.questions[0].successCriteria[0].priority, undefined);

    updateResearchSession(session.id, {
      budget: {
        maxWaves: confirmed.budget.maxWaves,
        maxParallelScouts: confirmed.budget.maxParallelScouts,
        maxSearches: 40,
        maxFetches: 40,
      },
    });
    const expanded = ensureResearchSessionBudget(session.id);
    assert.equal(expanded.budget.maxSearches, 180);
    assert.equal(expanded.budget.maxFetches, 180);

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
    assert.equal(stillTight.questions[0].successCriteria[0].priority, undefined);

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
test('research waves persist and evidence commit is idempotent with criterion ids', async () => {
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
      ledger: { version: 2, questionId, queries: [] },
    });
    updateResearchScoutRun(scout.id, {
      status: 'done',
      decision: { decision: 'done' },
      handoffMarkdown: 'Self-status: done',
      searchCount: 2,
      committedEvidenceIds: [],
    });
    updateResearchQuestion(questionId, {
      coverage: {
        version: 1,
        questionId,
        criteria: [{
          id: 'c1',
          text: 'Offline editing confirmed',
          status: 'covered',
          evidenceIds: [],
          toolCount: 2,
          reason: 'Accepted verified claim',
        }],
      },
      status: 'done',
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
        criterionIds: ['c1'],
      }],
    });
    assert.equal(commit.insertedEvidenceIds.length, 1);

    const repeated = applyResearchCommit(session.id, {
      acceptEvidence: [{
        candidateId: 'cand_offline',
        questionId,
        claim: 'Product X supports offline editing',
        criterionIds: ['c1'],
      }],
    });
    assert.deepEqual(repeated.insertedEvidenceIds, []);
    assert.deepEqual(repeated.reusedEvidenceIds, commit.insertedEvidenceIds);

    const detail = getResearchSessionDetail(session.id);
    assert.equal(detail.waves.length, 1);
    assert.equal(detail.waves[0].status, 'completed');
    assert.equal(detail.questions[0].coverage.criteria[0].status, 'covered');
    assert.equal(detail.evidence[0].originCandidateId, 'cand_offline');
    assert.deepEqual(detail.evidence[0].criterionIds, ['c1']);
  });
});

test('report readiness uses coverage evidence ids and caveats uncovered criteria', async () => {
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
    const scout = createResearchScoutRun({
      sessionId: session.id,
      waveId: wave.id,
      questionId,
      ledger: { version: 2, questionId, queries: [] },
    });
    updateResearchScoutRun(scout.id, { status: 'done' });

    const offline = applyResearchCommit(session.id, {
      acceptEvidence: [{
        candidateId: 'cand_offline',
        questionId,
        claim: 'Offline works',
        url: 'https://example.com/offline',
        criterionIds: ['c1'],
      }],
    });
    updateResearchQuestion(questionId, {
      coverage: {
        version: 1,
        questionId,
        criteria: [
          {
            id: 'c1',
            text: 'Offline support',
            status: 'covered',
            evidenceIds: offline.insertedEvidenceIds,
            toolCount: 3,
            reason: 'Verified',
          },
          {
            id: 'c2',
            text: 'Export support',
            status: 'covered',
            evidenceIds: [],
            toolCount: 2,
            reason: 'Marked covered without accepted evidence',
          },
        ],
      },
      status: 'partial',
    });

    const caveated = deterministicResearchReadiness(getResearchSessionDetail(session.id));
    assert.equal(caveated.ready, true);
    assert.equal(caveated.eligibleTargets.some((target) => target.criterionId === 'c2'), true);
    assert.equal(caveated.limitations.some((target) => target.criterionId === 'c2'), true);

    const exportCommit = applyResearchCommit(session.id, {
      acceptEvidence: [{
        candidateId: 'cand_export',
        questionId,
        claim: 'Export works',
        url: 'https://example.com/export',
        criterionIds: ['c2'],
      }],
    });
    updateResearchQuestion(questionId, {
      coverage: {
        version: 1,
        questionId,
        criteria: [
          {
            id: 'c1',
            text: 'Offline support',
            status: 'covered',
            evidenceIds: offline.insertedEvidenceIds,
            toolCount: 3,
            reason: 'Verified',
          },
          {
            id: 'c2',
            text: 'Export support',
            status: 'covered',
            evidenceIds: exportCommit.insertedEvidenceIds,
            toolCount: 2,
            reason: 'Verified',
          },
        ],
      },
      status: 'done',
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
        { text: 'a' },
        { text: 'b' },
        { text: 'c' },
        { text: 'd' },
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
        { text: 'a' },
        { text: 'b' },
        { text: 'c' },
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

test('research plan validation preserves its generated emoji title', () => {
  const result = validateResearchPlanByDepth({
    title: '🎵 City Pop 前世今生',
    depth: 'brief',
    questions: [{ tempId: 'q1', text: 'What shaped City Pop?', successCriteria: [] }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.title, '🎵 City Pop 前世今生');
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
    assert.equal(confirmed.budget.maxWaves, 1);
    // 3 criteria × 10 tools (single round)
    assert.equal(confirmed.budget.maxSearches, 30);
    assert.equal(confirmed.budget.maxFetches, 30);
  });
});

test('researchDepthRuntimeLimits use one round and a shared tool fuse', () => {
  assert.deepEqual(researchDepthRuntimeLimits('brief'), {
    maxWaves: 1,
    toolsPerCriterion: 10,
    searchesPerCriterionPerWave: 10,
  });
  assert.deepEqual(researchDepthRuntimeLimits('standard'), {
    maxWaves: 1,
    toolsPerCriterion: 10,
    searchesPerCriterionPerWave: 10,
  });
  assert.deepEqual(researchDepthRuntimeLimits('deep'), {
    maxWaves: 1,
    toolsPerCriterion: 10,
    searchesPerCriterionPerWave: 10,
  });
  const briefBudget = planResearchBudget(2, {
    maxWaves: 3,
    searchesPerWave: 3,
  });
  assert.equal(briefBudget.maxSearches, 6);
  assert.equal(briefBudget.maxWaves, 1);
});

test('confirmResearchPlan always syncs maxWaves to single investigation round', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({
      question: '简短研究一下：产品对比',
      budget: {
        maxWaves: 5,
        maxSearches: 40,
        maxFetches: 320,
        maxParallelScouts: 3,
      },
    });
    updateResearchSession(session.id, {
      plan: {
        depth: 'brief',
        questions: [{
          tempId: 'q1',
          text: 'Core angle',
          successCriteria: ['a'],
          dependsOn: [],
        }],
      },
    });
    const confirmed = confirmResearchPlan(session.id);
    assert.equal(confirmed.plan.depth, 'brief');
    assert.equal(confirmed.budget.maxWaves, 1);
    assert.equal(confirmed.budget.maxSearches, 40);
  });
});

test('writing pack includes conclusions, limitations, and accepted evidence', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: 'How did X evolve?' });
    updateResearchSession(session.id, {
      plan: { depth: 'standard', goal: 'Decision memo', questions: [] },
      conclusions: [{
        questionId: 'q_fake',
        completeness: 'partial',
        summary: 'Direction is clear; timeline is not.',
        limitations: 'No official GA table.',
        evidenceIds: ['ev_keep'],
      }],
    });
    const detail = {
      ...getResearchSessionDetail(session.id),
      questions: [{ id: 'q_fake', text: 'Milestones?', status: 'partial', gaps: ['dates'] }],
      evidence: [{
        id: 'ev_keep',
        questionId: 'q_fake',
        status: 'accepted',
        confidence: 'high',
        claim: 'Product moved toward agents',
        snippet: 'blog line',
        url: 'https://example.com/a',
        sourceLabel: 'Blog',
      }],
      waves: [{
        evaluation: {
          limitations: [{
            questionId: 'q_fake',
            criterionId: 'c1',
            gap: 'Stop chasing GA dates',
          }],
        },
      }],
      conclusions: normalizeResearchConclusions([{
        questionId: 'q_fake',
        completeness: 'partial',
        summary: 'Direction is clear; timeline is not.',
        limitations: 'No official GA table.',
        evidenceIds: ['ev_keep', 'ev_bogus'],
      }]).map((item) => ({
        ...item,
        evidenceIds: item.evidenceIds.filter((id) => id === 'ev_keep'),
      })),
    };
    const pack = buildResearchWritingPack(detail);
    assert.match(pack, /Depth: standard/);
    assert.match(pack, /Sub-question conclusions/);
    assert.match(pack, /Direction is clear/);
    assert.match(pack, /Session limitations/);
    assert.match(pack, /Stop chasing GA dates/);
    assert.match(pack, /Accepted evidence/);
    assert.match(pack, /ev_keep/);
    assert.doesNotMatch(pack, /ev_bogus/);
  });
});

test('deterministic conclusions strip to accepted evidence and coverage', async () => {
  await withGlobalDir(async () => {
    const session = createResearchSession({ question: 'Topic' });
    updateResearchSession(session.id, {
      plan: {
        depth: 'brief',
        questions: [{ tempId: 'q1', text: 'Angle', successCriteria: ['a'], dependsOn: [] }],
      },
    });
    const confirmed = confirmResearchPlan(session.id);
    const questionId = confirmed.questions[0].id;
    const wave = createResearchWave(session.id, { wave: 1, status: 'completed' });
    createResearchScoutRun({
      sessionId: session.id,
      waveId: wave.id,
      questionId,
      status: 'partial',
      ledger: { version: 2, questionId, queries: [] },
    });
    updateResearchQuestion(questionId, {
      coverage: {
        version: 1,
        questionId,
        criteria: [{
          id: 'c1',
          text: 'a',
          status: 'blocked',
          reason: 'No stable timeline',
          evidenceIds: [],
          toolCount: 3,
        }],
      },
      status: 'partial',
      gaps: ['No stable timeline'],
    });
    applyResearchCommit(session.id, {
      acceptEvidence: [{
        questionId,
        claim: 'Capability broadened',
        snippet: 'snippet',
        url: 'https://example.com/x',
        confidence: 'high',
        createdFrom: 'scout_handoff',
        criterionIds: ['c1'],
      }],
    });
    const detail = getResearchSessionDetail(session.id);
    const conclusions = buildDeterministicResearchConclusions(detail);
    assert.equal(conclusions.length, 1);
    assert.equal(conclusions[0].questionId, questionId);
    assert.equal(conclusions[0].completeness, 'partial');
    assert.equal(conclusions[0].evidenceIds.length, 1);
    assert.match(conclusions[0].limitations, /timeline/i);
  });
});
