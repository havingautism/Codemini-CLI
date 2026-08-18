import test from 'node:test';
import assert from 'node:assert/strict';
import stripAnsi from 'strip-ansi';
import { Container, getCapabilities, setCapabilities } from '@earendil-works/pi-tui';

import { buildSlashCommands, runOpenCodeTui } from '../src/tui/opencode-chat-app.js';
import { ActivityBar, ApprovalDialog, Footer, TopBar } from '../src/tui/components/chrome.js';
import { PlanProgress, ProcessedFold, ReasoningBlock, TodoProgress, ToolCall, ToolCallGroup, appendHistory, createAssistantMessage, createSystemMessage, createUserMessage, linkMarkdownImages } from '../src/tui/components/messages.js';
import { ModeHome } from '../src/tui/components/mode-home.js';
import { createTuiCopy } from '../src/tui/copy.js';

class FakeTerminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  output = '';
  screen = [];
  onInput = null;

  start(onInput) { this.onInput = onInput; }
  stop() {}
  drainInput() { return Promise.resolve(); }
  write(value) {
    this.output += value;
    if (value.includes('\u001b[2J')) this.screen = [];
    const rows = /\u001b\[(\d+);1H\u001b\[2K([\s\S]*?)(?=\u001b\[\d+;1H\u001b\[2K|\u001b\[\?25[hl]|\u001b\[\?2026l|$)/g;
    for (const match of value.matchAll(rows)) this.screen[Number(match[1]) - 1] = match[2];
  }
  screenText() { return stripAnsi(this.screen.join('\n')); }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
  send(value) { this.onInput?.(value); }
}

class DrainCheckingTerminal extends FakeTerminal {
  drained = false;
  drainInput() {
    this.drained = true;
    return Promise.resolve();
  }
  stop() {
    assert.equal(this.drained, true, 'terminal input must drain before a session switch stops the TUI');
  }
}

async function waitFor(check, timeoutMs = 1000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for TUI state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('OpenCode-style TUI renders and exits on double Ctrl+C', async () => {
  const terminal = new FakeTerminal();
  const modes = [];
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', messageCount: 0, contextUsagePct: 12, model: 'test-model', approvalMode: 'auto', sandboxMode: 'workspace-write', shell: 'bash', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async (mode) => modes.push(mode),
    submitMessage: async () => ({ type: 'noop' })
  };

  const running = runOpenCodeTui({
    runtime,
    sessionId: 'session-1234',
    model: 'test-model',
    version: 'test',
    language: 'zh',
    terminal
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(stripAnsi(terminal.output), /██████╗ ██████╗.*启动中心.*新对话.*会话历史.*设置.*◆ test-model.*⌂ E:\\repo/s);
  terminal.send('\r');
  await waitFor(() => modes.length === 1);
  await waitFor(() => stripAnsi(terminal.output).includes('test-model'));
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;

  const rendered = stripAnsi(terminal.output);
  assert.match(rendered, /codemini/i);
  assert.match(rendered, /test-model/);
  assert.deepEqual(modes, ['coding']);
});

test('unchecked session starts a real new conversation from a populated session', async () => {
  const terminal = new DrainCheckingTerminal();
  const runtime = {
    getSessionMessages: () => [{ role: 'user', content: 'existing' }],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', sessionId: 'current-session', sessionTitle: 'Existing work', messageCount: 1, model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async () => ({ type: 'noop' })
  };

  const running = runOpenCodeTui({
    runtime,
    sessionId: 'current-session',
    model: 'test-model',
    language: 'zh',
    terminal,
    workspaceDir: 'C:\\codemini-global\\workspace',
    currentDirectory: 'E:\\repo'
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(stripAnsi(terminal.output), /⌂ C:\\codemini-global\\workspace/);
  assert.match(stripAnsi(terminal.output), /继续当前会话.*Existing work/s);
  terminal.send('\r');
  assert.deepEqual(await running, { newSession: true, projectDir: 'C:\\codemini-global\\workspace' });
});

test('start location can launch a new conversation in the current directory', async () => {
  const terminal = new DrainCheckingTerminal();
  const runtime = {
    getSessionMessages: () => [{ role: 'user', content: 'existing' }],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getAvailableSouls: async () => [],
    getRuntimeState: () => ({ mode: 'plan', messageCount: 1, model: 'test-model', workspaceRoot: 'D:\\old' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {}
  };

  const running = runOpenCodeTui({
    runtime,
    sessionId: 'location-test',
    model: 'test-model',
    terminal,
    workspaceDir: 'C:\\codemini-global\\workspace',
    currentDirectory: 'E:\\launch-project'
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\u001b[B');
  terminal.send('\u001b[B');
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('Current directory'));
  terminal.send('\u001b[A');
  terminal.send('\u001b[A');
  terminal.send('\r');
  assert.deepEqual(await running, { newSession: true, projectDir: 'E:\\launch-project' });
});

test('start center exposes session history as a dedicated modal entry', async () => {
  const terminal = new FakeTerminal();
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getSessionHistory: async () => [
      { id: 'older-session', title: 'Previous work', messageCount: 4, isGeneral: true },
      { id: 'project-session', title: 'Project work', messageCount: 6, projectKey: 'E:/repo', projectDir: 'E:\\repo' }
    ],
    getRuntimeState: () => ({ mode: 'plan', messageCount: 0, model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async () => ({ type: 'noop' })
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'blank-session', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(stripAnsi(terminal.output), /Session history.*Browse and resume conversations/s);
  terminal.send('\u001b[B');
  terminal.send('\u001b[B');
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('General Chat'));
  assert.match(stripAnsi(terminal.output), /General Chat.*repo/s);
  terminal.send('\u001b[B');
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('Project work'));
  terminal.send('\u001b');
  await waitFor(() => terminal.screenText().includes('General Chat'));
  terminal.send('\u001b');
  terminal.send('\u0003');
  await running;
});

test('OpenCode-style TUI queues prompts while a turn is running', async () => {
  const terminal = new FakeTerminal();
  const calls = [];
  let releaseFirst;
  const firstTurn = new Promise((resolve) => { releaseFirst = resolve; });
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async ({ text }, onEvent) => {
      calls.push(text);
      if (calls.length === 1) await firstTurn;
      onEvent({ type: 'assistant:start' });
      onEvent({ type: 'assistant:delta', text: `reply:${text}` });
      onEvent({ type: 'assistant:response', text: `reply:${text}` });
      return { type: 'assistant', text: `reply:${text}` };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'queue-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const key of 'first') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => calls.length === 1);
  for (const key of 'second') terminal.send(key);
  terminal.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ['first']);

  releaseFirst();
  await waitFor(() => calls.length === 2);
  assert.deepEqual(calls, ['first', 'second']);
  await waitFor(() => stripAnsi(terminal.output).includes('reply:second'));
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('Ctrl+Enter jumps the queue while a turn is running', async () => {
  const terminal = new FakeTerminal();
  const calls = [];
  let releaseFirst;
  const firstTurn = new Promise((resolve) => { releaseFirst = resolve; });
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async ({ text }, onEvent) => {
      calls.push(text);
      if (calls.length === 1) await firstTurn;
      onEvent({ type: 'assistant:start' });
      onEvent({ type: 'assistant:delta', text: `reply:${text}` });
      onEvent({ type: 'assistant:response', text: `reply:${text}` });
      return { type: 'assistant', text: `reply:${text}` };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'queue-jump-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const key of 'first') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => calls.length === 1);

  // Enter while busy appends to the end of the queue...
  for (const key of 'normal') terminal.send(key);
  terminal.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 20));
  // ...Ctrl+Enter while busy jumps the queue instead.
  for (const key of 'urgent') terminal.send(key);
  terminal.send('\u001b[27;5;13~');
  await new Promise((resolve) => setTimeout(resolve, 20));

  releaseFirst();
  await waitFor(() => calls.length === 3);
  assert.deepEqual(calls, ['first', 'urgent', 'normal']);
  await waitFor(() => stripAnsi(terminal.output).includes('reply:urgent'));
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('manual stop continues on a new session instead of appending under the aborted turn', async () => {
  const terminal = new FakeTerminal();
  const calls = [];
  let currentSessionId = 'old-session';
  let rejectFirst;
  const firstTurn = new Promise((_, reject) => { rejectFirst = reject; });
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getCurrentSessionId: () => currentSessionId,
    getRuntimeState: () => ({ model: 'test-model', workspaceRoot: 'E:\\repo', sessionId: currentSessionId }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    abort() {
      currentSessionId = 'new-session';
      const error = new Error('Aborted');
      error.name = 'AbortError';
      rejectFirst(error);
      return true;
    },
    submitMessage: async ({ text }, onEvent) => {
      calls.push(text);
      if (calls.length === 1) {
        onEvent({ type: 'assistant:start' });
        onEvent({ type: 'assistant:delta', text: 'partial-' });
        await firstTurn;
      }
      onEvent({ type: 'assistant:start' });
      onEvent({ type: 'assistant:delta', text: `reply:${text}` });
      onEvent({ type: 'assistant:response', text: `reply:${text}` });
      return { type: 'assistant', text: `reply:${text}` };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'old-session', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const key of 'first') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => calls.length === 1);
  for (const key of 'next') terminal.send(key);
  terminal.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\u001b');
  await waitFor(() => calls.length === 2);
  await waitFor(() => /continued in a new conversation|已在新会话中继续/.test(stripAnsi(terminal.output)));
  await waitFor(() => stripAnsi(terminal.output).includes('reply:next'));
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('up arrow recalls editor history instead of scrolling the transcript', async () => {
  const terminal = new FakeTerminal();
  const calls = [];
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => ['remember me'],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'normal', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async ({ text }) => {
      calls.push(text);
      return { type: 'noop' };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'history-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\u001b[A');
  terminal.send('\r');
  await waitFor(() => calls.length === 1);
  assert.deepEqual(calls, ['remember me']);
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('tool calls collapse by default and expose details when toggled', () => {
  const row = new ToolCall({ name: 'read', arguments: { path: 'README.md' } });
  assert.doesNotMatch(stripAnsi(row.render(80).join('\n')), /arguments:/);
  row.update({ summary: 'Read 42 lines' }, 'success');
  row.setExpanded(true);
  const rendered = stripAnsi(row.render(80).join('\n'));
  assert.match(rendered, /arguments:/);
  assert.match(rendered, /Read 42 lines/);
});

test('todo progress is a persistent card that updates in place', () => {
  const todo = new TodoProgress({ tasks: [
    { content: 'Inspect', status: 'completed' },
    { content: 'Build', status: 'in_progress' },
    { content: 'Verify', status: 'pending' },
  ] });

  let rendered = stripAnsi(todo.render(80).join('\n'));
  assert.match(rendered, /Tasks  1\/3/);
  assert.match(rendered, /✓ Inspect/);
  assert.match(rendered, /● Build/);
  assert.match(rendered, /○ Verify/);
  todo.update({ arguments: { tasks: [
    { content: 'Inspect', status: 'completed' },
    { content: 'Build', status: 'completed' },
  ] } });
  rendered = stripAnsi(todo.render(80).join('\n'));
  assert.match(rendered, /Tasks  2\/2/);
  assert.doesNotMatch(rendered, /Verify/);
  assert.match(stripAnsi(new TodoProgress({ tasks: [] }).render(80).join('\n')), /Tasks  0\/0[\s\S]*No active tasks/);
});

test('processed folds keep pinned todo cards visible while body-only', () => {
  const fold = new ProcessedFold(createTuiCopy('en'));
  fold.addChild(new ReasoningBlock(createTuiCopy('en'), 'hidden details', { complete: true }));
  fold.addPinnedChild(new TodoProgress({ tasks: [{ content: 'Build', status: 'in_progress' }] }));
  fold.finish();
  fold.setBodyOnly(true);
  const rendered = stripAnsi(fold.render(80).join('\n'));
  assert.match(rendered, /Processed/);
  assert.match(rendered, /Tasks/);
  assert.match(rendered, /Build/);
  assert.doesNotMatch(rendered, /hidden details/);
});

test('chat chrome keeps only the logo on top and runtime details at the bottom', () => {
  const runtime = {
    getRuntimeState: () => ({
      mode: 'plan',
      approvalMode: 'auto',
      sandboxMode: 'workspace-write',
      shell: 'bash',
      model: 'test-model',
      workspaceRoot: 'E:\\repo',
      contextUsagePct: 25
    })
  };
  const top = stripAnsi(new TopBar({ version: '0.8.7' }).render(80).join('\n'));
  assert.match(top, /CODEMINI.*v0\.8\.7/);
  assert.doesNotMatch(top, /\b(?:CODE|DAILY|AUTO)\b|test-model|E:\\repo/);

  const bottom = stripAnsi(new Footer({ runtime, model: 'fallback', sessionId: 'session-12345678', safeMode: true }).render(80).join('\n'));
  assert.match(bottom, /◆ CODE\s+│\s+● AUTO\s+│\s+◇ WORKSPACE.*◆ test-model\s+│\s+# 12345678/);
  assert.match(bottom, /⌂ E:\\repo.*CTX/);

  const activity = new ActivityBar({ tui: { requestRender() {} }, copy: createTuiCopy('en') }).render(80).join('\n');
  assert.match(stripAnsi(activity), /● Ready.*\/ commands/);
  assert.match(activity, /\u001b\[48;2;38;42;52m/);
});

test('reasoning, tool groups and Processed folds leave one line of breathing room below', () => {
  const copy = createTuiCopy('en');
  const reasoning = new ReasoningBlock(copy, 'Inspecting', { complete: true });
  const tools = new ToolCallGroup(copy);
  tools.add({ name: 'read', arguments: { path: 'README.md' } });
  const processed = new ProcessedFold(copy);
  processed.finish();
  assert.equal(stripAnsi(reasoning.render(80).at(-1)), ' '.repeat(80));
  assert.equal(stripAnsi(tools.render(80).at(-1)), ' '.repeat(80));
  assert.equal(stripAnsi(processed.render(80).at(-1)), ' '.repeat(80));
});

test('every rendered TUI line is painted with the dark surface background', () => {
  const copy = createTuiCopy('en');
  const dark = /\u001b\[48;2;31;34;41m/;
  const painted = (lines) => lines.every((line) => dark.test(line));
  assert.equal(painted(new ModeHome({ copy, getHeight: () => 24, onAction() {} }).render(80)), true);
  assert.equal(painted(createUserMessage('hello **world**').render(80)), true);
  assert.equal(painted(createAssistantMessage('# hi').render(80)), true);
  assert.equal(painted(createSystemMessage('notice').render(80)), true);
  assert.equal(painted(new ReasoningBlock(copy, 'hidden details', { complete: true }).render(80)), true);
  const todo = new TodoProgress({ tasks: [{ content: 'Build', status: 'in_progress' }] });
  assert.equal(painted(todo.render(80)), true);
  const tools = new ToolCallGroup(copy);
  tools.add({ name: 'read', arguments: { path: 'README.md' } });
  tools.setExpanded(true);
  assert.equal(painted(tools.render(80)), true);
  const processed = new ProcessedFold(copy);
  processed.addChild(new ReasoningBlock(copy, 'details', { complete: true }));
  processed.finish();
  assert.equal(painted(processed.render(80)), true);
});

test('settings modal updates reasoning, approval, sandbox and persona', async () => {
  const terminal = new FakeTerminal();
  const changes = [];
  const state = {
    mode: 'plan',
    model: 'test-model',
    workspaceRoot: 'E:\\repo',
    reasoningEnabled: true,
    reasoningEffort: 'auto',
    approvalMode: 'auto',
    sandboxMode: 'workspace-write',
    activeSoul: 'Default'
  };
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getAvailableSouls: async () => [
      { name: 'Default', category: 'coding', active: true },
      { name: 'Ponytail', category: 'coding', active: false }
    ],
    getRuntimeState: () => state,
    setRequestToolApproval() {},
    setReasoningEffort: async (value) => { changes.push(['reasoning', value]); state.reasoningEffort = value; },
    setApprovalMode: async (value) => { changes.push(['approval', value]); state.approvalMode = value; },
    setSandboxMode: async (value) => { changes.push(['sandbox', value]); state.sandboxMode = value; },
    setSoul: async (value, category) => { changes.push(['soul', value, category]); state.activeSoul = value; }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'settings-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\u001b[B');
  terminal.send('\u001b[B');
  terminal.send('\u001b[B');
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('Reasoning effort'));
  assert.match(stripAnsi(terminal.output), /🧭 Work mode.*🧠 Reasoning effort.*✅ Approval mode.*🔒 Sandbox access.*🎭 Persona/s);
  assert.doesNotMatch(stripAnsi(terminal.output), /📍 Location/);
  assert.doesNotMatch(stripAnsi(terminal.output), /🛡️ Sandbox/, 'sandbox icon must not use ambiguous variation-selector width');
  terminal.send('\u001b[B');
  terminal.send('\u001b[C');
  terminal.send('\u001b[B');
  terminal.send('\u001b[C');
  terminal.send('\u001b[B');
  terminal.send('\u001b[C');
  terminal.send('\u001b[B');
  terminal.send('\u001b[C');
  await waitFor(() => changes.length === 4);
  assert.deepEqual(changes, [
    ['reasoning', 'low'],
    ['approval', 'full_access'],
    ['sandbox', 'danger-full-access'],
    ['soul', 'Ponytail', 'coding']
  ]);
  terminal.send('\u001b');
  terminal.send('\u0003');
  await running;
});

test('settings modal enters daily mode and Ctrl+O expands then collapses streamed tool details', async () => {
  const terminal = new FakeTerminal();
  const modes = [];
  let finishTurn;
  const turnGate = new Promise((resolve) => {
    finishTurn = resolve;
  });
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async (mode) => modes.push(mode),
    submitMessage: async (_message, onEvent) => {
      onEvent({ type: 'tool:start', id: 'read-1', name: 'read', arguments: { path: 'README.md' } });
      onEvent({ type: 'tool:end', id: 'read-1', name: 'read', summary: 'Read 42 lines' });
      await turnGate;
      return { type: 'noop' };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'tools-test', model: 'test-model', terminal, workspaceDir: 'E:\\repo' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\u001b[B');
  terminal.send('\u001b[B');
  terminal.send('\u001b[B');
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('Settings'));
  terminal.send('\u001b[C');
  terminal.send('\u001b');
  terminal.send('\u001b[A');
  terminal.send('\u001b[A');
  terminal.send('\u001b[A');
  terminal.send('\r');
  await waitFor(() => modes.length === 1);
  assert.deepEqual(modes, ['daily']);
  await waitFor(() => stripAnsi(terminal.output).includes('test-model'));
  for (const key of 'inspect') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('1 tool call'));
  assert.doesNotMatch(stripAnsi(terminal.output), /Read 42 lines/);
  assert.doesNotMatch(stripAnsi(terminal.output), /arguments:/);
  terminal.send('\u000f');
  await waitFor(() => stripAnsi(terminal.output).includes('arguments:'));
  assert.match(stripAnsi(terminal.output), /Read 42 lines/);
  const collapseStart = terminal.output.length;
  terminal.send('\u000f');
  await waitFor(() => stripAnsi(terminal.output.slice(collapseStart)).includes('Process details collapsed'));
  assert.doesNotMatch(stripAnsi(terminal.output.slice(collapseStart)), /arguments:|Read 42 lines/);
  finishTurn();
  await waitFor(() => stripAnsi(terminal.output).includes('Processed'));
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('Ctrl+O ignores Kitty key release instead of immediately collapsing again', async () => {
  const terminal = new FakeTerminal();
  let finishTurn;
  const turnGate = new Promise((resolve) => {
    finishTurn = resolve;
  });
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async (_message, onEvent) => {
      onEvent({ type: 'tool:start', id: 'read-release', name: 'read', arguments: { path: 'README.md' } });
      onEvent({ type: 'tool:end', id: 'read-release', name: 'read', summary: 'Read release fixture' });
      await turnGate;
      return { type: 'noop' };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'release-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  for (const key of 'inspect') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('1 tool call'));
  const outputStart = terminal.output.length;
  terminal.send('\u000f');
  terminal.send('\u001b[111;5:3u');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(stripAnsi(terminal.output.slice(outputStart)), /arguments:.*README\.md/s);
  finishTurn();
  await waitFor(() => stripAnsi(terminal.output).includes('Processed'));
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('Ctrl+T switches a completed process between body only and full', async () => {
  const terminal = new FakeTerminal();
  let finishTurn;
  const turnGate = new Promise((resolve) => {
    finishTurn = resolve;
  });
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async (_message, onEvent) => {
      onEvent({ type: 'assistant:reasoning_delta', text: 'private reasoning' });
      onEvent({ type: 'tool:start', id: 'fold-read', name: 'read', arguments: { path: 'README.md' } });
      onEvent({ type: 'tool:end', id: 'fold-read', name: 'read', summary: 'Read fold fixture' });
      await turnGate;
      onEvent({ type: 'assistant:delta', text: 'Final body' });
      onEvent({ type: 'assistant:response', text: 'Final body' });
      return { type: 'assistant', text: 'Final body' };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'process-fold-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  for (const key of 'inspect') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('1 tool call'));

  const completedStart = terminal.output.length;
  finishTurn();
  await waitFor(() => stripAnsi(terminal.output.slice(completedStart)).includes('Final body'));
  const bodyOnly = stripAnsi(terminal.output.slice(completedStart));
  assert.match(bodyOnly, /Processed\s+Ctrl\+T full[\s\S]*Final body/);
  assert.doesNotMatch(bodyOnly, /private reasoning|1 tool call/);

  const fullStart = terminal.output.length;
  terminal.send('\u0014');
  await waitFor(() => stripAnsi(terminal.output.slice(fullStart)).includes('Ctrl+T body only'));
  const full = stripAnsi(terminal.output.slice(fullStart));
  assert.match(full, /Processed\s+Ctrl\+T body only/);
  assert.match(full, /private reasoning|1 tool call/);

  const foldedAgainStart = terminal.output.length;
  terminal.send('\u0014');
  await waitFor(() => stripAnsi(terminal.output.slice(foldedAgainStart)).includes('Ctrl+T full'));
  const foldedAgain = stripAnsi(terminal.output.slice(foldedAgainStart));
  assert.match(foldedAgain, /Processed\s+Ctrl\+T full[\s\S]*Final body/);
  assert.doesNotMatch(foldedAgain, /private reasoning|1 tool call/);
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('a live multi-step turn folds every assistant step before the final body into one Processed block', async () => {
  const terminal = new FakeTerminal();
  terminal.rows = 20;
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async (_message, onEvent) => {
      onEvent({ type: 'assistant:start' });
      onEvent({ type: 'assistant:delta', text: 'Intermediate checkpoint' });
      onEvent({
        type: 'assistant:response',
        text: 'Intermediate checkpoint',
        toolCalls: ['read'],
        assistantMessage: { content: 'Intermediate checkpoint', tool_calls: [{ id: 'live-read', function: { name: 'read', arguments: '{}' } }] }
      });
      onEvent({ type: 'tool:start', id: 'live-read', name: 'read', arguments: { path: 'README.md' } });
      onEvent({ type: 'tool:end', id: 'live-read', name: 'read', summary: 'Read README' });
      onEvent({ type: 'assistant:start' });
      onEvent({ type: 'assistant:delta', text: 'Final body' });
      onEvent({ type: 'assistant:response', text: 'Final body', toolCalls: [], assistantMessage: { content: 'Final body' } });
      return { type: 'assistant', text: 'Final body' };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'live-turn-fold-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  terminal.send('x');
  terminal.send('\r');
  await waitFor(() => terminal.screenText().includes('Final body'));
  const bodyOnly = terminal.screenText();
  assert.equal((bodyOnly.match(/Processed/g) || []).length, 1);
  assert.doesNotMatch(bodyOnly, /Intermediate checkpoint|tool call/);

  terminal.send('\u0014');
  await waitFor(() => terminal.screenText().includes('Intermediate checkpoint'));
  assert.equal((terminal.screenText().match(/Processed/g) || []).length, 1);
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('process shortcuts reveal and hide content on the current screen above a long answer', async () => {
  const terminal = new FakeTerminal();
  terminal.rows = 14;
  const longBody = Array.from({ length: 24 }, (_, index) => `Answer line ${index}`).join('\n');
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async (_message, onEvent) => {
      onEvent({ type: 'assistant:reasoning_delta', text: 'reasoning that must become visible' });
      onEvent({ type: 'tool:start', id: 'screen-read', name: 'read', arguments: { path: 'SCREEN.md' } });
      onEvent({ type: 'tool:end', id: 'screen-read', name: 'read', summary: 'Read screen fixture' });
      onEvent({ type: 'assistant:response', text: longBody });
      return { type: 'assistant', text: longBody };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'screen-fold-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  terminal.send('x');
  terminal.send('\r');
  await waitFor(() => terminal.screenText().includes('Answer line 23'));
  assert.doesNotMatch(terminal.screenText(), /SCREEN\.md|reasoning that must become visible/);

  terminal.send('\u000f');
  await waitFor(() => terminal.screenText().includes('reasoning that must become visible'));
  assert.match(terminal.screenText(), /1 tool call/);

  terminal.send('\u0014');
  await waitFor(() => terminal.screenText().includes('Answer line 23'));
  assert.doesNotMatch(terminal.screenText(), /SCREEN\.md|reasoning that must become visible/);
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('assistant messages render without a redundant codemini label', () => {
  const rendered = stripAnsi(createAssistantMessage('Hello').render(80).join('\n'));
  assert.doesNotMatch(rendered, /codemini/i);
  assert.match(rendered, /Hello/);
});

test('user messages use a border instead of a background block', () => {
  const lines = createUserMessage('Hello').render(80);
  const rendered = stripAnsi(lines.join('\n'));
  assert.equal(lines.length, 3);
  assert.match(rendered, /╭─ YOU .*╮\n│ Hello.*│\n╰─+╯/);
  assert.doesNotMatch(lines.join('\n'), /\u001b\[48;2;37;55;80m/);
});

test('mouse wheel moves a long conversation away from the end', async () => {
  const terminal = new FakeTerminal();
  terminal.rows = 14;
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: 'assistant',
    content: `history-line-${String(index).padStart(2, '0')}`
  }));
  const runtime = {
    getSessionMessages: () => history,
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async () => ({ type: 'noop' })
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'scroll-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('history-line-39'));
  const outputStart = terminal.output.length;
  for (let index = 0; index < 8; index += 1) terminal.send('\u001b[<64;10;5M');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const scrolled = stripAnsi(terminal.output.slice(outputStart));
  assert.match(scrolled, /history-line-/);
  assert.doesNotMatch(scrolled, /history-line-39/);
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('Shift+Up scrolls the conversation while plain Up remains input history', async () => {
  const terminal = new FakeTerminal();
  terminal.rows = 14;
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: 'assistant',
    content: `keyboard-scroll-${String(index).padStart(2, '0')}`
  }));
  const runtime = {
    getSessionMessages: () => history,
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async () => ({ type: 'noop' })
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'keyboard-scroll', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('keyboard-scroll-39'));
  const outputStart = terminal.output.length;
  for (let index = 0; index < 8; index += 1) terminal.send('\u001b[1;2A');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const scrolled = stripAnsi(terminal.output.slice(outputStart));
  assert.match(scrolled, /keyboard-scroll-/);
  assert.doesNotMatch(scrolled, /keyboard-scroll-39/);
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('assistant Markdown renders structure instead of source markers', () => {
  const rendered = stripAnsi(createAssistantMessage([
    '# Heading',
    '',
    '- **bold item**',
    '',
    '> quoted text',
    '',
    '```js',
    'const answer = 42;',
    '```'
  ].join('\n')).render(64).join('\n'));
  assert.match(rendered, /Heading/);
  assert.match(rendered, /bold item/);
  assert.match(rendered, /quoted text/);
  assert.match(rendered, /const answer = 42/);
  assert.doesNotMatch(rendered, /^\s*#|```|\*\*/m);
});

test('Markdown images become clickable links for remote and local targets', () => {
  assert.equal(
    linkMarkdownImages('![diagram](https://example.com/diagram.png)'),
    '[🖼 diagram](<https://example.com/diagram.png>)'
  );
  assert.match(
    linkMarkdownImages('![screenshot](E:\\repo\\shot.png)'),
    /^\[🖼 screenshot\]\(<file:\/\/\/E:\/repo\/shot\.png>\)$/
  );

  const previous = getCapabilities();
  try {
    setCapabilities({ images: false, trueColor: true, hyperlinks: true });
    const rendered = createAssistantMessage('![diagram](https://example.com/diagram.png)').render(80).join('\n');
    assert.match(rendered, /\u001b\]8;;https:\/\/example\.com\/diagram\.png/);
  } finally {
    setCapabilities(previous);
  }
});

test('history images use inline rendering with a clickable local-path fallback', () => {
  const previous = getCapabilities();
  try {
    setCapabilities({ images: false, trueColor: true, hyperlinks: true });
    const transcript = new Container();
    appendHistory(transcript, [{
      role: 'user',
      content: '',
      model_images: [{
        mime: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        filename: 'E:\\repo\\shot.png'
      }]
    }], createTuiCopy('en'));
    const rendered = transcript.render(80).join('\n');
    assert.match(stripAnsi(rendered), /Image attachment/);
    assert.match(rendered, /\u001b\]8;;file:\/\/\/E:\/repo\/shot\.png/);
    assert.match(stripAnsi(rendered), /\[Image: E:\\repo\\shot\.png \[image\/png\] 1x1\]/);
  } finally {
    setCapabilities(previous);
  }
});

test('restored session process blocks join the global Ctrl+O and Ctrl+T collections', () => {
  const transcript = new Container();
  const history = [{ role: 'user', content: 'Audit this project' }, ...[0, 1].flatMap((index) => [
    {
      role: 'assistant',
      content: `Checkpoint ${index}`,
      reasoning_content: `Historical reasoning ${index}`,
      tool_calls: [{ id: `call-${index}`, function: { name: 'read', arguments: JSON.stringify({ path: `${index}.md` }) } }]
    },
    {
      role: 'tool',
      tool_call_id: `call-${index}`,
      content: `Historical result ${index}`,
      tool_summary: `Read ${index}.md`,
      tool_status: 'success'
    }
  ]), { role: 'assistant', content: 'Final answer' }];
  const restored = appendHistory(transcript, history, createTuiCopy('en'));

  assert.deepEqual([
    restored.processFolds.length,
    restored.reasoningBlocks.length,
    restored.toolGroups.length
  ], [1, 2, 2]);
  const bodyOnly = stripAnsi(transcript.render(80).join('\n'));
  assert.equal((bodyOnly.match(/Processed/g) || []).length, 1);
  assert.match(bodyOnly, /Final answer/);
  assert.doesNotMatch(bodyOnly, /Checkpoint|Historical reasoning|tool call|Read [01]\.md/);

  for (const fold of restored.processFolds) fold.setBodyOnly(false);
  for (const block of restored.reasoningBlocks) block.setExpanded(true);
  for (const group of restored.toolGroups) group.setExpanded(true);
  const expanded = stripAnsi(transcript.render(80).join('\n'));
  assert.match(expanded, /Checkpoint 0/);
  assert.match(expanded, /Checkpoint 1/);
  assert.match(expanded, /Historical reasoning 0/);
  assert.match(expanded, /Historical reasoning 1/);
  assert.match(expanded, /Read 0\.md/);
  assert.match(expanded, /Read 1\.md/);
});

test('a tool burst stays grouped while running and folds into Processed when complete', async () => {
  const terminal = new FakeTerminal();
  let finishTurn;
  const turnGate = new Promise((resolve) => {
    finishTurn = resolve;
  });
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async (_message, onEvent) => {
      for (let index = 0; index < 12; index += 1) {
        onEvent({ type: 'tool:start', id: `read-${index}`, name: `read-${index}`, arguments: { path: `${index}.md` } });
        onEvent({ type: 'tool:end', id: `read-${index}`, name: `read-${index}`, summary: `Read ${index}` });
      }
      await turnGate;
      return { type: 'noop' };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'group-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('test-model'));
  const outputStart = terminal.output.length;
  terminal.send('g');
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output.slice(outputStart)).includes('12 tool calls'));
  const rendered = stripAnsi(terminal.output.slice(outputStart));
  assert.doesNotMatch(rendered, /read-0/);
  const completedStart = terminal.output.length;
  finishTurn();
  await waitFor(() => stripAnsi(terminal.output.slice(completedStart)).includes('Processed'));
  const completed = stripAnsi(terminal.output.slice(completedStart));
  assert.doesNotMatch(completed, /12 tool calls|read-0/);
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('slash commands share one catalog with skills', () => {
  const commands = buildSlashCommands({
    getAvailableSkills: () => [{ name: 'review', description: 'Review changes' }]
  }, createTuiCopy('zh'));
  assert.deepEqual(commands.map(({ value }) => value), [
    'compact', 'dream', 'reflect', 'inbox', 'coding', 'daily', 'tools', 'history', 'help', 'review'
  ]);
  assert.equal(commands.find(({ value }) => value === 'tools').description, '展开或折叠过程详情');
  assert.match(commands.find(({ value }) => value === 'tools').label, /^工具/);
  assert.match(commands.find(({ value }) => value === 'review').label, /^技能/);
});

test('/history opens session history and returns the selected session', async () => {
  const terminal = new DrainCheckingTerminal();
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getSessionHistory: async () => [{
      id: 'older-session',
      title: 'Fix terminal scrolling',
      messageCount: 8,
      preview: 'Continue polishing the TUI',
      isGeneral: true
    }],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async () => ({ type: 'noop' })
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'current-session', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('test-model'));
  for (const key of '/history') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('General Chat'));
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('Fix terminal scrolling'));
  terminal.send('\r');
  assert.deepEqual(await running, { sessionId: 'older-session' });
});

test('Esc returns to home where session history is selectable', async () => {
  const terminal = new FakeTerminal();
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getSessionHistory: async () => [{ id: 'older-session', title: 'Previous work', messageCount: 4, isGeneral: true }],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async () => ({ type: 'noop' })
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'current-session', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('test-model'));
  terminal.send('\u001b');
  await waitFor(() => stripAnsi(terminal.output).includes('New conversation'));
  terminal.send('\u001b[B');
  terminal.send('\u001b[B');
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('General Chat'));
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('Previous work'));
  terminal.send('\r');
  assert.deepEqual(await running, { sessionId: 'older-session' });
});

test('slash commands dispatch actions and open local help', async () => {
  const terminal = new FakeTerminal();
  const actions = [];
  const messages = [];
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'plan', model: 'test-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    dispatchAction: async (action) => {
      actions.push(action.name);
      return { type: 'noop' };
    },
    submitMessage: async ({ text }) => {
      messages.push(text);
      return { type: 'noop' };
    }
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'commands-test', model: 'test-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('test-model'));
  for (const key of '/compact') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => actions.length === 1);
  assert.deepEqual(actions, ['compact']);
  for (const key of '/help') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('Keyboard shortcuts'));
  terminal.send('\u001b');
  for (const key of 'still-here') terminal.send(key);
  terminal.send('\r');
  await waitFor(() => messages.length === 1);
  assert.deepEqual(messages, ['still-here']);
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('reasoning stays compact until process details are expanded', () => {
  const block = new ReasoningBlock(createTuiCopy('en'), 'Inspecting the runtime path', { complete: true, durationMs: 1400 });
  assert.doesNotMatch(stripAnsi(block.render(80).join('\n')), /runtime path/);
  block.setExpanded(true);
  const rendered = stripAnsi(block.render(80).join('\n'));
  assert.match(rendered, /Thought for 1.4s/);
  assert.match(rendered, /Inspecting the runtime path/);
});

test('plan progress keeps every step visible with real status', () => {
  const plan = new PlanProgress(createTuiCopy('en'), {
    goal: 'Improve the TUI',
    steps: [
      { index: 1, role: 'explorer', title: 'Inspect', status: 'pending' },
      { index: 2, role: 'coder', title: 'Build', status: 'pending' }
    ]
  });
  plan.update({ type: 'plan:step_done', step: 1, status: 'done' });
  plan.update({ type: 'plan:step_start', step: 2, status: 'running' });
  const rendered = stripAnsi(plan.render(80).join('\n'));
  assert.match(rendered, /Plan  1\/2/);
  assert.match(rendered, /✓ Inspect/);
  assert.match(rendered, /● Build/);
});

test('compact terminals use the full-name compact logo and still enter chat', async () => {
  const terminal = new FakeTerminal();
  terminal.columns = 48;
  terminal.rows = 12;
  const runtime = {
    getSessionMessages: () => [],
    getInputHistory: async () => [],
    getAvailableSkills: () => [],
    getRuntimeState: () => ({ mode: 'normal', model: 'small-model', workspaceRoot: 'E:\\repo' }),
    setRequestToolApproval() {},
    setExecutionMode: async () => {},
    submitMessage: async () => ({ type: 'noop' })
  };

  const running = runOpenCodeTui({ runtime, sessionId: 'narrow-test', model: 'small-model', terminal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(stripAnsi(terminal.output), /◆ CODEMINI ◆/);
  terminal.send('\r');
  await waitFor(() => stripAnsi(terminal.output).includes('small-model'));
  terminal.send('\u0003');
  terminal.send('\u0003');
  await running;
});

test('approval dialog is contextual, localized and keyboard-operable', () => {
  let decision = null;
  const dialog = new ApprovalDialog(
    { name: 'run', command: 'npm test' },
    (approved) => { decision = approved; },
    createTuiCopy('zh')
  );
  const rendered = stripAnsi(dialog.render(64).join('\n'));
  assert.match(rendered, /^╭─+╮[\s\S]*╰─+╯$/);
  assert.match(rendered, /需要授权.*run/s);
  assert.match(rendered, /npm test/);
  assert.match(rendered, /仅本次允许/);
  dialog.handleInput('\r');
  assert.equal(decision, true);
});
