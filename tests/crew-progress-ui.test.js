import test from 'node:test';
import assert from 'node:assert/strict';

import { getCrewStatusBarText } from '../codemini-web/client/src/lib/crew-progress-ui.js';
import { resolveCrewWorkerDisplayName } from '../src/core/crew-progress.js';
import { describeCrewRunSubagent, formatToolDisplayName } from '../src/core/tool-display.js';

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
      { id: 'wkr_mira', name: 'Mira', runStatus: 'running' },
      { id: 'wkr_ivy', name: 'Ivy', runStatus: 'completed', sealed: true, reviewPassed: true },
    ],
    crewInFlightIds: ['wkr_ivy'],
  }, t);
  assert.match(text, /Mira 工作中/);
  assert.match(text, /Ivy 审核中/);
  assert.equal(text.includes('wkr_'), false);
});

test('getCrewStatusBarText stays empty when crew is inactive or roster is merged', () => {
  assert.equal(getCrewStatusBarText({ crewActive: false }, t), '');
  assert.equal(getCrewStatusBarText({
    crewActive: true,
    crewWorkers: [{ id: 'mira', integrated: true }],
    crewInFlightIds: [],
  }, t), '');
});

test('crew UI labels prefer roster nicknames over worker ids', () => {
  const workers = [{ id: 'wkr_mumd766n_7r1z45', name: 'Backend-Health' }];
  assert.equal(
    resolveCrewWorkerDisplayName('wkr_mumd766n_7r1z45', workers),
    'Backend-Health',
  );
  assert.equal(
    describeCrewRunSubagent(
      { resume: 'wkr_mumd766n_7r1z45', prompt: 'relay mail' },
      { workers },
    ).label,
    'Crew worker · Backend-Health',
  );
  assert.equal(
    describeCrewRunSubagent(
      { review: 'wkr_mumd766n_7r1z45', role: 'reviewer' },
      { workers },
    ).label,
    'Crew review · Backend-Health',
  );
  assert.equal(
    formatToolDisplayName(
      'cancel_worker',
      { worker_id: 'wkr_mumd766n_7r1z45' },
      { crewWorkers: workers },
    ),
    'Cancel Worker (Backend-Health)',
  );
});
