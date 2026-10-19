import { mergeTiming } from './usage-timing.js';

function numberFromPath(obj, pathParts) {
  let current = obj;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return null;
    current = current[part];
  }
  if (current == null || current === '') return null;
  const value = Number(current);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function firstFiniteNumber(obj, paths) {
  for (const pathParts of paths) {
    const value = numberFromPath(obj, pathParts);
    if (value != null) return value;
  }
  return null;
}

function sumFiniteNumbers(obj, paths) {
  let sum = 0;
  let found = false;
  for (const pathParts of paths) {
    const value = numberFromPath(obj, pathParts);
    if (value != null) {
      sum += value;
      found = true;
    }
  }
  return found ? sum : null;
}

function collectRawUsage(usage) {
  if (!usage || typeof usage !== 'object') return [];
  if (Array.isArray(usage.raw)) {
    return usage.raw
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ ...item }));
  }
  return [{ ...usage }];
}

export function normalizeModelUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const promptCacheHitTokens = firstFiniteNumber(usage, [
    ['prompt_cache_hit_tokens'],
    ['promptCacheHitTokens'],
    ['cache_hit_tokens'],
    ['cacheHitTokens']
  ]);
  const promptCacheMissTokens = firstFiniteNumber(usage, [
    ['prompt_cache_miss_tokens'],
    ['promptCacheMissTokens'],
    ['cache_miss_tokens'],
    ['cacheMissTokens']
  ]);
  const explicitInputTokens = firstFiniteNumber(usage, [
    ['prompt_tokens'],
    ['input_tokens'],
    ['inputTokens'],
    ['promptTokens'],
    ['prompt_token_count'],
    ['promptTokenCount'],
    ['input_token_count'],
    ['inputTokenCount'],
    ['input_total_tokens'],
    ['total_input_tokens'],
    ['usage', 'prompt_tokens'],
    ['usage', 'input_tokens'],
    ['usage_metadata', 'prompt_token_count'],
    ['usage_metadata', 'input_token_count'],
    ['usageMetadata', 'promptTokenCount'],
    ['usageMetadata', 'inputTokenCount'],
    ['token_usage', 'prompt_tokens'],
    ['token_usage', 'input_tokens'],
    ['tokenUsage', 'promptTokens'],
    ['tokenUsage', 'inputTokens'],
    ['tokens', 'input_tokens'],
    ['tokens', 'inputTokens'],
    ['tokens', 'prompt_tokens'],
    ['tokens', 'promptTokens'],
    ['billed_units', 'input_tokens'],
    ['billedUnits', 'inputTokens']
  ]);
  const cacheReadInputTokens = firstFiniteNumber(usage, [
    ['cache_read_input_tokens'],
    ['cacheReadInputTokens'],
    ['cache_read_tokens'],
    ['cacheReadTokens']
  ]);
  const outputTokens = firstFiniteNumber(usage, [
    ['completion_tokens'],
    ['output_tokens'],
    ['outputTokens'],
    ['completionTokens'],
    ['completion_token_count'],
    ['completionTokenCount'],
    ['output_token_count'],
    ['outputTokenCount'],
    ['candidates_token_count'],
    ['candidatesTokenCount'],
    ['usage', 'completion_tokens'],
    ['usage', 'output_tokens'],
    ['usage_metadata', 'candidates_token_count'],
    ['usage_metadata', 'output_token_count'],
    ['usageMetadata', 'candidatesTokenCount'],
    ['usageMetadata', 'outputTokenCount'],
    ['token_usage', 'completion_tokens'],
    ['token_usage', 'output_tokens'],
    ['tokenUsage', 'completionTokens'],
    ['tokenUsage', 'outputTokens'],
    ['tokens', 'output_tokens'],
    ['tokens', 'outputTokens'],
    ['tokens', 'completion_tokens'],
    ['tokens', 'completionTokens'],
    ['billed_units', 'output_tokens'],
    ['billedUnits', 'outputTokens']
  ]);
  const explicitTotal = firstFiniteNumber(usage, [
    ['total_tokens'],
    ['totalTokens'],
    ['total_token_count'],
    ['totalTokenCount'],
    ['usage', 'total_tokens'],
    ['usage_metadata', 'total_token_count'],
    ['usageMetadata', 'totalTokenCount'],
    ['token_usage', 'total_tokens'],
    ['tokenUsage', 'totalTokens'],
    ['tokens', 'total_tokens'],
    ['tokens', 'totalTokens']
  ]);
  const cachedInputTokens = firstFiniteNumber(usage, [
    ['prompt_tokens_details', 'cached_tokens'],
    ['input_tokens_details', 'cached_tokens'],
    ['promptTokensDetails', 'cachedTokens'],
    ['inputTokensDetails', 'cachedTokens'],
    ['cache_read_input_tokens'],
    ['cacheReadInputTokens'],
    ['cache_read_tokens'],
    ['cacheReadTokens'],
    ['cached_tokens'],
    ['cachedTokens'],
    ['cached_input_tokens'],
    ['cachedInputTokens'],
    ['cached_content_token_count'],
    ['cachedContentTokenCount'],
    ['usage', 'prompt_tokens_details', 'cached_tokens'],
    ['usage', 'input_tokens_details', 'cached_tokens'],
    ['usage_metadata', 'cached_content_token_count'],
    ['usageMetadata', 'cachedContentTokenCount'],
    ['token_usage', 'prompt_tokens_details', 'cached_tokens'],
    ['tokenUsage', 'promptTokensDetails', 'cachedTokens'],
    ['tokens', 'cached_tokens'],
    ['tokens', 'cachedTokens'],
    ['prompt_cache_hit_tokens'],
    ['promptCacheHitTokens'],
    ['cache_hit_tokens'],
    ['cacheHitTokens']
  ]);
  const explicitCacheMissInputTokens = firstFiniteNumber(usage, [
    ['prompt_cache_miss_tokens'],
    ['promptCacheMissTokens'],
    ['cache_miss_tokens'],
    ['cacheMissTokens']
  ]);
  const cacheWriteInputTokens = firstFiniteNumber(usage, [
    ['cache_creation_input_tokens'],
    ['cacheCreationInputTokens'],
    ['cache_write_input_tokens'],
    ['cacheWriteInputTokens'],
    ['cache_creation_tokens'],
    ['cacheCreationTokens'],
    ['usage', 'cache_creation_input_tokens'],
    ['usage', 'cache_write_input_tokens'],
    ['token_usage', 'cache_creation_input_tokens'],
    ['tokenUsage', 'cacheCreationInputTokens']
  ]) ?? sumFiniteNumbers(usage, [
    ['cache_creation', 'ephemeral_5m_input_tokens'],
    ['cache_creation', 'ephemeral_1h_input_tokens'],
    ['cacheCreation', 'ephemeral5mInputTokens'],
    ['cacheCreation', 'ephemeral1hInputTokens'],
    ['usage', 'cache_creation', 'ephemeral_5m_input_tokens'],
    ['usage', 'cache_creation', 'ephemeral_1h_input_tokens']
  ]);
  const hasCacheUsage = cachedInputTokens != null
    || explicitCacheMissInputTokens != null
    || cacheReadInputTokens != null
    || cacheWriteInputTokens != null;
  // Canonical usage has zero-valued cache fields even when no cache data was reported.
  const isNormalized = ['reported', 'unreported'].includes(usage.cacheUsageStatus);
  const cacheUsageStatus = isNormalized ? usage.cacheUsageStatus : hasCacheUsage ? 'reported' : 'unreported';
  const hasAnthropicSplitCacheInput = explicitInputTokens != null
    && !isNormalized
    && (cacheReadInputTokens != null || cacheWriteInputTokens != null)
    && promptCacheHitTokens == null;
  const cacheMissInputTokens = explicitCacheMissInputTokens ?? (
    hasAnthropicSplitCacheInput
      ? Number(explicitInputTokens || 0) + Number(cacheWriteInputTokens || 0)
      : null
  );
  const inputTokens = explicitInputTokens != null
    ? Number(explicitInputTokens || 0)
      + (hasAnthropicSplitCacheInput ? Number(cacheReadInputTokens || 0) + Number(cacheWriteInputTokens || 0) : 0)
    : (
      promptCacheHitTokens != null || promptCacheMissTokens != null
        ? Number(promptCacheHitTokens || 0) + Number(promptCacheMissTokens || 0)
        : null
    );
  const reasoningOutputTokens = firstFiniteNumber(usage, [
    ['reasoningOutputTokens'],
    ['completion_tokens_details', 'reasoning_tokens'],
    ['output_tokens_details', 'reasoning_tokens'],
    ['completionTokensDetails', 'reasoningTokens'],
    ['outputTokensDetails', 'reasoningTokens'],
    ['reasoning_tokens'],
    ['reasoningTokens'],
    ['thoughts_token_count'],
    ['thoughtsTokenCount'],
    ['usage', 'completion_tokens_details', 'reasoning_tokens'],
    ['usage_metadata', 'thoughts_token_count'],
    ['usageMetadata', 'thoughtsTokenCount']
  ]);
  const totalTokens = explicitTotal ?? (
    inputTokens != null || outputTokens != null
      ? Number(inputTokens || 0) + Number(outputTokens || 0)
      : null
  );
  if (
    inputTokens == null &&
    outputTokens == null &&
    totalTokens == null &&
    cachedInputTokens == null &&
    cacheWriteInputTokens == null
  ) {
    return null;
  }
  return withTiming({
    inputTokens: Math.round(inputTokens || 0),
    outputTokens: Math.round(outputTokens || 0),
    totalTokens: Math.round(totalTokens || 0),
    cachedInputTokens: Math.round(cachedInputTokens || 0),
    cacheMissInputTokens: Math.round(cacheMissInputTokens || 0),
    cacheWriteInputTokens: Math.round(cacheWriteInputTokens || 0),
    cacheUsageStatus,
    reasoningOutputTokens: Math.round(reasoningOutputTokens || 0),
    requests: 1,
    raw: collectRawUsage(usage)
  }, usage);
}

function withTiming(base, ...sources) {
  const timing = sources.reduce((acc, source) => mergeTiming(acc, source?.timing), null);
  if (timing) base.timing = timing;
  return base;
}

