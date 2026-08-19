function parseTimingMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function toIso(value) {
  const ms = parseTimingMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

function pickEarliestIso(...values) {
  const parsed = values.map((value) => ({ value, ms: parseTimingMs(value) }))
    .filter((item) => item.ms != null);
  if (!parsed.length) return null;
  parsed.sort((a, b) => a.ms - b.ms);
  return toIso(parsed[0].ms);
}

function pickLatestIso(...values) {
  const parsed = values.map((value) => ({ value, ms: parseTimingMs(value) }))
    .filter((item) => item.ms != null);
  if (!parsed.length) return null;
  parsed.sort((a, b) => b.ms - a.ms);
  return toIso(parsed[0].ms);
}

export function sanitizeTiming(timing) {
  if (!timing || typeof timing !== 'object') return null;
  const requestSentAt = toIso(timing.requestSentAt);
  if (!requestSentAt) return null;
  return {
    requestSentAt,
    firstTokenAt: toIso(timing.firstTokenAt),
    completedAt: toIso(timing.completedAt)
  };
}

export function mergeTiming(left, right) {
  const a = sanitizeTiming(left);
  const b = sanitizeTiming(right);
  if (!a) return b;
  if (!b) return a;
  return {
    requestSentAt: pickEarliestIso(a.requestSentAt, b.requestSentAt),
    firstTokenAt: pickEarliestIso(a.firstTokenAt, b.firstTokenAt),
    completedAt: pickLatestIso(a.completedAt, b.completedAt)
  };
}

export function createStreamTimingTracker(now = () => new Date()) {
  const timing = {
    requestSentAt: now().toISOString(),
    firstTokenAt: null,
    completedAt: null
  };
  let toolCallAt = null;

  const markVisible = () => {
    if (!timing.firstTokenAt) timing.firstTokenAt = now().toISOString();
  };

  return {
    noteTextDelta(text) {
      if (String(text || '').length) markVisible();
    },
    noteReasoningDelta(text) {
      if (String(text || '').length) markVisible();
    },
    noteToolCallDelta() {
      if (!toolCallAt) toolCallAt = now().toISOString();
    },
    finish() {
      if (!timing.completedAt) {
        if (!timing.firstTokenAt && toolCallAt) timing.firstTokenAt = toolCallAt;
        timing.completedAt = now().toISOString();
      }
      return sanitizeTiming(timing);
    },
    snapshot() {
      return sanitizeTiming(timing);
    }
  };
}

export function formatDurationMs(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = value / 1000;
  if (seconds < 10) return `${seconds.toFixed(2)} s`;
  if (seconds < 100) return `${seconds.toFixed(1)} s`;
  return `${Math.round(seconds)} s`;
}

export function formatTokensPerSecond(tps) {
  const value = Number(tps);
  if (!Number.isFinite(value) || value < 0) return '0.0 tokens/s';
  return `${value.toFixed(1)} tokens/s`;
}

function hasTokenCounts(usage) {
  const keys = [
    'totalTokens',
    'inputTokens',
    'outputTokens',
    'cachedInputTokens',
    'cacheWriteInputTokens',
    'reasoningOutputTokens'
  ];
  return keys.some((key) => Number(usage?.[key] || 0) > 0);
}

export function buildUsagePanelModel(usage) {
  if (!usage || typeof usage !== 'object' || !hasTokenCounts(usage)) return null;
  const input = Math.max(0, Math.round(Number(usage.inputTokens || 0)));
  const output = Math.max(0, Math.round(Number(usage.outputTokens || 0)));
  const cached = Math.max(0, Math.round(Number(usage.cachedInputTokens || 0)));
  const cacheMiss = Math.max(0, Math.round(Number(usage.cacheMissInputTokens || 0)));
  const cacheWrite = Math.max(0, Math.round(Number(usage.cacheWriteInputTokens || 0)));
  const reasoning = Math.max(0, Math.round(Number(usage.reasoningOutputTokens || 0)));
  const requests = Math.max(0, Math.round(Number(usage.requests || 0)));
  const total = Math.max(0, Math.round(Number(usage.totalTokens || 0))) || input + output;
  const tokens = { input, output, cached, cacheMiss, cacheWrite, reasoning, requests, total };

  const timing = sanitizeTiming(usage.timing);
  if (!timing?.requestSentAt || !timing.firstTokenAt || !timing.completedAt) {
    return { tokens, timing: null };
  }
  const sentMs = parseTimingMs(timing.requestSentAt);
  const firstMs = parseTimingMs(timing.firstTokenAt);
  const doneMs = parseTimingMs(timing.completedAt);
  const waitingMs = firstMs - sentMs;
  const generatingMs = doneMs - firstMs;
  const totalMs = doneMs - sentMs;
  if (waitingMs < 0 || generatingMs < 0 || totalMs < 0) {
    return { tokens, timing: null };
  }
  if (waitingMs <= 0 && generatingMs <= 0) {
    return { tokens, timing: null };
  }
  const showTps = generatingMs > 0;
  const tps = showTps ? output / (generatingMs / 1000) : 0;
  return {
    tokens,
    timing: {
      waitingMs,
      generatingMs,
      totalMs,
      tps,
      showTps,
      waitingRatio: totalMs > 0 ? waitingMs / totalMs : 0
    }
  };
}

export function attachTimingToUsage(usage, timing) {
  const clean = sanitizeTiming(timing);
  if (!clean) return usage && typeof usage === 'object' ? { ...usage } : usage;
  const base = usage && typeof usage === 'object' ? { ...usage } : {};
  const merged = mergeTiming(base.timing, clean);
  if (merged) base.timing = merged;
  return base;
}
