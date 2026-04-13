import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCommandWithLLM } from '../src/core/command-evaluator.js';

/** Minimal mock server that returns a canned LLM response */
function createMockConfig(overrides = {}) {
  return {
    sdk: { provider: 'openai' },
    gateway: {
      base_url: 'http://127.0.0.1:19999',
      api_key: 'test-key',
      ...overrides.gateway
    },
    model: {
      name: 'test-model',
      ...overrides.model
    },
    ...overrides
  };
}

describe('evaluateCommandWithLLM', () => {
  it('returns fail-closed result when gateway is unreachable', async () => {
    const config = createMockConfig();
    const result = await evaluateCommandWithLLM({
      command: 'npm install lodash',
      config,
      workspaceRoot: '/tmp/test'
    });
    assert.equal(result.risk, 'high');
    assert.equal(result.recommendation, 'deny');
  });

  it('returns fail-closed result for empty command', async () => {
    const config = createMockConfig();
    const result = await evaluateCommandWithLLM({
      command: '',
      config,
      workspaceRoot: '/tmp/test'
    });
    assert.equal(result.risk, 'high');
    assert.equal(result.recommendation, 'deny');
  });

  it('returns fail-closed result for null command', async () => {
    const config = createMockConfig();
    const result = await evaluateCommandWithLLM({
      command: null,
      config,
      workspaceRoot: '/tmp/test'
    });
    assert.equal(result.risk, 'high');
    assert.equal(result.recommendation, 'deny');
  });

  it('returns valid structure on all code paths', async () => {
    const config = createMockConfig();
    const result = await evaluateCommandWithLLM({
      command: 'rm -rf /',
      config,
      workspaceRoot: '/tmp/test'
    });
    assert.ok(['low', 'medium', 'high'].includes(result.risk));
    assert.ok(['allow', 'deny'].includes(result.recommendation));
    assert.ok(typeof result.description === 'string');
    assert.ok(typeof result.sideEffects === 'string');
  });
});
