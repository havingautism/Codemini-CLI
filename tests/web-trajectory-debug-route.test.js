import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { RuntimeBridge } from "../codemini-web/lib/runtime-bridge.js";

test("trajectory reuses persisted session system prompt instead of recomposing", async () => {
  const [server, runtime, bridge, panel, api] = await Promise.all([
    fs.readFile("codemini-web/server.js", "utf8"),
    fs.readFile("src/core/chat-runtime.js", "utf8"),
    fs.readFile("codemini-web/lib/runtime-bridge.js", "utf8"),
    fs.readFile("codemini-web/client/src/components/TrajectoryPanel.jsx", "utf8"),
    fs.readFile("codemini-web/client/src/hooks/use-api.js", "utf8"),
  ]);
  assert.doesNotMatch(server, /\/api\/debug\/system-prompt/);
  assert.doesNotMatch(runtime, /getActiveSystemPrompt/);
  assert.match(runtime, /persistLastSystemPrompt\(activeReplySystemPrompt\)/);
  assert.match(runtime, /getLastSystemPrompt:/);
  assert.match(bridge, /lastSystemPrompt/);
  assert.doesNotMatch(panel, /fetchSessionSystemPrompt/);
  assert.match(panel, /trajectoryLoopLabel/);
  assert.match(panel, /trajectoryFilterKind/);
  assert.match(panel, /trajectoryFilterTurn/);
  assert.match(panel, /kindOptions/);
  assert.match(panel, /trajectoryEventCount/);
  assert.match(panel, /trajectoryResetFilters/);
  assert.match(panel, /<Eye size=\{13\} \/>/);
  assert.doesNotMatch(api, /fetchSessionSystemPrompt/);
});

test("trajectory kind labels use title case", async () => {
  const [en, zh] = await Promise.all([
    fs.readFile("codemini-web/client/i18n/en.js", "utf8"),
    fs.readFile("codemini-web/client/i18n/zh.js", "utf8"),
  ]);
  for (const source of [en, zh]) {
    assert.match(source, /trajectoryKindSystem: "System Prompt"/);
    assert.match(source, /trajectoryKindUser: "User Message"/);
    assert.match(source, /trajectoryKindTool: "Tool Call"/);
    assert.match(source, /trajectoryKindRouting: "Graph Routing"/);
    assert.match(source, /trajectoryKindMemory: "Memory Inject"/);
    assert.match(source, /trajectoryKindSystemNotice: "System Notice"/);
  }
});

test("runtime:state sends lastSystemPrompt only when it changes", () => {
  const published = [];
  let prompt = "You are Codemini.";
  const runtime = {
    getCurrentSessionId: () => "sess-1",
    getRuntimeState: () => ({ sessionId: "sess-1", model: "gpt-test" }),
    getLastSystemPrompt: () => prompt,
    setRequestToolApproval() {},
    setRequestUserInput() {},
    setOnTitleUpdate() {},
    setOnTitleStatus() {},
  };
  const bridge = new RuntimeBridge(runtime, {
    sessionId: "sess-1",
    onEvent: (event) => published.push(event),
  });

  assert.equal(bridge.getState().lastSystemPrompt, "You are Codemini.");
  bridge.broadcastRuntimeState();
  bridge.broadcastRuntimeState();
  const states = published.filter((event) => event.type === "runtime:state");
  assert.equal(states[0].state.lastSystemPrompt, "You are Codemini.");
  assert.equal("lastSystemPrompt" in states[1].state, false);

  prompt = "You are Codemini.\nUpdated.";
  bridge.broadcastRuntimeState();
  const nextStates = published.filter((event) => event.type === "runtime:state");
  assert.equal(nextStates[2].state.lastSystemPrompt, "You are Codemini.\nUpdated.");
});
