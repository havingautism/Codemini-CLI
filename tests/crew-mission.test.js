import test from 'node:test';
import assert from 'node:assert/strict';

import { composeCrewBriefing } from '../src/core/crew-briefing.js';
import { crewMissionAcceptsSpawn } from '../src/core/crew-missions.js';
import {
  dedupeCrewMissionRecords,
  isWorkerIntegrated,
  isWorkerMissionTerminal,
} from '../src/core/crew-store.js';
import { summarizeToolResult } from '../src/core/tool-result-store.js';
import { normalizeExecutionMode, usesEngineeringRuntime } from '../src/core/chat-runtime.js';
import { buildCrewWorkerCompletedWake, parseCrewWakeHeadline } from '../src/core/crew-snapshot.js';
import { buildSubagentToolSegmentsFromMessages } from '../src/core/crew-worker-run.js';

test('crew is its own execution mode and still uses the engineering runtime', () => {
  assert.equal(normalizeExecutionMode('crew'), 'crew');
  assert.equal(normalizeExecutionMode('plan'), 'plan');
  assert.equal(normalizeExecutionMode('daily'), 'normal');
  assert.equal(usesEngineeringRuntime('crew'), true);
  assert.equal(usesEngineeringRuntime('plan'), true);
  assert.equal(usesEngineeringRuntime('normal'), false);
});

test('crew briefings keep coordinator notes behind the fixed role text', () => {
  const build = composeCrewBriefing({ kind: 'build', additional: 'Do not run the build.' });
  assert.match(build, /^Crew build mission/);
  assert.match(build, /package\.json/);
  assert.match(build, /lockfile/);
  assert.match(build, /Additional instructions:\nDo not run the build/);
  const survey = composeCrewBriefing({ kind: 'survey' });
  assert.match(survey, /Do not modify files/);
  assert.doesNotMatch(survey, /Additional instructions/);
});

test('dedupeCrewMissionRecords drops synthetic m_wkr when m1 owns the worker', () => {
  const missions = dedupeCrewMissionRecords([
    { id: 'm1', title: 'Survey', kind: 'survey', status: 'completed', workerId: 'wkr_a' },
    { id: 'm_wkr_a', title: 'Scout', kind: 'survey', status: 'active', workerId: 'wkr_a' },
  ]);
  assert.equal(missions.length, 1);
  assert.equal(missions[0].id, 'm1');
});

test('crew_plan tool summary keeps coordinator next-step message', () => {
  const summary = summarizeToolResult({
    ok: true,
    created: [{ id: 'm1', title: 'Survey' }],
    message: 'Planned m1 (Survey). Next: Dispatch with run_subagent mission_id for: m1.',
  });
  assert.match(summary, /Planned m1/);
  assert.match(summary, /Next:/);
  assert.doesNotMatch(summary, /^created 1 task/);
});

test('completed build mission accepts resume when rebaseOnto is set', () => {
  const mission = { id: 'm3', kind: 'build', status: 'completed' };
  const blocked = crewMissionAcceptsSpawn(mission, { resume: true });
  assert.equal(blocked.ok, false);
  const allowed = crewMissionAcceptsSpawn(mission, { resume: true, rebaseOnto: 'abc123' });
  assert.equal(allowed.ok, true);
});

test('awaiting_submit wake tells coordinator to require crew_complete', () => {
  const wake = buildCrewWorkerCompletedWake({
    workerId: 'wkr_a',
    status: 'awaiting_submit',
    dirty: false,
  });
  assert.match(wake, /crew\.worker\.awaiting_submit/);
  assert.match(parseCrewWakeHeadline(wake), /without crew_complete/);
});

test('mission terminal and integrated projection use missions[] only', () => {
  const state = {
    missions: [
      { id: 'm1', title: 'A', kind: 'build', status: 'merged', workerId: 'anna' },
      { id: 'm2', title: 'B', kind: 'build', status: 'abandoned', workerId: 'bob' },
      { id: 'm3', title: 'C', kind: 'build', status: 'active', workerId: 'cara' },
    ],
    workers: [{ id: 'anna', branch: 'b', worktreePath: '/w' }],
  };
  assert.equal(isWorkerMissionTerminal(state, { id: 'anna' }), true);
  assert.equal(isWorkerMissionTerminal(state, { id: 'bob' }), true);
  assert.equal(isWorkerMissionTerminal(state, { id: 'cara' }), false);
  assert.equal(isWorkerIntegrated(state, { id: 'anna' }), true);
  assert.equal(isWorkerIntegrated(state, { id: 'anna', rebaseOnto: 'abc' }), false);
});

test('buildSubagentToolSegmentsFromMessages includes crew_complete from sub-session', () => {
  const segments = buildSubagentToolSegmentsFromMessages([
    {
      role: 'assistant',
      tool_calls: [
        { id: 'a1', function: { name: 'read', arguments: '{}' } },
        { id: 'a2', function: { name: 'crew_complete', arguments: '{"outcome":"done"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'a1', content: 'file contents' },
    { role: 'tool', tool_call_id: 'a2', content: '{"ok":true}' },
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, 'tools');
  assert.deepEqual(segments[0].cards.map((card) => card.name), ['read', 'crew_complete']);
  assert.equal(segments[0].cards[1].result, '{"ok":true}');
});
