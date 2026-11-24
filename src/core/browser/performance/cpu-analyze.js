const SKIP = new Set(['(idle)', '(program)', '(root)', '(garbage collector)']);
const TOP_N = 8;

export function analyzeCpuProfile(profile) {
  const nodes = new Map();
  const parent = new Map();
  for (const node of profile?.nodes || []) {
    if (!node || node.id == null) continue;
    nodes.set(node.id, node);
    for (const child of node.children || []) parent.set(child, node.id);
  }
  const self = new Map();
  const total = new Map();
  const samples = Array.isArray(profile?.samples) ? profile.samples : [];
  const deltas = Array.isArray(profile?.timeDeltas) ? profile.timeDeltas : [];
  let sampledUs = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const delta = Number(deltas[index] || 0);
    if (!(delta > 0)) continue;
    sampledUs += delta;
    const id = samples[index];
    self.set(id, (self.get(id) || 0) + delta);
    let cursor = id;
    const seen = new Set();
    while (cursor != null && !seen.has(cursor)) {
      seen.add(cursor);
      total.set(cursor, (total.get(cursor) || 0) + delta);
      cursor = parent.get(cursor);
    }
  }
  const ranked = [...self.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([id, selfUs]) => {
      const frame = nodes.get(id)?.callFrame || {};
      return {
        functionName: String(frame.functionName || '(anonymous)'),
        selfTime: Number((selfUs / 1000).toFixed(1)),
        totalTime: Number(((total.get(id) || 0) / 1000).toFixed(1)),
        percentage: sampledUs ? Number(((selfUs / sampledUs) * 100).toFixed(1)) : 0,
        sampled: true,
        frame: {
          functionName: String(frame.functionName || ''),
          url: String(frame.url || ''),
          scriptId: String(frame.scriptId || ''),
          lineNumber: Number(frame.lineNumber || 0),
          columnNumber: Number(frame.columnNumber || 0),
        },
      };
    })
    .filter((item) => !SKIP.has(item.functionName))
    .slice(0, TOP_N);
  return { hotspots: ranked, sampledUs };
}
