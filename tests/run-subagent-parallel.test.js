import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSubAgentToolAllowList,
  SUBAGENT_FORBIDDEN_TOOLS,
  normalizeSubAgentPersonaName,
  getSubAgentPersonaPrompt,
  getSubAgentRolePrompt,
  subAgentAllowListMayMutate,
  subAgentRunFailed,
  resolveSubAgentModel,
  createTurnUsageAccumulator,
} from '../src/core/chat-runtime.js';
import {
  applyPlanEventToMessage,
  applyStreamEventToPlanRun,
  listCreatePlanCards,
  settleRunningCreatePlanCards,
} from '../codemini-web/client/src/lib/plan-ui-state.js';

test('subagent allow-list always strips run_subagent even if parent asks for it', () => {
  const tools = resolveSubAgentToolAllowList({
    role: 'coder',
    tools: ['read', 'edit', 'run_subagent', 'create_plan'],
  });
  assert.equal(tools.includes('read'), true);
  assert.equal(tools.includes('edit'), true);
  for (const name of SUBAGENT_FORBIDDEN_TOOLS) {
    assert.equal(tools.includes(name), false, name);
  }
});

test('explicit empty or forbidden-only allow-lists grant no tools', () => {
  assert.deepEqual(resolveSubAgentToolAllowList({ role: 'coder', tools: [] }), []);
  assert.deepEqual(
    resolveSubAgentToolAllowList({ role: 'coder', tools: ['run_subagent', 'create_plan'] }),
    []
  );
});

test('subagent allow-list cannot grant tools outside role policy', () => {
  const tools = resolveSubAgentToolAllowList({
    role: 'explorer',
    tools: ['read', 'edit', 'write'],
  });
  assert.deepEqual(tools, ['read']);
});

test('subagent allow-list accepts public shell tool names and keeps internal policy canonical', () => {
  assert.deepEqual(
    resolveSubAgentToolAllowList({ role: 'coder', tools: ['Bash'], platform: 'linux' }),
    ['run'],
  );
  assert.deepEqual(
    resolveSubAgentToolAllowList({ role: 'coder', tools: ['Powershell'], platform: 'win32' }),
    ['run'],
  );
});

test('freeform persona names use coder tool baseline', () => {
  const tools = resolveSubAgentToolAllowList({
    role: 'david',
    tools: ['read', 'edit', 'run_subagent'],
  });
  assert.equal(tools.includes('read'), true);
  assert.equal(tools.includes('edit'), true);
  assert.equal(tools.includes('run_subagent'), false);
});

test('unix subagent baselines drop staged write and promote glob/grep', () => {
  const coder = resolveSubAgentToolAllowList({ role: 'coder', platform: 'linux' });
  assert.equal(coder.includes('edit'), true);
  assert.equal(coder.includes('glob'), true);
  assert.equal(coder.includes('grep'), true);
  for (const name of ['begin_write', 'write_chunk', 'commit_write', 'abort_write', 'apply_patch']) {
    assert.equal(coder.includes(name), false, name);
  }
  const explorer = resolveSubAgentToolAllowList({ role: 'explorer', platform: 'linux' });
  assert.ok(explorer.includes('glob'));
  assert.ok(explorer.includes('grep'));
  assert.equal(
    resolveSubAgentToolAllowList({
      role: 'coder',
      tools: ['read', 'edit', 'begin_write', 'apply_patch'],
      platform: 'linux',
    }).includes('begin_write'),
    false,
  );
  const winCoder = resolveSubAgentToolAllowList({ role: 'coder', platform: 'win32' });
  assert.ok(winCoder.includes('begin_write'));
  assert.ok(winCoder.includes('apply_patch'));
  for (const name of ['list', 'glob', 'grep', 'tool_search']) {
    assert.ok(winCoder.includes(name), name);
  }
});

test('Windows subagents keep explicitly requested inspection tools', () => {
  assert.deepEqual(
    resolveSubAgentToolAllowList({
      role: 'coder',
      tools: ['list', 'glob'],
      platform: 'win32',
    }),
    ['list', 'glob', 'tool_search'],
  );
});

test('persona name normalization keeps playful short names', () => {
  assert.equal(normalizeSubAgentPersonaName('david'), 'David');
  assert.equal(normalizeSubAgentPersonaName(''), 'Alex');
  assert.match(getSubAgentPersonaPrompt('mira'), /You are Mira/);
  assert.match(getSubAgentPersonaPrompt('mira'), /Choose the clearest format/);
  assert.doesNotMatch(getSubAgentPersonaPrompt('mira'), /Findings:\n|Actions Taken:\n/);
  assert.match(getSubAgentRolePrompt('Kai'), /You are Kai/);
  assert.match(getSubAgentRolePrompt('coder'), /You are the coder/);
});

test('mutating allow-list detection ignores read-only sets', () => {
  assert.equal(subAgentAllowListMayMutate(['read', 'search_code']), false);
  assert.equal(subAgentAllowListMayMutate(['read', 'edit']), true);
});

test('subagent failure detection uses final outcome rather than recovered tool errors', () => {
  assert.equal(subAgentRunFailed({ text: 'done' }), false);
  assert.equal(subAgentRunFailed({ text: 'recovered', blockedCount: 1 }), false);
  assert.equal(subAgentRunFailed({ text: 'recovered', toolErrorCount: 1 }), false);
  assert.equal(subAgentRunFailed({ text: 'Error: tests failed', hasErrorLine: true }), true);
  assert.equal(subAgentRunFailed({ text: '' }), true);
  assert.equal(subAgentRunFailed({ text: 'done' }, { aborted: true }), true);
});

test('a recovered tool error does not fail a subagent with a valid handoff', () => {
  assert.equal(
    subAgentRunFailed({
      text: 'Python 3.12.3',
      toolErrorCount: 1,
      blockedCount: 0,
      hasErrorLine: false,
    }),
    false,
  );
});

test('run_subagent uses the configured lite model instead of inheriting the parent model', () => {
  assert.equal(
    resolveSubAgentModel(
      { model: { name: 'main-model', fast_name: 'lite-model' } },
      'parent-turn-model',
    ),
    'lite-model',
  );
  assert.equal(
    resolveSubAgentModel(
      { model: { name: 'main-model', lite_name: 'legacy-lite-model' } },
      'parent-turn-model',
    ),
    'legacy-lite-model',
  );
  assert.equal(
    resolveSubAgentModel({ model: { name: 'main-model' } }, 'parent-turn-model'),
    'parent-turn-model',
  );
});

test('parent turn usage accumulator merges parallel subagents exactly once', () => {
  const usage = createTurnUsageAccumulator();
  usage.addDelegated({
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedInputTokens: 40,
    requests: 1,
  });
  usage.addDelegated({
    inputTokens: 60,
    outputTokens: 10,
    totalTokens: 70,
    cachedInputTokens: 0,
    requests: 1,
  });

  assert.deepEqual(usage.peekPending(), {
    inputTokens: 160,
    outputTokens: 30,
    totalTokens: 190,
    cachedInputTokens: 40,
    cacheMissInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningOutputTokens: 0,
    requests: 2,
    raw: [],
  });
  assert.equal(
    usage.consumeInto({
      inputTokens: 30,
      outputTokens: 5,
      totalTokens: 35,
      requests: 1,
    }).totalTokens,
    225,
  );
  assert.equal(usage.peekPending(), null);
  assert.equal(usage.consumeInto(null), null);
});

test('parallel run_subagent handlers actually overlap in wall time', async () => {
  const { runAgentLoop } = await import('../src/core/agent-loop.js');
  const active = new Set();
  let maxConcurrent = 0;
  let n = 0;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  await runAgentLoop({
    systemPrompt: 'sys',
    userPrompt: 'parallel',
    model: 'test',
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: { memory: { enabled: false } },
    requestCompletion: async () => {
      n += 1;
      if (n === 1) {
        return {
          text: '',
          toolCalls: [
            { id: 'a', name: 'run_subagent', arguments: JSON.stringify({ prompt: 'A', name: 'A', tools: ['read'] }) },
            { id: 'b', name: 'run_subagent', arguments: JSON.stringify({ prompt: 'B', name: 'B', tools: ['read'] }) },
          ],
        };
      }
      return { text: 'done', toolCalls: [] };
    },
    toolHandlers: {
      run_subagent: async (args) => {
        const id = String(args?.name || args?.prompt || '');
        active.add(id);
        maxConcurrent = Math.max(maxConcurrent, active.size);
        await sleep(40);
        active.delete(id);
        return { ok: true, text: id };
      },
    },
  });

  assert.equal(maxConcurrent, 2);
});

test('default mutating run_subagent handlers stay serial', async () => {
  const { runAgentLoop } = await import('../src/core/agent-loop.js');
  const active = new Set();
  let maxConcurrent = 0;
  let n = 0;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  await runAgentLoop({
    systemPrompt: 'sys',
    userPrompt: 'serial',
    model: 'test',
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: { memory: { enabled: false } },
    requestCompletion: async () => {
      n += 1;
      if (n === 1) {
        return {
          text: '',
          toolCalls: [
            { id: 'a', name: 'run_subagent', arguments: JSON.stringify({ prompt: 'A', name: 'A' }) },
            { id: 'b', name: 'run_subagent', arguments: JSON.stringify({ prompt: 'B', name: 'B' }) },
          ],
        };
      }
      return { text: 'done', toolCalls: [] };
    },
    toolHandlers: {
      run_subagent: async (args) => {
        const id = String(args?.name || args?.prompt || '');
        active.add(id);
        maxConcurrent = Math.max(maxConcurrent, active.size);
        await sleep(20);
        active.delete(id);
        return { ok: true, text: id };
      },
    },
  });

  assert.equal(maxConcurrent, 1);
});

test('dependent subagent cards distinguish waiting and dependency-blocked states', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'call-b',
    name: 'run_subagent',
    arguments: {
      prompt: 'Configure the project',
      name: 'Mika',
      task_id: 'configure',
      depends_on: ['inspect'],
    },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    toolCallId: 'call-b',
    step: 1,
    role: 'Mika',
    title: 'Configure the project',
    goal: 'Configure the project',
    status: 'waiting',
    taskId: 'configure',
    dependsOn: ['inspect'],
  });

  let card = listCreatePlanCards(message)[0];
  assert.equal(card.planRun.phase, 'waiting');
  assert.equal(card.planRun.steps[0].status, 'waiting');
  assert.deepEqual(card.planRun.steps[0].dependsOn, ['inspect']);

  message = applyPlanEventToMessage(message, {
    type: 'plan:step_done',
    toolCallId: 'call-b',
    step: 1,
    status: 'blocked',
    taskId: 'configure',
    dependsOn: ['inspect'],
    blockedBy: ['inspect'],
    summary: 'Upstream inspection failed.',
  });
  card = listCreatePlanCards(message)[0];
  assert.equal(card.status, 'blocked');
  assert.equal(card.planRun.phase, 'blocked');
  assert.equal(card.planRun.steps[0].status, 'blocked');
  assert.deepEqual(card.planRun.steps[0].blockedBy, ['inspect']);
});

test('finishing one subagent card leaves sibling card running', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'call-a',
    name: 'run_subagent',
    arguments: { prompt: 'A', name: 'Mira' },
  });
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'call-b',
    name: 'run_subagent',
    arguments: { prompt: 'B', name: 'David' },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    toolCallId: 'call-a',
    step: 1,
    total: 1,
    role: 'Mira',
    title: 'A',
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    toolCallId: 'call-b',
    step: 1,
    total: 1,
    role: 'David',
    title: 'B',
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_done',
    toolCallId: 'call-a',
    step: 1,
    total: 1,
    role: 'Mira',
    title: 'A',
    status: 'done',
    summary: 'done A',
  });
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:end',
    id: 'call-a',
    name: 'run_subagent',
    durationMs: 10,
  });

  const cards = listCreatePlanCards(message);
  assert.equal(cards[0].status, 'done');
  assert.equal(cards[1].status, 'running');
  assert.equal(cards[1].planRun.phase, 'executing');
});

test('successful parent completion never marks a parallel subagent aborted', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  for (const [id, name] of [
    ['call-a', 'Alice'],
    ['call-b', 'Bob'],
    ['call-c', 'Charlie'],
  ]) {
    message = applyStreamEventToPlanRun(message, {
      type: 'tool:start',
      id,
      name: 'run_subagent',
      arguments: { prompt: name, name },
    });
    message = applyPlanEventToMessage(message, {
      type: 'plan:step_start',
      toolCallId: id,
      step: 1,
      total: 1,
      role: name,
      title: name,
    });
  }

  message = settleRunningCreatePlanCards(message, { reason: 'completed' });

  const cards = listCreatePlanCards(message);
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((card) => card.planRun.phase),
    ['completed', 'completed', 'completed'],
  );
  assert.deepEqual(
    cards.map((card) => card.planRun.steps[0].status),
    ['done', 'done', 'done'],
  );
});

test('successful completion reconciles a done card whose plan phase is still executing', () => {
  let message = { id: 'parent', role: 'general', segments: [] };
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:start',
    id: 'call-c',
    name: 'run_subagent',
    arguments: { prompt: 'C', name: 'Charlie' },
  });
  message = applyPlanEventToMessage(message, {
    type: 'plan:step_start',
    toolCallId: 'call-c',
    step: 1,
    total: 1,
    role: 'Charlie',
    title: 'C',
  });
  message = applyStreamEventToPlanRun(message, {
    type: 'tool:end',
    id: 'call-c',
    name: 'run_subagent',
  });

  assert.equal(listCreatePlanCards(message)[0].status, 'done');
  assert.equal(listCreatePlanCards(message)[0].planRun.phase, 'executing');

  message = settleRunningCreatePlanCards(message, { reason: 'completed' });
  const card = listCreatePlanCards(message)[0];
  assert.equal(card.status, 'done');
  assert.equal(card.planRun.phase, 'completed');
  assert.equal(card.planRun.steps[0].status, 'done');
});
