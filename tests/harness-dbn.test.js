import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialBelief, updateBelief, beliefProbability } from '../src/core/harness/belief/discrete-dbn.js';
import { mapStateToEvidence } from '../src/core/harness/belief/evidence.js';

test('DBN updates deterministic test evidence', () => {
  const belief = updateBelief(createInitialBelief(), [{ node: 'TestPass', value: true }]);
  assert.ok(beliefProbability(belief, 'TestPass') > 0.9);
  assert.ok(beliefProbability(belief, 'TaskComplete') > 0.35);
});

test('DBN propagates learned tool reliability into retry benefit', () => {
  const belief = updateBelief(createInitialBelief(), [{
    node: 'ToolReliability',
    posterior: 0.1,
  }]);
  assert.ok(beliefProbability(belief, 'ToolReliability') < 0.2);
  assert.ok(beliefProbability(belief, 'RetryBenefit') < 0.4);
});

test('DBN accepts calibrated prior objects and per-edge CPT overrides', () => {
  const initial = createInitialBelief({ TaskComplete: { true: 0.9 }, ToolReliability: { true: 0.2 } });
  assert.equal(beliefProbability(initial, 'TaskComplete'), 0.9);
  const belief = updateBelief(initial, [{ node: 'ToolReliability', posterior: 0.2 }], {
    cpts: { 'ToolReliability->RetryBenefit': { parentTrue: 0.9, parentFalse: 0.1 } },
  });
  assert.ok(beliefProbability(belief, 'RetryBenefit') < 0.3);
});

test('provider evidence requires calibration before injection', () => {
  const answers = [{ id: 'task_complete', type: 'noul', pTrue: 0.99, abstain: false }];
  assert.deepEqual(mapStateToEvidence({}, { provider: 'jev', answers }), []);
  assert.equal(mapStateToEvidence({}, { provider: 'jev', calibrationId: 'cal-1', answers }).length, 1);
});
