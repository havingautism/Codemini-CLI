import test from 'node:test';
import assert from 'node:assert/strict';

import { runPiChatApp } from '../src/tui-pi/app.js';

function stripAnsi(str) {
  return String(str || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function getMainText(harness) {
  return stripAnsi(harness.textInstances[0]?.text || '');
}

function getFocusedRender(harness, width = 80) {
  const tui = harness.tuiInstances[0];
  const lines = tui?.focused?.render?.(width) || [];
  return stripAnsi(lines.join('\n'));
}

function createFakePiTuiHarness({ closeOnStart = false } = {}) {
  const textInstances = [];
  const tuiInstances = [];

  class FakeContainer {
    constructor() {
      this.children = [];
    }

    addChild(child) {
      this.children.push(child);
    }
  }

  class FakeInput {
    constructor() {
      this.value = '';
      this.onEscape = null;
      this.onSubmit = null;
    }

    getValue() {
      return this.value;
    }

    setValue(value) {
      this.value = value;
    }
  }

  class FakeSpacer {
    constructor(_lines = 1) {}
  }

  class FakeText {
    constructor(text = '', _px = 0, _py = 0) {
      this.text = text;
      textInstances.push(this);
    }

    setText(text) {
      this.text = text;
    }
  }

  class FakeTerminal {}

  class FakeTUI {
    constructor(terminal) {
      this.terminal = terminal;
      this.children = [];
      this.listeners = [];
      this.stopCalls = 0;
      this.requestRenderCalls = 0;
      this.focused = null;
      tuiInstances.push(this);
    }

    addChild(child) {
      this.children.push(child);
    }

    setFocus(component) {
      this.focused = component;
    }

    addInputListener(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      };
    }

    requestRender() {
      this.requestRenderCalls += 1;
    }

    start() {
      if (closeOnStart) {
        this.emit('ctrl+c');
      }
    }

    stop() {
      this.stopCalls += 1;
    }

    emit(key) {
      for (const listener of [...this.listeners]) {
        const result = listener(key);
        if (result?.consume) {
          break;
        }
      }
    }
  }

  return {
    textInstances,
    tuiInstances,
    deps: {
      Container: FakeContainer,
      Input: FakeInput,
      Key: {
        ctrl: (value) => `ctrl+${value}`,
        up: 'up',
        down: 'down'
      },
      ProcessTerminal: FakeTerminal,
      Spacer: FakeSpacer,
      Text: FakeText,
      TUI: FakeTUI,
      matchesKey: (data, expected) => data === expected
    }
  };
}

test('runPiChatApp renders the minimal shell structure and toggles tool details', async () => {
  const harness = createFakePiTuiHarness();

  const appPromise = runPiChatApp({
    language: 'en',
    sessionId: 'sess-structure',
    model: 'gpt-5',
    sdkProvider: 'mock-provider',
    shellName: 'bash',
    safeMode: true,
    __piTui: harness.deps,
    __noSpinner: true
  });

  const tui = harness.tuiInstances[0];
  assert.ok(tui);

  const rendered = getMainText(harness);
  assert.match(rendered, /██████/);
  assert.match(rendered, /gpt-5/);
  assert.match(rendered, /collapsed/);
  assert.match(rendered, /developed by/);
  assert.doesNotMatch(rendered, /codemini>/);

  const composer = getFocusedRender(harness);
  assert.match(composer, /\+-+\+/);
  assert.match(composer, /COMMAND BAR/);
  assert.match(composer, />/);

  tui.emit('ctrl+t');
  assert.match(getMainText(harness), /expanded/);

  tui.emit('ctrl+c');
  await appPromise;
  assert.equal(tui.stopCalls, 1);
});

test('runPiChatApp resolves cleanly when shutdown happens during startup', async () => {
  const harness = createFakePiTuiHarness({ closeOnStart: true });

  await assert.doesNotReject(() =>
    runPiChatApp({
      language: 'en',
      sessionId: 'sess-race',
      __piTui: harness.deps,
      __noSpinner: true
    })
  );

  assert.equal(harness.tuiInstances[0].stopCalls, 1);
});

test('runPiChatApp submits through the runtime and renders streamed runtime events', async () => {
  const harness = createFakePiTuiHarness();
  const seen = [];
  let eventHandler = null;
  let releaseSubmit = null;
  const runtime = {
    submit: (line, onAgentEvent) => {
      seen.push(line);
      eventHandler = onAgentEvent;
      return new Promise((resolve) => {
        releaseSubmit = () => resolve({ type: 'assistant', text: 'done' });
      });
    }
  };

  const appPromise = runPiChatApp({
    language: 'en',
    sessionId: 'sess-live-submit',
    runtime,
    __piTui: harness.deps,
    __noSpinner: true
  });

  const tui = harness.tuiInstances[0];
  const input = tui.focused;
  input.onSubmit('Implement Task 4');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(seen, ['Implement Task 4']);
  const text = getMainText(harness);
  assert.match(text, /YOU/);
  assert.match(text, /Implement Task 4/);
  assert.match(getFocusedRender(harness), /THINKING/i);

  eventHandler({ type: 'assistant:start' });
  eventHandler({ type: 'assistant:delta', text: 'Streaming reply' });
  assert.match(getMainText(harness), /CODER/);
  assert.match(getMainText(harness), /Streaming reply/);
  assert.match(getFocusedRender(harness), /STREAMING/i);

  eventHandler({ type: 'tool:start', id: 'tool-1', name: 'read(src/tui-pi/app.js)' });
  assert.match(getMainText(harness), /🔧/);
  assert.match(getMainText(harness), /read\(src\/tui-pi\/app\.js\)/);
  assert.match(getFocusedRender(harness), /TOOLING/i);

  eventHandler({ type: 'tool:result', id: 'tool-1', name: 'read(src/tui-pi/app.js)', content: 'const answer = 42;' });
  eventHandler({ type: 'tool:end', id: 'tool-1', name: 'read(src/tui-pi/app.js)', summary: 'Read app.js' });
  eventHandler({ type: 'assistant:response', text: 'Final response' });

  assert.match(getMainText(harness), /CODER/);
  assert.match(getMainText(harness), /🔧 read\(src\/tui-pi\/app\.js\)/);
  assert.match(getMainText(harness), /📄 Read app\.js/);
  assert.match(getMainText(harness), /└ const answer = 42;/);
  assert.match(getMainText(harness), /Final response/);
  assert.match(getMainText(harness), /Read app\.js/);

  const composer = getFocusedRender(harness);
  assert.doesNotMatch(composer, /Implement Task 4/);
  assert.match(composer, /\| >\s+\|/);

  releaseSubmit();
  await new Promise((resolve) => setImmediate(resolve));
  tui.emit('ctrl+c');
  await appPromise;
});

test('runPiChatApp treats runtime submit as required and shows a stable failure when absent', async () => {
  const harness = createFakePiTuiHarness();

  const appPromise = runPiChatApp({
    language: 'en',
    sessionId: 'sess-missing-runtime',
    __piTui: harness.deps,
    __noSpinner: true
  });

  const tui = harness.tuiInstances[0];
  const input = tui.focused;

  assert.doesNotThrow(() => input.onSubmit('Implement Task 4'));
  await new Promise((resolve) => setImmediate(resolve));

  const text = getMainText(harness);
  assert.match(text, /YOU/);
  assert.match(text, /Implement Task 4/);
  assert.match(text, /Runtime submit failed: runtime\.submit is required/);
  assert.doesNotMatch(text, /codemini>/);

  const composer = getFocusedRender(harness);
  assert.match(composer, /\| >\s+\|/);

  tui.emit('ctrl+c');
  await appPromise;
});

test('runPiChatApp catches both sync and async runtime submit failures', async () => {
  const syncHarness = createFakePiTuiHarness();
  const syncAppPromise = runPiChatApp({
    language: 'en',
    sessionId: 'sess-sync-fail',
    runtime: {
      submit() {
        throw new Error('sync boom');
      }
    },
    __piTui: syncHarness.deps,
    __noSpinner: true
  });

  assert.doesNotThrow(() => syncHarness.tuiInstances[0].focused.onSubmit('Sync failure'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(getMainText(syncHarness), /Runtime submit failed: sync boom/);
  assert.match(getFocusedRender(syncHarness), /\| >\s+\|/);
  syncHarness.tuiInstances[0].emit('ctrl+c');
  await syncAppPromise;

  const asyncHarness = createFakePiTuiHarness();
  const asyncAppPromise = runPiChatApp({
    language: 'en',
    sessionId: 'sess-async-fail',
    runtime: {
      submit: async () => {
        throw new Error('async boom');
      }
    },
    __piTui: asyncHarness.deps,
    __noSpinner: true
  });

  assert.doesNotThrow(() => asyncHarness.tuiInstances[0].focused.onSubmit('Async failure'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(getMainText(asyncHarness), /Runtime submit failed: async boom/);
  assert.match(getFocusedRender(asyncHarness), /\| >\s+\|/);
  asyncHarness.tuiInstances[0].emit('ctrl+c');
  await asyncAppPromise;
});

test('runPiChatApp renders a direct-return submit result when no callback events fire', async () => {
  const harness = createFakePiTuiHarness();
  const appPromise = runPiChatApp({
    language: 'en',
    sessionId: 'sess-direct-return',
    runtime: {
      submit: async () => ({ type: 'assistant', text: 'Direct runtime result' })
    },
    __piTui: harness.deps,
    __noSpinner: true
  });

  harness.tuiInstances[0].focused.onSubmit('Direct return request');
  await new Promise((resolve) => setImmediate(resolve));

  const text = getMainText(harness);
  assert.match(text, /Direct return request/);
  assert.match(text, /Direct runtime result/);
  assert.match(getFocusedRender(harness), /\| >\s+\|/);

  harness.tuiInstances[0].emit('ctrl+c');
  await appPromise;
});

test('runPiChatApp ignores overlapping submits while one request is already in flight', async () => {
  const harness = createFakePiTuiHarness();
  let releaseSubmit = null;
  const seen = [];
  const appPromise = runPiChatApp({
    language: 'en',
    sessionId: 'sess-overlap',
    runtime: {
      submit: (line) => {
        seen.push(line);
        return new Promise((resolve) => {
          releaseSubmit = () => resolve({ type: 'assistant', text: `Finished: ${line}` });
        });
      }
    },
    __piTui: harness.deps,
    __noSpinner: true
  });

  const input = harness.tuiInstances[0].focused;
  input.onSubmit('First request');
  await new Promise((resolve) => setImmediate(resolve));
  input.onSubmit('Second request');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(seen, ['First request']);
  const text = getMainText(harness);
  assert.match(text, /First request/);
  assert.doesNotMatch(text, /Second request/);
  assert.match(getFocusedRender(harness), /THINKING/i);

  releaseSubmit();
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(getMainText(harness), /Finished: First request/);
  assert.match(getFocusedRender(harness), /\| >\s+\|/);

  harness.tuiInstances[0].emit('ctrl+c');
  await appPromise;
});

test('runPiChatApp ignores empty submit while a request is already in flight', async () => {
  const harness = createFakePiTuiHarness();
  let releaseSubmit = null;
  const appPromise = runPiChatApp({
    language: 'en',
    sessionId: 'sess-empty-inflight',
    runtime: {
      submit: () =>
        new Promise((resolve) => {
          releaseSubmit = () => resolve({ type: 'assistant', text: 'Settled reply' });
        })
    },
    __piTui: harness.deps,
    __noSpinner: true
  });

  const input = harness.tuiInstances[0].focused;
  input.onSubmit('First request');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(getFocusedRender(harness), /THINKING/i);

  input.onSubmit('   ');
  assert.match(getFocusedRender(harness), /THINKING/i);

  releaseSubmit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(getFocusedRender(harness), /\| >\s+\|/);

  harness.tuiInstances[0].emit('ctrl+c');
  await appPromise;
});
