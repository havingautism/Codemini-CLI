import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateCommandWithLLM, parseEvaluation } from '../src/core/command-evaluator.js';
import { reviewCommandAccess } from '../src/core/command-access-review.js';
import {
  evaluationFromJevAnswers,
  evaluateCommandWithJev,
  jevReviewEnabled,
} from '../src/core/jev-command-review.js';

const jevConfig = {
  ui: { reply_language: 'zh' },
  jev: { enabled: true, api_key: 'secret', model: 'jev-latest' },
  shell: { default: 'bash' },
  sandbox: { enabled: true, mode: 'workspace-write', network: 'none' },
};

test('Jev stays off unless the switch and a key are both set', () => {
  assert.equal(jevReviewEnabled({}), false);
  assert.equal(jevReviewEnabled({ jev: { enabled: true, api_key: '' } }), false);
  assert.equal(jevReviewEnabled({ jev: { enabled: false, api_key: 'secret' } }), false);
  assert.equal(jevReviewEnabled(jevConfig), true);
});

test('Jev review maps score and choice into fixed text and a confidence gate', () => {
  const sure = evaluationFromJevAnswers({
    risk: { type: 'score', score: 1, confidence: 0.91 },
    recommendation: { type: 'choice', choice: 'allow', confidence: 0.88 },
  }, jevConfig);
  assert.equal(sure.risk, 'medium');
  assert.equal(sure.recommendation, 'allow');
  assert.equal(sure.uncertain, false);
  assert.equal(sure.description, '风险中，建议允许。');
  assert.match(sure.sideEffects, /风险和建议/);

  const unsure = evaluationFromJevAnswers({
    risk: { type: 'score', score: 1, confidence: 0.91 },
    recommendation: { type: 'choice', choice: 'allow', confidence: 0.5 },
  }, jevConfig);
  assert.equal(unsure.recommendation, 'allow');
  assert.equal(unsure.uncertain, true);
});

test('uncertain Jev allow does not skip the user', async () => {
  let requests = 0;
  const result = await reviewCommandAccess({
    command: 'touch jev-review-test.txt',
    config: { policy: { safe_mode: true, command_allowlist: [] }, sandbox: { enabled: false } },
    evaluate: async () => evaluationFromJevAnswers({
      risk: { score: 1, confidence: 0.4 },
      recommendation: { choice: 'allow', confidence: 0.4 },
    }, jevConfig),
    requestApproval: async () => {
      requests += 1;
      return { approved: true };
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.source, 'user');
});

test('Jev failure falls back to the fast model and a disabled switch never calls Jev', async () => {
  let jevCalls = 0;
  let fastCalls = 0;
  const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fastCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ choices: [{ message: { content: '{"risk":"low","description":"lists files","sideEffects":"none","recommendation":"allow"}' } }] }),
      };
    };
  try {
    const failed = await evaluateCommandWithLLM({
      command: 'touch notes.txt',
      config: { ...jevConfig, sdk: { provider: 'openai-compatible' }, gateway: { base_url: 'http://127.0.0.1:9/v1', api_key: 'gw' }, model: { name: 'fast' } },
      reviewWithJev: async () => {
        jevCalls += 1;
        throw new Error('jev down');
      },
    });
    assert.equal(jevCalls, 1);
    assert.equal(failed.recommendation, 'allow');
    assert.equal(failed.source, undefined);

    jevCalls = 0;
    await evaluateCommandWithLLM({
      command: 'touch notes.txt',
      config: { jev: { enabled: false, api_key: 'secret' }, sdk: { provider: 'openai-compatible' }, gateway: { base_url: 'http://127.0.0.1:9/v1', api_key: 'gw' }, model: { name: 'fast' } },
      reviewWithJev: async () => {
        jevCalls += 1;
        throw new Error('should not run');
      },
    });
    assert.equal(jevCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(parseEvaluation('{"risk":"low","description":"ok","sideEffects":"none","recommendation":"allow"}').recommendation, 'allow');
});

test('evaluateCommandWithJev sends both questions in one call', async () => {
  let body;
  const evaluation = await evaluateCommandWithJev({
    command: 'touch notes.txt',
    config: jevConfig,
    workspaceRoot: '/tmp/project',
    ask: async (request) => {
      body = request;
      return {
        answers: {
          risk: { score: 0, confidence: 0.95 },
          recommendation: { choice: 'allow', confidence: 0.95 },
        },
      };
    },
  });
  assert.equal(body.questions.risk.type, 'score');
  assert.equal(body.questions.recommendation.type, 'choice');
  assert.equal(evaluation.risk, 'low');
  assert.equal(evaluation.uncertain, false);
});
