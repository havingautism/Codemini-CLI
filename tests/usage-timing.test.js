import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeTiming,
  mergeTiming,
  attachTimingToUsage,
  createStreamTimingTracker,
  buildUsagePanelModel,
  formatDurationMs,
  formatTokensPerSecond,
} from '../src/core/usage-timing.js';

test('sanitizeTiming drops objects without requestSentAt', () => {
  assert.equal(sanitizeTiming(null), null);
  assert.equal(sanitizeTiming({ firstTokenAt: '2026-08-19T00:00:01.000Z' }), null);
  assert.deepEqual(
    sanitizeTiming({
      requestSentAt: '2026-08-19T00:00:00.000Z',
      firstTokenAt: 'nope',
      completedAt: '2026-08-19T00:00:02.000Z',
    }),
    {
      requestSentAt: '2026-08-19T00:00:00.000Z',
      firstTokenAt: null,
      completedAt: '2026-08-19T00:00:02.000Z',
    },
  );
});

test('mergeTiming uses earliest sent, earliest first token, latest complete', () => {
  const merged = mergeTiming(
    {
      requestSentAt: '2026-08-19T00:00:05.000Z',
      firstTokenAt: '2026-08-19T00:00:08.000Z',
      completedAt: '2026-08-19T00:00:10.000Z',
    },
    {
      requestSentAt: '2026-08-19T00:00:01.000Z',
      firstTokenAt: '2026-08-19T00:00:03.000Z',
      completedAt: '2026-08-19T00:00:20.000Z',
    },
  );
  assert.deepEqual(merged, {
    requestSentAt: '2026-08-19T00:00:01.000Z',
    firstTokenAt: '2026-08-19T00:00:03.000Z',
    completedAt: '2026-08-19T00:00:20.000Z',
  });
});

test('attachTimingToUsage writes nested timing without summing timestamps', () => {
  const usage = attachTimingToUsage(
    { inputTokens: 10, timing: { requestSentAt: '2026-08-19T00:00:05.000Z' } },
    {
      requestSentAt: '2026-08-19T00:00:01.000Z',
      firstTokenAt: '2026-08-19T00:00:02.000Z',
      completedAt: '2026-08-19T00:00:03.000Z',
    },
  );
  assert.equal(usage.inputTokens, 10);
  assert.equal(usage.timing.requestSentAt, '2026-08-19T00:00:01.000Z');
});

test('mergeTiming ignores invalid timestamps and drops empty results', () => {
  assert.deepEqual(
    mergeTiming(
      { requestSentAt: '2026-08-19T00:00:00.000Z', firstTokenAt: null, completedAt: null },
      { requestSentAt: 'bad' },
    ),
    {
      requestSentAt: '2026-08-19T00:00:00.000Z',
      firstTokenAt: null,
      completedAt: null,
    },
  );
  assert.equal(mergeTiming({ firstTokenAt: '2026-08-19T00:00:01.000Z' }, null), null);
});

test('createStreamTimingTracker records sent, first visible token, then complete', () => {
  let t = Date.parse('2026-08-19T00:00:00.000Z');
  const now = () => new Date(t);
  const tracker = createStreamTimingTracker(now);
  t += 2330;
  tracker.noteToolCallDelta();
  tracker.noteTextDelta('H');
  t += 24200;
  const timing = tracker.finish();
  assert.deepEqual(timing, {
    requestSentAt: '2026-08-19T00:00:00.000Z',
    firstTokenAt: '2026-08-19T00:00:02.330Z',
    completedAt: '2026-08-19T00:00:26.530Z',
  });
});

test('createStreamTimingTracker falls back to first tool-call delta when there is no text', () => {
  let t = Date.parse('2026-08-19T00:00:00.000Z');
  const now = () => new Date(t);
  const tracker = createStreamTimingTracker(now);
  t += 1000;
  tracker.noteToolCallDelta();
  t += 500;
  tracker.noteTextDelta('');
  t += 2000;
  const timing = tracker.finish();
  assert.equal(timing.firstTokenAt, '2026-08-19T00:00:01.000Z');
  assert.equal(timing.completedAt, '2026-08-19T00:00:03.500Z');
});

test('createStreamTimingTracker finish() does not move completedAt on a second call', () => {
  let t = Date.parse('2026-08-19T00:00:00.000Z');
  const now = () => new Date(t);
  const tracker = createStreamTimingTracker(now);
  t += 1000;
  tracker.noteTextDelta('Hi');
  t += 1000;
  const first = tracker.finish();
  t += 5000;
  const second = tracker.finish();
  assert.equal(first.completedAt, '2026-08-19T00:00:02.000Z');
  assert.equal(second.completedAt, first.completedAt);
});

test('formatDurationMs follows the spec buckets', () => {
  assert.equal(formatDurationMs(320), '320 ms');
  assert.equal(formatDurationMs(2330), '2.33 s');
  assert.equal(formatDurationMs(24200), '24.2 s');
  assert.equal(formatDurationMs(126000), '126 s');
});

test('formatTokensPerSecond uses one decimal', () => {
  assert.equal(formatTokensPerSecond(20.2479), '20.2 tokens/s');
});

test('buildUsagePanelModel hides timing when timestamps are inverted', () => {
  const model = buildUsagePanelModel({
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    timing: {
      requestSentAt: '2026-08-19T00:00:05.000Z',
      firstTokenAt: '2026-08-19T00:00:01.000Z',
      completedAt: '2026-08-19T00:00:08.000Z',
    },
  });
  assert.ok(model);
  assert.equal(model.timing, null);
});

test('buildUsagePanelModel computes TTFT, generating, TPS and hides TPS when generating is 0', () => {
  const model = buildUsagePanelModel({
    inputTokens: 8884,
    outputTokens: 490,
    totalTokens: 57246,
    cachedInputTokens: 47872,
    timing: {
      requestSentAt: '2026-08-19T00:00:00.000Z',
      firstTokenAt: '2026-08-19T00:00:02.330Z',
      completedAt: '2026-08-19T00:00:26.530Z',
    },
  });
  assert.equal(model.timing.waitingMs, 2330);
  assert.equal(model.timing.generatingMs, 24200);
  assert.equal(model.timing.totalMs, 26530);
  assert.equal(model.timing.showTps, true);
  assert.ok(Math.abs(model.timing.tps - 490 / 24.2) < 1e-6);

  const zeroGen = buildUsagePanelModel({
    outputTokens: 10,
    totalTokens: 10,
    timing: {
      requestSentAt: '2026-08-19T00:00:00.000Z',
      firstTokenAt: '2026-08-19T00:00:02.000Z',
      completedAt: '2026-08-19T00:00:02.000Z',
    },
  });
  assert.ok(zeroGen.timing);
  assert.equal(zeroGen.timing.showTps, false);
  assert.equal(zeroGen.timing.waitingMs, 2000);
});
