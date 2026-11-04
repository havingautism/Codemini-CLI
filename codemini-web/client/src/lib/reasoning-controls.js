import {
  normalizeReasoningAuto,
  normalizeReasoningEffort,
} from "../../../../src/core/provider/reasoning-effort.js";

export { normalizeReasoningAuto, normalizeReasoningEffort };

export const REASONING_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

const REASONING_EFFORT_LABELS = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/**
 * Effort colors follow the active palette accent (`--input-shell-accent`),
 * so vscode / github / catppuccin / etc. stay coherent. Levels differ by
 * intensity of the same hue, not by unrelated semantic colors.
 */
export const REASONING_EFFORT_ACCENTS = {
  low: "color-mix(in srgb, var(--input-shell-accent) 48%, var(--bg-secondary))",
  medium: "color-mix(in srgb, var(--input-shell-accent) 64%, var(--bg-secondary))",
  high: "color-mix(in srgb, var(--input-shell-accent) 78%, var(--bg-secondary))",
  xhigh: "color-mix(in srgb, var(--input-shell-accent) 90%, var(--bg-secondary))",
  max: "var(--input-shell-accent)",
};

/** Label / emphasis tint — same theme accent, stepped for readability. */
export const REASONING_EFFORT_ACCENT_TEXT = {
  low: "color-mix(in srgb, var(--input-shell-accent) 70%, var(--text-secondary))",
  medium: "color-mix(in srgb, var(--input-shell-accent) 82%, var(--text-secondary))",
  high: "color-mix(in srgb, var(--input-shell-accent) 92%, var(--text-primary))",
  xhigh: "var(--input-shell-accent)",
  max: "var(--input-shell-accent)",
};

/** Flow animation duration — higher effort = faster flow. */
export const REASONING_EFFORT_FLOW_DURATION = {
  low: "2.4s",
  medium: "1.8s",
  high: "1.3s",
  xhigh: "0.95s",
  max: "0.7s",
};

export function getReasoningEffortIndex(value) {
  const normalized = normalizeReasoningEffort(value);
  const index = REASONING_EFFORT_LEVELS.indexOf(normalized);
  return index >= 0 ? index : REASONING_EFFORT_LEVELS.indexOf("high");
}

export function getReasoningEffortAccent(value) {
  const normalized = normalizeReasoningEffort(value);
  return REASONING_EFFORT_ACCENTS[normalized] || REASONING_EFFORT_ACCENTS.high;
}

export function getReasoningEffortAccentText(value) {
  const normalized = normalizeReasoningEffort(value);
  return (
    REASONING_EFFORT_ACCENT_TEXT[normalized] || REASONING_EFFORT_ACCENT_TEXT.high
  );
}

export function getReasoningEffortFlowDuration(value) {
  const normalized = normalizeReasoningEffort(value);
  return (
    REASONING_EFFORT_FLOW_DURATION[normalized] ||
    REASONING_EFFORT_FLOW_DURATION.high
  );
}

/** Fill ratio ending at the selected thumb center (0 at low … 1 at max). */
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
  return REASONING_EFFORT_LABELS[normalized] || REASONING_EFFORT_LABELS.high;
}

export function extractReasoningFromConfig(config) {
  return {
    enabled: normalizeReasoningEnabled(config?.model?.reasoning_enabled),
    auto: normalizeReasoningAuto(config?.model?.reasoning_auto),
    effort: normalizeReasoningEffort(config?.model?.reasoning_effort),
  };
}

export function extractReasoningRuntimePatch(config) {
  const { enabled, auto, effort } = extractReasoningFromConfig(config);
  return {
    reasoningEnabled: enabled,
    reasoningAuto: auto,
    reasoningEffort: effort,
  };
}

export function getReasoningEffortShortLabel(effort) {
  return getReasoningEffortLabel(effort);
}
