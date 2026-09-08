import test from 'node:test';
import assert from 'node:assert/strict';

import { getCrewStatusBarText } from '../codemini-web/client/src/lib/crew-progress-ui.js';

const t = (key) => ({
  crewPhaseRunning: '工作中',
  crewPhaseReviewing: '审核中',
  crewPhaseMerged: '已合并',
  crewPhaseIdle: '空闲',
}[key] || key);

test('getCrewStatusBarText shows crew worker phases when the parent turn is idle', () => {
  const text = getCrewStatusBarText({
    crewActive: true,
    crewWorkers: [
      { id: 'mira', runStatus: 'running' },
      { id: 'ivy', runStatus: 'completed', sealed: true, reviewPassed: true },
    ],
    crewInFlightIds: ['ivy'],
  }, t);
  assert.match(text, /mira 工作中/);
  assert.match(text, /ivy 审核中/);
});

test('getCrewStatusBarText stays empty when crew is inactive or roster is merged', () => {
  assert.equal(getCrewStatusBarText({ crewActive: false }, t), '');
  assert.equal(getCrewStatusBarText({
    crewActive: true,
    crewWorkers: [{ id: 'mira', integrated: true }],
    crewInFlightIds: [],
  }, t), '');
});
