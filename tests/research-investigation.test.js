import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgentLoop } from '../src/core/agent-loop.js';
import {
  appendToolBudgetNote,
  buildScoutHandoff,
  createEmptyCoverage,
  createResearchSearchDefinition,
  createSubmitCandidatesDefinition,
  deriveQuestionGaps,
  finalizeInvestigationRound,
  gateCandidatesByUrl,
  indexFetchResult,
  indexSearchResult,
  normalizeSubmittedCandidates,
  normalizeSubmitNarrative,
  normalizeUrl,
  partitionWaveTargetsAndLimitations,
  resolveToolsCap,
  validateSupportVerdicts,
  verifyCandidateSupport,
  RESEARCH_SCOUT_TOOLS_PER_CRITERION,
} from '../src/core/research-investigation.js';

test('research search schema requires criterionId without max_results clamp', () => {
  const base = {
    type: 'function',
    function: {
      name: 'web_search',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'number', description: 'Max results to return' },
        },
        required: ['query'],
      },
    },
  };
  const scoped = createResearchSearchDefinition(base);
  assert.deepEqual(base.function.parameters.required, ['query']);
  assert.deepEqual(scoped.function.parameters.required, ['query', 'criterionId']);
  assert.equal(scoped.function.parameters.properties.criterionId.type, 'string');
  assert.equal(scoped.function.parameters.properties.max_results?.maximum, undefined);
  assert.doesNotMatch(scoped.function.description, /capped at 8/);
});

test('submit_criterion_candidates tool includes summary and gap fields without quote', () => {
  const def = createSubmitCandidatesDefinition();
  assert.equal(def.function.name, 'submit_criterion_candidates');
  assert.ok(def.function.parameters.properties.candidates);
  assert.ok(def.function.parameters.properties.summary);
  assert.ok(def.function.parameters.properties.gap);
  assert.equal(def.function.parameters.properties.candidates.items.properties.quote, undefined);
  assert.deepEqual(def.function.parameters.required, ['candidates', 'summary', 'gap']);
});

test('tool budget note appends fuse progress', () => {
  assert.match(appendToolBudgetNote('ok', 3, 10), /\[tools 3\/10 used, 7 left\]/);
  assert.equal(resolveToolsCap(0), RESEARCH_SCOUT_TOOLS_PER_CRITERION);
  assert.equal(resolveToolsCap(12), 12);
});

test('url index stores search snippets and fetch bodies without downgrading fetch', () => {
  const urlIndex = new Map();
  indexSearchResult(urlIndex, {
    results: [{
      url: 'https://example.com/doc?utm_source=x',
      title: 'Docs',
      snippet: 'Offline editing is supported.',
    }],
  });
  const url = normalizeUrl('https://example.com/doc?utm_source=x');
  assert.equal(urlIndex.get(url).source, 'search');
  assert.match(urlIndex.get(url).text, /Offline editing/);

  indexFetchResult(urlIndex, { url: 'https://example.com/doc' }, {
    final_url: 'https://example.com/doc',
    text: 'Full page: Offline editing is supported in Product X.',
  });
  assert.equal(urlIndex.get(url).source, 'fetch');
  assert.match(urlIndex.get(url).text, /Full page/);

  indexSearchResult(urlIndex, {
    results: [{ url: 'https://example.com/doc', title: 'Docs', snippet: 'short' }],
  });
  assert.equal(urlIndex.get(url).source, 'fetch');
  assert.match(urlIndex.get(url).text, /Full page/);
});

test('normalizeSubmittedCandidates forces criterion id and drops empty claims', () => {
  const candidates = normalizeSubmittedCandidates([
    { claim: 'Works offline', urls: ['https://example.com/a'], criterionIds: ['c9'], quote: 'ignored' },
    { claim: '', urls: ['https://example.com/b'] },
    { claim: 'No urls', urls: [] },
  ], 'c1');
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].criterionIds, ['c1']);
  assert.equal(candidates[0].claim, 'Works offline');
  assert.equal(candidates[0].quote, undefined);
});

test('normalizeSubmittedCandidates keeps at most three URLs per claim', () => {
  const candidates = normalizeSubmittedCandidates([{
    claim: 'Supported by many pages',
    urls: [
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
      'https://example.com/4',
      'https://example.com/2',
    ],
  }], 'c1');
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].urls, [
    'https://example.com/1',
    'https://example.com/2',
    'https://example.com/3',
  ]);
});

test('submit_criterion_candidates schema caps urls at three per claim', () => {
  const def = createSubmitCandidatesDefinition();
  assert.equal(def.function.parameters.properties.candidates.items.properties.urls.maxItems, 3);
  assert.equal(def.function.parameters.properties.candidates.maxItems, 3);
});

test('normalizeSubmittedCandidates keeps at most three claims', () => {
  const candidates = normalizeSubmittedCandidates([
    { claim: 'A', urls: ['https://example.com/a'] },
    { claim: 'B', urls: ['https://example.com/b'] },
    { claim: 'C', urls: ['https://example.com/c'] },
    { claim: 'D', urls: ['https://example.com/d'] },
  ], 'c1');
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((item) => item.claim), ['A', 'B', 'C']);
});

test('validateSupportVerdicts requires support and criterion relevance to accept', () => {
  const gated = [{
    id: 'cand_1',
    claim: 'Offline editing works',
    slices: [{ url: 'https://example.com', toolText: 'Offline editing works in desktop.' }],
  }];
  const verdicts = validateSupportVerdicts({
    verdicts: [{
      candidateId: 'cand_1',
      supported: true,
      relevantToCriterion: false,
      snippet: 'Offline editing works in desktop.',
      reason: 'True but off-topic for pricing criterion',
    }],
  }, gated);
  assert.equal(verdicts[0].supported, true);
  assert.equal(verdicts[0].relevantToCriterion, false);
  assert.equal(verdicts[0].snippet, 'Offline editing works in desktop.');
});

test('normalizeSubmitNarrative keeps summary and gap text', () => {
  const narrative = normalizeSubmitNarrative({
    summary: 'Offline editing is supported.',
    gap: 'Mobile support unclear.',
    note: 'optional',
  });
  assert.equal(narrative.summary, 'Offline editing is supported.');
  assert.equal(narrative.gap, 'Mobile support unclear.');
  assert.equal(narrative.note, 'optional');
});

test('URL gate keeps only candidates whose urls appear in tool results', () => {
  const urlIndex = new Map([
    ['https://example.com/a', { source: 'fetch', text: 'A supports offline editing.' }],
    ['https://example.com/b', { source: 'search', text: 'B mentions sync.' }],
  ]);
  const { accepted, rejected } = gateCandidatesByUrl([
    {
      id: 'cand_1',
      claim: 'Offline works',
      urls: ['https://example.com/a'],
    },
    {
      id: 'cand_2',
      claim: 'Unknown source',
      urls: ['https://missing.example/x'],
    },
    {
      id: 'cand_3',
      claim: 'Needs both',
      urls: ['https://example.com/a', 'https://missing.example/y'],
    },
  ], urlIndex);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, 'cand_1');
  assert.equal(accepted[0].slices[0].toolText.includes('offline'), true);
  assert.equal(rejected.length, 2);
});

test('agent loop checkpoints when shouldCheckpoint returns true after tools', async () => {
  let steps = 0;
  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'go',
    model: 'test-model',
    alwaysAllowTools: ['web_search'],
    toolDefinitions: [{
      type: 'function',
      function: {
        name: 'web_search',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    }],
    toolHandlers: {
      web_search: async () => ({ results: [] }),
    },
    requestCompletion: async () => {
      steps += 1;
      if (steps === 1) {
        return {
          text: '',
          toolCalls: [{
            id: 'call_1',
            name: 'web_search',
            arguments: JSON.stringify({ query: 'x' }),
          }],
        };
      }
      return { text: 'should not reach', toolCalls: [] };
    },
    shouldCheckpoint: () => true,
  });
  assert.equal(result.checkpoint, true);
  assert.equal(steps, 1);
});

test('createEmptyCoverage seeds missing criteria', () => {
  const coverage = createEmptyCoverage({
    id: 'rq_1',
    successCriteria: ['Offline editing confirmed', { text: 'Sync conflict handling', priority: 'high' }],
  });
  assert.equal(coverage.criteria.length, 2);
  assert.equal(coverage.criteria[0].id, 'c1');
  assert.equal(coverage.criteria[0].status, 'missing');
  assert.equal(coverage.criteria[1].text, 'Sync conflict handling');
  assert.equal(coverage.criteria[1].priority, undefined);
});

test('wave targets and limitations stay mutually exclusive', () => {
  const partitioned = partitionWaveTargetsAndLimitations({
    targets: [{ questionId: 'q1', criterionId: 'c1', gap: 'need more' }],
    limitations: [
      { questionId: 'q1', criterionId: 'c1', gap: 'also limitation' },
      { questionId: 'q1', criterionId: 'c2', gap: 'blocked' },
    ],
  });
  assert.equal(partitioned.targets.length, 1);
  assert.equal(partitioned.limitations.length, 1);
  assert.equal(partitioned.limitations[0].criterionId, 'c2');
});

test('finalizeInvestigationRound never returns next_wave', () => {
  const evaluation = finalizeInvestigationRound({
    id: '',
    questions: [],
    evidence: [],
  }, []);
  assert.notEqual(evaluation.decision, 'next_wave');
  assert.ok(['ready_for_report', 'incomplete'].includes(evaluation.decision));
  assert.deepEqual(evaluation.targets, []);
});

test('buildScoutHandoff lists summary and gap instead of reason', () => {
  const handoff = buildScoutHandoff(
    { id: 'q1', text: 'Does offline editing work?' },
    {
      criteria: [{
        id: 'c1',
        status: 'partial',
        reason: 'Accepted 1 claim(s); internal only',
        summary: 'Offline docs editing works in the browser app.',
        gap: 'Mobile offline editing is still unclear.',
      }],
    },
    [],
  );
  assert.match(handoff, /summary: Offline docs editing works/);
  assert.match(handoff, /gap: Mobile offline editing/);
  assert.doesNotMatch(handoff, /Accepted 1 claim/);
});

test('deriveQuestionGaps uses over-approved gap only', () => {
  const gaps = deriveQuestionGaps({
    criteria: [
      { id: 'c1', status: 'covered', gap: '', reason: 'Accepted 2 claim(s).' },
      { id: 'c2', status: 'blocked', gap: 'Need primary source for pricing.', reason: 'Accepted 0' },
      { id: 'c3', status: 'partial', gap: '', reason: 'should not appear' },
    ],
  });
  assert.deepEqual(gaps, ['Need primary source for pricing.']);
});

test('verifyCandidateSupport throws instead of silently accepting on model failure', async () => {
  await assert.rejects(
    () => verifyCandidateSupport({
      config: {
        model: { name: 'dummy' },
        gateway: { base_url: 'http://127.0.0.1:9', api_key: 'x', timeout_ms: 50, max_retries: 0 },
        sdk: {},
      },
      model: 'dummy',
      question: { text: 'Q' },
      criterion: { id: 'c1', text: 'Criterion' },
      gatedCandidates: [{
        id: 'cand_1',
        claim: 'Claim',
        urls: ['https://example.com'],
        slices: [{ url: 'https://example.com', toolText: 'enough text '.repeat(20) }],
      }],
      scoutSummary: 'Summary',
      scoutGap: 'Gap',
    }),
    /./,
  );
});
