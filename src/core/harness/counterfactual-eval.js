export function compareCandidateOutcomes(outcomes = []) {
  const rows = (Array.isArray(outcomes) ? outcomes : []).map((row) => ({
    candidate: String(row.candidate || ''), success: Boolean(row.success), latencyMs: Number(row.latencyMs || 0), cost: Number(row.cost || 0),
  })).filter((row) => row.candidate);
  const grouped = new Map();
  for (const row of rows) {
    const item = grouped.get(row.candidate) || { candidate: row.candidate, count: 0, successes: 0, latencyMs: 0, cost: 0 };
    item.count += 1; item.successes += row.success ? 1 : 0; item.latencyMs += row.latencyMs; item.cost += row.cost; grouped.set(row.candidate, item);
  }
  return [...grouped.values()].map((item) => ({ ...item, successRate: item.successes / item.count, meanLatencyMs: item.latencyMs / item.count, meanCost: item.cost / item.count })).sort((a, b) => b.successRate - a.successRate || a.meanLatencyMs - b.meanLatencyMs);
}

