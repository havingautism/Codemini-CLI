import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissAgentTab, EMPTY_WORKSPACE_TABS, openWorkspacePicker, openWorkspaceTool, removeWorkspaceTab, visibleAgentCommands } from '../codemini-web/client/src/lib/workspace-tabs.js';

test('new tabs keep separate terminals and reuse the Files and Git views', () => {
  let state = openWorkspaceTool(EMPTY_WORKSPACE_TABS, 'files');
  state = openWorkspaceTool(openWorkspacePicker(state), 'terminal', 'one');
  state = openWorkspaceTool(openWorkspacePicker(state), 'terminal', 'two');
  state = openWorkspaceTool(openWorkspacePicker(state), 'git');
  state = openWorkspaceTool(openWorkspacePicker(state), 'files');
  assert.deepEqual(state.tabs.map(tab => tab.id), ['files', 'one', 'two', 'git']);
  assert.deepEqual(state.tabs.filter(tab => tab.type === 'terminal').map(tab => tab.number), [1, 2]);
  assert.equal(state.activeId, 'files');
  state = openWorkspacePicker(openWorkspacePicker(state));
  assert.equal(state.tabs.filter(tab => tab.type === 'new').length, 1);
  assert.equal(removeWorkspaceTab(state, 'new').activeId, 'git');
  assert.deepEqual(removeWorkspaceTab(openWorkspaceTool(EMPTY_WORKSPACE_TABS, 'git'), 'git').tabs, EMPTY_WORKSPACE_TABS.tabs);
});

test('ignores legacy and completed commands and keeps an agent tab dismissed across tab changes', () => {
  const server = { id: 'dev', background: true, status: 'running' };
  const commands = [
    { id: 'old-build', background: false, status: 'done' },
    { id: 'foreground', background: false, status: 'running' },
    { id: 'exited-dev', background: true, status: 'done' },
    server,
  ];
  assert.deepEqual(visibleAgentCommands(commands), [server]);
  const state = dismissAgentTab({ ...EMPTY_WORKSPACE_TABS, activeId: 'dev' }, 'dev');
  assert.equal(state.activeId, 'new');
  const withFiles = openWorkspaceTool(state, 'files');
  assert.deepEqual(visibleAgentCommands(commands, withFiles.hiddenAgentTabs), []);
  assert.deepEqual(visibleAgentCommands(commands, EMPTY_WORKSPACE_TABS.hiddenAgentTabs), [server]);
});
