function normalizeTaskId(value) {
  return String(value || "").trim();
}

function normalizeDependencies(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeTaskId).filter(Boolean))];
}

function isValidTaskId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

/**
 * Coordinates run_subagent dependencies within one agent-loop completion step.
 * Dependencies must reference earlier task_ids, which prevents forward-reference
 * deadlocks while still allowing arbitrary topologically ordered DAGs.
 */
export function createSubAgentDependencyCoordinator() {
  let activeGroupId = "";
  let tasks = new Map();

  return {
    register({
      groupId,
      taskId,
      dependsOn,
      name = "",
      prompt = "",
    } = {}) {
      const normalizedGroupId = String(groupId || "default");
      const normalizedTaskId = normalizeTaskId(taskId);
      const dependencies = normalizeDependencies(dependsOn);

      if (normalizedGroupId !== activeGroupId) {
        activeGroupId = normalizedGroupId;
        tasks = new Map();
      }
      if (normalizedTaskId && !isValidTaskId(normalizedTaskId)) {
        return {
          ok: false,
          error:
            "task_id must start with a letter or number and contain only letters, numbers, underscores, or hyphens (max 64 characters).",
        };
      }
      if (normalizedTaskId && tasks.has(normalizedTaskId)) {
        return {
          ok: false,
          error: `Duplicate run_subagent task_id "${normalizedTaskId}" in the same orchestration.`,
        };
      }

      const missing = dependencies.filter((dependency) => !tasks.has(dependency));
      if (missing.length) {
        return {
          ok: false,
          error: `Unknown or forward run_subagent dependency: ${missing.join(", ")}. depends_on may only reference earlier task_id values from the same response.`,
        };
      }

      let resolveTask;
      const promise = new Promise((resolve) => {
        resolveTask = resolve;
      });
      const record = {
        taskId: normalizedTaskId,
        name: String(name || "").trim(),
        prompt: String(prompt || "").trim(),
        promise,
      };
      if (normalizedTaskId) tasks.set(normalizedTaskId, record);

      let settled = false;
      return {
        ok: true,
        taskId: normalizedTaskId,
        dependencies,
        async wait() {
          const upstream = await Promise.all(
            dependencies.map(async (dependency) => {
              const dependencyRecord = tasks.get(dependency);
              const result = await dependencyRecord.promise;
              return {
                taskId: dependency,
                name: dependencyRecord.name,
                prompt: dependencyRecord.prompt,
                ok: result?.ok !== false,
                text: String(result?.text || result?.error || "").trim(),
                handoffPath: String(result?.handoffPath || "").trim(),
              };
            }),
          );
          return {
            ok: upstream.every((item) => item.ok),
            upstream,
            blockedBy: upstream.filter((item) => !item.ok).map((item) => item.taskId),
          };
        },
        settle(result) {
          if (settled) return;
          settled = true;
          resolveTask(result || { ok: false, error: "Subagent finished without a result." });
        },
      };
    },
  };
}

const UPSTREAM_HANDOFF_MAX_CHARS = 1500;

function clipHandoffText(text, maxChars = UPSTREAM_HANDOFF_MAX_CHARS) {
  const body = String(text || "").trim();
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
}

export function formatSubAgentUpstreamContext(upstream = [], { maxChars = UPSTREAM_HANDOFF_MAX_CHARS } = {}) {
  const sections = (Array.isArray(upstream) ? upstream : [])
    .filter((item) => item?.ok && String(item?.text || "").trim())
    .map((item) => {
      const identity = [item.taskId, item.name].filter(Boolean).join(" — ");
      const handoffPath = String(item.handoffPath || "").trim();
      return [
        `### ${identity || "Upstream task"}`,
        ...(item.prompt ? [`Task: ${item.prompt}`] : []),
        "Status: completed",
        ...(handoffPath ? [`Handoff: ${handoffPath}`] : []),
        "",
        clipHandoffText(item.text, maxChars),
      ].join("\n");
    });
  return sections.length ? `Upstream handoffs:\n\n${sections.join("\n\n")}` : "";
}
