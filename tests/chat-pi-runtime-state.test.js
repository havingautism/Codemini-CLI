import test from 'node:test';
import assert from 'node:assert/strict';

import { getPiCopy } from '../src/tui-pi/copy.js';
import {
  applyPiRuntimeEvent,
  applyPiSubmitStart,
  buildInitialPiShellState,
  buildPiMessagesFromSessionHistory,
  buildPiToolPanelState,
  toggleToolDetails
} from '../src/tui-pi/runtime-state.js';

test('buildPiMessagesFromSessionHistory maps session roles to pi-tui rows', () => {
  const rows = buildPiMessagesFromSessionHistory([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'world' }
  ]);

  assert.deepEqual(rows.map((row) => row.role), ['you', 'coder']);
  assert.equal(rows[0].text, 'hello');
  assert.equal(rows[1].text, 'world');
});

test('buildPiMessagesFromSessionHistory accepts sessionHistory.messages input shape', () => {
  const rows = buildPiMessagesFromSessionHistory({
    messages: [{ role: 'user', content: 'from session' }]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'you');
  assert.equal(rows[0].text, 'from session');
});

test('buildPiMessagesFromSessionHistory normalizes structured single-object content', () => {
  const rows = buildPiMessagesFromSessionHistory([
    { role: 'assistant', content: { text: 'hello' } },
    { role: 'assistant', content: { content: 'world' } }
  ]);

  assert.equal(rows[0].text, 'hello');
  assert.equal(rows[1].text, 'world');
});

test('buildPiMessagesFromSessionHistory normalizes nested array item text objects', () => {
  const rows = buildPiMessagesFromSessionHistory([
    { role: 'assistant', content: [{ text: { value: 'hello' } }] }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'hello');
});

test('buildPiMessagesFromSessionHistory normalizes nested array item content objects', () => {
  const rows = buildPiMessagesFromSessionHistory([
    { role: 'assistant', content: [{ content: { text: 'hello' } }] }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'hello');
});

test('buildPiMessagesFromSessionHistory separates array items into readable text', () => {
  const rows = buildPiMessagesFromSessionHistory([
    { role: 'assistant', content: ['hello', 'world'] }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'hello\nworld');
});

test('buildPiMessagesFromSessionHistory skips unknown and empty roles', () => {
  const rows = buildPiMessagesFromSessionHistory([
    { role: '', content: 'blank' },
    { role: 'unknown', content: 'skip me' },
    { role: 'system', content: 'keep me' }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'system');
  assert.equal(rows[0].text, 'keep me');
});

test('buildPiToolPanelState returns collapsed summaries by default', () => {
  const panel = buildPiToolPanelState(
    [{ name: 'read(src/cli.js)', done: true, summary: '已读取文件: src/cli.js' }],
    false
  );

  assert.equal(panel.expanded, false);
  assert.equal(panel.summaryRows.length, 1);
  assert.equal(panel.detailRows.length, 0);
});

test('buildPiToolPanelState formats expanded detail rows', () => {
  const panel = buildPiToolPanelState(
    [
      { name: 'read(src/cli.js)', done: true, summary: '已读取文件: src/cli.js' },
      { name: 'run(npm test)', done: false, summary: '正在运行测试: npm test' }
    ],
    true
  );

  assert.deepEqual(panel.detailRows, [
    '[done] 已读取文件: src/cli.js',
    '[run] 正在运行测试: npm test'
  ]);
});

test('toggleToolDetails flips the expanded state without changing the tool list', () => {
  const next = toggleToolDetails({
    expanded: false,
    items: [{ name: 'run(npm test)', done: false, summary: '正在运行测试: npm test' }]
  });

  assert.equal(next.expanded, true);
  assert.equal(next.items.length, 1);
});

test('buildInitialPiShellState seeds a shell snapshot from runtime metadata', () => {
  const shell = buildInitialPiShellState({
    runtimeState: {
      sessionId: 'sess-42',
      model: 'gpt-5',
      sdkProvider: 'openai-compatible',
      mode: 'plan'
    },
    toolDetailsExpanded: false
  });

  assert.equal(shell.status, 'waiting');
  assert.equal(shell.messages.length, 2);
  assert.match(shell.messages[0].text, /sess-42/);
  assert.match(shell.messages[1].text, /send it through the runtime/);
  assert.equal(shell.toolPanel.expanded, false);
  assert.equal(shell.toolPanel.items.length, 0);
});

test('buildInitialPiShellState can start with expanded tool details', () => {
  const shell = buildInitialPiShellState({
    runtimeState: {
      sessionId: 'sess-99',
      model: 'gpt-4.1-mini',
      sdkProvider: 'openai-compatible',
      mode: 'auto'
    },
    toolDetailsExpanded: true
  });

  assert.equal(shell.toolPanel.expanded, true);
  assert.equal(shell.toolPanel.detailRows.length, 0);
});

test('applyPiSubmitStart appends the user turn and moves the shell into thinking state', () => {
  const initial = buildInitialPiShellState({
    runtimeState: {
      sessionId: 'sess-submit',
      model: 'gpt-5',
      sdkProvider: 'openai-compatible',
      mode: 'auto'
    }
  });

  const next = applyPiSubmitStart(initial, 'Ship Task 4');

  assert.equal(next.status, 'thinking');
  assert.equal(next.messages.at(-1)?.role, 'you');
  assert.equal(next.messages.at(-1)?.text, 'Ship Task 4');
});

test('applyPiRuntimeEvent streams assistant text and tracks tool activity by event id', () => {
  let state = {
    status: 'waiting',
    messages: [],
    toolPanel: buildPiToolPanelState([], true)
  };

  state = applyPiRuntimeEvent(state, { type: 'assistant:start' });
  state = applyPiRuntimeEvent(state, { type: 'assistant:delta', text: 'Hello' });
  state = applyPiRuntimeEvent(state, {
    type: 'tool:start',
    id: 'tool-1',
    name: 'read(src/tui-pi/app.js)'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'tool:end',
    id: 'tool-1',
    name: 'read(src/tui-pi/app.js)',
    summary: 'Read 1 file'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'tool:result',
    id: 'tool-1',
    name: 'read(src/tui-pi/app.js)',
    content: 'const answer = 42;'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'assistant:response',
    text: 'Hello there'
  });

  assert.equal(state.status, 'waiting');
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].role, 'coder');
  assert.equal(state.messages[0].text, 'Hello there');
  assert.match(state.messages[0].toolLines[0], /🔧/);
  assert.match(state.messages[0].toolLines[0], /read\(src\/tui-pi\/app\.js\)/);
  assert.match(state.messages[0].toolLines[1], /📄/);
  assert.match(state.messages[0].toolLines[1], /Read 1 file/);
  assert.match(state.messages[0].toolLines[2], /└/);
  assert.match(state.messages[0].toolLines[2], /const answer = 42;/);
  assert.equal(state.toolPanel.items.length, 1);
  assert.equal(state.toolPanel.items[0].done, true);
  assert.match(state.toolPanel.summaryRows[0], /Read 1 file/);
  assert.match(state.toolPanel.detailRows[0], /const answer = 42;/);
});

test('applyPiRuntimeEvent attaches tool timeline rows to the current coder message', () => {
  let state = {
    status: 'waiting',
    messages: [],
    toolPanel: buildPiToolPanelState([], false)
  };

  state = applyPiRuntimeEvent(state, { type: 'assistant:start' });
  state = applyPiRuntimeEvent(state, {
    type: 'tool:start',
    id: 'tool-1',
    name: 'Read(/tmp/README.md)'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'tool:end',
    id: 'tool-1',
    name: 'Read(/tmp/README.md)',
    summary: 'Read README.md'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'assistant:response',
    text: 'Done reading it.'
  });

  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].role, 'coder');
  assert.deepEqual(state.messages[0].toolLines, [
    '🔧 Read(/tmp/README.md)',
    '📄 Read README.md'
  ]);
  assert.equal(state.messages[0].text, 'Done reading it.');
});

test('applyPiRuntimeEvent keeps tooling status while another tool is still running', () => {
  let state = {
    status: 'waiting',
    messages: [],
    toolPanel: buildPiToolPanelState([], false)
  };

  state = applyPiRuntimeEvent(state, {
    type: 'tool:start',
    id: 'tool-1',
    name: 'read(src/a.js)'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'tool:start',
    id: 'tool-2',
    name: 'read(src/b.js)'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'tool:end',
    id: 'tool-1',
    name: 'read(src/a.js)',
    summary: 'Read a.js'
  });

  assert.equal(state.status, 'tooling');
  assert.equal(state.toolPanel.items.length, 2);
  assert.equal(state.toolPanel.items[0].done, true);
  assert.equal(state.toolPanel.items[1].done, false);
});

test('applyPiRuntimeEvent keeps tooling when assistant response arrives before last tool completion', () => {
  let state = {
    status: 'waiting',
    messages: [],
    toolPanel: buildPiToolPanelState([], false)
  };

  state = applyPiRuntimeEvent(state, {
    type: 'tool:start',
    id: 'tool-1',
    name: 'read(src/a.js)'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'assistant:response',
    text: 'I have started working on it.'
  });

  assert.equal(state.status, 'tooling');
  assert.equal(state.messages.at(-1)?.text, 'I have started working on it.');

  state = applyPiRuntimeEvent(state, {
    type: 'tool:end',
    id: 'tool-1',
    name: 'read(src/a.js)',
    summary: 'Read a.js'
  });

  assert.equal(state.status, 'waiting');
});

test('applyPiRuntimeEvent keeps tooling when assistant delta arrives while a tool is still running', () => {
  let state = {
    status: 'waiting',
    messages: [],
    toolPanel: buildPiToolPanelState([], false)
  };

  state = applyPiRuntimeEvent(state, {
    type: 'tool:start',
    id: 'tool-1',
    name: 'read(src/a.js)'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'assistant:start'
  });
  state = applyPiRuntimeEvent(state, {
    type: 'assistant:delta',
    text: 'Streaming while tool is still active'
  });

  assert.equal(state.status, 'tooling');
  assert.equal(state.messages.at(-1)?.text, 'Streaming while tool is still active');
});

test('getPiCopy normalizes language and falls back to zh', () => {
  assert.equal(getPiCopy('EN-us').language, 'en');
  assert.equal(getPiCopy('fr').language, 'zh');
  assert.equal(getPiCopy().toolPanel.collapsed, '已收起');
});
