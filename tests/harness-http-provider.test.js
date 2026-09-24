import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpDecisionProvider } from '../src/core/harness/providers/http.js';

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
        { id: 'next_action', type: 'choice', choice: 'continue', confidence: 0.9 },
        { id: 'action_risk', type: 'score', score: 'low', confidence: 0.9 },
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
