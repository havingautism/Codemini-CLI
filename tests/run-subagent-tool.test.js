import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinTools } from '../src/core/tools.js';

test('coding tools expose run_subagent when onRunSubAgent is provided', () => {
  const { definitions, handlers } = getBuiltinTools({
    onRunSubAgent: async () => ({ ok: true, text: 'done' }),
  });
  const names = definitions.map((item) => item.function?.name || item.name);
  assert.equal(names.includes('run_subagent'), true);
  assert.equal(names.includes('create_plan'), false);
  assert.equal(names.includes('create_spec'), false);
  assert.equal(typeof handlers.run_subagent, 'function');
});

test('run_subagent requires a prompt or tasks', async () => {
  const { handlers } = getBuiltinTools({
    onRunSubAgent: async () => ({ ok: true, text: 'done' }),
  });
  const empty = await handlers.run_subagent({});
  assert.equal(empty.ok, false);
  assert.match(empty.error, /prompt or tasks/i);
});

test('run_subagent accepts structured tasks without duplicating them in prompt prose', async () => {
  let seen = null;
  const { definitions, handlers } = getBuiltinTools({
    onRunSubAgent: async (args) => {
      seen = args;
      return { ok: true, text: 'done' };
    },
  });
  const def = definitions.find((item) => item.function?.name === 'run_subagent');
  assert.equal(Boolean(def?.function?.parameters?.properties?.tasks), true);

  await handlers.run_subagent({
    name: 'Mira',
    tasks: [{ content: 'Inspect notebook sources', activeForm: 'Inspecting notebook sources', status: 'pending' }],
  });

  assert.equal(seen.prompt, 'Complete the assigned tasks.');
  assert.deepEqual(seen.tasks, [
    { content: 'Inspect notebook sources', activeForm: 'Inspecting notebook sources', status: 'pending' },
  ]);
});

test('run_subagent forwards invented name to handler', async () => {
  let seen = null;
  const { handlers, definitions } = getBuiltinTools({
    onRunSubAgent: async (args) => {
      seen = args;
      return { ok: true, text: 'done' };
    },
  });
  const def = definitions.find((item) => item.function?.name === 'run_subagent');
  assert.equal(Boolean(def?.function?.parameters?.properties?.name), true);
  assert.equal(Boolean(def?.function?.parameters?.properties?.summary), true);
  assert.equal(Boolean(def?.function?.parameters?.properties?.task_id), true);
  assert.equal(Boolean(def?.function?.parameters?.properties?.depends_on), true);
  assert.equal(Boolean(def?.function?.parameters?.properties?.paths), false);
  assert.match(String(def?.function?.description || ''), /David|invent/i);

  await handlers.run_subagent(
    {
      prompt: 'Implement X',
      summary: 'Implement the requested feature.',
      name: 'david',
      task_id: 'implement',
      depends_on: ['inspect'],
      tools: ['read'],
    },
    { toolCallId: 'call-1', orchestrationId: 'turn-1' }
  );
  assert.equal(seen.prompt, 'Implement X');
  assert.equal(seen.summary, 'Implement the requested feature.');
  assert.equal(seen.name, 'david');
  assert.equal(seen.toolCallId, 'call-1');
  assert.equal(seen.orchestrationId, 'turn-1');
  assert.equal(seen.taskId, 'implement');
  assert.deepEqual(seen.dependsOn, ['inspect']);
  assert.deepEqual(seen.tools, ['read']);
});
