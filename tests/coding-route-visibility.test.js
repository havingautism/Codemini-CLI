import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('automatic graph-selected skills become visible activity badges', async () => {
  const [bridge, appContext] = await Promise.all([
    fs.readFile('codemini-web/lib/runtime-bridge.js', 'utf8'),
    fs.readFile('codemini-web/client/src/context/app-context.jsx', 'utf8'),
  ]);

  for (const source of [bridge, appContext]) {
    assert.match(source, /case ['"]skill:auto-selected['"]/);
    assert.match(
      source,
      /event\.type === ['"]skill:always['"] \? ['"]always['"] : ['"]selected['"]/,
    );
  }
});

test('graph routing events are persisted and reduced onto the user turn', async () => {
  const [bridge, sessionState] = await Promise.all([
    fs.readFile('codemini-web/lib/runtime-bridge.js', 'utf8'),
    fs.readFile('codemini-web/client/src/lib/session-state.js', 'utf8'),
  ]);

  assert.equal(bridge.includes("case 'routing:graph'"), true);
  assert.match(bridge, /routingGraph:\s*routingGraphFromEvent\(event\)/);
  assert.equal(sessionState.includes('event.type === "routing:graph"'), true);
  assert.match(sessionState, /routingGraph:\s*routingGraphFromEvent\(event\)/);
});

test('memory retrieve events are persisted and reduced onto the user turn', async () => {
  const [bridge, sessionState, runtime] = await Promise.all([
    fs.readFile('codemini-web/lib/runtime-bridge.js', 'utf8'),
    fs.readFile('codemini-web/client/src/lib/session-state.js', 'utf8'),
    fs.readFile('src/core/chat-runtime.js', 'utf8'),
  ]);

  assert.equal(bridge.includes("case 'memory:retrieved'"), true);
  assert.match(bridge, /memoryInject:\s*memoryInjectFromEvent\(event/);
  assert.equal(sessionState.includes('event.type === "memory:retrieved"'), true);
  assert.match(sessionState, /memoryInject:\s*memoryInjectFromEvent\(event/);
  assert.match(runtime, /type: 'memory:retrieved'/);
});

test('retrieved memories surface beside the reply notebook action', async () => {
  const [chatPanel, messageBubble] = await Promise.all([
    fs.readFile('codemini-web/client/src/components/ChatPanel.jsx', 'utf8'),
    fs.readFile('codemini-web/client/src/components/MessageBubble.jsx', 'utf8'),
  ]);

  assert.match(chatPanel, /retrievedMemoriesByReplyId/);
  assert.match(chatPanel, /message\.memoryInject\?\.retrieved/);
  assert.match(messageBubble, /<RetrievedMemoryButton memories=\{retrievedMemories\} \/>/);
  assert.match(messageBubble, /memoryRetrievedCount/);
  assert.match(messageBubble, /memory\?\.recallReason/);
});
