import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isCrewBackgroundWorkerToolEvent,
  messageHasLandWorkersTool,
  messageHasCrewDispatchCards,
  sanitizeCrewMessageFileChanges,
  shouldShowCrewModeFileChanges,
  shouldSuppressCrewTaskTodos,
} from '../codemini-web/client/src/lib/crew-ui-state.js';

const crewDispatchMessage = {
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

test('shouldSuppressCrewTaskTodos only when crew is active', () => {
  assert.equal(shouldSuppressCrewTaskTodos({ crewActive: true }), true);
  assert.equal(shouldSuppressCrewTaskTodos({ crewActive: false }), false);
});

test('messageHasCrewDispatchCards detects crew run_subagent cards', () => {
  assert.equal(messageHasCrewDispatchCards(crewDispatchMessage), true);
  assert.equal(
    messageHasCrewDispatchCards({
      segments: [{
        type: 'tools',
        cards: [{ name: 'run_subagent', arguments: { prompt: 'plain subagent' } }],
      }],
    }),
    false,
  );
});

test('shouldShowCrewModeFileChanges hides dispatch bubbles and shows land turns', () => {
  assert.equal(
    shouldShowCrewModeFileChanges(crewDispatchMessage, { crewActive: true }),
    false,
  );
  assert.equal(
    shouldShowCrewModeFileChanges(landMessage, { crewActive: true }),
    true,
  );
  assert.equal(
    shouldShowCrewModeFileChanges(crewDispatchMessage, { crewActive: false }),
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

test('isCrewBackgroundWorkerToolEvent matches nested worker stream events only', () => {
  assert.equal(
    isCrewBackgroundWorkerToolEvent(
      { type: 'tool:end', parentToolCallId: 'sub-1' },
      { crewActive: true },
    ),
    true,
  );
  assert.equal(
    isCrewBackgroundWorkerToolEvent(
      { type: 'tool:end', parentToolCallId: 'sub-1' },
      { crewActive: false },
    ),
    false,
  );
  assert.equal(
    isCrewBackgroundWorkerToolEvent(
      { type: 'plan:step_start', crewKind: 'review', toolCallId: 'review-1' },
      { crewActive: true },
    ),
    false,
  );
});

test('sanitizeCrewMessageFileChanges strips leaked worker edits from dispatch bubbles', () => {
  const sanitized = sanitizeCrewMessageFileChanges(crewDispatchMessage, {
    crewActive: true,
  });
  assert.deepEqual(sanitized.fileChanges, []);
  const kept = sanitizeCrewMessageFileChanges(landMessage, { crewActive: true });
  assert.equal(kept.fileChanges.length, 1);
});
