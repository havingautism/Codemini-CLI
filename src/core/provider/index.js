import {
  createChatCompletion as createOpenAICompatibleChatCompletion,
  createChatCompletionStream as createOpenAICompatibleChatCompletionStream
} from './openai-compatible.js';
import {
  createChatCompletion as createAnthropicChatCompletion,
  createChatCompletionStream as createAnthropicChatCompletionStream
} from './anthropic.js';
import { recordTokenUsage } from '../token-usage-store.js';
import { getTokenUsageSession } from '../token-usage-context.js';

function recordCompletion(options, provider, result, timing) {
  try {
    recordTokenUsage({ model: options?.model, provider, sessionId: getTokenUsageSession(), usage: result?.usage, timing });
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
  const requestSentAt = new Date().toISOString();
  const provider = getSdkProvider(options?.sdkProvider);
  const result = await (provider === 'anthropic'
    ? createAnthropicChatCompletion(options)
    : createOpenAICompatibleChatCompletion(options));
  return recordCompletion(options, provider, result, { requestSentAt, completedAt: new Date().toISOString() });
}

export async function createChatCompletionStream(options) {
  const timing = { requestSentAt: new Date().toISOString(), firstTokenAt: null };
  const tracked = { ...options };
  for (const name of ['onTextDelta', 'onReasoningDelta', 'onToolCallDelta']) {
    tracked[name] = (...args) => {
      if (!timing.firstTokenAt) timing.firstTokenAt = new Date().toISOString();
      return options?.[name]?.(...args);
    };
  }
  const provider = getSdkProvider(options?.sdkProvider);
  const result = await (provider === 'anthropic'
    ? createAnthropicChatCompletionStream(tracked)
    : createOpenAICompatibleChatCompletionStream(tracked));
  timing.completedAt = new Date().toISOString();
  return recordCompletion(options, provider, result, timing);
}
