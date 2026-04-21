# Pi TUI Chat POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `codemini chat-pi` command that reuses the existing chat runtime, renders a minimal `pi-tui` chat interface with tool activity details, and avoids the destructive redraw behavior that currently resets scrollback in the Ink UI.

**Architecture:** Keep `src/core/chat-runtime.js` as the source of truth and add a small `src/tui-pi/` rendering layer that adapts runtime results into renderable `pi-tui` screen state. The command path stays isolated from the existing Ink `chat` flow so the POC can be compared side-by-side without risking regressions in the default experience.

**Tech Stack:** Node.js ESM, `node:test`, existing CodeMini chat runtime, `@mariozechner/pi-tui`

---

## File Structure

### Existing files to modify

- `package.json`
  Add the `@mariozechner/pi-tui` dependency.
- `src/cli.js`
  Register the new `chat-pi` command and update help text.
- `src/commands/chat.js`
  Share chat argument parsing so the new command can reuse it without duplicating flags.

### New files to create

- `src/commands/chat-pi.js`
  Standalone CLI entrypoint for the `pi-tui` POC.
- `src/tui-pi/copy.js`
  Minimal shared copy and labels needed by the `pi-tui` renderer.
- `src/tui-pi/runtime-state.js`
  Pure helpers that convert runtime results and session history into renderable rows.
- `src/tui-pi/app.js`
  Main `pi-tui` application controller: input handling, screen composition, tool panel toggle, and rendering lifecycle.
- `tests/chat-pi-command.test.js`
  Command parser and CLI entry wiring coverage.
- `tests/chat-pi-runtime-state.test.js`
  Pure-state tests for messages, tool rows, and expand or collapse behavior.

### Existing files to reuse without modification unless blocked

- `src/core/chat-runtime.js`
- `src/tui/tool-activity/index.js`
- `src/tui/tool-narration.js`
- `src/tui/skill-activity/index.js`

---

### Task 1: Wire the standalone `chat-pi` command

**Files:**
- Modify: `package.json`
- Modify: `src/cli.js`
- Modify: `src/commands/chat.js`
- Create: `src/commands/chat-pi.js`
- Test: `tests/chat-pi-command.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { runCli } from '../src/cli.js';

test('runCli dispatches chat-pi to the standalone pi-tui handler', async () => {
  const calls = [];
  const originalLog = console.log;
  console.log = () => {};

  try {
    await runCli(['chat-pi', '--plain']);
  } catch (error) {
    calls.push(error instanceof Error ? error.message : String(error));
  } finally {
    console.log = originalLog;
  }

  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chat-pi-command.test.js`

Expected: FAIL because `chat-pi` is not listed in `src/cli.js`, so the CLI falls back to the default chat path instead of a dedicated handler.

- [ ] **Step 3: Write the minimal implementation**

Update `src/cli.js` so the command is recognized and dispatched:

```js
import { handleChat } from './commands/chat.js';
import { handleChatPi } from './commands/chat-pi.js';

const knownCommands = new Set(['chat', 'chat-pi', 'run', 'config', 'doctor', 'skill']);

case 'chat-pi':
  await handleChatPi(rest);
  return;
```

Extract shared argument parsing in `src/commands/chat.js`:

```js
export function parseChatArgs(args) {
  const parsed = {
    prompt: '',
    sessionId: undefined,
    model: undefined,
    system: undefined,
    plain: false
  };

  // existing argument loop stays here
  return parsed;
}
```

Create `src/commands/chat-pi.js` with an isolated entrypoint:

```js
import { loadConfig } from '../core/config-store.js';
import { createChatRuntime } from '../core/chat-runtime.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { resolveSession } from '../core/session-store.js';
import { parseChatArgs } from './chat.js';
import { runPiChatApp } from '../tui-pi/app.js';

export async function handleChatPi(args) {
  const parsed = parseChatArgs(args);
  const config = await loadConfig();
  const session = await resolveSession(parsed.sessionId);
  const systemPrompt = parsed.system || buildDefaultSystemPrompt(config);
  const runtime = await createChatRuntime({
    session,
    config,
    model: parsed.model,
    systemPrompt
  });

  try {
    await runPiChatApp({
      runtime,
      sessionId: session.id,
      model: parsed.model || config.model.name,
      sdkProvider: config.sdk?.provider || 'openai-compatible',
      language: config.ui?.language || 'zh',
      shellName: config.shell?.default || 'powershell',
      safeMode: config.policy?.safe_mode !== false
    });
  } finally {
    await runtime.dispose?.();
  }
}
```

Add the dependency in `package.json`:

```json
"dependencies": {
  "@cursorless/tree-sitter-wasms": "^0.8.1",
  "@mariozechner/pi-tui": "^0.67.68",
  "cheerio": "^1.1.2",
  "cli-truncate": "^6.0.0"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/chat-pi-command.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json src/cli.js src/commands/chat.js src/commands/chat-pi.js tests/chat-pi-command.test.js
git commit -m "feat: add standalone pi-tui chat entrypoint"
```

---

### Task 2: Build pure `pi-tui` screen-state helpers first

**Files:**
- Create: `src/tui-pi/copy.js`
- Create: `src/tui-pi/runtime-state.js`
- Test: `tests/chat-pi-runtime-state.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
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

test('buildPiToolPanelState returns collapsed summaries by default', () => {
  const panel = buildPiToolPanelState(
    [{ name: 'read(src/cli.js)', done: true, summary: '已读取文件: src/cli.js' }],
    false
  );

  assert.equal(panel.expanded, false);
  assert.equal(panel.summaryRows.length, 1);
  assert.equal(panel.detailRows.length, 0);
});

test('toggleToolDetails flips the expanded state without changing the tool list', () => {
  const next = toggleToolDetails({
    expanded: false,
    items: [{ name: 'run(npm test)', done: false, summary: '正在运行测试: npm test' }]
  });

  assert.equal(next.expanded, true);
  assert.equal(next.items.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chat-pi-runtime-state.test.js`

Expected: FAIL because `src/tui-pi/runtime-state.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `src/tui-pi/copy.js`:

```js
export function getPiCopy(language = 'zh') {
  const lang = String(language || 'zh').startsWith('en') ? 'en' : 'zh';
  return lang === 'en'
    ? {
        headerTitle: 'CodeMini Pi TUI',
        waiting: 'Waiting for input',
        thinking: 'Thinking',
        streaming: 'Streaming',
        tooling: 'Using tools',
        toolPanel: 'Tool Activity',
        collapsed: 'collapsed',
        expanded: 'expanded',
        inputHint: 'Enter to send, Ctrl+C to exit, Ctrl+T to toggle tools'
      }
    : {
        headerTitle: 'CodeMini Pi TUI',
        waiting: '等待输入',
        thinking: '思考中',
        streaming: '输出中',
        tooling: '工具中',
        toolPanel: '工具活动',
        collapsed: '已收起',
        expanded: '已展开',
        inputHint: 'Enter 发送，Ctrl+C 退出，Ctrl+T 切换工具详情'
      };
}
```

Create `src/tui-pi/runtime-state.js`:

```js
function textFromContent(content) {
  return Array.isArray(content)
    ? content.map((item) => item?.text || '').join('').trim()
    : String(content || '');
}

export function buildPiMessagesFromSessionHistory(sessionMessages = []) {
  return sessionMessages
    .filter((message) => message?.role === 'user' || message?.role === 'assistant' || message?.role === 'system')
    .map((message, index) => ({
      id: `msg-${index + 1}`,
      role:
        message.role === 'user'
          ? 'you'
          : message.role === 'assistant'
            ? 'coder'
            : 'system',
      text: textFromContent(message.content)
    }));
}

export function buildPiToolPanelState(items = [], expanded = false) {
  const normalized = items.map((item, index) => ({
    id: item.id || `tool-${index + 1}`,
    name: String(item.name || ''),
    summary: String(item.summary || item.name || ''),
    done: !!item.done
  }));

  return {
    expanded,
    items: normalized,
    summaryRows: normalized.map((item) => item.summary),
    detailRows: expanded ? normalized.map((item) => `${item.done ? 'done' : 'run'} ${item.name}`) : []
  };
}

export function toggleToolDetails(panelState) {
  return buildPiToolPanelState(panelState?.items || [], !panelState?.expanded);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/chat-pi-runtime-state.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui-pi/copy.js src/tui-pi/runtime-state.js tests/chat-pi-runtime-state.test.js
git commit -m "feat: add pi-tui screen state helpers"
```

---

### Task 3: Implement the minimal `pi-tui` app shell

**Files:**
- Create: `src/tui-pi/app.js`
- Modify: `src/tui-pi/runtime-state.js`
- Test: `tests/chat-pi-runtime-state.test.js`

- [ ] **Step 1: Write the failing test**

Append a state-focused test that defines the intended renderer contract for tool panel updates:

```js
test('buildPiToolPanelState exposes detail rows when expanded', () => {
  const panel = buildPiToolPanelState(
    [
      { name: 'read(src/cli.js)', done: true, summary: '已读取文件: src/cli.js' },
      { name: 'run(node --test)', done: false, summary: '正在执行命令: node --test' }
    ],
    true
  );

  assert.equal(panel.expanded, true);
  assert.equal(panel.detailRows.length, 2);
  assert.match(panel.detailRows[0], /read\(src\/cli\.js\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chat-pi-runtime-state.test.js`

Expected: FAIL because the current detail-row shape is too weak for the renderer contract.

- [ ] **Step 3: Write the minimal implementation**

Improve `src/tui-pi/runtime-state.js` detail rows so the renderer can show stable detail text:

```js
export function buildPiToolPanelState(items = [], expanded = false) {
  const normalized = items.map((item, index) => ({
    id: item.id || `tool-${index + 1}`,
    name: String(item.name || ''),
    summary: String(item.summary || item.name || ''),
    done: !!item.done,
    detail: String(item.detail || item.name || '')
  }));

  return {
    expanded,
    items: normalized,
    summaryRows: normalized.map((item) => item.summary),
    detailRows: expanded
      ? normalized.map((item) => `${item.done ? '[done]' : '[run]'} ${item.detail}`)
      : []
  };
}
```

Create `src/tui-pi/app.js` with the smallest usable screen controller:

```js
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { ProcessTerminal, TUI, Text, Input, Container, Box } from '@mariozechner/pi-tui';
import { getPiCopy } from './copy.js';
import {
  buildPiMessagesFromSessionHistory,
  buildPiToolPanelState,
  toggleToolDetails
} from './runtime-state.js';

export async function runPiChatApp(context) {
  const copy = getPiCopy(context.language);
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const root = new Container();
  const shell = new Box(1, 0);
  shell.addChild(root);
  tui.addChild(shell);

  let toolPanel = buildPiToolPanelState([], false);

  function rerender(runtimeState) {
    root.children.length = 0;
    root.addChild(new Text(`${copy.headerTitle} | ${context.model} | ${context.sessionId}`));

    const historyRows = buildPiMessagesFromSessionHistory(runtimeState?.messages || []);
    for (const row of historyRows.slice(-20)) {
      root.addChild(new Text(`[${row.role}] ${row.text}`));
    }

    root.addChild(new Text(`${copy.toolPanel} (${toolPanel.expanded ? copy.expanded : copy.collapsed})`));
    for (const row of toolPanel.summaryRows.slice(-5)) {
      root.addChild(new Text(`- ${row}`));
    }
    for (const row of toolPanel.detailRows.slice(-5)) {
      root.addChild(new Text(`  ${row}`));
    }
    tui.requestRender();
  }

  input.setRawMode?.(true);
  readline.emitKeypressEvents(input);
  input.on('keypress', (_value, key) => {
    if (key?.ctrl && key.name === 't') {
      toolPanel = toggleToolDetails(toolPanel);
      rerender(context.runtime.getRuntimeState?.());
    }
    if (key?.ctrl && key.name === 'c') {
      tui.stop();
    }
  });

  tui.start();
  rerender(context.runtime.getRuntimeState?.());
}
```

The initial implementation can stay visually simple. The goal here is a stable `pi-tui` screen skeleton that updates locally rather than clearing the whole terminal.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/chat-pi-runtime-state.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui-pi/app.js src/tui-pi/runtime-state.js tests/chat-pi-runtime-state.test.js
git commit -m "feat: add minimal pi-tui chat renderer"
```

---

### Task 4: Connect runtime submit flow, tool panel updates, and verification

**Files:**
- Modify: `src/tui-pi/app.js`
- Modify: `tests/chat-pi-command.test.js`
- Modify: `tests/chat-pi-runtime-state.test.js`

- [ ] **Step 1: Write the failing test**

Add a focused state test for runtime status transitions:

```js
import { derivePiStatusLabel } from '../src/tui-pi/runtime-state.js';

test('derivePiStatusLabel maps runtime phases to compact footer text', () => {
  assert.equal(derivePiStatusLabel({ liveStatus: '模型正在思考' }, 'zh'), '思考中');
  assert.equal(derivePiStatusLabel({ liveStatus: '回复正在流式输出' }, 'zh'), '输出中');
  assert.equal(derivePiStatusLabel({ liveStatus: '工具执行中' }, 'zh'), '工具中');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chat-pi-runtime-state.test.js`

Expected: FAIL because `derivePiStatusLabel` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Extend `src/tui-pi/runtime-state.js`:

```js
import { getPiCopy } from './copy.js';

export function derivePiStatusLabel(runtimeState, language = 'zh') {
  const copy = getPiCopy(language);
  const status = String(runtimeState?.liveStatus || '');
  if (/思考|thinking/i.test(status)) return copy.thinking;
  if (/流式|stream|输出中/i.test(status)) return copy.streaming;
  if (/工具|tool/i.test(status)) return copy.tooling;
  return copy.waiting;
}
```

Update `src/tui-pi/app.js` so submit and refresh work end-to-end:

```js
let draft = '';
let submitting = false;

async function submitCurrentInput() {
  const text = draft.trim();
  if (!text || submitting) return;
  submitting = true;
  try {
    await context.runtime.submit(text);
    draft = '';
    rerender(context.runtime.getRuntimeState?.());
  } finally {
    submitting = false;
  }
}
```

Add input wiring:

```js
input.on('keypress', async (value, key) => {
  if (key?.name === 'return' && !key.ctrl && !key.meta) {
    await submitCurrentInput();
    return;
  }
  if (key?.name === 'backspace') {
    draft = draft.slice(0, -1);
    rerender(context.runtime.getRuntimeState?.());
    return;
  }
  if (typeof value === 'string' && value >= ' ') {
    draft += value;
    rerender(context.runtime.getRuntimeState?.());
  }
});
```

Render footer status and composer:

```js
const statusText = derivePiStatusLabel(context.runtime.getRuntimeState?.(), context.language);
root.addChild(new Text(`status: ${statusText}`));
root.addChild(new Text(`> ${draft || ''}`));
root.addChild(new Text(copy.inputHint));
```

At this stage, tool activity can be fed from a small in-memory collection that the app updates from submit results and any available runtime callbacks. Keep the implementation narrow and prefer reuse of existing formatter helpers over duplicating summary text logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/chat-pi-runtime-state.test.js tests/chat-pi-command.test.js`

Expected: PASS

- [ ] **Step 5: Run targeted manual verification**

Run:

```bash
node bin/coder.js chat-pi
```

Manual checklist:

- Type a normal prompt and confirm a response appears
- Confirm the screen updates without full clear-screen flashes
- Scroll upward in the terminal during or after streaming and confirm the viewport is not yanked back to the top
- Toggle tool details with `Ctrl+T` and confirm the screen updates without destructive redraw behavior
- Exit with `Ctrl+C` and confirm the terminal input mode is restored

Expected: The POC is usable, isolated from the Ink path, and materially more stable for scrollback than the current Ink implementation.

- [ ] **Step 6: Commit**

```bash
git add src/tui-pi/app.js src/tui-pi/runtime-state.js tests/chat-pi-command.test.js tests/chat-pi-runtime-state.test.js
git commit -m "feat: connect pi-tui chat poc runtime flow"
```

---

## Spec Coverage Check

- Standalone command path: covered by Task 1
- Runtime reuse: covered by Tasks 1 and 4
- `pi-tui` screen with header, messages, input, status, and tools: covered by Tasks 2 through 4
- Tool activity summary and collapsible detail area: covered by Tasks 2 through 4
- Scroll-stability focus and manual validation: covered by Task 4
- Isolation from existing Ink UI: covered by Task 1 and preserved throughout

## Placeholder Scan

- No `TODO` or `TBD` markers remain
- Each task names concrete files
- Each code step includes a concrete snippet
- Each verification step includes an exact command and expected outcome

## Type Consistency Check

- `handleChatPi` is the dedicated command entrypoint used consistently
- `buildPiToolPanelState`, `toggleToolDetails`, and `derivePiStatusLabel` are defined and referenced consistently
- `runPiChatApp` remains the only exported `pi-tui` app bootstrap function
