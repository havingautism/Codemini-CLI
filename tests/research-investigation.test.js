import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runResearchAgentLoop } from '../src/core/research-agent-loop.js';
import {
  appendToolBudgetNote,
  attachFetchArtifactMeta,
  buildScoutHandoff,
  buildUpstreamDependencySummary,
  collectDependencyContextForQuestion,
  candidateToEvidence,
  createEmptyCoverage,
  buildFetchArtifactPreview,
  createReadArtifactDefinition,
  createResearchArtifactStore,
  createResearchSearchDefinition,
  createSubmitCandidatesDefinition,
  createSubmitCriterionReviewDefinition,
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
  selectReadyWaveBatch,
  validateSupportVerdicts,
  verifyCandidateSupport,
  RESEARCH_SCOUT_TOOLS_PER_CRITERION,
} from '../src/core/research-investigation.js';

test('research search schema requires criterionId without max_results clamp', () => {
  const scoped = createResearchSearchDefinition({
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
  });
  assert.equal(scoped.function.name, 'research_web_search');
  assert.deepEqual(scoped.function.parameters.required, ['query', 'criterionId']);
  assert.equal(scoped.function.parameters.properties.criterionId.type, 'string');
  assert.equal(scoped.function.parameters.properties.max_results?.maximum, undefined);
  assert.doesNotMatch(scoped.function.description, /capped at 8/);
});

test('submit_criterion_candidates tool uses source-level snippets', () => {
  const def = createSubmitCandidatesDefinition();
  assert.equal(def.function.name, 'submit_criterion_candidates');
  assert.ok(def.function.parameters.properties.candidates);
  assert.ok(def.function.parameters.properties.summary);
  assert.ok(def.function.parameters.properties.gap);
  assert.equal(def.function.parameters.properties.candidates.items.properties.quote, undefined);
  assert.equal(def.function.parameters.properties.candidates.items.properties.snippet, undefined);
  assert.equal(def.function.parameters.properties.candidates.items.properties.artifactRefs, undefined);
  assert.equal(def.function.parameters.properties.candidates.items.properties.urls, undefined);
  assert.ok(def.function.parameters.properties.candidates.items.properties.sources);
  assert.deepEqual(
    def.function.parameters.properties.candidates.items.properties.sources.items.required,
    ['url', 'snippet'],
  );
  assert.deepEqual(def.function.parameters.required, ['candidates', 'summary', 'gap']);
});

test('read_artifact tool definition is constrained and explicit', () => {
  const def = createReadArtifactDefinition();
  assert.equal(def.function.name, 'read_artifact');
  assert.deepEqual(def.function.parameters.required, ['artifactId']);
  assert.match(def.function.description, /Successful reads count toward the same per-criterion tool budget/i);
  assert.match(def.function.description, /exact artifactId field returned by research_web_fetch/i);
  assert.match(def.function.description, /does not consume budget/i);
});

test('attachFetchArtifactMeta exposes artifactId on fetch results for the model', () => {
  const withArtifact = attachFetchArtifactMeta(
    { title: 'Doc', text: 'hello', final_url: 'https://example.com/a' },
    { artifactId: 'art_123', filePath: '/tmp/art_123.txt' },
  );
  assert.equal(withArtifact.artifactId, 'art_123');
  assert.equal(withArtifact.artifactPersisted, true);
  assert.equal(withArtifact.title, 'Doc');
  assert.match(withArtifact.artifactNote, /exact artifactId/i);

  const without = attachFetchArtifactMeta({ title: 'Empty' }, null);
  assert.equal(without.artifactId, null);
  assert.equal(without.artifactPersisted, false);
  assert.match(without.artifactNote, /No artifact persisted/i);
});

test('submit_criterion_review tool defines clean evaluator payload', () => {
  const def = createSubmitCriterionReviewDefinition();
  assert.equal(def.function.name, 'submit_criterion_review');
  assert.deepEqual(def.function.parameters.required, ['decision', 'verdicts', 'summary', 'gap']);
  assert.deepEqual(def.function.parameters.properties.decision.enum, ['PASS', 'WARNING', 'FAIL']);
  assert.ok(def.function.parameters.properties.verdicts.items.properties.sources);
  assert.equal(def.function.parameters.properties.verdicts.items.properties.snippet, undefined);
  assert.match(def.function.description, /never write accepted\/rejected counts/i);
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
    title: 'Offline Editing',
    metadata: { status: 200, fetch_mode: 'static' },
    text: 'Full page: Offline editing is supported in Product X.',
  });
  assert.equal(urlIndex.get(url).source, 'fetch');
  assert.match(urlIndex.get(url).text, /Title: Offline Editing/);
  assert.match(urlIndex.get(url).text, /URL: https:\/\/example.com\/doc/);
  assert.match(urlIndex.get(url).text, /Full page: Offline editing/);

  indexSearchResult(urlIndex, {
    results: [{ url: 'https://example.com/doc', title: 'Docs', snippet: 'short' }],
  });
  assert.equal(urlIndex.get(url).source, 'fetch');
  assert.match(urlIndex.get(url).text, /Full page/);
});

test('buildFetchArtifactPreview uses fixed metadata plus excerpt', () => {
  const preview = buildFetchArtifactPreview({
    title: 'A Doc',
    final_url: 'https://example.com/a',
    metadata: { status: 200, fetch_mode: 'browser', content_type: 'text/html' },
  }, 'Body preview');
  assert.match(preview, /^Title: A Doc/m);
  assert.match(preview, /^URL: https:\/\/example.com\/a/m);
  assert.match(preview, /^Status: 200/m);
  assert.match(preview, /^Mode: browser/m);
  assert.match(preview, /Body preview/);
});

test('normalizeSubmittedCandidates forces criterion id and drops empty claims', () => {
  const candidates = normalizeSubmittedCandidates([
    { claim: 'Works offline', sources: [{ url: 'https://example.com/a', snippet: 'offline works' }], criterionIds: ['c9'], quote: 'ignored' },
    { claim: '', sources: [{ url: 'https://example.com/b', snippet: 'x' }] },
    { claim: 'No sources', sources: [] },
  ], 'c1');
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].criterionIds, ['c1']);
  assert.equal(candidates[0].claim, 'Works offline');
  assert.equal(candidates[0].quote, undefined);
  assert.equal(candidates[0].sources[0].snippet, 'offline works');
});

test('normalizeSubmittedCandidates keeps at most three sources per claim', () => {
  const candidates = normalizeSubmittedCandidates([{
    claim: 'Supported by many pages',
    sources: [
      { url: 'https://example.com/1', snippet: 'one' },
      { url: 'https://example.com/2', snippet: 'two' },
      { url: 'https://example.com/3', snippet: 'three' },
      { url: 'https://example.com/4', snippet: 'four' },
      { url: 'https://example.com/2', snippet: 'dup' },
    ],
  }], 'c1');
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].sources.map((source) => source.url), [
    'https://example.com/1',
    'https://example.com/2',
    'https://example.com/3',
  ]);
  assert.deepEqual(candidates[0].urls, [
    'https://example.com/1',
    'https://example.com/2',
    'https://example.com/3',
  ]);
});

test('submit_criterion_candidates schema caps sources at three per claim', () => {
  const def = createSubmitCandidatesDefinition();
  assert.equal(def.function.parameters.properties.candidates.items.properties.sources.maxItems, 3);
  assert.equal(def.function.parameters.properties.candidates.maxItems, 3);
});

test('normalizeSubmittedCandidates keeps at most three claims', () => {
  const candidates = normalizeSubmittedCandidates([
    { claim: 'A', sources: [{ url: 'https://example.com/a', snippet: 'a' }] },
    { claim: 'B', sources: [{ url: 'https://example.com/b', snippet: 'b' }] },
    { claim: 'C', sources: [{ url: 'https://example.com/c', snippet: 'c' }] },
    { claim: 'D', sources: [{ url: 'https://example.com/d', snippet: 'd' }] },
  ], 'c1');
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((item) => item.claim), ['A', 'B', 'C']);
});

test('normalizeSubmittedCandidates preserves per-source snippet and artifact id', () => {
  const candidates = normalizeSubmittedCandidates([{
    claim: 'A',
    sources: [
      { url: 'https://example.com/a', snippet: 'Exact source line', artifactId: 'art_1' },
      { url: 'https://example.com/b', snippet: 'Second line', artifactId: 'art_2' },
    ],
    riskFlags: ['numeric', 'causal'],
  }], 'c1');
  assert.deepEqual(candidates[0].sources, [
    { url: 'https://example.com/a', snippet: 'Exact source line', artifactId: 'art_1' },
    { url: 'https://example.com/b', snippet: 'Second line', artifactId: 'art_2' },
  ]);
  assert.deepEqual(candidates[0].riskFlags, ['numeric', 'causal']);
});

test('validateSupportVerdicts requires support and criterion relevance to accept', () => {
  const gated = [{
    id: 'cand_1',
    claim: 'Offline editing works',
    sources: [{ url: 'https://example.com', toolText: 'Offline editing works in desktop.', artifactId: '' }],
  }];
  const verdicts = validateSupportVerdicts({
    verdicts: [{
      candidateId: 'cand_1',
      supported: true,
      relevantToCriterion: false,
      sources: [{ url: 'https://example.com', snippet: 'Offline editing works in desktop.' }],
      reason: 'True but off-topic for pricing criterion',
    }],
  }, gated);
  assert.equal(verdicts[0].supported, true);
  assert.equal(verdicts[0].relevantToCriterion, false);
  assert.equal(verdicts[0].sources[0].snippet, 'Offline editing works in desktop.');
});

test('validateSupportVerdicts does not hard-require snippet to be a corpus substring', () => {
  const gated = [{
    id: 'cand_1',
    claim: '桌面端支持离线编辑',
    sources: [{
      url: 'https://example.com',
      toolText: 'Offline editing works in the desktop app.',
      artifactId: 'art_1',
    }],
  }];
  const verdicts = validateSupportVerdicts({
    verdicts: [{
      candidateId: 'cand_1',
      supported: true,
      relevantToCriterion: true,
      sources: [{
        url: 'https://example.com',
        snippet: '文档说明桌面端可离线编辑',
      }],
    }],
  }, gated);
  assert.equal(verdicts[0].supported, true);
  assert.equal(verdicts[0].relevantToCriterion, true);
  assert.equal(verdicts[0].sources[0].snippet, '文档说明桌面端可离线编辑');
  assert.equal(Boolean(verdicts[0].supported && verdicts[0].relevantToCriterion), true);
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

test('URL gate keeps valid sources and drops missing ones', () => {
  const urlIndex = new Map([
    ['https://example.com/a', { source: 'fetch', text: 'A supports offline editing.', artifactId: 'art_1' }],
    ['https://example.com/b', { source: 'search', text: 'B mentions sync.' }],
  ]);
  const { accepted, rejected } = gateCandidatesByUrl([
    {
      id: 'cand_1',
      claim: 'Offline works',
      sources: [{ url: 'https://example.com/a', snippet: 'offline editing' }],
    },
    {
      id: 'cand_2',
      claim: 'Unknown source',
      sources: [{ url: 'https://missing.example/x', snippet: 'missing' }],
    },
    {
      id: 'cand_3',
      claim: 'Keeps valid source',
      sources: [
        { url: 'https://example.com/a', snippet: 'offline editing' },
        { url: 'https://missing.example/y', snippet: 'gone' },
      ],
    },
  ], urlIndex);
  assert.equal(accepted.length, 2);
  assert.equal(accepted[0].id, 'cand_1');
  assert.equal(accepted[0].sources[0].toolText.includes('offline'), true);
  assert.equal(accepted[0].sources[0].artifactId, 'art_1');
  assert.equal(accepted[1].id, 'cand_3');
  assert.equal(accepted[1].sources.length, 1);
  assert.equal(accepted[1].sources[0].url, 'https://example.com/a');
  assert.equal(rejected.length, 1);
});

test('candidateToEvidence keeps all verified sources', () => {
  const evidence = candidateToEvidence(
    {
      id: 'cand_1',
      claim: 'Offline editing works',
      confidence: 'high',
      criterionIds: ['c1'],
    },
    'q1',
    {
      supported: true,
      relevantToCriterion: true,
      sources: [
        { url: 'https://example.com/a', snippet: 'edit offline', artifactId: 'art_1' },
        { url: 'https://example.com/b', snippet: 'works offline', artifactId: '' },
      ],
    },
  );
  assert.equal(evidence.claim, 'Offline editing works');
  assert.equal(evidence.sources.length, 2);
  assert.equal(evidence.url, 'https://example.com/a');
  assert.equal(evidence.snippet, 'edit offline');
  assert.deepEqual(evidence.sources[1], {
    url: 'https://example.com/b',
    snippet: 'works offline',
    artifactId: '',
  });
});

test('artifact store persists fetched text for later reads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-research-artifact-test-'));
  try {
    const store = createResearchArtifactStore({
      sessionId: 's1',
      scoutRunId: 'sr1',
      criterionId: 'c1',
      rootDir: root,
    });
    const artifact = await store.persistFetch('https://example.com/a', {
      final_url: 'https://example.com/a',
      title: 'Doc',
      text: '0123456789abcdef',
    });
    assert.equal(artifact.url, 'https://example.com/a');
    assert.deepEqual(store.listArtifactIds(), [artifact.artifactId]);
    const chunk = await store.readArtifact({ artifactId: artifact.artifactId, offset: 4, maxChars: 4 });
    assert.equal(chunk.text, '4567');
    assert.equal(store.artifactForUrl('https://example.com/a').artifactId, artifact.artifactId);
    await assert.rejects(
      () => store.readArtifact({ artifactId: 'art_missing' }),
      /Artifact not found for this Scout run/,
    );
    const restored = createResearchArtifactStore({
      sessionId: 's1',
      scoutRunId: 'sr1',
      criterionId: 'c1',
      rootDir: root,
    });
    restored.loadManifest(store.toManifest());
    const restoredChunk = await restored.readArtifact({ artifactId: artifact.artifactId, offset: 8, maxChars: 4 });
    assert.equal(restoredChunk.text, '89ab');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('research agent loop checkpoints when shouldCheckpoint returns true after tools', async () => {
  let steps = 0;
  const result = await runResearchAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'go',
    model: 'test-model',
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

test('research agent loop keeps large tool bodies in messages (no chat persist preview)', async () => {
  const body = 'BODY_MARKER_' + 'x'.repeat(9000);
  const result = await runResearchAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'go',
    model: 'test-model',
    toolResultMaxChars: 12000,
    toolDefinitions: [{
      type: 'function',
      function: {
        name: 'read_artifact',
        parameters: { type: 'object', properties: { artifactId: { type: 'string' } } },
      },
    }],
    toolHandlers: {
      read_artifact: async () => ({
        artifactId: 'art_1',
        text: body,
        totalChars: body.length,
      }),
    },
    requestCompletion: async ({ messages }) => {
      const toolMsg = messages.find((m) => m.role === 'tool');
      if (toolMsg) {
        assert.ok(!String(toolMsg.content).includes('persisted-output'));
        assert.ok(String(toolMsg.content).includes('BODY_MARKER_'));
        assert.ok(String(toolMsg.content).length > 8000);
        return { text: 'done', toolCalls: [] };
      }
      return {
        text: '',
        toolCalls: [{
          id: 'call_read',
          name: 'read_artifact',
          arguments: JSON.stringify({ artifactId: 'art_1' }),
        }],
      };
    },
  });
  assert.equal(result.text, 'done');
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
        verification: 'WARNING',
        summary: 'Offline docs editing works in the browser app.',
        gap: 'Mobile offline editing is still unclear.',
        warning: 'Evidence is browser-only.',
      }],
    },
    [],
  );
  assert.match(handoff, /verification: WARNING/);
  assert.match(handoff, /summary: Offline docs editing works/);
  assert.match(handoff, /gap: Mobile offline editing/);
  assert.match(handoff, /warning: Evidence is browser-only/);
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

test('buildUpstreamDependencySummary uses accepted claims and criterion notes only', () => {
  const summary = buildUpstreamDependencySummary({
    question: { id: 'q1', text: 'What are the main approaches?', status: 'done' },
    coverage: {
      criteria: [{
        id: 'c1',
        status: 'covered',
        summary: 'Three harness patterns dominate.',
        gap: 'Latency tradeoffs unclear.',
        warning: 'Most sources are vendor blogs.',
      }],
    },
    evidence: [
      { questionId: 'q1', status: 'accepted', claim: 'Pattern A uses tool budgets.' },
      { questionId: 'q1', status: 'accepted', claim: 'Pattern B isolates subagents.' },
      { questionId: 'q1', status: 'revoked', claim: 'Should not appear.' },
      { questionId: 'q2', status: 'accepted', claim: 'Other question claim.' },
    ],
  });
  assert.match(summary, /What are the main approaches/);
  assert.match(summary, /Pattern A uses tool budgets/);
  assert.match(summary, /Pattern B isolates subagents/);
  assert.match(summary, /summary: Three harness patterns/);
  assert.match(summary, /gap: Latency tradeoffs/);
  assert.match(summary, /warning: Most sources are vendor blogs/);
  assert.doesNotMatch(summary, /Should not appear/);
  assert.doesNotMatch(summary, /Other question claim/);
});

test('same upstream summary can be reused by many dependents', () => {
  const upstream = {
    question: { id: 'q1', text: 'Discovery', status: 'partial' },
    coverage: {
      criteria: [{ id: 'c1', summary: 'Found X and Y', gap: 'Need depth on X' }],
    },
    evidence: [
      { questionId: 'q1', status: 'accepted', claim: 'X is primary.' },
    ],
  };
  const forQ2 = buildUpstreamDependencySummary(upstream);
  const forQ3 = buildUpstreamDependencySummary(upstream);
  assert.equal(forQ2, forQ3);
  assert.match(forQ2, /X is primary/);
});

test('selectReadyWaveBatch keeps dependents waiting until upstream completes', () => {
  const questionById = new Map([
    ['q1', { id: 'q1', text: 'Root', dependsOn: [], status: 'pending' }],
    ['q2', { id: 'q2', text: 'Harness', dependsOn: ['q1'], status: 'pending' }],
    ['q3', { id: 'q3', text: 'Context', dependsOn: ['q1'], status: 'pending' }],
    ['q4', { id: 'q4', text: 'Future', dependsOn: ['q2', 'q3'], status: 'pending' }],
  ]);

  const first = selectReadyWaveBatch({
    pendingIds: ['q1', 'q2', 'q3', 'q4'],
    completedIds: [],
    questionById,
    maxParallel: 4,
  });
  assert.deepEqual(first.batchIds, ['q1']);
  assert.equal(first.waiting.length, 3);
  assert.deepEqual(
    first.waiting.find((item) => item.questionId === 'q4')?.waitingOn.sort(),
    ['q2', 'q3'],
  );

  const afterQ1 = selectReadyWaveBatch({
    pendingIds: ['q2', 'q3', 'q4'],
    completedIds: ['q1'],
    questionById,
    maxParallel: 4,
  });
  assert.deepEqual(afterQ1.batchIds.sort(), ['q2', 'q3']);
  assert.deepEqual(afterQ1.waiting.map((item) => item.questionId), ['q4']);
  assert.deepEqual(afterQ1.waiting[0].waitingOn.sort(), ['q2', 'q3']);

  const afterMid = selectReadyWaveBatch({
    pendingIds: ['q4'],
    completedIds: ['q1', 'q2', 'q3'],
    questionById,
    maxParallel: 4,
  });
  assert.deepEqual(afterMid.batchIds, ['q4']);
  assert.deepEqual(afterMid.waiting, []);
});

test('selectReadyWaveBatch never dumps all pending when deps block everyone', () => {
  const questionById = new Map([
    ['q1', { id: 'q1', text: 'A', dependsOn: ['q2'], status: 'pending' }],
    ['q2', { id: 'q2', text: 'B', dependsOn: ['q1'], status: 'pending' }],
  ]);
  const batch = selectReadyWaveBatch({
    pendingIds: ['q1', 'q2'],
    completedIds: [],
    questionById,
    maxParallel: 3,
  });
  // Cycle: start exactly one to avoid deadlock, not both.
  assert.equal(batch.batchIds.length, 1);
  assert.equal(batch.waiting.length, 1);
});

test('selectReadyWaveBatch does not treat unknown deps as satisfied', () => {
  const questionById = new Map([
    ['q1', { id: 'q1', text: 'Root', dependsOn: [], status: 'pending' }],
    ['q2', { id: 'q2', text: 'Broken', dependsOn: ['missing_upstream'], status: 'pending' }],
  ]);
  const batch = selectReadyWaveBatch({
    pendingIds: ['q1', 'q2'],
    completedIds: [],
    questionById,
    maxParallel: 3,
  });
  assert.deepEqual(batch.batchIds, ['q1']);
  assert.equal(batch.waiting[0].questionId, 'q2');
  assert.deepEqual(batch.waiting[0].waitingOn, ['missing_upstream']);
});
