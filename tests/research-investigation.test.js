import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgentLoop } from '../src/core/agent-loop.js';
import {
  applyLedgerPatch,
  advanceLedgerAfterCheckpoint,
  buildScoutHandoff,
  createInitialLedger,
  createResearchSearchDefinition,
  createScoutCheckpointController,
  ledgerProgressSignature,
  partitionWaveTargetsAndLimitations,
  scopeScoutEvaluatorPatch,
} from '../src/core/research-investigation.js';

test('research search schema is scoped with required criterionId', () => {
  const base = {
    type: 'function',
    function: {
      name: 'web_search',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  };
  const scoped = createResearchSearchDefinition(base);
  assert.deepEqual(base.function.parameters.required, ['query']);
  assert.deepEqual(scoped.function.parameters.required, ['query', 'criterionId']);
  assert.equal(scoped.function.parameters.properties.criterionId.type, 'string');
});

test('ledger patch merges duplicate claims and attaches attributable sources', () => {
  const question = {
    id: 'rq_1',
    text: 'Does Product X work offline?',
    successCriteria: ['Offline editing confirmed'],
  };
  const initial = createInitialLedger(question);
  const first = applyLedgerPatch(initial, {
    newCandidates: [{
      criterionIds: ['c1'],
      claim: 'Product X supports offline editing',
      confidence: 'medium',
      sources: [{
        url: 'https://example.com/offline',
        snippet: 'Offline editing is supported.',
      }],
    }],
    coverageUpdates: { c1: 'covered' },
    decision: 'done',
  }, [{
    type: 'tool:result',
    name: 'web_search',
    arguments: { criterionId: 'c1', query: 'product x offline' },
    content: 'Official documentation https://example.com/offline',
  }]);
  assert.equal(first.candidates.length, 1);
  assert.equal(first.criteria[0].status, 'covered');

  const repeated = applyLedgerPatch(first, {
    newCandidates: [{
      criterionIds: ['c1'],
      claim: 'Product X supports offline editing',
      confidence: 'high',
      sources: [{
        url: 'https://example.com/release-notes',
        snippet: 'Edit without a connection.',
      }],
    }],
    coverageUpdates: { c1: 'covered' },
    decision: 'done',
  }, [{
    type: 'tool:result',
    name: 'web_search',
    arguments: { criterionId: 'c1', query: 'product x release notes offline' },
    content: 'Release notes https://example.com/release-notes',
  }]);
  assert.equal(repeated.candidates.length, 1);
  assert.equal(repeated.candidates[0].sources.length, 2);
  assert.match(buildScoutHandoff(question, repeated), /Candidate ID:/);
});

test('agent loop checkpoint returns control after a tool batch', async () => {
  let requests = 0;
  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'search',
    model: 'test-model',
    toolDefinitions: [{
      type: 'function',
      function: {
        name: 'web_search',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    }],
    toolHandlers: {
      web_search: async () => ({ results: [{ title: 'Result' }] }),
    },
    alwaysAllowTools: ['web_search'],
    approvalMode: 'auto',
    requestCompletion: async () => {
      requests += 1;
      return {
        text: '',
        toolCalls: [{ id: 'tc_1', name: 'web_search', arguments: '{}' }],
      };
    },
    shouldCheckpoint: () => true,
  });
  assert.equal(requests, 1);
  assert.equal(result.checkpoint, true);
  assert.equal(result.steps, 1);
});

test('rejected searches are tool errors and do not pollute query history', async () => {
  const events = [];
  await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'search',
    model: 'test-model',
    toolDefinitions: [{
      type: 'function',
      function: {
        name: 'web_search',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    }],
    toolHandlers: {
      web_search: async () => {
        throw new Error('Search rejected: checkpoint allowance used');
      },
    },
    alwaysAllowTools: ['web_search'],
    approvalMode: 'auto',
    requestCompletion: async () => ({
      text: '',
      toolCalls: [{
        id: 'tc_rejected',
        name: 'web_search',
        arguments: JSON.stringify({ criterionId: 'c1', query: 'duplicate query' }),
      }],
    }),
    shouldCheckpoint: () => true,
    onEvent: (event) => events.push(event),
  });
  const resultEvents = events.filter((event) => event.type === 'tool:result');
  assert.equal(resultEvents.length, 1);
  assert.equal(resultEvents[0].error, true);
  const ledger = createInitialLedger({
    id: 'rq_rejected',
    text: 'Test rejected search',
    successCriteria: ['Evidence'],
  });
  const patched = applyLedgerPatch(ledger, {
    coverageUpdates: {},
    decision: 'continue',
  }, resultEvents);
  assert.equal(patched.queries.length, 0);
});

test('scout checkpoint waits for finish_scout_cycle instead of the next fetch batch', () => {
  const controller = createScoutCheckpointController();
  controller.markSearchStarted();
  assert.equal(
    controller.shouldCheckpoint({ tools: 2 }),
    false,
    'search alone must not end the checkpoint',
  );
  assert.equal(
    controller.shouldCheckpoint({ tools: 5 }),
    false,
    'fetch rounds after search must not end the checkpoint',
  );
  controller.markFinished();
  assert.equal(
    controller.shouldCheckpoint({ tools: 6 }),
    true,
    'finish_scout_cycle ends the checkpoint',
  );
});

test('second search in the same cycle is gated by searchStartedThisCycle not criterion total', () => {
  const controller = createScoutCheckpointController();
  assert.equal(controller.hasSearchStarted(), false);
  controller.markSearchStarted();
  assert.equal(controller.hasSearchStarted(), true);
  // Criterion may still be 1/5 overall; the cycle gate is independent.
  assert.equal(controller.isFinished(), false);
});

test('checkpoint advances across criteria instead of ending the whole scout early', () => {
  const question = {
    id: 'rq_multi',
    text: 'Evaluate Product X',
    successCriteria: ['Offline support', 'Export support'],
  };
  const initial = createInitialLedger(question);
  const patched = applyLedgerPatch(initial, {
    newCandidates: [{
      criterionIds: ['c1'],
      claim: 'Product X works offline',
      sources: [{ url: 'https://example.com/offline', snippet: 'Offline mode' }],
    }],
    coverageUpdates: { c1: 'covered' },
    criterionDecision: { criterionId: 'c1', status: 'covered', reason: 'Documented' },
    decision: 'continue',
    nextGap: { criterionId: 'c2', reason: 'Export support' },
  }, [{
    type: 'tool:result',
    name: 'web_search',
    arguments: { criterionId: 'c1', query: 'product x offline' },
    content: 'https://example.com/offline',
  }]);
  const advanced = advanceLedgerAfterCheckpoint(patched, {
    patch: {
      criterionDecision: { criterionId: 'c1', status: 'covered', reason: 'Documented' },
      nextGap: { criterionId: 'c2', reason: 'Export support' },
    },
    targetCriterionId: 'c1',
    progressed: true,
  });
  assert.equal(advanced.decision, 'continue');
  assert.equal(advanced.nextGap.criterionId, 'c2');
  assert.equal(advanced.criteria[0].status, 'covered');
  assert.equal(advanced.criteria[1].status, 'missing');
});

test('covered criterion without candidate evidence is downgraded', () => {
  const ledger = createInitialLedger({
    id: 'rq_guard',
    text: 'Verify a claim',
    successCriteria: ['Primary evidence'],
  });
  ledger.criteria[0].status = 'covered';
  const advanced = advanceLedgerAfterCheckpoint(ledger, {
    patch: {
      criterionDecision: { criterionId: 'c1', status: 'covered', reason: 'Claimed covered' },
    },
    targetCriterionId: 'c1',
    progressed: true,
  });
  assert.equal(advanced.criteria[0].status, 'missing');
  assert.equal(advanced.decision, 'continue');
});

test('checkpoint evaluator cannot mutate a non-target criterion', () => {
  const ledger = createInitialLedger({
    id: 'rq_scope',
    text: 'Check two capabilities',
    successCriteria: ['Capability A', 'Capability B'],
  });
  const scoped = scopeScoutEvaluatorPatch({
    newCandidates: [{
      criterionIds: ['c1', 'c2'],
      claim: 'Capability result',
      sources: [{ url: 'https://example.com/result' }],
    }],
    updateCandidates: [],
    coverageUpdates: { c1: 'covered', c2: 'covered' },
    gaps: [],
    criterionDecision: { criterionId: 'c1', status: 'needs_more', reason: 'Need details' },
    decision: 'continue',
    nextGap: { criterionId: 'c2', reason: 'Capability B' },
  }, ledger);
  assert.deepEqual(scoped.coverageUpdates, { c1: 'missing' });
  assert.deepEqual(scoped.newCandidates[0].criterionIds, ['c1']);
  assert.equal(Object.hasOwn(scoped.coverageUpdates, 'c2'), false);
});

test('checkpoint evaluator accepts array-shaped coverage updates from fast models', () => {
  const ledger = createInitialLedger({
    id: 'rq_array_coverage',
    text: 'Check capability',
    successCriteria: ['Capability A'],
  });
  const scoped = scopeScoutEvaluatorPatch({
    newCandidates: [],
    updateCandidates: [],
    coverageUpdates: [{ criterionId: 'c1', status: 'partial', reason: 'Only indirect evidence' }],
    gaps: [{ criterionId: 'c1', text: 'Need a primary source' }],
    criterionDecision: {
      criterionId: 'c1',
      status: 'partial',
      reason: 'Only indirect evidence',
    },
    decision: 'partial',
    nextGap: null,
  }, ledger);
  // Before search cap, partial is coerced to needs_more; coverageUpdates stay non-terminal.
  assert.deepEqual(scoped.coverageUpdates, { c1: 'missing' });
  assert.equal(scoped.criterionDecision.status, 'needs_more');
});

test('real fast-model candidate shapes are normalized into ledger evidence', () => {
  const ledger = createInitialLedger({
    id: 'rq_real_shape',
    text: 'Compare AI tools',
    successCriteria: ['Tool capabilities'],
  });
  const patch = scopeScoutEvaluatorPatch({
    newCandidates: [{
      id: 'cand_cursor',
      criterionId: 'c1',
      url: 'https://cursor.com',
      confidence: 'low',
      claims: [
        'Cursor is an AI code editor.',
        'Cursor provides AI-assisted programming features.',
      ],
      source: 'Search result snippet',
    }],
    coverageUpdates: { c1: 'partial' },
    criterionDecision: {
      criterionId: 'c1',
      status: 'partial',
      reason: 'Useful search-result evidence',
    },
    decision: 'continue',
    gaps: [],
  }, ledger);
  const updated = applyLedgerPatch(ledger, patch, [{
    type: 'tool:result',
    name: 'web_search',
    arguments: { criterionId: 'c1', query: 'Cursor AI editor' },
    content: 'Cursor AI editor https://cursor.com',
  }]);
  assert.equal(updated.candidates.length, 2);
  assert.equal(updated.candidates[0].sources[0].url, 'https://cursor.com');
  assert.equal(updated.criteria[0].candidateIds.length, 2);
});

test('rewritten gap prose does not count as evidence progress', () => {
  const ledger = createInitialLedger({
    id: 'rq_gap_progress',
    text: 'Find evidence',
    successCriteria: ['Primary source'],
  });
  const rewritten = structuredClone(ledger);
  rewritten.gaps[0].text = 'Same unresolved gap with different wording';
  rewritten.criteria[0].reason = 'The evaluator rewrote its explanation';
  assert.equal(ledgerProgressSignature(rewritten), ledgerProgressSignature(ledger));
});

test('initial ledger preserves criterion priority from the plan', () => {
  const ledger = createInitialLedger({
    id: 'rq_priority',
    text: 'Priority question',
    successCriteria: [
      { text: 'Must answer core claim', priority: 'high' },
      'Legacy string criterion',
      { text: 'Nice to have', priority: 'low' },
    ],
  });
  assert.equal(ledger.criteria[0].priority, 'high');
  assert.equal(ledger.criteria[1].priority, 'normal');
  assert.equal(ledger.criteria[2].priority, 'low');
  assert.equal(ledger.criteria[0].searchCount, 0);
});

test('budget exhaustion with searchCount marks criterion blocked for the wave', () => {
  const ledger = createInitialLedger({
    id: 'rq_search_cap',
    text: 'Search capped question',
    successCriteria: ['Find primary sources'],
  });
  ledger.criteria[0].searchCount = 5;
  const next = advanceLedgerAfterCheckpoint(ledger, {
    patch: { criterionDecision: { criterionId: 'c1', status: 'missing' } },
    targetCriterionId: 'c1',
    budgetExhausted: true,
  });
  assert.equal(next.criteria[0].status, 'blocked');
  assert.match(next.criteria[0].reason, /search limit/i);
  assert.equal(next.criteria[0].searchCount, 5);
});

test('evaluator blocked before search allowance is spent does not early-close', () => {
  const ledger = createInitialLedger({
    id: 'rq_no_early_block',
    text: 'Keep searching',
    successCriteria: ['Primary evidence'],
  });
  ledger.criteria[0].searchCount = 2;
  const next = advanceLedgerAfterCheckpoint(ledger, {
    patch: {
      criterionDecision: {
        criterionId: 'c1',
        status: 'blocked',
        reason: 'Results look thin',
      },
    },
    targetCriterionId: 'c1',
  });
  assert.equal(next.criteria[0].status, 'missing');
  assert.equal(next.decision, 'continue');
  assert.equal(next.nextGap.criterionId, 'c1');
  assert.match(next.criteria[0].reason, /2\/5/);
  assert.match(next.criteria[0].reason, /thin/i);
});

test('evaluator partial before search allowance is spent does not early-close', () => {
  const ledger = createInitialLedger({
    id: 'rq_no_early_partial',
    text: 'Keep searching for full coverage',
    successCriteria: ['Primary evidence'],
  });
  ledger.criteria[0].searchCount = 3;
  ledger.criteria[0].candidateIds = ['cand_1'];
  const next = advanceLedgerAfterCheckpoint(ledger, {
    patch: {
      criterionDecision: {
        criterionId: 'c1',
        status: 'partial',
        reason: 'Only indirect evidence so far',
      },
    },
    targetCriterionId: 'c1',
  });
  assert.equal(next.criteria[0].status, 'missing');
  assert.equal(next.decision, 'continue');
  assert.equal(next.nextGap.criterionId, 'c1');
  assert.match(next.criteria[0].reason, /3\/5/);
  assert.match(next.criteria[0].reason, /2 remaining|remaining this wave/i);
  assert.doesNotMatch(next.criteria[0].reason, /配额已用尽/);
});

test('coverageUpdates cannot force early partial before search cap', () => {
  const ledger = createInitialLedger({
    id: 'rq_coverage_bypass',
    text: 'Do not early partial via coverage map',
    successCriteria: ['Primary evidence'],
  });
  ledger.criteria[0].searchCount = 1;
  ledger.nextGap = { criterionId: 'c1', reason: 'Primary evidence' };
  const scoped = scopeScoutEvaluatorPatch({
    newCandidates: [{
      criterionIds: ['c1'],
      claim: 'Some claim',
      sources: [{ url: 'https://example.com/a', snippet: 'Evidence' }],
    }],
    updateCandidates: [],
    coverageUpdates: { c1: 'partial' },
    gaps: [],
    criterionDecision: { criterionId: 'c1', status: 'partial', reason: 'c1 搜索配额已用尽 (5/5)。' },
    decision: 'partial',
    nextGap: { criterionId: 'c1', reason: 'c1 搜索配额已用尽 (5/5)。' },
  }, ledger);
  assert.equal(scoped.criterionDecision.status, 'needs_more');
  assert.equal(scoped.coverageUpdates.c1, 'missing');

  const patched = applyLedgerPatch(ledger, scoped, [{
    type: 'tool:result',
    name: 'web_search',
    arguments: { criterionId: 'c1', query: 'test' },
    content: 'https://example.com/a',
  }]);
  assert.equal(patched.criteria[0].status, 'missing');
  const advanced = advanceLedgerAfterCheckpoint(patched, {
    patch: scoped,
    targetCriterionId: 'c1',
  });
  assert.equal(advanced.criteria[0].status, 'missing');
  assert.equal(advanced.decision, 'continue');
  assert.match(advanced.criteria[0].reason, /1\/5/);
  assert.doesNotMatch(advanced.criteria[0].reason, /配额已用尽/);
  assert.match(advanced.nextGap.reason, /1\/5/);
});

test('searchCount at cap with candidates closes as partial', () => {
  const ledger = createInitialLedger({
    id: 'rq_cap_partial',
    text: 'Cap with evidence',
    successCriteria: ['Primary evidence'],
  });
  ledger.criteria[0].searchCount = 5;
  ledger.criteria[0].candidateIds = ['cand_1'];
  const next = advanceLedgerAfterCheckpoint(ledger, {
    patch: {
      criterionDecision: {
        criterionId: 'c1',
        status: 'needs_more',
        reason: 'Still incomplete',
      },
    },
    targetCriterionId: 'c1',
  });
  assert.equal(next.criteria[0].status, 'partial');
  assert.match(next.criteria[0].reason, /incomplete|attributable/i);
});

test('searchCount at cap without candidates closes as blocked', () => {
  const ledger = createInitialLedger({
    id: 'rq_cap_only',
    text: 'Cap only',
    successCriteria: ['Primary evidence'],
  });
  ledger.criteria[0].searchCount = 5;
  const next = advanceLedgerAfterCheckpoint(ledger, {
    patch: {
      criterionDecision: {
        criterionId: 'c1',
        status: 'needs_more',
        reason: 'Still missing',
      },
    },
    targetCriterionId: 'c1',
  });
  assert.equal(next.criteria[0].status, 'blocked');
  assert.match(next.criteria[0].reason, /search limit|Still missing/i);
});

test('blocked with candidates at allowance end is normalized to partial', () => {
  const ledger = createInitialLedger({
    id: 'rq_blocked_to_partial',
    text: 'Normalize end state',
    successCriteria: ['Primary evidence'],
  });
  ledger.criteria[0].searchCount = 5;
  ledger.criteria[0].candidateIds = ['cand_1'];
  const next = advanceLedgerAfterCheckpoint(ledger, {
    patch: {
      criterionDecision: {
        criterionId: 'c1',
        status: 'blocked',
        reason: 'Could not fully settle',
      },
    },
    targetCriterionId: 'c1',
  });
  assert.equal(next.criteria[0].status, 'partial');
});

test('wave targets and limitations are mutually exclusive with targets winning', () => {
  const partitioned = partitionWaveTargetsAndLimitations({
    targets: [
      { questionId: 'q1', criterionId: 'c1', gap: 'Need primary source' },
      { questionId: 'q1', criterionId: 'c1', gap: 'duplicate' },
    ],
    limitations: [
      { questionId: 'q1', criterionId: 'c1', gap: 'Should not remain' },
      { questionId: 'q1', criterionId: 'c2', gap: 'Accept as limitation' },
    ],
    unresolved: [
      { questionId: 'q2', criterionId: 'c1', gap: 'Also unresolved' },
    ],
  });
  assert.equal(partitioned.targets.length, 1);
  assert.equal(partitioned.targets[0].criterionId, 'c1');
  assert.deepEqual(
    partitioned.limitations.map((item) => `${item.questionId}:${item.criterionId}`).sort(),
    ['q1:c2', 'q2:c1'],
  );
});
