import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachCurrentTurnModelContent,
  buildRuntimeStateSnapshot,
} from '../src/core/chat-runtime.js';

test('current-turn model input is persisted for trajectory inspection', () => {
  const message = attachCurrentTurnModelContent(
    { role: 'user', content: 'Fix the bug' },
    '<turn_context>\n<coding_harness>tasks=required</coding_harness>\n</turn_context>\n\n<task>\nFix the bug\n</task>',
  );

  assert.equal(message.content, 'Fix the bug');
  assert.match(message.model_content, /<coding_harness>tasks=required<\/coding_harness>/);
  assert.equal(message.model_content_scope, 'current_turn');
});

test('runtime CTX reports the latest request input usage, not the next-request estimate', () => {
  const snapshot = buildRuntimeStateSnapshot({
    currentSession: {
      id: 'session-1',
      messages: [
        { role: 'user', content: 'Explain the current context.' },
        {
          role: 'assistant',
          content: 'A long response that belongs to the next request only.',
          usage: { inputTokens: 2048, outputTokens: 512, totalTokens: 2560 },
        },
      ],
    },
    config: {
      model: { max_context_tokens: 10000 },
      execution: { mode: 'normal' },
      sandbox: {},
      sdk: {},
    },
    model: 'test-model',
    executionMode: 'normal',
    workspaceRoot: 'C:\\workspace',
  });

  assert.equal(snapshot.currentContextTokens, 2048);
  assert.equal(snapshot.contextUsagePct, 20.48);
  assert.equal(snapshot.contextUsageSource, 'actual');
});

test('runtime CTX fallback excludes the latest assistant response', () => {
  const messagesBeforeResponse = [
    { role: 'user', content: 'Current request' },
  ];
  const snapshot = buildRuntimeStateSnapshot({
    currentSession: {
      id: 'session-1',
      messages: [
        ...messagesBeforeResponse,
        { role: 'assistant', content: 'x'.repeat(4000) },
      ],
    },
    config: {
      model: { max_context_tokens: 10000 },
      context: { project_context_enabled: false },
      execution: { mode: 'normal' },
      sandbox: {},
      sdk: {},
    },
    model: 'test-model',
    executionMode: 'normal',
    workspaceRoot: 'C:\\workspace',
  });

  assert.equal(snapshot.contextUsageSource, 'estimated');
  assert.ok(snapshot.currentContextTokens < 3000);
});

test('runtime CTX uses the active sub-session request without adding the parent', () => {
  const snapshot = buildRuntimeStateSnapshot({
    currentSession: {
      id: 'parent',
      messages: [
        { role: 'user', content: 'Parent' },
        { role: 'assistant', content: 'Parent response', usage: { inputTokens: 8000 } },
      ],
    },
    extraSession: {
      messages: [
        { role: 'user', content: 'Sub-session' },
        { role: 'assistant', content: 'Sub response', usage: { inputTokens: 1200 } },
      ],
    },
    config: {
      model: { max_context_tokens: 10000 },
      execution: { mode: 'normal' },
      sandbox: {},
      sdk: {},
    },
    model: 'test-model',
    executionMode: 'normal',
    workspaceRoot: 'C:\\workspace',
  });

  assert.equal(snapshot.currentContextTokens, 1200);
  assert.equal(snapshot.contextUsagePct, 12);
});
