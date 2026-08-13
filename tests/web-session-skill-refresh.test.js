import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateSession,
  alignSessionAssistantMessages,
  alignSessionUserMessages,
  mergeAlignedAssistantSkillContext,
  mergeAlignedUserContext,
  projectVisibleSessionState,
  reduceSessionRuntimeEvent,
  reduceSessionTranscriptEvent,
  rollbackOptimisticSandboxMode,
} from '../codemini-web/client/src/lib/session-state.js';

test('switching to a pool-only session does not retain the previous runtime state', () => {
  const state = {
    currentSessionId: 'session-a',
    runtimeState: {
      sessionId: 'session-a',
      model: 'old-model',
      maxContextTokens: 128000,
      pendingApproval: { id: 'approval-a' },
    },
    approvalRequest: { id: 'approval-a' },
    userInputRequest: { id: 'input-a' },
    sessionRuntimeById: {
      'session-b': {
        sessionId: 'session-b',
        model: 'new-model',
        status: 'idle',
        busy: false,
      },
    },
    sessionMessagesById: { 'session-b': [] },
  };

  const activated = activateSession(state, 'session-b');
  const visible = projectVisibleSessionState(activated);

  assert.equal(visible.currentSessionId, 'session-b');
  assert.equal(visible.runtimeState.sessionId, 'session-b');
  assert.equal(visible.runtimeState.model, 'new-model');
  assert.equal(visible.runtimeState.maxContextTokens, undefined);
  assert.equal(visible.approvalRequest, null);
  assert.equal(visible.userInputRequest, null);
});

test('refresh keeps manual and always skill badges on their originating user turns', () => {
  const reconstructed = [
    {
      id: 'generated-user-1',
      role: 'you',
      segments: [{ type: 'text', text: 'first' }],
      skillBadges: [{ name: 'manual-skill', status: 'selected' }],
    },
    { id: 'plan', role: 'plan-overview', planOverview: { goal: 'first' } },
    { id: 'generated-user-2', role: 'you', segments: [{ type: 'text', text: 'second' }] },
  ];
  const uiMessages = [
    {
      id: 'persisted-user-1',
      role: 'you',
      segments: [{ type: 'text', text: 'first' }],
      skillBadges: [{ name: 'always-skill', status: 'always' }],
    },
    { id: 'persisted-plan', role: 'plan-overview', planOverview: { goal: 'first' } },
    {
      id: 'persisted-user-2',
      role: 'you',
      segments: [{ type: 'text', text: 'second' }],
      skillBadges: [],
    },
  ];

  const aligned = alignSessionUserMessages(reconstructed, uiMessages);
  const restored = mergeAlignedUserContext(aligned, uiMessages);

  assert.equal(restored[0].id, 'persisted-user-1');
  assert.deepEqual(restored[0].skillBadges, [
    { name: 'manual-skill', status: 'selected' },
    { name: 'always-skill', status: 'always' },
  ]);
  assert.equal(restored[2].id, 'persisted-user-2');
  assert.deepEqual(restored[2].skillBadges || [], []);
});

test('refresh keeps skill invocation segments on the aligned assistant response', () => {
  const reconstructed = [
    { id: 'generated-user-1', role: 'you', segments: [{ type: 'text', text: 'first' }] },
    { id: 'generated-assistant-1', role: 'general', segments: [{ type: 'text', text: 'answer one' }] },
    { id: 'error-1', role: 'error', segments: [{ type: 'text', text: 'failed retry' }] },
    { id: 'generated-user-2', role: 'you', segments: [{ type: 'text', text: 'second' }] },
    { id: 'generated-assistant-2', role: 'general', segments: [{ type: 'text', text: 'answer two' }] },
  ];
  const skillSegment = {
    type: 'skill',
    name: 'manual-skill',
    status: 'done',
    startedAt: '2026-07-11T00:00:00.000Z',
  };
  const uiMessages = [
    { id: 'persisted-user-1', role: 'you', segments: [{ type: 'text', text: 'first' }] },
    {
      id: 'persisted-assistant-1',
      role: 'general',
      segments: [skillSegment, { type: 'text', text: 'answer one' }],
      skillBadges: [{ name: 'always-skill', status: 'always' }],
    },
    { id: 'persisted-error-1', role: 'error', segments: [{ type: 'text', text: 'failed retry' }] },
    { id: 'persisted-user-2', role: 'you', segments: [{ type: 'text', text: 'second' }] },
    {
      id: 'persisted-assistant-2',
      role: 'general',
      segments: [{ type: 'text', text: 'answer two' }],
      skillBadges: [],
    },
  ];

  const aligned = alignSessionAssistantMessages(reconstructed, uiMessages);
  const restored = mergeAlignedAssistantSkillContext(aligned, uiMessages);

  const firstAnswer = restored.find((message) => message.id === 'persisted-assistant-1');
  const secondAnswer = restored.find((message) => message.id === 'persisted-assistant-2');
  assert.deepEqual(firstAnswer.skillBadges, [{ name: 'always-skill', status: 'always' }]);
  assert.deepEqual(firstAnswer.segments[0], skillSegment);
  assert.equal(secondAnswer.segments.some((segment) => segment.type === 'skill'), false);
});

test('refresh restores process timing on the aligned assistant response', () => {
  const reconstructed = [{
    id: 'generated-assistant',
    role: 'general',
    segments: [
      { type: 'thinking', text: 'reasoning', isStreaming: false },
      { type: 'tools', cards: [{ id: 'tool-1', name: 'search', status: 'done' }] },
      { type: 'text', text: 'final answer', isStreaming: false },
    ],
  }];
  const uiMessages = [{
    id: 'persisted-assistant',
    role: 'general',
    segments: [
      {
        type: 'thinking',
        text: 'reasoning',
        startedAt: '2026-07-11T00:00:00.000Z',
        endedAt: '2026-07-11T00:00:02.000Z',
        durationMs: 2000,
      },
      {
        type: 'tools',
        cards: [{ id: 'tool-1', startedAt: '2026-07-11T00:00:02.000Z' }],
      },
      {
        type: 'text',
        text: 'final answer',
        startedAt: '2026-07-11T00:00:05.000Z',
      },
    ],
  }];

  const aligned = alignSessionAssistantMessages(reconstructed, uiMessages);
  const [restored] = mergeAlignedAssistantSkillContext(aligned, uiMessages);

  assert.equal(restored.segments[0].startedAt, '2026-07-11T00:00:00.000Z');
  assert.equal(restored.segments[0].durationMs, 2000);
  assert.equal(restored.segments[1].cards[0].startedAt, '2026-07-11T00:00:02.000Z');
  assert.equal(restored.segments[2].startedAt, '2026-07-11T00:00:05.000Z');
});

test('missing UI transcript does not remove core-session manual skill badges', () => {
  const reconstructed = [{
    id: 'generated-user',
    role: 'you',
    skillBadges: [{ name: 'manual-skill', status: 'selected' }],
  }];

  assert.deepEqual(mergeAlignedUserContext(reconstructed, []), reconstructed);
});

test('assistant:response replaces prior text even when a tool card follows it', () => {
  const state = {
    sessionMessagesById: {
      'session-a': [
        {
          id: 'msg-1',
          role: 'general',
          isComplete: false,
          segments: [
            {
              type: 'text',
              text: '先加载技能指令',
              isStreaming: true,
              startedAt: '2026-07-12T00:00:00.000Z',
            },
            {
              type: 'tools',
              cards: [{ id: 'tool-1', name: 'Skill', status: 'running' }],
            },
          ],
        },
      ],
    },
  };

  const next = reduceSessionTranscriptEvent(state, {
    type: 'assistant:response',
    sessionId: 'session-a',
    messageId: 'msg-1',
    text: '先加载技能指令',
  });

  const segments = next.sessionMessagesById['session-a'][0].segments;
  const textSegments = segments.filter((segment) => segment.type === 'text');
  assert.equal(textSegments.length, 1);
  assert.equal(textSegments[0].text, '先加载技能指令');
  assert.equal(textSegments[0].isStreaming, false);
  assert.equal(segments[1].type, 'tools');
});

test('sandbox-mode:changed updates the projected session runtime immediately', () => {
  const state = {
    currentSessionId: 'session-a',
    runtimeState: {
      sessionId: 'session-a',
      sandboxMode: 'read-only',
      approvalUiEnabled: false,
    },
    sessionRuntimeById: {
      'session-a': {
        sessionId: 'session-a',
        sandboxMode: 'read-only',
        approvalUiEnabled: false,
      },
    },
    sessionMessagesById: { 'session-a': [] },
  };

  const reduced = reduceSessionRuntimeEvent(state, {
    type: 'sandbox-mode:changed',
    sessionId: 'session-a',
    sandboxMode: 'workspace-write',
    approvalUiEnabled: true,
    busy: false,
  });
  const visible = projectVisibleSessionState(reduced);

  assert.equal(visible.runtimeState.sandboxMode, 'workspace-write');
  assert.equal(visible.runtimeState.approvalUiEnabled, true);
  assert.equal(visible.runtimeState.type, undefined);
  assert.equal(visible.runtimeState.sessionId, 'session-a');
});

test('sandbox mode rollback preserves newer runtime events', () => {
  const previousRuntime = { sandboxMode: 'read-only', status: 'idle' };
  const previousSessionRuntime = {
    sessionId: 'session-a',
    sandboxMode: 'read-only',
    status: 'idle',
  };
  const rolledBack = rollbackOptimisticSandboxMode({
    runtimeState: {
      sandboxMode: 'workspace-write',
      status: 'running',
      reasoningEffort: 'high',
    },
    sessionRuntimeById: {
      'session-a': {
        sessionId: 'session-a',
        sandboxMode: 'workspace-write',
        status: 'running',
        busy: true,
      },
    },
  }, {
    sessionId: 'session-a',
    optimisticMode: 'workspace-write',
    previousRuntime,
    previousSessionRuntime,
  });

  assert.deepEqual(rolledBack.runtimeState, {
    sandboxMode: 'read-only',
    status: 'running',
    reasoningEffort: 'high',
  });
  assert.deepEqual(rolledBack.sessionRuntimeById['session-a'], {
    sessionId: 'session-a',
    sandboxMode: 'read-only',
    status: 'running',
    busy: true,
  });

  const superseded = rollbackOptimisticSandboxMode({
    runtimeState: { sandboxMode: 'danger-full-access', status: 'idle' },
    sessionRuntimeById: {
      'session-a': { sessionId: 'session-a', sandboxMode: 'danger-full-access' },
    },
  }, {
    sessionId: 'session-a',
    optimisticMode: 'workspace-write',
    previousRuntime,
    previousSessionRuntime,
  });
  assert.equal(superseded.runtimeState.sandboxMode, 'danger-full-access');
  assert.equal(
    superseded.sessionRuntimeById['session-a'].sandboxMode,
    'danger-full-access',
  );
});
