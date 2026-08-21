import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createToolRegistry,
  ToolArgumentsError,
  ToolRegistryContractError,
} from '../src/core/tool-registry.js';
import { getBuiltinTools } from '../src/core/tools.js';

function definition(name, parameters = { type: 'object', properties: {} }) {
  return {
    type: 'function',
    function: { name, description: `${name} tool`, parameters },
  };
}

test('ToolRegistry compiles definitions into one validated execution interface', async () => {
  const signal = new AbortController().signal;
  let receivedContext;
  const registry = createToolRegistry({
    definitions: [definition('echo', {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    })],
    handlers: {
      echo: async (args, context) => {
        receivedContext = context;
        return { value: args.value };
      },
    },
    formatters: { echo: (result) => result.value },
    displayLabels: { echo: 'Echo' },
    metadata: { echo: { isConcurrencySafe: true } },
  });

  assert.deepEqual(registry.definitions().map((item) => item.function.name), ['echo']);
  assert.equal(registry.getDisplayLabel('echo'), 'Echo');
  assert.deepEqual(registry.displayLabels(), { echo: 'Echo' });
  assert.equal(registry.isConcurrencySafe('echo', { value: 'ok' }), true);
  assert.deepEqual(
    await registry.execute('echo', { value: 'ok' }, { signal, toolCallId: 'call-1' }),
    { value: 'ok' },
  );
  assert.equal(receivedContext.signal, signal);
  assert.equal(receivedContext.toolCallId, 'call-1');
  assert.equal(registry.format('echo', { value: 'ok' }, {}), 'ok');
  assert.throws(
    () => registry.validateArguments('echo', {}),
    (error) => error instanceof ToolArgumentsError && error.code === 'INVALID_TOOL_ARGUMENTS',
  );
});

test('ToolRegistry fails registration for duplicate definitions and missing handlers', () => {
  assert.throws(
    () => createToolRegistry({
      definitions: [definition('echo'), definition('echo')],
      handlers: { echo: async () => ({}) },
    }),
    (error) => error instanceof ToolRegistryContractError && /Duplicate/.test(error.message),
  );
  assert.throws(
    () => createToolRegistry({ definitions: [definition('missing')] }),
    (error) => error instanceof ToolRegistryContractError && /no handler/.test(error.message),
  );
});

test('ToolRegistry keeps handler-only tools callable without exposing a fake schema', async () => {
  const registry = createToolRegistry({
    handlers: { internal: async (args) => args.value },
  });
  assert.deepEqual(registry.definitions(), []);
  assert.equal(await registry.execute('internal', { value: 3 }), 3);
  assert.equal(registry.get('internal').exposure, 'host-only');
});

test('builtin concurrency policy lives behind the registry seam', () => {
  const registry = createToolRegistry({
    handlers: {
      read: async () => ({}),
      edit: async () => ({}),
      run_subagent: async () => ({}),
    },
  });
  assert.equal(registry.isConcurrencySafe('read', { path: 'a' }), true);
  assert.equal(registry.isConcurrencySafe('edit', { path: 'a' }), false);
  assert.equal(registry.isConcurrencySafe('run_subagent', { tools: ['read', 'glob'] }), true);
  assert.equal(registry.isConcurrencySafe('run_subagent', { tools: ['read', 'edit'] }), true);
  assert.equal(registry.isConcurrencySafe('run_subagent', {}), true);
});

test('the complete builtin tool bundle satisfies the registry contract', async () => {
  const bundle = getBuiltinTools({ workspaceRoot: process.cwd(), config: {} });
  try {
    const registry = createToolRegistry(bundle);
    assert.ok(registry.definitions().length > 0);
    assert.ok(Object.keys(registry.deferredDefinitions()).length > 0);
  } finally {
    await bundle.dispose?.();
  }
});
