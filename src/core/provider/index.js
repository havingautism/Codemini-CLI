import {
  createChatCompletion as createOpenAICompatibleChatCompletion,
  createChatCompletionStream as createOpenAICompatibleChatCompletionStream
} from './openai-compatible.js';
import {
  createChatCompletion as createAnthropicChatCompletion,
  createChatCompletionStream as createAnthropicChatCompletionStream
} from './anthropic.js';

function normalizeSdkProvider(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'anthropic') return 'anthropic';
  return 'openai-compatible';
}

export function getSdkProvider(configOrValue) {
  if (configOrValue && typeof configOrValue === 'object' && !Array.isArray(configOrValue)) {
    return normalizeSdkProvider(configOrValue?.sdk?.provider);
  }
  return normalizeSdkProvider(configOrValue);
}

export async function createChatCompletion(options) {
  const provider = getSdkProvider(options?.sdkProvider);
  if (provider === 'anthropic') {
    return createAnthropicChatCompletion(options);
  }
  return createOpenAICompatibleChatCompletion(options);
}

export async function createChatCompletionStream(options) {
  const provider = getSdkProvider(options?.sdkProvider);
  if (provider === 'anthropic') {
    return createAnthropicChatCompletionStream(options);
  }
  return createOpenAICompatibleChatCompletionStream(options);
}
