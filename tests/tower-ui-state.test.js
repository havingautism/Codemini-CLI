import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isTowerBackgroundWorkerToolEvent,
  messageHasLandWorkersTool,
  messageHasTowerDispatchCards,
  sanitizeTowerMessageFileChanges,
  shouldShowTowerModeFileChanges,
  shouldSuppressTowerTaskTodos,
} from '../codemini-web/client/src/lib/tower-ui-state.js';

const towerDispatchMessage = {
  id: 'dispatch',
  segments: [
    {
      type: 'tools',
      cards: [{
        id: 'sub-1',
        name: 'run_subagent',
        arguments: { name: 'workerA', paths: ['docs/testA.txt'] },
        planRun: { phase: 'executing', steps: [{ status: 'running' }] },
      }],
    },
  ],
  fileChanges: [{ path: 'docs/testA.txt', kind: 'write' }],
};

const landMessage = {
  id: 'land',
  segments: [
    {
      type: 'tools',
      cards: [{
        id: 'land-1',
        name: 'land_workers',
        status: 'done',
      }],
    },
  ],
  fileChanges: [{ path: 'docs/testA.txt', kind: 'write' }],
};

test('shouldSuppressTowerTaskTodos only when tower is active', () => {
  assert.equal(shouldSuppressTowerTaskTodos({ towerActive: true }), true);
  assert.equal(shouldSuppressTowerTaskTodos({ towerActive: false }), false);
});

test('messageHasTowerDispatchCards detects tower run_subagent cards', () => {
  assert.equal(messageHasTowerDispatchCards(towerDispatchMessage), true);
  assert.equal(
    messageHasTowerDispatchCards({
      segments: [{
        type: 'tools',
        cards: [{ name: 'run_subagent', arguments: { prompt: 'plain subagent' } }],
      }],
    }),
    false,
  );
});

test('shouldShowTowerModeFileChanges hides dispatch bubbles and shows land turns', () => {
  assert.equal(
    shouldShowTowerModeFileChanges(towerDispatchMessage, { towerActive: true }),
    false,
  );
  assert.equal(
    shouldShowTowerModeFileChanges(landMessage, { towerActive: true }),
    true,
  );
  assert.equal(
    shouldShowTowerModeFileChanges(towerDispatchMessage, { towerActive: false }),
    true,
  );
});

test('messageHasLandWorkersTool requires a completed land_workers card', () => {
  assert.equal(messageHasLandWorkersTool(landMessage), true);
  assert.equal(
    messageHasLandWorkersTool({
      segments: [{
        type: 'tools',
        cards: [{ name: 'land_workers', status: 'running' }],
      }],
    }),
    false,
  );
});

test('isTowerBackgroundWorkerToolEvent matches nested worker stream events only', () => {
  assert.equal(
    isTowerBackgroundWorkerToolEvent(
      { type: 'tool:end', parentToolCallId: 'sub-1' },
      { towerActive: true },
    ),
    true,
  );
  assert.equal(
    isTowerBackgroundWorkerToolEvent(
      { type: 'tool:end', parentToolCallId: 'sub-1' },
      { towerActive: false },
    ),
    false,
  );
  assert.equal(
    isTowerBackgroundWorkerToolEvent(
      { type: 'plan:step_start', towerKind: 'review', toolCallId: 'review-1' },
      { towerActive: true },
    ),
    false,
  );
});

test('sanitizeTowerMessageFileChanges strips leaked worker edits from dispatch bubbles', () => {
  const sanitized = sanitizeTowerMessageFileChanges(towerDispatchMessage, {
    towerActive: true,
  });
  assert.deepEqual(sanitized.fileChanges, []);
  const kept = sanitizeTowerMessageFileChanges(landMessage, { towerActive: true });
  assert.equal(kept.fileChanges.length, 1);
});
