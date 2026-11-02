import test from 'node:test';
import assert from 'node:assert/strict';
import { createDistillationJudge, normalizeDistillationConfig } from '../src/core/harness/distillation.js';
import { evaluateSessionMemory } from '../src/core/memory-session-review.js';
import { buildReflectSkillDraft, attachReflectTargets } from '../src/core/reflect-skill.js';
import { validateWebConfigValue } from '../codemini-web/shared/web-config-policy.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureToInbox, listInbox } from '../src/core/memory-store.js';
import { createHarnessSqliteStore } from '../src/core/harness/audit/harness-sqlite-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

const config = (mode = 'filter') => ({ harness: { enabled: true, provider: 'jev',
  providers: { jev: { base_url: 'https://example.test/decide', api_key: 'test-key' } },
  distillation: { memory_enabled: true, skill_enabled: true, mode, confidence_threshold: 0.8, max_candidates: 8 },
} });
const sourceMessages = [{ role: 'user', content: 'Always use focused tests before the full suite.' },
  { role: 'assistant', content: 'Accepted as a lasting project convention.' }];
const memoryCandidate = { scope: 'project', kind: 'convention', family: 'repo',
  content: 'Use focused tests before the full suite.', summary: 'Test order', semantic_key: 'repo:test-order',
  decision_state: 'accepted', durable_score: 8, confidence: 0.9, evidence_indices: [0] };

function judge({ kind = 'memory', mode = 'filter', reusable = 0.95, duplicate = 0.01, preflight = 0.95, override = {}, fail = false } = {}) {
  const requests = [];
  const events = [];
  const settings = config(mode);
  Object.assign(settings.harness, override);
  const instance = createDistillationJudge({ config: settings, kind, sessionId: 's1', projectDir: '/repo',
    audit: (event) => events.push(event), adapter: { async ask(request) {
      requests.push(request);
      if (fail) throw new Error('service offline');
      return { provider: 'jev', modelVersion: 'test-model', answers: request.questions.map((question) => question.type === 'choice'
        ? { id: question.id, type: 'choice', choice: 'global', confidence: 0.95 }
        : { id: question.id, type: 'noul', pTrue: question.id === 'worth_extracting' ? preflight : question.id.startsWith('reusable_') ? reusable : duplicate }) };
    } },
  });
  return { instance, requests, events };
}

test('distillation is opt-in, obeys harness and rollout, and normalizes invalid settings', async () => {
  assert.deepEqual(normalizeDistillationConfig(), { memory_enabled: false, skill_enabled: false,
    mode: 'shadow', confidence_threshold: 0.8, max_candidates: 8 });
  assert.equal(normalizeDistillationConfig({ confidence_threshold: 'invalid', max_candidates: Infinity }).confidence_threshold, 0.8);
  assert.equal(normalizeDistillationConfig({ confidence_threshold: 0, max_candidates: 999 }).max_candidates, 16);
  for (const override of [{ enabled: false }, { provider: 'rules' }, { distillation: {} }, { providers: {} },
    { rollout: { enabled: true, percentage: 0, risk_tiers: ['low'] } }]) {
    const { instance, requests } = judge({ override });
    assert.equal(instance.enabled, false);
    assert.equal((await instance.preflight(sourceMessages)).extract, true);
    assert.deepEqual(await instance.assess([memoryCandidate]), [memoryCandidate]);
    assert.equal(requests.length, 0);
  }
});

test('preflight skips only confident negatives in filter mode with complete evidence', async () => {
  assert.equal((await judge({ preflight: 0.2 }).instance.preflight(sourceMessages)).extract, false);
  assert.equal((await judge({ preflight: 0.4 }).instance.preflight(sourceMessages)).extract, true);
  assert.equal((await judge({ preflight: 0.01, mode: 'shadow' }).instance.preflight(sourceMessages)).extract, true);
  assert.equal((await judge({ preflight: 0.01 }).instance.preflight(Array(11).fill(sourceMessages[0]))).extract, true);
  assert.equal((await judge({ preflight: 0.01 }).instance.preflight([{ role: 'user', content: 'a'.repeat(1001) }])).extract, true);
});

test('candidate decisions batch reuse, duplication and scope without widening applicability', async () => {
  const { instance, requests, events } = judge();
  const candidates = await instance.assess([memoryCandidate, { ...memoryCandidate, summary: 'Other' }], [{ content: 'Existing convention', scope: 'project' }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].questions.length, 6);
  assert.match(requests[0].state.candidates[0].textBlocks[0], /focused tests/);
  assert.equal(candidates[0].scope, 'project');
  assert.equal(candidates[0].distillation.suggestedScope, 'global');
  assert.equal(candidates[0].distillation.reusableProbability, 0.95);
  assert.ok(events[0].inputHash);
  assert.equal(Object.hasOwn(events[0], 'state'), false);
});

test('filter rejects high-confidence duplicates and non-reusable candidates; shadow only annotates', async () => {
  assert.equal((await judge({ duplicate: 0.9 }).instance.assess([memoryCandidate])).length, 0);
  assert.equal((await judge({ reusable: 0.1 }).instance.assess([memoryCandidate])).length, 0);
  const shadow = await judge({ duplicate: 0.9, mode: 'shadow' }).instance.assess([memoryCandidate]);
  assert.equal(shadow.length, 1);
  assert.equal(shadow[0].distillation.reason, 'duplicate');
  assert.equal((await judge({ reusable: 0.4, duplicate: 0.6 }).instance.assess([memoryCandidate])).length, 1);
});

test('failure, abstention and malformed probabilities retain the original candidates', async () => {
  const failed = judge({ fail: true });
  assert.equal((await failed.instance.preflight(sourceMessages)).extract, true);
  assert.equal((await failed.instance.assess([memoryCandidate])).length, 1);
  for (const answer of [null, NaN, -1, 2]) {
    const { instance } = judge({ reusable: answer, duplicate: answer });
    const result = await instance.assess([memoryCandidate]);
    assert.equal(result.length, 1);
    assert.equal(result[0].distillation.reusableProbability, null);
  }
  const instance = createDistillationJudge({ config: config(), kind: 'memory', audit: null,
    adapter: { async ask() { return { provider: 'jev', answers: [{ id: 'reusable_0', type: 'noul', pTrue: 0, abstain: true }] }; } } });
  assert.equal((await instance.assess([memoryCandidate])).length, 1);
});

test('budget overflow and incomplete candidate text are retained', async () => {
  const { instance, requests } = judge({ duplicate: 0.99, override: { distillation: {
    memory_enabled: true, mode: 'filter', max_candidates: 1,
  } } });
  const candidates = [memoryCandidate, { ...memoryCandidate, summary: 'Beyond budget' }];
  assert.deepEqual(await instance.assess(candidates), [candidates[1]]);
  assert.equal(requests[0].questions.length, 3);
  assert.equal((await instance.assess([{ ...memoryCandidate, content: 'a'.repeat(6001) }])).length, 1);
});

test('memory preflight saves the extraction call and evidence gates run before candidate decisions', async () => {
  let calls = 0;
  const complete = async () => { calls += 1; return { text: JSON.stringify({ candidates: [memoryCandidate] }) }; };
  const args = { session: { id: 's1', projectDir: '/repo' }, messages: sourceMessages, config: config(), maxInputChars: 12000,
    complete, loadExisting: async () => [] };
  assert.deepEqual(await evaluateSessionMemory({ ...args, judge: judge({ preflight: 0.01 }).instance }), []);
  assert.equal(calls, 0);
  const result = await evaluateSessionMemory({ ...args, judge: judge().instance });
  assert.equal(calls, 1);
  assert.equal(result[0].distillation.provider, 'jev');
  const invalid = judge();
  assert.deepEqual(await evaluateSessionMemory({ ...args, judge: invalid.instance, complete: async () => ({ text: JSON.stringify({
    candidates: [{ ...memoryCandidate, evidence_indices: [], decision_state: 'proposed' }],
  }) }) }), []);
  assert.equal(invalid.requests.length, 1); // Preflight only; ungrounded candidates never reach the judge.
});

test('Skill preflight and filtering preserve explicit requests, revisions and draft metadata', async () => {
  let calls = 0;
  const args = { session: { id: 's1', messages: sourceMessages }, config: config(),
    complete: async () => { calls += 1; return { text: JSON.stringify({ candidates: [{ name: 'test-first', description: 'Test workflow', content: '## Workflow\nRun focused tests.' }] }) }; },
    loadExisting: async () => [] };
  assert.deepEqual(await buildReflectSkillDraft({ ...args, judge: judge({ kind: 'skill', preflight: 0.01 }).instance }), []);
  assert.equal(calls, 0);
  const directed = judge({ kind: 'skill', preflight: 0.01, duplicate: 0.99 });
  const drafts = await buildReflectSkillDraft({ ...args, request: 'Preserve this workflow', judge: directed.instance });
  assert.equal(drafts.length, 1);
  assert.equal(directed.requests.length, 1); // No preflight for an explicit request.
  assert.equal(drafts[0].distillation.mode, 'shadow');
  assert.equal(attachReflectTargets({ candidates: drafts })[0].distillation.reason, 'duplicate');
  assert.equal((await buildReflectSkillDraft({ ...args, previousDraft: drafts[0], feedback: 'Revise it', judge: directed.instance })).length, 1);
  assert.equal((await buildReflectSkillDraft({ ...args, judge: judge({ kind: 'skill', duplicate: 0.99 }).instance })).length, 0);
});

test('Web config validates distillation candidate bounds and probability thresholds', () => {
  for (const value of [0, 17, 1.5, '8']) assert.throws(() => validateWebConfigValue('harness.distillation.max_candidates', value));
  for (const value of [NaN, Infinity, 0.49, 1.01, '0.8']) assert.throws(() => validateWebConfigValue('harness.distillation.confidence_threshold', value));
  validateWebConfigValue('harness.distillation.max_candidates', 8);
  validateWebConfigValue('harness.distillation.confidence_threshold', 0.8);
});

test('Jev transport, audit and inbox retain typed distillation results through persistence', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-distillation-'));
  const originalDirectory = process.env.CODEMINI_GLOBAL_DIR;
  const originalFetch = globalThis.fetch;
  process.env.CODEMINI_GLOBAL_DIR = directory;
  const bodies = [];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    bodies.push(body);
    return { ok: true, async json() { return { model: 'jev-test', answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]) =>
      [id, question.type === 'choice' ? { type: 'choice', choice: 'project', confidence: 0.9 }
        : { type: 'noul', noul: id.startsWith('duplicate_') ? 0.01 : 0.95 }])) }; } };
  };
  try {
    const instance = createDistillationJudge({ config: config(), kind: 'memory', sessionId: 'persisted-session' });
    const [candidate] = await instance.assess([memoryCandidate], [], { messages: sourceMessages });
    assert.equal(bodies.length, 1);
    assert.match(bodies[0].state.candidates[0].textBlocks[0], /focused tests/);
    assert.equal(Object.keys(bodies[0].questions).length, 3);
    const store = createHarnessSqliteStore();
    const [episode] = store.listEpisodes({ sessionId: 'persisted-session' });
    assert.equal(episode.status, 'completed');
    assert.equal(store.listEpisodeEvents(episode.id)[0].payload.decision.provider, 'jev');
    await captureToInbox({ scope: 'project', summary: candidate.summary, details: candidate.content, evidence: { distillation: candidate.distillation } });
    assert.equal((await listInbox())[0].evidence.distillation.suggestedScope, 'project');
    assert.equal((await listInbox())[0].evidence.distillation.reusableProbability, 0.95);
  } finally {
    globalThis.fetch = originalFetch;
    closeSqliteDatabasesForTests(directory);
    if (originalDirectory === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = originalDirectory;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('distillation omits secret-like text and never filters based on the omitted evidence', async () => {
  const { instance, requests } = judge({ preflight: 0, duplicate: 1 });
  const messages = [{ role: 'user', content: 'api_key=sk-testing-secret-value' }];
  assert.equal((await instance.preflight(messages)).extract, true);
  assert.doesNotMatch(JSON.stringify(requests[0].state), /sk-testing/);
  const candidate = { content: 'api_key=sk-testing-secret-value' };
  assert.equal((await instance.assess([candidate], [], { messages })).length, 1);
  assert.doesNotMatch(JSON.stringify(requests[1].state), /sk-testing/);
});
