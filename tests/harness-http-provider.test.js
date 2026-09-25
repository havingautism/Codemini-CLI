import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpDecisionProvider } from '../src/core/harness/providers/http.js';
import { createJevProvider } from '../src/core/harness/providers/jev.js';

const questions = [
  { id: 'next_action', type: 'choice', options: ['continue'] },
  { id: 'action_risk', type: 'score', levels: ['low'] },
  { id: 'needs_review', type: 'noul', statement: 'review' },
  { id: 'task_complete', type: 'noul', statement: 'done' },
];

test('HTTP provider sends bearer auth and validates typed decisions', async () => {
  let request;
  const provider = createHttpDecisionProvider({
    name: 'jev', baseUrl: 'http://example.test', apiKey: 'secret',
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return { ok: true, async json() { return { modelVersion: 'jev-1', answers: [
        { id: 'next_action', type: 'choice', choice: 'continue', probabilities: { continue: 1 }, confidence: 0.9 },
        { id: 'action_risk', type: 'score', score: 'low', probabilities: { low: 1 }, confidence: 0.9 },
        { id: 'needs_review', type: 'noul', pTrue: 0.1 },
        { id: 'task_complete', type: 'noul', pTrue: 0.8 },
      ] }; } };
    }
  });
  const result = await provider.ask({ state: { token: 'redact' }, questions });
  assert.equal(result.provider, 'jev');
  assert.equal(result.answers[0].choice, 'continue');
  assert.equal(request.init.headers.authorization, 'Bearer secret');
});

test('HTTP provider preserves a Jev base URL when path is empty', async () => {
  let requestUrl = '';
  const provider = createHttpDecisionProvider({
    name: 'jev', baseUrl: 'https://openrouter.ai/api/alpha/decisions',
    path: '',
    fetchImpl: async (url) => {
      requestUrl = String(url);
      return { ok: true, async json() { return { answers: questions.map((question) => ({
        id: question.id,
        type: question.type,
        ...(question.type === 'choice' ? { choice: 'continue', probabilities: { continue: 1 } } : question.type === 'score' ? { score: 'low', probabilities: { low: 1 } } : { pTrue: 0.5 }),
      })) }; } };
    },
  });
  await provider.ask({ state: {}, questions });
  assert.equal(requestUrl, 'https://openrouter.ai/api/alpha/decisions');
});

test('HTTP provider fail-closes on unknown choice', async () => {
  const provider = createHttpDecisionProvider({
    name: 'laya', baseUrl: 'http://example.test',
    fetchImpl: async () => ({ ok: true, async json() { return { answers: questions.map((question) => ({
      id: question.id, type: question.type,
      ...(question.type === 'choice' ? { choice: 'unknown' } : question.type === 'score' ? { score: 'low' } : { pTrue: 0.5 })
    })) }; } })
  });
  const result = await provider.ask({ state: {}, questions });
  assert.equal(result.answers[0].abstain, true);
  assert.equal(result.errors[0], 'provider response schema mismatch');
});

test('Jev provider uses the OpenRouter Decisions API contract', async () => {
  let request;
  const provider = createJevProvider({
    baseUrl: 'https://openrouter.ai/api/alpha/decisions',
    apiKey: 'secret',
    fetchImpl: async (url, init) => {
      request = { url: String(url), init, body: JSON.parse(init.body) };
      return {
        ok: true,
        async json() {
          return {
            model: 'typesafe/jev-1.13-20260917',
            answers: {
              next_action: { type: 'choice', choice: 'continue', probabilities: { continue: 1 }, confidence: 1 },
              action_risk: { type: 'score', score: 0.25, probabilities: { 0: 1 }, confidence: 0.8 },
              needs_review: { type: 'noul', noul: 0.1, confidence: 0.9 },
              task_complete: { type: 'noul', noul: 0.8, confidence: 0.8 },
            },
          };
        },
      };
    },
  });
  const result = await provider.ask({ state: { objective: 'test' }, candidates: [{ id: 'continue', description: '按当前计划继续' }], questions });
  assert.equal(request.url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(request.body.model, 'typesafe/jev-1.13');
  assert.equal(typeof request.body.questions, 'object');
  assert.equal(request.body.questions.next_action.type, 'choice');
  assert.equal(request.body.questions.next_action.criteria.continue, '按当前计划继续');
  assert.equal(result.modelVersion, 'typesafe/jev-1.13-20260917');
  assert.equal(result.answers[1].score, 'low');
  assert.equal(result.answers[1].scoreValue, 0.25);
  assert.deepEqual(result.answers[1].probabilities, { low: 1 });
  assert.equal(result.answers[2].pTrue, 0.1);
  assert.equal(result.errors.length, 0);
});

test('HTTP provider does not claim a calibration for failed requests', async () => {
  const provider = createHttpDecisionProvider({
    name: 'jev', baseUrl: 'http://example.test', fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  const result = await provider.ask({ state: {}, questions });
  assert.equal(result.calibrationId, '');
  assert.equal(result.modelVersion, 'jev-error');
});
