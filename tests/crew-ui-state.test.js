import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isCrewBackgroundWorkerToolEvent,
  isCrewDispatchCard,
  messageHasLandWorkersTool,
  messageHasCrewDispatchCards,
  repairCrewSessionMessages,
  sanitizeCrewMessageFileChanges,
  settleCrewCancelledWorkerCards,
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

test('isCrewDispatchCard requires crew spawn arguments not a plain subagent', () => {
  assert.equal(
    isCrewDispatchCard({
      name: 'run_subagent',
      arguments: { name: 'doc-txt', paths: ['docs/test.txt'] },
    }),
    true,
  );
  assert.equal(
    isCrewDispatchCard({
      name: 'run_subagent',
      arguments: { prompt: 'plain subagent', name: 'Alice' },
    }),
    false,
  );
});

test('settleCrewCancelledWorkerCards does not complete unrelated coding subagents', () => {
  const messages = [
    {
      id: 'crew',
      segments: [{
        type: 'tools',
        cards: [{
          id: 'html',
          name: 'run_subagent',
          status: 'running',
          arguments: { name: 'doc-html', paths: ['docs/test.html'] },
          planRun: { phase: 'executing', steps: [{ status: 'running', role: 'doc-html' }] },
        }],
      }],
    },
    {
      id: 'coding',
      segments: [{
        type: 'tools',
        cards: [{
          id: 'alice',
          name: 'run_subagent',
          status: 'running',
          arguments: { prompt: 'review code', name: 'Alice' },
          planRun: { phase: 'executing', steps: [{ status: 'running', role: 'Alice' }] },
        }],
      }],
    },
  ];
  const next = settleCrewCancelledWorkerCards(messages, 'doc-html');
  assert.equal(next[0].segments[0].cards[0].planRun.phase, 'cancelled');
  assert.equal(next[1].segments[0].cards[0].planRun.phase, 'executing');
});

test('repairCrewSessionMessages heals a leaked duplicate and a cancelled html worker', () => {
  const messages = [
    {
      id: 'first',
      segments: [{
        type: 'tools',
        cards: [
          {
            id: 'call-html',
            name: 'run_subagent',
            status: 'done',
            arguments: { name: 'doc-html', paths: ['docs/test.html'] },
            planRun: { phase: 'completed', steps: [{ status: 'done', role: 'doc-html' }] },
          },
          {
            id: 'call-txt',
            name: 'run_subagent',
            status: 'running',
            arguments: {},
            planRun: { phase: 'executing', steps: [{ status: 'running', role: 'Doc-txt' }] },
          },
        ],
      }],
    },
    {
      id: 'second',
      segments: [{
        type: 'tools',
        cards: [
          {
            id: 'call-cancel',
            name: 'cancel_worker',
            status: 'done',
            arguments: { worker_id: 'doc-html' },
          },
          {
            id: 'call-txt',
            name: 'run_subagent',
            status: 'done',
            arguments: { name: 'doc-txt', paths: ['docs/test.txt'] },
            planRun: { phase: 'executing', steps: [] },
          },
        ],
      }],
    },
  ];
  const next = repairCrewSessionMessages(messages);
  assert.equal(next[0].segments[0].cards.some((card) => card.id === 'call-txt'), false);
  assert.equal(next[0].segments[0].cards[0].planRun.phase, 'cancelled');
  const txt = next[1].segments[0].cards.find((card) => card.id === 'call-txt');
  assert.equal(txt.arguments.name, 'doc-txt');
});
