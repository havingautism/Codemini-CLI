import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrajectory,
  filterTrajectoryEvents,
  formatTrajectoryDuration,
  formatTrajectoryExportStamp,
  formatTrajectoryRowPreview,
  formatTrajectoryUsage,
  stringifyTrajectoryValue,
  trajectoryExportFilename,
  truncateTrajectoryText,
} from "../codemini-web/client/src/lib/session-trajectory.js";
import { buildRenderGroups } from "../codemini-web/client/src/lib/message-render-groups.js";

test("empty messages yield empty events and zero metrics", () => {
  const result = buildTrajectory({
    messages: [],
    runtimeState: { model: "gpt-test" },
    projectCwd: "/tmp/app",
  });
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.metrics, { durationMs: null, turns: 0, calls: 0, tokens: null });
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
    "thinking",
    "tool",
    "skill",
    "assistant",
    "user",
  ]);
  assert.equal(result.events[0].turn, 0);
  assert.equal(result.events[0].title, "system prompt");
  assert.equal(result.events[0].input, "");
  assert.equal(result.events[1].body, "梳理一下整体链路");
  assert.equal(result.events[1].turn, 1);
  assert.equal(result.events[1].input, "梳理一下整体链路");
  assert.equal(result.events[2].kind, "thinking");
  assert.equal(result.events[2].title, "thinking");
  assert.equal(result.events[2].body, "I will inspect the repo.");
  assert.equal(result.events[3].title, "glob");
  assert.equal(result.events[3].sourceCard?.name, "glob");
  assert.equal(result.events[3].sourceCard?.arguments?.pattern, "README*");
  assert.match(result.events[3].body, /README\*/);
  assert.match(result.events[3].input, /README\*/);
  assert.equal(result.events[3].preview, "README.md");
  assert.equal(result.events[3].output, "README.md");
  assert.equal(result.events[4].kind, "skill");
  assert.equal(result.events[5].kind, "assistant");
  assert.equal(result.events[5].title, "body");
  assert.equal(result.events[5].body, "这里是给用户看的最终回复");
  assert.equal(result.events[6].turn, 2);
  assert.equal(result.events.some((event) => event.kind === "context"), false);
});

test("user trajectory includes image and file attachments", () => {
  const result = buildTrajectory({
    messages: [
      {
        id: "u1",
        role: "you",
        text: "检查这些附件",
        attachments: [
          { id: "image-1", kind: "image", name: "screenshot.png" },
          { id: "file-1", kind: "file", name: "requirements.pdf" },
        ],
      },
    ],
  });

  const user = result.events.find((event) => event.kind === "user");
  assert.match(user.body, /screenshot\.png/);
  assert.match(user.body, /requirements\.pdf/);
  assert.match(user.input, /screenshot\.png/);
  assert.match(user.input, /requirements\.pdf/);
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
    ["system", "user", "thinking", "assistant"],
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
    ["system", "user", "thinking", "tool", "assistant"],
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

test("includes coder-role model turns without assistant-role inference", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "fix it" },
      {
        id: "a1",
        role: "coder",
        segments: [{ type: "text", text: "patched" }],
      },
    ],
  });
  const timeline = result.events.filter((event) => event.kind !== "system");
  assert.deepEqual(
    timeline.map((event) => event.kind),
    ["user", "assistant"],
  );
  assert.equal(timeline[1].body, "patched");
});

test("orders messages by timestamps instead of array position", () => {
  const result = buildTrajectory({
    messages: [
      {
        id: "a1",
        role: "coder",
        text: "later answer",
        timestamp: "2026-08-19T01:00:02.000Z",
      },
      {
        id: "u1",
        role: "you",
        text: "first question",
        timestamp: "2026-08-19T01:00:00.000Z",
      },
    ],
  });
  const timeline = result.events.filter((event) => event.kind !== "system");
  assert.deepEqual(
    timeline.map((event) => event.body),
    ["first question", "later answer"],
  );
});

test("wraps assistant work in agent-loop round headers inside a turn", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "fix it" },
      {
        id: "a1",
        role: "general",
        segments: [
          { type: "loop", phase: "start", step: 1, startedAt: "2026-08-19T01:00:01.000Z" },
          { type: "thinking", text: "look around" },
          {
            type: "tools",
            cards: [{ id: "t1", name: "glob", arguments: { pattern: "*" }, status: "done" }],
          },
          {
            type: "loop",
            phase: "end",
            step: 1,
            endedAt: "2026-08-19T01:00:02.000Z",
            durationMs: 1000,
            reason: "tools",
          },
          { type: "loop", phase: "start", step: 2, startedAt: "2026-08-19T01:00:02.000Z" },
          { type: "text", text: "patched" },
          {
            type: "loop",
            phase: "end",
            step: 2,
            endedAt: "2026-08-19T01:00:03.000Z",
            durationMs: 1000,
            reason: "final",
          },
        ],
      },
    ],
  });
  const timeline = result.events.filter((event) => event.kind !== "system");
  assert.deepEqual(
    timeline.map((event) => [event.kind, event.loop || 0, event.title]),
    [
      ["user", 0, "user message"],
      ["loop", 1, "agent loop 1"],
      ["thinking", 1, "thinking"],
      ["tool", 1, "glob"],
      ["loop", 2, "agent loop 2"],
      ["assistant", 2, "body"],
    ],
  );
  assert.equal(timeline[1].durationMs, 1000);
  assert.equal(timeline[1].status, "done");
  assert.equal(timeline.find((event) => event.title === "body").body, "patched");
});

test("chat render groups skip loop markers so they stay trajectory-only", () => {
  const groups = buildRenderGroups([
    { type: "loop", phase: "start", step: 1 },
    { type: "thinking", text: "look around" },
    { type: "text", text: "patched" },
    { type: "loop", phase: "end", step: 1, reason: "final" },
  ]);
  assert.deepEqual(
    groups.map((group) => group.type),
    ["thinking", "text"],
  );
});

test("keeps plan-overview, system notices, abort, and errors in time order", () => {
  const result = buildTrajectory({
    messages: [
      { id: "u1", role: "you", text: "go", at: "2026-08-19T01:00:00.000Z" },
      {
        id: "p1",
        role: "plan-overview",
        text: "Ship the feature",
        timestamp: "2026-08-19T01:00:01.000Z",
        planOverview: {
          goal: "Ship the feature",
          steps: [{ index: 1, title: "Edit", role: "coder", status: "done" }],
        },
      },
      {
        id: "s1",
        role: "system",
        text: "Plan revised.",
        timestamp: "2026-08-19T01:00:02.000Z",
      },
      {
        id: "d1",
        role: "divider",
        dividerType: "manual-abort",
        text: "aborted",
        timestamp: "2026-08-19T01:00:03.000Z",
      },
      { id: "e1", role: "error", text: "boom", timestamp: "2026-08-19T01:00:04.000Z" },
    ],
    runtimeState: { model: "m" },
  });
  const timeline = result.events;
  assert.equal(timeline[0].kind, "system");
  assert.equal(timeline[0].input, "");
  assert.equal(timeline[1].kind, "user");
  assert.equal(timeline[2].kind, "assistant");
  assert.equal(timeline[2].title, "plan");
  assert.match(timeline[2].body, /Ship the feature/);
  assert.match(timeline[2].input, /Edit/);
  assert.equal(timeline[3].kind, "system");
  assert.equal(timeline[3].title, "system notice");
  assert.equal(timeline[3].body, "Plan revised.");
  assert.equal(timeline[4].kind, "error");
  assert.equal(timeline[4].title, "abort");
  assert.equal(timeline[4].status, "error");
  assert.equal(timeline[4].body, "aborted");
  assert.equal(timeline[5].kind, "error");
  assert.equal(timeline[5].title, "error");
  assert.equal(timeline[5].status, "error");
  assert.equal(timeline[5].body, "boom");
  assert.equal(result.events.some((event) => event.kind === "context"), false);
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
  assert.equal(system.body, "You are Codemini....");
  assert.match(system.input, /Follow AGENTS.md/);
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
  assert.equal(system.input.includes("model:"), false);
  assert.equal(result.events.some((event) => event.kind === "context"), false);
});

test("omits synthetic runtime context while user inspect keeps model input", () => {
  const result = buildTrajectory({
    messages: [
      {
        id: "u1",
        role: "you",
        text: "用这个技能",
        model_content: "用这个技能\n\n<skill>explore</skill>",
      },
      {
        id: "a1",
        role: "general",
        model: "gpt-debug",
        sdkProvider: "openai-compatible",
        usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160, reasoningOutputTokens: 12 },
        segments: [{ type: "text", text: "done" }],
      },
    ],
    runtimeState: {
      model: "gpt-debug",
      sdkProvider: "openai-compatible",
      mode: "coding",
      reasoningEffort: "medium",
      shell: "zsh",
      activeSoul: "coder",
      alwaysSkillNames: ["explore"],
      approvalMode: "auto",
      sandboxMode: "workspace-write",
    },
  });
  const user = result.events.find((event) => event.kind === "user");
  const assistant = result.events.find((event) => event.kind === "assistant");
  assert.equal(user.input, "用这个技能");
  assert.match(user.output, /<skill>explore<\/skill>/);
  assert.equal(result.events.some((event) => event.kind === "context"), false);
  assert.equal(assistant.model, "gpt-debug");
  assert.equal(assistant.usage.totalTokens, 160);
  assert.equal(result.metrics.tokens, 160);
  assert.equal(formatTrajectoryUsage(assistant.usage), "in 120 · out 40 · reason 12 · 160 tok");
});

test("shows graph routing decisions on the routed user turn", () => {
  const result = buildTrajectory({
    messages: [
      {
        id: "u-route",
        role: "you",
        text: "修复并验证",
        model_content: [
          "<turn_context>",
          '<coding_harness version="coding-turn-route-v14" source="llm">',
          "tasks=required",
          "</coding_harness>",
          "</turn_context>",
          "",
          "<task>",
          "修复并验证",
          "</task>",
        ].join("\n"),
        routingGraph: {
          graphVersion: "coding-turn-route-v14",
          path: ["coding_gate", "task_gate"],
          source: "llm",
          delegationMode: "direct",
          decisions: { tasks: { required: true, reason: "multi-step work" } },
        },
      },
    ],
  });

  const user = result.events.find((event) => event.kind === "user");
  const routing = result.events.find((event) => event.kind === "routing");
  assert.match(user.output, /<coding_harness/);
  assert.equal(routing.turn, 1);
  assert.equal(routing.title, "graph routing");
  assert.match(routing.body, /coding_gate → task_gate/);
  assert.match(routing.input, /"required": true/);
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

test("filterTrajectoryEvents matches turn and kind", () => {
  const events = [
    { id: "1", kind: "user", turn: 1, title: "USER", body: "hello" },
    { id: "2", kind: "thinking", turn: 1, title: "thinking", body: "hmm" },
    { id: "3", kind: "tool", turn: 1, title: "glob", body: "{}" },
    { id: "4", kind: "thinking", turn: 2, title: "thinking", body: "next" },
    { id: "5", kind: "tool", turn: 2, title: "read", body: "{}" },
    { id: "6", kind: "loop", turn: 2, title: "agent loop 1", body: "" },
  ];
  assert.deepEqual(
    filterTrajectoryEvents(events, { turn: 2 }).map((event) => event.id),
    ["4", "5", "6"],
  );
  assert.deepEqual(
    filterTrajectoryEvents(events, { kind: "thinking" }).map((event) => event.id),
    ["2", "4"],
  );
  assert.deepEqual(
    filterTrajectoryEvents(events, { turn: 2, kind: "tool" }).map((event) => event.id),
    ["5"],
  );
  assert.deepEqual(
    filterTrajectoryEvents(events, { kind: "tool", includeCalls: false }).map(
      (event) => event.id,
    ),
    ["3", "5"],
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

test("row preview stays one line and adds ... when source had more lines", () => {
  const tool = formatTrajectoryRowPreview({
    kind: "tool",
    title: "Bash",
    input: '{\n  "command": "ls -la"\n}',
    preview: "ls -la -> exit 0 stdout: total 208 -rw-r--r-- 1 root root 8196 .DS_Store",
    output: "total 208\n-rw-r--r-- 1 root root 8196 Jun 19 13:40 .DS_Store\ndrwxr-xr-x 1 root root 4096 src\nREADME.md",
  });
  assert.equal(tool.includes("\n"), false);
  assert.match(tool, /^Bash \{/);
  assert.match(tool, /"command":"ls -la"/);
  assert.match(tool, /total 208\.\.\.$/);
  assert.equal(tool.includes("-rw-r--r--"), false);

  const body = formatTrajectoryRowPreview({
    kind: "assistant",
    body: "第一行说明\n第二行补充",
  });
  assert.equal(body, "第一行说明...");
  assert.equal(
    formatTrajectoryRowPreview({ kind: "assistant", body: "只有一行" }),
    "只有一行",
  );
  assert.equal(
    formatTrajectoryRowPreview({
      kind: "system",
      body: "You are Codemini.",
      input: "You are Codemini.\nFollow AGENTS.md.",
    }),
    "You are Codemini....",
  );
});
