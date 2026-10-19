import { buildTrajectory } from './session-trajectory.js';

export function buildSessionContextStats(messages = []) {
  const { metrics, events } = buildTrajectory({ messages });
  const tools = new Map();
  let toolDurationMs = 0;
  let timedTools = 0;
  for (const event of events) {
    if (event.kind !== 'tool') continue;
    const name = event.title || 'tool';
    tools.set(name, (tools.get(name) || 0) + 1);
    const card = event.sourceCard;
    const explicit = card?.durationMs;
    const start = Date.parse(card?.startedAt);
    const end = Date.parse(card?.endedAt);
    const duration = explicit != null && Number.isFinite(Number(explicit)) ? Number(explicit)
      : Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
    if (duration != null && duration >= 0 && event.status !== 'running') {
      toolDurationMs += duration;
      timedTools += 1;
    }
  }
  return {
    turns: metrics.turns,
    calls: metrics.calls,
    skills: events.filter((event) => event.kind === 'skill').length,
    tools: [...tools].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    toolDurationMs: timedTools ? toolDurationMs : null,
    timedTools,
  };
}

export function tokenSegments(totals) {
  const input = Math.max(0, totals.inputTokens || 0);
  const output = Math.max(0, totals.outputTokens || 0);
  const cached = Math.min(input, Math.max(0, totals.cachedInputTokens || 0));
  const write = Math.min(input - cached, Math.max(0, totals.cacheWriteInputTokens || 0));
  return [
    { key: 'contextInput', value: input - cached - write, color: 'var(--accent-blue)' },
    { key: 'contextCacheRead', value: cached, color: 'var(--accent-teal)' },
    { key: 'contextCacheWrite', value: write, color: 'var(--accent-orange)' },
    { key: 'contextOutput', value: output, color: 'var(--accent-purple)' },
    { key: 'contextOther', value: Math.max(0, (totals.totalTokens || 0) - input - output), color: 'var(--text-muted)' },
  ];
}
