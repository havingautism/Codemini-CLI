import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSession } from '../src/core/browser/session.js';
import { buildBrowserHandlers } from '../src/core/browser/handlers.js';
import { analyzeTrace } from '../src/core/browser/performance/trace-analyze.js';
import { analyzeCpuProfile } from '../src/core/browser/performance/cpu-analyze.js';
import { buildPerformanceReport } from '../src/core/browser/performance/report.js';

test('trace analysis keeps a RunTask and does not add the nested FunctionCall', () => {
  const analyzed = analyzeTrace([
    { name: 'RunTask', ph: 'X', ts: 1_000_000, dur: 80_000, tid: 1, args: { data: { stackTrace: [{ url: 'http://localhost/assets/index.js', scriptId: '9', lineNumber: 0, columnNumber: 10, functionName: 'calculateData' }] } } },
    { name: 'FunctionCall', ph: 'X', ts: 1_010_000, dur: 60_000, tid: 1 },
    { name: 'RunTask', ph: 'X', ts: 2_000_000, dur: 40_000, tid: 1 },
    { name: 'LongTask', ph: 'X', ts: 1_000_000, dur: 80_000, tid: 1 },
  ]);
  assert.equal(analyzed.longTasks.length, 1);
  assert.equal(analyzed.longTasks[0].name, 'RunTask');
  assert.equal(analyzed.longTasks[0].duration, 80);
  assert.equal(analyzed.estimatedBlockingTime, 30);
  assert.equal(analyzed.longTasks[0].frame.functionName, 'calculateData');
  assert.equal(JSON.stringify(analyzed).includes('Lighthouse'), false);
});

test('cpu analysis splits sampled self time from total time', () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { functionName: '(root)' }, children: [2] },
      { id: 2, callFrame: { functionName: 'calculateData', url: 'app.js', scriptId: '1', lineNumber: 10, columnNumber: 2 }, children: [3] },
      { id: 3, callFrame: { functionName: 'sortData', url: 'app.js', scriptId: '1', lineNumber: 40, columnNumber: 1 }, children: [] },
    ],
    samples: [3, 3, 2],
    timeDeltas: [10_000, 10_000, 10_000],
  };
  const analyzed = analyzeCpuProfile(profile);
  const sort = analyzed.hotspots.find((item) => item.functionName === 'sortData');
  const calculate = analyzed.hotspots.find((item) => item.functionName === 'calculateData');
  assert.equal(sort.selfTime, 20);
  assert.equal(sort.totalTime, 20);
  assert.equal(calculate.selfTime, 10);
  assert.equal(calculate.totalTime, 30);
  assert.equal(sort.sampled, true);
  assert.equal(analyzed.hotspots.some((item) => item.functionName === '(root)'), false);
});

test('report maps a sampled frame and keeps the generated url', async () => {
  const report = await buildPerformanceReport({
    trace: [],
    profile: {
      nodes: [
        { id: 1, callFrame: { functionName: 'calculateData', url: 'http://localhost/assets/index.js', scriptId: '9', lineNumber: 0, columnNumber: 4 }, children: [] },
      ],
      samples: [1, 1],
      timeDeltas: [20_000, 20_000],
    },
    durationMs: 2000,
    resolver: {
      async locate() {
        return {
          file: 'src/hooks/useChat.ts',
          line: 128,
          column: 15,
          name: 'calculateData',
          generatedUrl: 'http://localhost/assets/index.js',
        };
      },
    },
  });
  assert.equal(report.hotspots[0].source.file, 'src/hooks/useChat.ts');
  assert.equal(report.hotspots[0].source.line, 128);
  assert.equal(report.hotspots[0].generatedUrl, 'http://localhost/assets/index.js');
  assert.equal(report.hotspots[0].attribution, 'app');
  assert.equal(report.summary.estimatedBlockingTime, undefined);
  assert.match(report.limitations.join('\n'), /sampled estimates/);
  assert.match(report.limitations.join('\n'), /not Lighthouse/);
});

test('profiling a closed browser returns BROWSER_NOT_OPEN and a busy session does not start a second trace', async () => {
  const session = createBrowserSession({ workspaceRoot: process.cwd() });
  const handlers = buildBrowserHandlers(session);
  const closed = await handlers.performance_profile({});
  assert.equal(closed.ok, false);
  assert.equal(closed.code, 'BROWSER_NOT_OPEN');
  session.performanceBusy = true;
  const busy = await handlers.performance_profile({ url: 'http://127.0.0.1:9/' });
  assert.equal(busy.code, 'PROFILE_BUSY');
  session.performanceBusy = false;
  await session.dispose();
});
