import { isKimiModelName } from './kimi-gateway.js';

const REASONING_EFFORTS = new Set(['auto', 'low', 'medium', 'high']);
const OPENAI_REASONING_MODEL = /^(?:gpt-5(?:[.-]|$)|o[134](?:-|$)|codex-mini(?:-|$))/i;
const OPENAI_NONE_EFFORT_MODEL = /^gpt-5(?:\.[1-9]\d*|-[1-9]\d*)/i;
const MODERN_ANTHROPIC_MODEL =
  /^claude-(?:(?:opus|sonnet)-(?:4-[6-9]|[5-9](?:-|$))|(?:fable|mythos))/i;

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

export function resolveOpenAICompatibleReasoning({ model, effort } = {}) {
  const normalized = normalizeResolvedReasoningEffort(effort);
  if (normalized === 'auto') return {};

  if (isKimiModelName(model)) {
    return {
      thinking: {
        type: normalized === 'off' ? 'disabled' : 'enabled'
      }
    };
  }

  if (!OPENAI_REASONING_MODEL.test(String(model || ''))) return {};
  if (normalized === 'off') {
    return OPENAI_NONE_EFFORT_MODEL.test(String(model || ''))
      ? { reasoning_effort: 'none' }
      : {};
  }
  return { reasoning_effort: normalized };
}

export function resolveAnthropicReasoning({ model, effort, maxTokens = 4096 } = {}) {
  const normalized = normalizeResolvedReasoningEffort(effort);
  if (normalized === 'auto' || normalized === 'off') return {};

  if (MODERN_ANTHROPIC_MODEL.test(String(model || ''))) {
    return {
      thinking: { type: 'adaptive' },
      output_config: { effort: normalized }
    };
  }

  const outputLimit = Math.max(0, Math.floor(Number(maxTokens) || 4096));
  if (outputLimit <= 2048) return {};
  const requestedBudget = {
    low: 1024,
    medium: 4096,
    high: 16384
  }[normalized];
  return {
    thinking: {
      type: 'enabled',
      budget_tokens: Math.min(requestedBudget, outputLimit - 1024)
    }
  };
}
