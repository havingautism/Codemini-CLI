const LONG_TASK_US = 50_000;
const TASK_NAMES = new Set(['RunTask', 'LongTask']);
const FALLBACK_NAMES = new Set(['FunctionCall', 'EventDispatch', 'EvaluateScript']);
const MAX_TASKS = 8;

function completeEvents(events) {
  return (Array.isArray(events) ? events : []).filter((event) => (
    event
    && event.ph === 'X'
    && Number(event.dur) > 0
  ));
}

function mainThreadId(events) {
  const totals = new Map();
  for (const event of events) {
    if (event.tid == null) continue;
    totals.set(event.tid, (totals.get(event.tid) || 0) + Number(event.dur));
  }
  let best = null;
  let bestDur = 0;
  for (const [tid, dur] of totals) {
    if (dur > bestDur) {
      best = tid;
      bestDur = dur;
    }
  }
  return best;
}

function firstFrame(event) {
  const found = [];
  const walk = (node) => {
    if (!node || found.length || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const line = node.lineNumber ?? node.line;
    if ((node.url || node.scriptId) && line != null) {
      found.push({
        functionName: String(node.functionName || ''),
        url: String(node.url || ''),
        scriptId: String(node.scriptId || ''),
        lineNumber: Number(line) || 0,
        columnNumber: Number(node.columnNumber ?? node.column ?? 0) || 0,
      });
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(event?.args);
  return found[0] || null;
}

function contains(parent, child) {
  const start = Number(child.ts);
  const end = start + Number(child.dur);
  return Number(parent.ts) <= start && Number(parent.ts) + Number(parent.dur) >= end;
}

export function analyzeTrace(events = []) {
  const complete = completeEvents(events);
  const named = complete.filter((event) => TASK_NAMES.has(event.name));
  const pool = named.length
    ? named
    : complete.filter((event) => FALLBACK_NAMES.has(event.name));
  const thread = mainThreadId(pool);
  const candidates = pool
    .filter((event) => thread == null || event.tid === thread)
    .filter((event) => Number(event.dur) > LONG_TASK_US)
    .sort((left, right) => Number(right.dur) - Number(left.dur) || Number(left.ts) - Number(right.ts));
  const kept = [];
  for (const event of candidates) {
    if (kept.some((parent) => contains(parent, event))) continue;
    kept.push(event);
    if (kept.length >= MAX_TASKS) break;
  }
  kept.sort((left, right) => Number(left.ts) - Number(right.ts));
  const longTasks = kept.map((event) => ({
    name: event.name,
    startTime: Number((Number(event.ts) / 1000).toFixed(1)),
    duration: Number((Number(event.dur) / 1000).toFixed(1)),
    frame: firstFrame(event),
  }));
  const blocking = longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
  return {
    longTasks,
    ...(longTasks.length ? { estimatedBlockingTime: Number(blocking.toFixed(1)) } : {}),
    eventCount: Array.isArray(events) ? events.length : 0,
  };
}
