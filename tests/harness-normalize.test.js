import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDecisionInput, normalizeDecisionState } from '../src/core/harness/normalize.js';

test('provider normalization preserves user content and long context', () => {
  const content = '用户上下文 '.repeat(800);
  const normalized = normalizeDecisionInput({ content, token: 'do-not-send' }, [], {
    maxString: 20000,
    maxItems: 200,
    maxDepth: 8,
  });
  assert.equal(normalized.state.content, content);
  assert.equal(normalized.state.token, '[redacted]');
});

test('audit normalization can redact content separately from provider input', () => {
  const payload = normalizeDecisionState({ content: 'secret context', nested: { value: 'keep' } }, { redactSensitive: true });
  assert.equal(payload.content, '[redacted]');
  assert.equal(payload.nested.value, 'keep');
});
