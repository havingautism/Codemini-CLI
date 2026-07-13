const REASONING_EFFORTS = new Set(['auto', 'low', 'medium', 'high']);

function normalizeModelName(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  const leaf = raw.split('/').at(-1) || raw;
  return leaf.replace(/:(?:free|extended|thinking)$/i, '');
}

function isOpenAIReasoningModel(model) {
  return /^(?:gpt-5(?:[.-]|$)|o[134](?:-|$)|codex-mini(?:-|$))/i.test(model);
}

function isOpenAINoneEffortModel(model) {
  return /^gpt-5\.(?:[1-9]\d*)(?:[.-]|$)/i.test(model);
}

function isOpenAIHighOnlyModel(model) {
  return /^gpt-5(?:[.-])pro(?:[.-]|$)/i.test(model);
}

function isClaudeModel(model) {
  return /^claude(?:-|$)/i.test(model);
}

function isClaudeAlwaysThinkingModel(model) {
  return /^claude-(?:fable|mythos)(?:-|$)/i.test(model);
}

function isClaudeAdaptiveModel(model) {
  if (isClaudeAlwaysThinkingModel(model)) return true;
  if (/^claude-sonnet-[5-9](?:-|$)/i.test(model)) return true;
  const match = model.match(/^claude-(?:opus|sonnet)-(\d+)[.-](\d+)(?:[.-]|$)/i);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 4 || (major === 4 && minor >= 6);
}

function isClaudeManualThinkingModel(model) {
  if (!isClaudeModel(model) || isClaudeAdaptiveModel(model)) return false;
  return /^claude-(?:(?:3[.-]7-(?:sonnet|opus|haiku))|(?:(?:opus|sonnet|haiku)-4))(?:[.-]|$)/i.test(model);
}

function isClaudeOpus45Model(model) {
  return /^claude-opus-4[.-]5(?:[.-]|$)/i.test(model);
}

function isDeepSeekToggleModel(model) {
  return /^deepseek-v4(?:[.-]|$)/i.test(model);
}

function isDeepSeekForcedThinkingModel(model) {
  return /^(?:deepseek-reasoner|deepseek-r1)(?:[.-]|$)/i.test(model);
}

function isGlmThinkingModel(model) {
  const match = model.match(/^glm-(\d+)(?:[.-](\d+))?/i);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  return major > 4 || (major === 4 && minor >= 5);
}

function isMiniMaxM2Model(model) {
  return /^minimax-m2(?:[.-]|$)/i.test(model);
}

function isKimiToggleModel(model) {
  return /^kimi-k2[.-](?:5|6)(?:[.-]|$)/i.test(model);
}

function isKimiForcedThinkingModel(model) {
  return /^kimi-k2-thinking(?:-|$)/i.test(model);
}

function isQwenThinkingOnlyModel(model) {
  return /^qwen.*[-.]thinking(?:[-.]|$)/i.test(model)
    || /^qwen3[.-]7-max-(?:preview|2026-05-17)(?:-|$)/i.test(model);
}

function isQwenNonThinkingModel(model) {
  return /^qwen3-coder-(?:next|plus)(?:-|$)/i.test(model);
}

function isQwenHybridThinkingModel(model) {
  if (!/^qwen/i.test(model) || isQwenThinkingOnlyModel(model) || isQwenNonThinkingModel(model)) return false;
  return /^(?:qwen3(?:[.-]|$)|qwen-(?:plus|flash|turbo)(?:[-.]|$))/i.test(model);
}

export function normalizeReasoningEffort(value) {
  const normalized = String(value || 'auto').trim().toLowerCase();
  return REASONING_EFFORTS.has(normalized) ? normalized : 'auto';
}

export function resolveConfiguredReasoningEffort({ enabled = true, effort } = {}) {
  return enabled === false ? 'off' : normalizeReasoningEffort(effort);
}

function normalizeResolvedReasoningEffort(value) {
  return String(value || '').trim().toLowerCase() === 'off'
    ? 'off'
    : normalizeReasoningEffort(value);
}

function enabledType(effort) {
  return { thinking: { type: effort === 'off' ? 'disabled' : 'enabled' } };
}

function resolveOpenAIEffort(model, effort) {
  if (!isOpenAIReasoningModel(model)) return {};
  if (isOpenAIHighOnlyModel(model)) {
    return effort === 'off' || effort === 'auto' ? {} : { reasoning_effort: 'high' };
  }
  if (effort === 'off') {
    if (isOpenAINoneEffortModel(model)) return { reasoning_effort: 'none' };
    return /^gpt-5(?:[.-]|$)/i.test(model) ? { reasoning_effort: 'minimal' } : {};
  }
  return { reasoning_effort: effort };
}

export function resolveOpenAICompatibleReasoning({ model, effort } = {}) {
  const normalizedModel = normalizeModelName(model);
  const normalizedEffort = normalizeResolvedReasoningEffort(effort);
  if (normalizedEffort === 'auto') return {};

  const openai = resolveOpenAIEffort(normalizedModel, normalizedEffort);
  if (Object.keys(openai).length > 0) return openai;

  if (isClaudeModel(normalizedModel)) {
    if (isClaudeAlwaysThinkingModel(normalizedModel) && normalizedEffort === 'off') return {};
    return { reasoning: { effort: normalizedEffort === 'off' ? 'none' : normalizedEffort } };
  }

  if (isDeepSeekToggleModel(normalizedModel)) {
    if (normalizedEffort === 'off') return enabledType('off');
    return {
      ...enabledType(normalizedEffort),
      reasoning_effort: 'high'
    };
  }
  if (isDeepSeekForcedThinkingModel(normalizedModel) || isMiniMaxM2Model(normalizedModel)) return {};

  if (isGlmThinkingModel(normalizedModel)) return enabledType(normalizedEffort);

  if (isKimiToggleModel(normalizedModel)) return enabledType(normalizedEffort);
  if (isKimiForcedThinkingModel(normalizedModel)) return {};

  if (isQwenHybridThinkingModel(normalizedModel)) {
    return { enable_thinking: normalizedEffort !== 'off' };
  }
  if (isQwenThinkingOnlyModel(normalizedModel)) return {};

  return {};
}

function manualThinkingBudget(effort, maxTokens) {
  const outputLimit = Math.max(0, Math.floor(Number(maxTokens) || 4096));
  if (outputLimit <= 1024) return 0;
  const requested = { low: 1024, medium: 4096, high: 16384 }[effort];
  return Math.min(requested, outputLimit - 1);
}

export function resolveAnthropicReasoning({ model, effort, maxTokens = 4096 } = {}) {
  const normalizedModel = normalizeModelName(model);
  const normalizedEffort = normalizeResolvedReasoningEffort(effort);
  if (normalizedEffort === 'auto') return {};

  if (isClaudeAdaptiveModel(normalizedModel)) {
    if (normalizedEffort === 'off') {
      return isClaudeAlwaysThinkingModel(normalizedModel)
        ? {}
        : { thinking: { type: 'disabled' } };
    }
    return {
      thinking: { type: 'adaptive' },
      output_config: { effort: normalizedEffort }
    };
  }

  if (isClaudeManualThinkingModel(normalizedModel)) {
    if (normalizedEffort === 'off') return {};
    const budgetTokens = manualThinkingBudget(normalizedEffort, maxTokens);
    if (budgetTokens <= 0) return {};
    return {
      thinking: { type: 'enabled', budget_tokens: budgetTokens },
      ...(isClaudeOpus45Model(normalizedModel)
        ? { output_config: { effort: normalizedEffort } }
        : {})
    };
  }

  if (isDeepSeekToggleModel(normalizedModel)) {
    if (normalizedEffort === 'off') return enabledType('off');
    return {
      ...enabledType(normalizedEffort),
      output_config: { effort: 'high' }
    };
  }
  if (isDeepSeekForcedThinkingModel(normalizedModel) || isMiniMaxM2Model(normalizedModel)) return {};

  if (isGlmThinkingModel(normalizedModel)) {
    if (normalizedEffort === 'off') return enabledType('off');
    const budgetTokens = manualThinkingBudget(normalizedEffort, maxTokens);
    return budgetTokens > 0
      ? { thinking: { type: 'enabled', budget_tokens: budgetTokens } }
      : {};
  }

  if (isKimiToggleModel(normalizedModel)) {
    if (normalizedEffort === 'off') return enabledType('off');
    const budgetTokens = manualThinkingBudget(normalizedEffort, maxTokens);
    return budgetTokens > 0
      ? { thinking: { type: 'enabled', budget_tokens: budgetTokens } }
      : {};
  }
  if (isKimiForcedThinkingModel(normalizedModel)) return {};

  if (isQwenHybridThinkingModel(normalizedModel)) {
    if (normalizedEffort === 'off') return { thinking: { type: 'disabled' } };
    const budgetTokens = manualThinkingBudget(normalizedEffort, maxTokens);
    return budgetTokens > 0
      ? { thinking: { type: 'enabled', budget_tokens: budgetTokens } }
      : {};
  }
  if (isQwenThinkingOnlyModel(normalizedModel)) return {};

  return {};
}

export function modelUsesFixedKimiSampling(model) {
  const normalizedModel = normalizeModelName(model);
  return isKimiToggleModel(normalizedModel) || isKimiForcedThinkingModel(normalizedModel);
}
