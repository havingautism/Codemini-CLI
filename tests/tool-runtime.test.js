import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolRuntime } from '../src/core/tool-runtime.js';

function definition(name, parameters = { type: 'object', properties: {} }) {
  return {
    type: 'function',
    function: { name, description: `${name} tool`, parameters },
  };
}

test('ToolRuntime owns model visibility, validation, activation, execution, and presentation', async () => {
  const echoDefinition = definition('echo', {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  });
  const laterDefinition = definition('later');
  const echo = async (args) => ({ echoed: args.value });
  echo.prepareApproval = async (args) => ({ command: `echo ${args.value}` });

  const runtime = createToolRuntime({
    definitions: [echoDefinition],
    deferredDefinitions: { later: laterDefinition },
    handlers: { echo, later: async () => ({ ready: true }) },
    formatters: { echo: (result) => result.echoed },
    displayLabels: { echo: 'Echo' },
    metadata: { echo: { isConcurrencySafe: true } },
  });

  const response = runtime.beginModelResponse([
    { id: 'valid', name: 'echo', arguments: '{"value":"ok"}' },
    { id: 'invalid', name: 'echo', arguments: '{"value":3}' },
    { id: 'hidden', name: 'later', arguments: '{}' },
  ]);

  assert.deepEqual(runtime.definitions().map((item) => item.function.name), ['echo']);
  assert.deepEqual(response.visibleNames, ['echo']);
  assert.equal(response.calls[0].displayName, 'Echo (ok)');
  assert.equal(response.calls[0].isParallelSafe, true);
  assert.equal(response.calls[0].isModelVisible, true);
  assert.equal(response.calls[1].args._invalid_schema, true);
  assert.equal(response.calls[2].isModelVisible, false);
  assert.deepEqual(await runtime.execute('echo', { value: 'ok' }), { echoed: 'ok' });
  assert.equal(runtime.format('echo', { echoed: 'ok' }, {}), 'ok');
  assert.deepEqual(await runtime.prepareApproval('echo', { value: 'ok' }), { command: 'echo ok' });

  assert.deepEqual(runtime.activateSchemas([laterDefinition]), [laterDefinition]);
  assert.deepEqual(runtime.activateSchemas([laterDefinition]), []);
  assert.deepEqual(runtime.definitions().map((item) => item.function.name), ['echo', 'later']);
  assert.equal(
    runtime.beginModelResponse([{ id: 'now-visible', name: 'later', arguments: '{}' }]).calls[0].isModelVisible,
    true,
  );
});

test('ToolRuntime bounds parallel batches and treats exclusive calls as barriers', async () => {
  const runtime = createToolRuntime({ maxParallelCalls: 2 });
  const events = [];
  let active = 0;
  let maxActive = 0;
  const execute = async (call) => {
    events.push(`start:${call.id}`);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, call.delay));
    active -= 1;
    events.push(`end:${call.id}`);
    return call.id;
  };

  const results = await runtime.executeOrdered([
    { id: 'read-1', delay: 20, isParallelSafe: true },
    { id: 'read-2', delay: 10, isParallelSafe: true },
    { id: 'write', delay: 1, isParallelSafe: false },
    { id: 'read-3', delay: 1, isParallelSafe: true },
  ], {
    canRunConcurrently: () => true,
    execute,
  });

  assert.deepEqual(results, ['read-1', 'read-2', 'write', 'read-3']);
  assert.equal(maxActive, 2);
  assert.ok(events.indexOf('start:write') > events.indexOf('end:read-1'));
  assert.ok(events.indexOf('start:write') > events.indexOf('end:read-2'));
  assert.ok(events.indexOf('start:read-3') > events.indexOf('end:write'));
});
