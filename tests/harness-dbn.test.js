import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialBelief, updateBelief, beliefProbability } from '../src/core/harness/belief/discrete-dbn.js';
import { mapStateToEvidence } from '../src/core/harness/belief/evidence.js';

test('DBN updates deterministic test evidence', () => {
  const belief = updateBelief(createInitialBelief(), [{ node: 'TestPass', value: true }]);
  assert.ok(beliefProbability(belief, 'TestPass') > 0.9);
});

test('provider evidence requires calibration before injection', () => {
  const answers = [{ id: 'task_complete', type: 'noul', pTrue: 0.99, abstain: false }];
  assert.deepEqual(mapStateToEvidence({}, { provider: 'jev', answers }), []);
  assert.equal(mapStateToEvidence({}, { provider: 'jev', calibrationId: 'cal-1', answers }).length, 1);
});
