/**
 * Harness 轨迹展示使用的纯函数。
 * 这里不把“没有数据”“未命中灰度”和“请求失败”混成一个状态。
 */

const HARNESS_EVENT_TYPES = new Set([
  "harness:decision",
  "harness:route",
  "harness:context",
  "harness:status",
]);

function timeValue(value) {
  if (value == null || value === "") return Number.POSITIVE_INFINITY;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function eventTime(event, episode) {
  return timeValue(
    event?.timestamp || event?.createdAt || event?.startedAt || event?.endedAt
      || episode?.startedAt || episode?.createdAt,
  );
}

/** 将多个 episode 的事件按真实时间合并，避免接口返回顺序影响 UI。 */
export function collectHarnessEvents(episodes = []) {
  const rows = [];
  (Array.isArray(episodes) ? episodes : []).forEach((episode, episodeIndex) => {
    (Array.isArray(episode?.events) ? episode.events : []).forEach((event, eventIndex) => {
      if (!HARNESS_EVENT_TYPES.has(event?.type)) return;
      rows.push({
        ...event,
        episode,
        __episodeIndex: episodeIndex,
        __eventIndex: eventIndex,
        __time: eventTime(event, episode),
      });
    });
  });
  return rows.sort((a, b) =>
    a.__time - b.__time
    || a.__episodeIndex - b.__episodeIndex
    || a.__eventIndex - b.__eventIndex,
  );
}

export function decisionAction(payload = {}) {
  return String(
    payload?.policy?.choice
      || payload?.policy?.action
      || payload?.advisory?.choice
      || payload?.advisory?.action
      || payload?.choice
      || payload?.action
      || "unknown",
  ).trim() || "unknown";
}

function hasAnswers(decision = {}) {
  if (Array.isArray(decision.answers)) return decision.answers.length > 0;
  return Boolean(decision.answers && typeof decision.answers === "object");
}

/** 每条 decision 只计数一次，错误优先于弃权，避免按答案数量放大统计。 */
export function classifyDecision(event = {}) {
  const payload = event?.payload || {};
  const decision = payload?.decision || {};
  const errors = Array.isArray(decision.errors)
    ? decision.errors.filter(Boolean)
    : (decision.error ? [decision.error] : []);
  const answers = Array.isArray(decision.answers)
    ? decision.answers
    : Object.values(decision.answers || {});
  const abstained = Boolean(
    decision.abstain
      || payload.abstain
      || answers.some((answer) => answer?.abstain === true || answer?.reason === "provider_error"),
  );
  if (errors.length) return { status: "failed", errors, answers, decision };
  if (abstained || !hasAnswers(decision)) return { status: "abstained", errors, answers, decision };
  return { status: "success", errors, answers, decision };
}

export function latestBeliefEvent(events = []) {
  return [...events].reverse().find((event) => {
    const belief = event?.payload?.belief;
    return belief && typeof belief === "object" && Object.keys(belief).length > 0;
  }) || null;
}

export function beliefPercent(event, node) {
  const value = Number(event?.payload?.belief?.[node]?.true);
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

/** 硬门禁只有明确给出通过才显示“通过”。 */
export function hardGateLabel(payload = {}) {
  const guards = payload?.guards || payload?.hardGuards || {};
  if (guards.requiresReview === true || guards.blocked === true || guards.denied === true) {
    return "需要人工复核";
  }
  if (
    guards.passed === true
      || guards.pass === true
      || guards.status === "pass"
      || guards.result === "pass"
  ) return "通过";
  return "未判定";
}

export function summarizeHarness(episodes = [], { fetchStatus = "success", fetchError = "" } = {}) {
  const events = collectHarnessEvents(episodes);
  const decisions = events.filter((event) => event.type === "harness:decision");
  const routes = events.filter((event) => event.type === "harness:route");
  const contexts = events.filter((event) => event.type === "harness:context");
  const counts = { success: 0, failed: 0, abstained: 0 };
  const actions = {};
  const providers = {};
  const providerErrors = [];
  for (const event of decisions) {
    const payload = event.payload || {};
    const result = classifyDecision(event);
    counts[result.status] += 1;
    const action = decisionAction(payload);
    actions[action] = (actions[action] || 0) + 1;
    const provider = String(result.decision.provider || payload.provider || "unknown");
    providers[provider] = (providers[provider] || 0) + 1;
    for (const error of result.errors) providerErrors.push({ provider, model: result.decision.modelVersion || result.decision.model || "—", error, event });
  }
  const contextBlocks = contexts.reduce((total, event) => {
    const decisionsInContext = event.payload?.decisions;
    return total + (Array.isArray(decisionsInContext) ? decisionsInContext.length : 0);
  }, 0);
  const latestBelief = latestBeliefEvent(events);
  return {
    events,
    decisions,
    routes,
    contexts,
    contextBlocks,
    counts,
    actions,
    providers,
    providerErrors,
    latestBelief,
    latestDecision: decisions.at(-1) || null,
    fetchStatus,
    fetchError: String(fetchError || ""),
    hasHistory: events.length > 0,
  };
}

export function activationLabel(activation = {}) {
  if (activation?.active === true) return `当前已满足启用条件${activation.provider ? `（${activation.provider}）` : ""}`;
  if (activation?.reason) return `当前未启用：${activation.reason}`;
  return "当前启用条件未知";
}

