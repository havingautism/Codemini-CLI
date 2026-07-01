import { t } from "../../i18n/index.js";

export const REASONING_EFFORT_LEVELS = ["auto", "low", "medium", "high"];

export function normalizeReasoningEffort(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return REASONING_EFFORT_LEVELS.includes(normalized) ? normalized : "auto";
}

export function normalizeReasoningEnabled(value) {
  return value !== false && value !== "false";
}

export function getReasoningEffortLabel(effort) {
  const normalized = normalizeReasoningEffort(effort);
  const labels = {
    auto: t("reasoningEffortAuto"),
    low: t("reasoningEffortLow"),
    medium: t("reasoningEffortMedium"),
    high: t("reasoningEffortHigh"),
  };
  return labels[normalized] || labels.auto;
}

export function extractReasoningFromConfig(config) {
  return {
    enabled: normalizeReasoningEnabled(config?.model?.reasoning_enabled),
    effort: normalizeReasoningEffort(config?.model?.reasoning_effort),
  };
}

export function extractReasoningRuntimePatch(config) {
  const { enabled, effort } = extractReasoningFromConfig(config);
  return {
    reasoningEnabled: enabled,
    reasoningEffort: effort,
  };
}

export function getReasoningEffortShortLabel(effort) {
  const normalized = normalizeReasoningEffort(effort);
  const labels = {
    auto: t("reasoningEffortAutoShort"),
    low: t("reasoningEffortLowShort"),
    medium: t("reasoningEffortMediumShort"),
    high: t("reasoningEffortHighShort"),
  };
  return labels[normalized] || labels.auto;
}
