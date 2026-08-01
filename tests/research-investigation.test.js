import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgentLoop } from '../src/core/agent-loop.js';
import {
  appendToolBudgetNote,
  createEmptyCoverage,
  createResearchSearchDefinition,
  createSubmitCandidatesDefinition,
  finalizeInvestigationRound,
  gateCandidatesByUrl,
  indexFetchResult,
  indexSearchResult,
  normalizeSubmittedCandidates,
  normalizeUrl,
  partitionWaveTargetsAndLimitations,
  resolveToolsCap,
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

test('submit_criterion_candidates tool is defined for Scout delivery', () => {
  const def = createSubmitCandidatesDefinition();
  assert.equal(def.function.name, 'submit_criterion_candidates');
  assert.ok(def.function.parameters.properties.candidates);
  assert.deepEqual(def.function.parameters.required, ['candidates']);
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
    { claim: 'Works offline', urls: ['https://example.com/a'], criterionIds: ['c9'] },
    { claim: '', urls: ['https://example.com/b'] },
    { claim: 'No urls', urls: [] },
  ], 'c1');
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].criterionIds, ['c1']);
  assert.equal(candidates[0].claim, 'Works offline');
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
  assert.equal(coverage.criteria[1].priority, 'high');
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
