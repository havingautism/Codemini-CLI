const MAX_EVENTS = 20_000;
const TRACE_COMPLETE_MS = 4_000;
const TRACE_CATEGORIES = ['devtools.timeline', 'v8.execute', 'blink.user_timing'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function metricMap(payload) {
  const out = {};
  for (const item of payload?.metrics || []) {
    if (item && typeof item.name === 'string' && typeof item.value === 'number') out[item.name] = item.value;
  }
  return out;
}

export function diffMetrics(before = {}, after = {}) {
  const out = {};
  for (const name of Object.keys(after)) {
    if (typeof before[name] === 'number' && typeof after[name] === 'number') {
      out[name] = Number((after[name] - before[name]).toFixed(3));
    }
  }
  return out;
}

export async function startTrace(cdp) {
  const events = [];
  let complete = false;
  let truncated = false;
  const onData = (payload) => {
    const batch = Array.isArray(payload?.value) ? payload.value : [];
    for (const event of batch) {
      if (events.length >= MAX_EVENTS) {
        truncated = true;
        return;
      }
      events.push(event);
    }
  };
  const onComplete = () => { complete = true; };
  cdp.on('Tracing.dataCollected', onData);
  cdp.on('Tracing.tracingComplete', onComplete);
  const detach = () => {
    cdp.off('Tracing.dataCollected', onData);
    cdp.off('Tracing.tracingComplete', onComplete);
  };
  try {
    await cdp.send('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: {
        recordMode: 'recordUntilFull',
        includedCategories: TRACE_CATEGORIES,
      },
    });
  } catch (error) {
    detach();
    throw error;
  }
  return {
    async stop() {
      try {
        await cdp.send('Tracing.end');
        const deadline = Date.now() + TRACE_COMPLETE_MS;
        while (!complete && Date.now() < deadline) await sleep(25);
        return { events, complete, truncated };
      } finally {
        detach();
      }
    },
  };
}

export async function startCpu(cdp) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }).catch(() => {});
  await cdp.send('Profiler.start');
  return {
    async stop() {
      try {
        const result = await cdp.send('Profiler.stop');
        return result?.profile || null;
      } finally {
        await cdp.send('Profiler.disable').catch(() => {});
      }
    },
  };
}

export async function enableMetrics(cdp) {
  await cdp.send('Performance.enable');
  try {
    return metricMap(await cdp.send('Performance.getMetrics'));
  } catch (error) {
    await cdp.send('Performance.disable').catch(() => {});
    throw error;
  }
}

export async function disableMetrics(cdp) {
  try {
    return metricMap(await cdp.send('Performance.getMetrics'));
  } finally {
    await cdp.send('Performance.disable').catch(() => {});
  }
}
