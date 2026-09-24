import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCalibrationMetrics, calculateDriftMetrics, parseCalibrationJsonl } from '../src/core/harness/calibration.js';

test('calibration metrics calculate brier, log loss and ECE', () => {
  const rows = parseCalibrationJsonl('{"prediction":0.9,"label":true}\n{"prediction":0.1,"label":false}');
  const metrics = calculateCalibrationMetrics(rows);
  assert.equal(metrics.sampleCount, 2);
  assert.ok(metrics.brier < 0.02);
  assert.ok(metrics.ece < 0.2);
});

test('drift metrics preserve provider groups and operational measures', () => {
  const metrics = calculateDriftMetrics([
    { provider: 'jev', modelVersion: 'v1', questionSetHash: 'q1', prediction: 0.8, label: true, latencyMs: 10, costUsd: 0.1 },
    { provider: 'jev', modelVersion: 'v1', questionSetHash: 'q1', prediction: 0.2, label: false, latencyMs: 20, costUsd: 0.2 },
  ]);
  assert.equal(metrics[0].sampleCount, 2);
  assert.equal(metrics[0].p95LatencyMs, 20);
  assert.equal(metrics[0].meanCostUsd, 0.15000000000000002);
});
