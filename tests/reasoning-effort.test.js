import assert from 'node:assert/strict';
import test from 'node:test';

import {
  modelUsesFixedKimiSampling,
  resolveAnthropicReasoning,
  resolveOpenAICompatibleReasoning,
} from '../src/core/provider/reasoning-effort.js';

test('OpenAI reasoning generations use only supported off values', () => {
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'openai/gpt-5.4', effort: 'off' }),
    { reasoning_effort: 'none' },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'openai/gpt-5', effort: 'off' }),
    { reasoning_effort: 'minimal' },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'openai/gpt-5-2025-08-07', effort: 'off' }),
    { reasoning_effort: 'minimal' },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'openai/o3', effort: 'off' }),
    {},
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'openai/gpt-5-pro', effort: 'low' }),
    { reasoning_effort: 'high' },
  );
});

test('Claude generations select adaptive or manual thinking', () => {
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'anthropic/claude-sonnet-4.6', effort: 'medium', maxTokens: 8192 }),
    { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } },
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'claude-sonnet-4.5', effort: 'medium', maxTokens: 8192 }),
    { thinking: { type: 'enabled', budget_tokens: 4096 } },
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'claude-opus-4-5-20251101', effort: 'low', maxTokens: 8192 }),
    { thinking: { type: 'enabled', budget_tokens: 1024 }, output_config: { effort: 'low' } },
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'claude-sonnet-5', effort: 'off' }),
    { thinking: { type: 'disabled' } },
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'claude-3-7-sonnet-20250219', effort: 'low', maxTokens: 4096 }),
    { thinking: { type: 'enabled', budget_tokens: 1024 } },
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'claude-sonnet-4.5', effort: 'low', maxTokens: 1024 }),
    {},
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'claude-mythos-5', effort: 'off' }),
    {},
  );
});

test('DeepSeek V4 supports explicit toggles in both API formats', () => {
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'deepseek/deepseek-v4-flash', effort: 'off' }),
    { thinking: { type: 'disabled' } },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'deepseek-v4-pro', effort: 'low' }),
    { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'deepseek-v4-flash', effort: 'high' }),
    { thinking: { type: 'enabled' }, output_config: { effort: 'high' } },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'deepseek/deepseek-r1', effort: 'off' }),
    {},
  );
});

test('GLM generations toggle thinking without inventing effort levels', () => {
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'z-ai/glm-5.1', effort: 'off' }),
    { thinking: { type: 'disabled' } },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'glm-4.6', effort: 'low' }),
    { thinking: { type: 'enabled' } },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'glm-4.4', effort: 'high' }),
    {},
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'z-ai/glm-5', effort: 'medium', maxTokens: 8192 }),
    { thinking: { type: 'enabled', budget_tokens: 4096 } },
  );
});

test('Kimi only toggles hybrid K2.5 and K2.6 generations', () => {
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'moonshotai/kimi-k2.6', effort: 'off' }),
    { thinking: { type: 'disabled' } },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'kimi-k2.5', effort: 'high' }),
    { thinking: { type: 'enabled' } },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'kimi-k2-thinking', effort: 'off' }),
    {},
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'moonshot-v1-128k', effort: 'high' }),
    {},
  );
  assert.equal(modelUsesFixedKimiSampling('moonshotai/kimi-k2.6'), true);
  assert.equal(modelUsesFixedKimiSampling('moonshot-v1-128k'), false);
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'kimi-k2.5', effort: 'low', maxTokens: 4096 }),
    { thinking: { type: 'enabled', budget_tokens: 1024 } },
  );
});

test('Qwen hybrid and thinking-only generations are separated', () => {
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'qwen/qwen3.7-plus', effort: 'off' }),
    { enable_thinking: false },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'qwen-plus', effort: 'medium' }),
    { enable_thinking: true },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'qwen3-235b-a22b-thinking-2507', effort: 'off' }),
    {},
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'qwen/qwen3.7-max-preview', effort: 'off' }),
    {},
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'qwen/qwen3.7-max-2026-05-20', effort: 'off' }),
    { enable_thinking: false },
  );
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'qwen3-coder-plus', effort: 'high' }),
    {},
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'qwen3.7-plus', effort: 'low', maxTokens: 1024 }),
    {},
  );
});

test('MiniMax M2 and unknown models receive no unsupported thinking controls', () => {
  assert.deepEqual(
    resolveOpenAICompatibleReasoning({ model: 'minimax/minimax-m2.7', effort: 'off' }),
    {},
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'MiniMax-M2.7', effort: 'high' }),
    {},
  );
  assert.deepEqual(
    resolveAnthropicReasoning({ model: 'custom/model', effort: 'high' }),
    {},
  );
});
