import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrajectory,
  filterTrajectoryEvents,
  formatTrajectoryDuration,
  formatTrajectoryExportStamp,
  formatTrajectoryRowPreview,
  stringifyTrajectoryValue,
  trajectoryExportFilename,
  truncateTrajectoryText,
} from "../codemini-web/client/src/lib/session-trajectory.js";

test("empty messages yield empty events and zero metrics", () => {
  const result = buildTrajectory({
    messages: [],
    runtimeState: { model: "gpt-test" },
    projectCwd: "/tmp/app",
  });
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.metrics, { durationMs: null, turns: 0, calls: 0 });
});

test("splits turns and maps thinking, tool calls, and assistant body text", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "梳理一下整体链路", at: "2026-08-19T01:00:00.000Z" },
      {
        id: "a1",
        role: "agent",
        at: "2026-08-19T01:00:01.000Z",
        segments: [
          {
            type: "thinking",
            text: "I will inspect the repo.",
            startedAt: "2026-08-19T01:00:01.000Z",
            endedAt: "2026-08-19T01:00:03.000Z",
            durationMs: 2000,
          },
          {
            type: "tools",
            cards: [
              {
                id: "t1",
                name: "glob",
                arguments: { pattern: "README*" },
                summary: "README.md",
                status: "done",
                startedAt: "2026-08-19T01:00:03.000Z",
                endedAt: "2026-08-19T01:00:04.000Z",
                durationMs: 1000,
              },
            ],
          },
          { type: "skill", name: "explore", summary: "PreToolUse", status: "done" },
          { type: "text", text: "这里是给用户看的最终回复" },
        ],
      },
      { id: "u2", role: "you", text: "继续", at: "2026-08-19T01:00:10.000Z" },
    ],
    runtimeState: {
      model: "gpt-test",
      sdkProvider: "openai",
      mode: "coding",
      cwd: "/tmp/app",
      approvalMode: "auto",
      sandboxMode: "workspace-write",
    },
    projectCwd: "/tmp/app",
    isGeneral: false,
  });

  assert.equal(result.metrics.turns, 2);
  assert.equal(result.metrics.calls, 1);
  assert.equal(result.metrics.durationMs, 10000);

  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "system",
    "user",
    "context",
    "thinking",
    "tool",
    "skill",
    "assistant",
    "user",
  ]);
  assert.equal(result.events[0].turn, 0);
  assert.match(result.events[0].input, /model: gpt-test/);
  assert.match(result.events[0].input, /provider: openai/);
  assert.match(result.events[0].input, /mode: coding/);
  assert.equal(result.events[0].body, "model: gpt-test");
  assert.equal(result.events[1].body, "梳理一下整体链路");
  assert.equal(result.events[1].turn, 1);
  assert.match(result.events[2].body, /cwd: \/tmp\/app/);
  assert.equal(result.events[3].kind, "thinking");
  assert.equal(result.events[3].title, "thinking");
  assert.equal(result.events[3].body, "I will inspect the repo.");
  assert.equal(result.events[4].title, "glob");
  assert.equal(result.events[4].sourceCard?.name, "glob");
  assert.equal(result.events[4].sourceCard?.arguments?.pattern, "README*");
  assert.match(result.events[4].body, /README\*/);
  assert.match(result.events[4].input, /README\*/);
  assert.equal(result.events[4].preview, "README.md");
  assert.equal(result.events[4].output, "README.md");
  assert.equal(result.events[5].kind, "skill");
  assert.equal(result.events[6].kind, "assistant");
  assert.equal(result.events[6].title, "body");
  assert.equal(result.events[6].body, "这里是给用户看的最终回复");
  assert.equal(result.events[7].turn, 2);
  assert.equal(result.events.filter((event) => event.kind === "context").length, 1);
});

test("text-only assistant turn still emits thinking and body without tool calls", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "测试一下tasks 工具" },
      {
        id: "a1",
        role: "agent",
        segments: [
          { type: "thinking", text: "User wants to try the tasks tool." },
          { type: "text", text: "好的，我先说明 tasks 怎么用。" },
        ],
      },
    ],
    runtimeState: { lastSystemPrompt: "You are Codemini CLI, an AI assistant." },
  });
  assert.equal(result.metrics.calls, 0);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["system", "user", "context", "thinking", "assistant"],
  );
  const thinking = result.events.find((event) => event.kind === "thinking");
  const body = result.events.find((event) => event.kind === "assistant");
  assert.equal(thinking.body, "User wants to try the tasks tool.");
  assert.equal(body.body, "好的，我先说明 tasks 怎么用。");
  assert.equal(body.input, "好的，我先说明 tasks 怎么用。");
  assert.match(result.events[0].input, /You are Codemini CLI/);
  assert.equal(result.events[0].body.includes("\n"), false);
});

test("falls back to message.text when assistant has no text segments", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "hi" },
      { id: "a1", role: "agent", text: "hello from the assistant" },
    ],
  });
  const body = result.events.find((event) => event.kind === "assistant");
  assert.equal(body.body, "hello from the assistant");
});

test("maps web UI general-role turns including tasks tool cards", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "测试一下tasks 工具" },
      {
        id: "a1",
        role: "general",
        segments: [
          { type: "thinking", text: "I'll demo the tasks tool." },
          {
            type: "tools",
            cards: [
              {
                id: "t1",
                name: "tasks",
                arguments: {
                  todos: [
                    { content: "演示:调用 tasks 工具创建清单", status: "completed" },
                    { content: "演示:更新任务状态", status: "completed" },
                  ],
                },
                result: { todos: [{ status: "completed" }, { status: "completed" }] },
                summary: "2/2",
                status: "done",
              },
            ],
          },
          { type: "text", text: "任务工具测试通过。" },
        ],
      },
    ],
  });
  assert.equal(result.metrics.calls, 1);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["system", "user", "context", "thinking", "tool", "assistant"],
  );
  const tool = result.events.find((event) => event.kind === "tool");
  assert.equal(tool.title, "tasks");
  assert.match(tool.input, /调用 tasks 工具创建清单/);
  assert.equal(tool.preview, "2/2");
  assert.equal(
    result.events.find((event) => event.kind === "assistant").body,
    "任务工具测试通过。",
  );
});

test("streaming thinking and tools are marked running", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "go" },
      {
        id: "a1",
        role: "agent",
        segments: [
          { type: "thinking", text: "", isStreaming: true },
          {
            type: "tools",
            cards: [{ id: "t1", name: "read", arguments: { path: "a.js" }, isStreaming: true }],
          },
        ],
      },
    ],
  });
  const thinking = result.events.find((event) => event.title === "thinking");
  const tool = result.events.find((event) => event.kind === "tool");
  assert.equal(thinking.status, "running");
  assert.equal(tool.status, "running");
});

test("skips abort dividers and maps error messages", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "go" },
      { id: "d1", role: "divider", dividerType: "manual-abort", text: "aborted" },
      { id: "e1", role: "error", text: "boom" },
    ],
    runtimeState: { model: "m" },
  });
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["system", "user", "context", "assistant"]);
  const errorEvent = result.events.at(-1);
  assert.equal(errorEvent.status, "error");
  assert.equal(errorEvent.body, "boom");
});

test("USER and error events omit endedAt so duration stays unknown", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "go", at: "2026-08-19T01:00:00.000Z" },
      { id: "e1", role: "error", text: "boom", at: "2026-08-19T01:00:01.000Z" },
    ],
  });
  const user = result.events.find((event) => event.kind === "user");
  const error = result.events.find((event) => event.status === "error");
  assert.equal(user.endedAt, null);
  assert.equal(user.durationMs, null);
  assert.equal(error.endedAt, null);
  assert.equal(error.durationMs, null);
  assert.equal(formatTrajectoryDuration(user.durationMs), "—");
  assert.equal(formatTrajectoryDuration(error.durationMs), "—");
});

test("handoff text becomes assistant body and empty non-streaming handoff is skipped", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "go" },
      {
        id: "a1",
        role: "agent",
        segments: [
          { type: "handoff", text: "Scout summary for parent" },
          { type: "handoff", text: "" },
          { type: "handoff", text: "", isStreaming: true },
        ],
      },
    ],
  });
  const handoffs = result.events.filter((event) => event.title === "handoff");
  assert.equal(handoffs.length, 2);
  assert.equal(handoffs[0].kind, "assistant");
  assert.equal(handoffs[0].body, "Scout summary for parent");
  assert.equal(handoffs[0].status, "done");
  assert.equal(handoffs[1].kind, "assistant");
  assert.equal(handoffs[1].body, "");
  assert.equal(handoffs[1].status, "running");
});

test("normalizeStatus maps pending and errors; streaming stays running", () => {
  const result = buildTrajectory({
    messages: [
      {
        id: "a1",
        role: "agent",
        segments: [
          {
            type: "tools",
            cards: [
              { id: "t1", name: "pending-tool", status: "pending" },
              { id: "t2", name: "failed-tool", status: "failed" },
              { id: "t3", name: "done-tool", status: "done" },
              {
                id: "t4",
                name: "streaming-tool",
                status: "failed",
                isStreaming: true,
              },
            ],
          },
        ],
      },
    ],
  });
  const byTitle = Object.fromEntries(
    result.events
      .filter((event) => event.kind === "tool")
      .map((event) => [event.title, event.status]),
  );
  assert.equal(byTitle["pending-tool"], "running");
  assert.equal(byTitle["failed-tool"], "error");
  assert.equal(byTitle["done-tool"], "done");
  assert.equal(byTitle["streaming-tool"], "running");
});

test("uses the composed system prompt and keeps tool result as inspectable output", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "go", skillBadges: [{ name: "explore", status: "selected" }] },
      {
        id: "a1",
        role: "agent",
        segments: [
          {
            type: "tools",
            cards: [
              {
                id: "t1",
                name: "read",
                arguments: { path: "AGENTS.md" },
                result: "# AGENTS.md\nUse the project index.",
                summary: "AGENTS.md",
                status: "done",
              },
            ],
          },
          {
            type: "skill",
            name: "explore",
            event: "PreToolUse",
            command: "node skill.js",
            summary: "loaded SKILL.md",
            status: "done",
          },
        ],
      },
    ],
    systemPrompt: "You are Codemini.\nFollow AGENTS.md.",
    runtimeState: { model: "gpt-test" },
  });
  const system = result.events.find((event) => event.kind === "system");
  const tool = result.events.find((event) => event.kind === "tool");
  const skills = result.events.filter((event) => event.kind === "skill");
  assert.match(system.body, /You are Codemini/);
  assert.match(tool.input, /AGENTS.md/);
  assert.match(tool.output, /project index/);
  assert.equal(skills.length, 2);
  assert.equal(skills[0].title, "explore");
  assert.match(skills[1].input, /node skill.js/);
  assert.match(skills[1].body, /SKILL.md/);
});

test("system event reuses lastSystemPrompt from session runtime state", () => {
  const result = buildTrajectory({
    messages: [{ id: "u1", role: "you", text: "hi" }],
    runtimeState: {
      model: "gpt-test",
      lastSystemPrompt: "Persisted system prompt from the session record.",
    },
  });
  const system = result.events.find((event) => event.kind === "system");
  assert.match(system.body, /Persisted system prompt/);
  assert.match(system.input, /session record/);
});

test("filterTrajectoryEvents hides calls and matches search", () => {
  const events = [
    { id: "1", kind: "user", title: "USER", body: "hello", preview: "" },
    { id: "2", kind: "tool", title: "glob", body: '{"pattern":"src"}', preview: "a.js", output: "secret-output" },
    { id: "3", kind: "skill", title: "explore", body: "hook", preview: "" },
  ];
  const withoutCalls = filterTrajectoryEvents(events, { includeCalls: false });
  assert.deepEqual(
    withoutCalls.map((event) => event.kind),
    ["user"],
  );
  const searched = filterTrajectoryEvents(events, { query: "GLOB" });
  assert.deepEqual(
    searched.map((event) => event.id),
    ["2"],
  );
  const byOutput = filterTrajectoryEvents(events, { query: "secret-output" });
  assert.deepEqual(
    byOutput.map((event) => event.id),
    ["2"],
  );
});

test("duration, export stamp, stringify, and truncate helpers", () => {
  assert.equal(formatTrajectoryDuration(null), "—");
  assert.equal(formatTrajectoryDuration(200), "<1s");
  assert.equal(formatTrajectoryDuration(12000), "12s");
  assert.equal(formatTrajectoryDuration(72000), "1m 12s");
  assert.equal(formatTrajectoryDuration(3720000), "1h 2m");
  assert.equal(
    formatTrajectoryExportStamp(new Date(2026, 7, 19, 9, 18, 5)),
    "20260819091805",
  );
  assert.equal(
    trajectoryExportFilename("abc", new Date(2026, 7, 19, 9, 18, 5)),
    "codemini-trajectory-abc-20260819091805.json",
  );
  assert.equal(stringifyTrajectoryValue({ pattern: "a" }), '{\n  "pattern": "a"\n}');
  assert.equal(stringifyTrajectoryValue(undefined), "");
  assert.equal(truncateTrajectoryText("a".repeat(241)).endsWith("…"), true);
  assert.equal(truncateTrajectoryText("short"), "short");
});

test("row preview keeps events on one line and tools show args then output", () => {
  const tool = formatTrajectoryRowPreview({
    kind: "tool",
    title: "bash",
    input: '{\n  "command": "ls src"\n}',
    preview: "/Users/havingautism/Git_Projects/Codemini-CLI",
    output: "src/\nREADME.md",
  });
  assert.equal(tool.includes("\n"), false);
  assert.match(tool, /^bash \{/);
  assert.match(tool, /"command":"ls src"/);
  assert.match(tool, /-> \/Users\/havingautism\/Git_Projects\/Codemini-CLI$/);

  const body = formatTrajectoryRowPreview({
    kind: "assistant",
    body: "第一行说明\n第二行不该出现在列表里",
  });
  assert.equal(body, "第一行说明");
});
