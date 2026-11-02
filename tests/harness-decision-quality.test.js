import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialBelief, NODES } from '../src/core/harness/belief/discrete-dbn.js';
import { mapStateToEvidence } from '../src/core/harness/belief/evidence.js';
import { decideInfluencePolicy } from '../src/core/harness/policy/influence-policy.js';
import { buildDecisionLabels } from '../src/core/harness/eval/history-labels.js';
import { createCalibrationVersion, fitBinaryCpt, fitBinaryPriors, fitNetworkCpts } from '../src/core/harness/eval/cpt-trainer.js';

test('expanded DBN exposes decision-quality nodes', () => {
  const belief = createInitialBelief();
  assert.ok(NODES.includes('RetryBenefit'));
  assert.ok(belief.RequirementClarity && belief.DiffScopeOK);
  assert.ok(mapStateToEvidence({ requirementClarity: false, retryBenefit: true }).length >= 2);
});

test('retry requires predicted retry benefit', () => {
  const result = decideInfluencePolicy({
    belief: { TaskComplete: { true: 0.2 }, TestPass: { true: 0.2 }, RetryBenefit: { true: 0.9 } },
    decision: { answers: [{ id: 'next_action', choice: 'retry_once' }] },
    guards: { allowed: true, requiresReview: false, reasons: [] },
    state: { retries: 0, retryLimit: 3 },
  });
  assert.equal(result.action, 'retry_once');
});

test('ambiguous history is excluded from labels', () => {
  assert.equal(buildDecisionLabels({ status: 'completed' }, []).status, 'ambiguous');
  assert.equal(fitBinaryPriors([{ label: true }, { label: false }]).true, 0.5);
});

test('calibration version is reproducible and uses Dirichlet smoothing', () => {
  const first = createCalibrationVersion({ datasetHash: 'sha256:x', params: { alpha: 1 } });
  const second = createCalibrationVersion({ datasetHash: 'sha256:x', params: { alpha: 1 } });
  assert.equal(first.calibrationId, second.calibrationId);
  assert.deepEqual(fitBinaryPriors([{ label: true }, { label: false }]), { true: 0.5, false: 0.5, sampleCount: 2 });
});

test('each DBN edge receives a complete smoothed CPT', () => {
  const rows = [
    { states: { ToolReliability: true }, labels: { RetryBenefit: true } },
    { states: { ToolReliability: false }, labels: { RetryBenefit: false } },
  ];
  const cpt = fitBinaryCpt(rows.map((row) => ({ ...row, label: row.labels.RetryBenefit })), { childKey: 'label', parentKeys: ['ToolReliability'] });
  assert.equal(Object.keys(cpt.table).length, 2);
  assert.equal(cpt.table['ToolReliability=true'].sampleCount, 1);
  const network = fitNetworkCpts(rows);
  assert.ok(network['ToolReliability->RetryBenefit'].table['ToolReliability=true']);
  assert.ok(network['TestPass->TaskComplete'].table['TestPass=true']);
});
