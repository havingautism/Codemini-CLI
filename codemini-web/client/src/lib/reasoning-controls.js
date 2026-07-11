import { t } from "../../i18n/index.js";

export const REASONING_EFFORT_LEVELS = ["auto", "low", "medium", "high"];

/**
 * Effort colors follow the active palette accent (`--input-shell-accent`),
 * so vscode / github / catppuccin / etc. stay coherent. Levels differ by
 * intensity of the same hue, not by unrelated semantic colors.
 */
export const REASONING_EFFORT_ACCENTS = {
  auto: "color-mix(in srgb, var(--input-shell-accent) 42%, var(--bg-secondary))",
  low: "color-mix(in srgb, var(--input-shell-accent) 58%, var(--bg-secondary))",
  medium: "color-mix(in srgb, var(--input-shell-accent) 74%, var(--bg-secondary))",
  high: "color-mix(in srgb, var(--input-shell-accent) 90%, var(--bg-secondary))",
};

/** Label / emphasis tint — same theme accent, stepped for readability. */
export const REASONING_EFFORT_ACCENT_TEXT = {
  auto: "color-mix(in srgb, var(--input-shell-accent) 62%, var(--text-secondary))",
  low: "color-mix(in srgb, var(--input-shell-accent) 74%, var(--text-secondary))",
  medium: "color-mix(in srgb, var(--input-shell-accent) 88%, var(--text-primary))",
  high: "var(--input-shell-accent)",
};

/** Flow animation duration — higher effort = faster flow. */
export const REASONING_EFFORT_FLOW_DURATION = {
  auto: "2.8s",
  low: "2.1s",
  medium: "1.45s",
  high: "0.95s",
};

export function normalizeReasoningEffort(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  return REASONING_EFFORT_LEVELS.includes(normalized) ? normalized : "auto";
}

export function getReasoningEffortIndex(value) {
  const normalized = normalizeReasoningEffort(value);
  const index = REASONING_EFFORT_LEVELS.indexOf(normalized);
  return index >= 0 ? index : 0;
}

export function getReasoningEffortAccent(value) {
  const normalized = normalizeReasoningEffort(value);
  return REASONING_EFFORT_ACCENTS[normalized] || REASONING_EFFORT_ACCENTS.auto;
}

export function getReasoningEffortAccentText(value) {
  const normalized = normalizeReasoningEffort(value);
  return (
    REASONING_EFFORT_ACCENT_TEXT[normalized] || REASONING_EFFORT_ACCENT_TEXT.auto
  );
}

export function getReasoningEffortFlowDuration(value) {
  const normalized = normalizeReasoningEffort(value);
  return (
    REASONING_EFFORT_FLOW_DURATION[normalized] ||
    REASONING_EFFORT_FLOW_DURATION.auto
  );
}

/** Fill ratio ending at the selected thumb center (0 at auto … 1 at high). */
export function getReasoningEffortFillRatio(value) {
  const index = getReasoningEffortIndex(value);
  const count = REASONING_EFFORT_LEVELS.length;
  if (count <= 1) return 1;
  return index / (count - 1);
}

/** Snap a 0–1 ratio to the nearest discrete effort level. */
export function getReasoningEffortFromRatio(ratio) {
  const count = REASONING_EFFORT_LEVELS.length;
  if (count <= 1) return REASONING_EFFORT_LEVELS[0];
  const clamped = Math.min(1, Math.max(0, Number(ratio) || 0));
  const index = Math.round(clamped * (count - 1));
  return REASONING_EFFORT_LEVELS[index];
}

/** Continuous 0–1 ratio from a pointer X within a track rect. */
export function getReasoningEffortRatioFromClientX(clientX, trackRect) {
  if (!trackRect || !(trackRect.width > 0)) return 0;
  return Math.min(1, Math.max(0, (clientX - trackRect.left) / trackRect.width));
}

/** Map a pointer X position within a track rect to the nearest effort level. */
export function getReasoningEffortFromClientX(clientX, trackRect) {
  return getReasoningEffortFromRatio(
    getReasoningEffortRatioFromClientX(clientX, trackRect),
  );
}

export function clearSettledReasoningGesture(gesture, level) {
  return gesture?.level === level && gesture.dragging !== true ? null : gesture;
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
