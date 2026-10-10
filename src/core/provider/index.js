import {
  createChatCompletion as createOpenAICompatibleChatCompletion,
  createChatCompletionStream as createOpenAICompatibleChatCompletionStream
} from './openai-compatible.js';
import {
  createChatCompletion as createAnthropicChatCompletion,
  createChatCompletionStream as createAnthropicChatCompletionStream
} from './anthropic.js';
import { recordTokenUsage } from '../token-usage-store.js';

function recordCompletion(options, provider, result) {
  try {
    recordTokenUsage({ model: options?.model, provider, usage: result?.usage });
  } catch (error) {
    // A storage failure must not discard a paid completion.
    console.warn(`Token usage could not be saved: ${error.message}`);
  }
  return result;
}

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
  const result = await (provider === 'anthropic'
    ? createAnthropicChatCompletion(options)
    : createOpenAICompatibleChatCompletion(options));
  return recordCompletion(options, provider, result);
}

export async function createChatCompletionStream(options) {
  const provider = getSdkProvider(options?.sdkProvider);
  const result = await (provider === 'anthropic'
    ? createAnthropicChatCompletionStream(options)
    : createOpenAICompatibleChatCompletionStream(options));
  return recordCompletion(options, provider, result);
}
