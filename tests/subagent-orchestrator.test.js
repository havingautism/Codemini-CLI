import test from "node:test";
import assert from "node:assert/strict";
import {
  createSubAgentDependencyCoordinator,
  formatSubAgentUpstreamContext,
} from "../src/core/subagent-orchestrator.js";

test("dependent subagents wait for earlier task ids and receive their handoffs", async () => {
  const coordinator = createSubAgentDependencyCoordinator();
  const inspect = coordinator.register({
    groupId: "turn-1",
    taskId: "inspect",
    name: "Rin",
    prompt: "Inspect the project",
  });
  const configure = coordinator.register({
    groupId: "turn-1",
    taskId: "configure",
    dependsOn: ["inspect"],
    name: "Mika",
    prompt: "Configure it",
  });

  let released = false;
  const waiting = configure.wait().then((result) => {
    released = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(released, false);

  inspect.settle({ ok: true, text: "Use package A." });
  const dependencyResult = await waiting;
  assert.equal(dependencyResult.ok, true);
  assert.deepEqual(dependencyResult.blockedBy, []);
  assert.equal(dependencyResult.upstream[0].taskId, "inspect");
  assert.match(
    formatSubAgentUpstreamContext(dependencyResult.upstream),
    /### inspect — Rin[\s\S]*Task: Inspect the project[\s\S]*Use package A\./,
  );
});

test("failed upstream tasks block dependents without calling them failed", async () => {
  const coordinator = createSubAgentDependencyCoordinator();
  const inspect = coordinator.register({
    groupId: "turn-1",
    taskId: "inspect",
  });
  const configure = coordinator.register({
    groupId: "turn-1",
    taskId: "configure",
    dependsOn: ["inspect"],
  });

  inspect.settle({ ok: false, error: "inspection failed" });
  const result = await configure.wait();
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockedBy, ["inspect"]);
});

test("dependencies reject forward references, duplicate ids, and invalid ids", () => {
  const coordinator = createSubAgentDependencyCoordinator();
  const forward = coordinator.register({
    groupId: "turn-1",
    taskId: "configure",
    dependsOn: ["inspect"],
  });
  assert.equal(forward.ok, false);
  assert.match(forward.error, /earlier task_id/i);

  assert.equal(
    coordinator.register({ groupId: "turn-1", taskId: "inspect" }).ok,
    true,
  );
  const duplicate = coordinator.register({ groupId: "turn-1", taskId: "inspect" });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /duplicate/i);

  const invalid = coordinator.register({ groupId: "turn-1", taskId: "bad id" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /task_id/i);
});

test("task ids are scoped to one orchestration group", () => {
  const coordinator = createSubAgentDependencyCoordinator();
  assert.equal(
    coordinator.register({ groupId: "turn-1", taskId: "inspect" }).ok,
    true,
  );
  assert.equal(
    coordinator.register({ groupId: "turn-2", taskId: "inspect" }).ok,
    true,
  );
});
