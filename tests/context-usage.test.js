import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachCurrentTurnModelContent,
  buildRuntimeStateSnapshot,
} from '../src/core/chat-runtime.js';

test('model input is persisted for trajectory inspection and future request stability', () => {
  const message = attachCurrentTurnModelContent(
    { role: 'user', content: 'Fix the bug' },
    '<turn_context>\n<coding_harness>tasks=required</coding_harness>\n</turn_context>\n\n<task>\nFix the bug\n</task>',
  );

  assert.equal(message.content, 'Fix the bug');
  assert.match(message.model_content, /<coding_harness>tasks=required<\/coding_harness>/);
  assert.equal(message.model_content_scope, undefined);
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

test('runtime CTX uses the post-compact estimate until the next request reports usage', () => {
  const compactAt = Date.now();
  const snapshot = buildRuntimeStateSnapshot({
    currentSession: {
      id: 'session-1',
      messages: [
        { role: 'user', content: 'Earlier prompt' },
        {
          role: 'assistant',
          content: 'Earlier answer',
          at: new Date(compactAt - 20).toISOString(),
          usage: { inputTokens: 148820 },
        },
      ],
      compact: {
        estimatedTokens: 11115,
        estimatedAt: compactAt,
        view: [
          {
            role: 'assistant',
            content: 'summary',
            at: new Date(compactAt - 10).toISOString(),
            usage: { inputTokens: 148820 },
          },
          { role: 'user', content: 'Continue the task', at: new Date(compactAt - 5).toISOString() },
        ],
      },
    },
    config: {
      model: { max_context_tokens: 202752 },
      execution: { mode: 'normal' },
      sandbox: {},
      sdk: {},
    },
    model: 'test-model',
    executionMode: 'normal',
    workspaceRoot: 'C:\\workspace',
  });

  assert.equal(snapshot.currentContextTokens, 11115);
  assert.equal(snapshot.contextUsageSource, 'estimated');
  assert.equal(snapshot.maxContextTokens, 202752);
  assert.ok(Math.abs(snapshot.contextUsagePct - (11115 / 202752) * 100) < 1e-6);
});

test('runtime CTX follows real input tokens after the next post-compact request', () => {
  const compactAt = Date.now() - 1000;
  const snapshot = buildRuntimeStateSnapshot({
    currentSession: {
      id: 'session-1',
      messages: [
        { role: 'user', content: 'Continue the task' },
        {
          role: 'assistant',
          content: 'Done',
          at: new Date(compactAt + 500).toISOString(),
          usage: { inputTokens: 29427 },
        },
      ],
      compact: {
        estimatedTokens: 11115,
        estimatedAt: compactAt,
        view: [
          { role: 'assistant', content: 'summary', at: new Date(compactAt - 10).toISOString() },
          { role: 'user', content: 'Continue the task' },
          {
            role: 'assistant',
            content: 'Done',
            at: new Date(compactAt + 500).toISOString(),
            usage: { inputTokens: 29427 },
          },
        ],
      },
    },
    config: {
      model: { max_context_tokens: 202752 },
      execution: { mode: 'normal' },
      sandbox: {},
      sdk: {},
    },
    model: 'test-model',
    executionMode: 'normal',
    workspaceRoot: 'C:\\workspace',
  });

  assert.equal(snapshot.currentContextTokens, 29427);
  assert.equal(snapshot.contextUsageSource, 'actual');
  assert.ok(Math.abs(snapshot.contextUsagePct - (29427 / 202752) * 100) < 1e-6);
});

