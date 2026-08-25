import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltinTools } from '../src/core/tools.js';
import { UserInputManager } from '../codemini-web/lib/user-input-manager.js';

test('request_user_input is exposed only when the host installs a handler', async () => {
  const cliTools = getBuiltinTools({ workspaceRoot: process.cwd(), config: {} });
  assert.equal(
    cliTools.definitions.some((tool) => tool.function?.name === 'request_user_input'),
    false,
  );
  await cliTools.dispose();

  let receivedForm = null;
  const webTools = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {},
    requestUserInput: async (form) => {
      receivedForm = form;
      return { status: 'submitted', answers: { choice: 'a' } };
    },
  });
  assert.equal(
    webTools.definitions.some((tool) => tool.function?.name === 'request_user_input'),
    true,
  );
  const requestSchema = webTools.definitions.find(
    (tool) => tool.function?.name === 'request_user_input',
  )?.function?.parameters;
  const questionProperties = requestSchema?.properties?.questions?.items?.properties || {};
  assert.deepEqual(Object.keys(requestSchema?.properties || {}), ['questions']);
  assert.deepEqual(Object.keys(questionProperties), ['id', 'question', 'multi_select', 'options']);
  assert.deepEqual(questionProperties.options.items.required, ['label']);

  const result = await webTools.handlers.request_user_input({
    title: 'Choose',
    questions: [{
      id: 'choice',
      label: 'Choice',
      type: 'radio',
      options: [{ label: 'A', value: 'a' }],
    }],
  });
  assert.deepEqual(result, { status: 'submitted', answers: { choice: 'a' } });
  assert.equal(receivedForm.questions[0].type, 'radio');
  await webTools.dispose();
});

test('user input manager resolves submitted and skipped forms', async () => {
  const manager = new UserInputManager();
  const submitted = manager.create('one', { title: 'One' });
  assert.equal(manager.current.id, 'one');
  assert.equal(manager.resolve('one', { status: 'submitted', answers: { name: 'Ada' } }), true);
  assert.deepEqual(await submitted, { status: 'submitted', answers: { name: 'Ada' } });
  assert.equal(manager.current, null);

  const skipped = manager.create('two', { title: 'Two' });
  assert.equal(manager.resolveAll(), 1);
  assert.deepEqual(await skipped, { status: 'skipped', answers: {} });
});
