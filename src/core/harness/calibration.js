import crypto from 'node:crypto';

export function parseCalibrationJsonl(text = '') {
  return String(text).split(/\r?\n/).map((line, index) => {
    if (!line.trim()) return null;
    const row = JSON.parse(line);
    if (!row || row.prediction == null || row.label == null) throw new Error(`Invalid calibration row ${index + 1}`);
    const prediction = Math.max(0.000001, Math.min(0.999999, Number(row.prediction)));
    if (!Number.isFinite(prediction)) throw new Error(`Invalid prediction at row ${index + 1}`);
    return { ...row, prediction, label: Boolean(row.label) };
  }).filter(Boolean);
}

export function calibrationDatasetHash(rows = []) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`;
}

export function calculateCalibrationMetrics(rows = [], { bins = 10 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { sampleCount: 0, brier: null, logLoss: null, ece: null, riskCoverage: [] };
  let brier = 0;
  let logLoss = 0;
  for (const row of list) {
    const p = row.prediction;
    const y = row.label ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  const groups = Array.from({ length: Math.max(1, bins) }, () => []);
  for (const row of list) groups[Math.min(groups.length - 1, Math.floor(row.prediction * groups.length))].push(row);
  let ece = 0;
  for (const group of groups) {
    if (!group.length) continue;
    const confidence = group.reduce((sum, row) => sum + row.prediction, 0) / group.length;
    const accuracy = group.reduce((sum, row) => sum + (row.label ? 1 : 0), 0) / group.length;
    ece += (group.length / list.length) * Math.abs(confidence - accuracy);
  }
  const sorted = [...list].sort((a, b) => b.prediction - a.prediction);
  const riskCoverage = sorted.filter((_, index) => index === 0 || index === sorted.length - 1 || index % Math.max(1, Math.floor(sorted.length / 10)) === 0).map((row, index) => {
    const subset = sorted.slice(0, Math.max(1, index + 1));
    const errors = subset.filter((item) => (item.prediction >= 0.5) !== item.label).length;
    return { coverage: subset.length / sorted.length, selectiveRisk: errors / subset.length };
  });
  return { sampleCount: list.length, brier: brier / list.length, logLoss: logLoss / list.length, ece, riskCoverage };
}

export function calculateDriftMetrics(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = new Map();
  for (const row of list) {
    const key = `${row.provider || 'unknown'}:${row.modelVersion || 'unknown'}:${row.questionSetHash || 'unknown'}`;
    const item = groups.get(key) || { key, count: 0, sum: 0, labelSum: 0, latencies: [], costs: [] };
    item.count += 1;
    item.sum += row.prediction;
    item.labelSum += row.label ? 1 : 0;
    if (Number.isFinite(Number(row.latencyMs))) item.latencies.push(Number(row.latencyMs));
    if (Number.isFinite(Number(row.costUsd))) item.costs.push(Number(row.costUsd));
    groups.set(key, item);
  }
  const paired = list.filter((row) => Number.isFinite(Number(row.baselinePrediction)));
  const distribution = paired.length ? distributionDrift(paired) : { psi: null, ks: null };
  return [...groups.values()].map((item) => ({
    provider: item.key,
    sampleCount: item.count,
    meanPrediction: item.sum / item.count,
    labelRate: item.labelSum / item.count,
    p95LatencyMs: percentile(item.latencies, 0.95),
    meanCostUsd: item.costs.length ? item.costs.reduce((a, b) => a + b, 0) / item.costs.length : null,
    ...distribution,
  }));
}

function distributionDrift(rows) {
  const bins = 10;
  const current = Array(bins).fill(0);
  const baseline = Array(bins).fill(0);
  for (const row of rows) {
    current[Math.min(bins - 1, Math.floor(row.prediction * bins))] += 1;
    baseline[Math.min(bins - 1, Math.floor(Number(row.baselinePrediction) * bins))] += 1;
  }
  const n = rows.length;
  let psi = 0;
  let ks = 0;
  let currentCdf = 0;
  let baselineCdf = 0;
  for (let i = 0; i < bins; i += 1) {
    const currentRate = Math.max(current[i] / n, 0.0001);
    const baselineRate = Math.max(baseline[i] / n, 0.0001);
    psi += (currentRate - baselineRate) * Math.log(currentRate / baselineRate);
    currentCdf += currentRate;
    baselineCdf += baselineRate;
    ks = Math.max(ks, Math.abs(currentCdf - baselineCdf));
  }
  return { psi, ks };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}
