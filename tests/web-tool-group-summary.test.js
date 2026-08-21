import test from "node:test";
import assert from "node:assert/strict";
import { formatToolGroupSummaryLabel, toolGroupSummaryI18n } from "../codemini-web/client/src/lib/tool-group-summary.js";

test("tool group summary reports mixed completed and running counts", () => {
  assert.deepEqual(
    toolGroupSummaryI18n([
      { name: "write", status: "done" },
      { name: "write", status: "done" },
      { name: "read", status: "running" },
    ]),
    {
      key: "toolGroupToolsMixed",
      replacements: { done: 2, running: 1 },
    },
  );
});

test("tool group summary uses running-only or completed-only copy when the group is uniform", () => {
  assert.deepEqual(
    toolGroupSummaryI18n([
      { name: "run", status: "running" },
      { name: "Bash", status: "running" },
    ]),
    {
      key: "toolGroupCommandsRunning",
      replacements: { count: 2 },
    },
  );
  assert.deepEqual(
    toolGroupSummaryI18n([
      { name: "write", status: "done" },
      { name: "read", status: "error" },
    ]),
    {
      key: "toolGroupTools",
      replacements: { count: 2 },
    },
  );
});

test("tool group summary formats mixed zh copy from actual counts", () => {
  const zh = {
    toolGroupToolsMixed: "已完成 {{done}} 个工具，正在运行 {{running}} 个工具",
  };
  assert.equal(
    formatToolGroupSummaryLabel(
      [
        { name: "write", status: "done" },
        { name: "edit", status: "done" },
        { name: "read", status: "running" },
      ],
      (key) => zh[key] || key,
    ),
    "已完成 2 个工具，正在运行 1 个工具",
  );
});
