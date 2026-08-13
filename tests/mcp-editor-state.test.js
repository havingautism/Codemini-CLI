import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMcpEditorPatch } from '../codemini-web/client/src/lib/mcp-editor-state.js';

const discoveredEditor = {
  id: 'demo',
  name: 'Demo',
  transport: 'http',
  url: 'https://old.example/mcp',
  headersText: '{}',
  cachedTools: [{ name: 'old_tool', enabled: true }],
  instructions: 'Old instructions',
  lastConnectedAt: '2026-07-18T00:00:00.000Z',
};

test('changing an MCP connection input invalidates discovered tools', () => {
  const next = applyMcpEditorPatch(discoveredEditor, { url: 'https://new.example/mcp' });
  assert.equal(next.url, 'https://new.example/mcp');
  assert.deepEqual(next.cachedTools, []);
  assert.equal(next.instructions, '');
  assert.equal(next.lastConnectedAt, '');
});

test('editing presentation or tool enablement preserves MCP discovery', () => {
  const renamed = applyMcpEditorPatch(discoveredEditor, { name: 'Renamed' });
  assert.deepEqual(renamed.cachedTools, discoveredEditor.cachedTools);

  const tools = [{ name: 'old_tool', enabled: false }];
  const toggled = applyMcpEditorPatch(discoveredEditor, { cachedTools: tools });
  assert.deepEqual(toggled.cachedTools, tools);
  assert.equal(toggled.lastConnectedAt, discoveredEditor.lastConnectedAt);
});
