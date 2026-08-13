/** Pure helpers for Deep Research investigation Scout board (no React / i18n). */

export const SETTLED_QUESTION_STATUSES = new Set(["done", "partial", "blocked"]);
export const TERMINAL_COVERAGE_STATUSES = new Set(["covered", "partial", "blocked", "conflicted"]);
export const TERMINAL_SCOUT_STATUSES = new Set([
  "done",
  "partial",
  "blocked",
  "failed",
  "aborted",
  "error",
]);

export function isQuestionSettled(question) {
  if (SETTLED_QUESTION_STATUSES.has(String(question?.status || "").toLowerCase())) return true;
  const criteria = question?.coverage?.criteria || [];
  if (!criteria.length) return false;
  return criteria.every((item) => TERMINAL_COVERAGE_STATUSES.has(String(item?.status || "").toLowerCase()));
}

export function unresolvedDependencyIds(question, questions = []) {
  const deps = Array.isArray(question?.dependsOn) ? question.dependsOn.map(String) : [];
  if (!deps.length) return [];
  return deps.filter((depId) => {
    const upstream = (questions || []).find((item) => item.id === depId || item.tempId === depId);
    if (!upstream) return true;
    return !isQuestionSettled(upstream);
  });
}

/** Real started scout run (store uses sr_; not a waiting/queue stub keyed by questionId). */
export function isRealScoutRunId(id) {
  return /^sr_/i.test(String(id || "").trim());
}

export function isActivelyRunningScout(live) {
  return live?.status === "running" && isRealScoutRunId(live?.scoutRunId);
}

export function isScoutShownOnBoard(scout, live, question, questions = []) {
  const status = String(live?.status || scout?.status || "").toLowerCase();
  if (status === "waiting") return false;
  if (Array.isArray(live?.waitingOn) && live.waitingOn.length > 0) return false;

  const scoutRunId = String(live?.scoutRunId || scout?.id || "").trim();
  // Queued placeholders are keyed by questionId and must never appear here.
  if (!isRealScoutRunId(scoutRunId)) return false;

  // If deps are still unresolved and this live entry is only a queue stub, hide it.
  // Real started runs always have status running/terminal after scout:start.
  const unresolved = unresolvedDependencyIds(question, questions);
  if (unresolved.length && status !== "running" && !TERMINAL_SCOUT_STATUSES.has(status)) {
    return false;
  }

  return (
    status === "running"
    || TERMINAL_SCOUT_STATUSES.has(status)
    || status === "failed"
    || status === "aborted"
    || status === "error"
  );
}

/**
 * Merge persisted wave scouts with live runs.
 * Never drop a real running sr_ scout (including waveId mismatch orphans on the active wave).
 */
export function collectWaveScoutEntries({
  wave,
  waveIndex = 0,
  waveCount = 1,
  liveList = [],
  questions = [],
}) {
  const questionById = new Map((questions || []).map((q) => [q.id, q]));
  const targetIds = new Set(
    (Array.isArray(wave?.targets) ? wave.targets : [])
      .map((item) => item?.questionId || item)
      .filter(Boolean),
  );
  const isActiveWave = wave?.status === "running"
    || wave?.status === "evaluating"
    || waveIndex === Math.max(0, waveCount - 1);

  const matchesWave = (live) => {
    if (live?.waveId && wave?.id && live.waveId === wave.id) return true;
    if (!live?.waveId && Number(live?.wave || 1) === Number(wave?.wave || 1)) return true;
    // Orphan live runs (waveId mismatch / stale): attach to the active wave only.
    if (isActiveWave && live?.status === "running") return true;
    if (isActiveWave && targetIds.size && targetIds.has(live?.questionId)) return true;
    return false;
  };

  const byId = new Map();
  for (const scout of wave?.scouts || []) {
    const id = String(scout?.id || "").trim();
    if (!id) continue;
    byId.set(id, {
      id,
      questionId: scout.questionId,
      name: scout.name,
      status: scout.status,
      coverage: scout.coverage || scout.ledger?.criteria || [],
      handoffMarkdown: scout.handoffMarkdown || "",
      searchCount: scout.searchCount,
      fetchCount: scout.fetchCount,
      error: scout.error || "",
    });
  }

  for (const live of liveList) {
    if (!matchesWave(live)) continue;
    if (live.status === "waiting") continue;
    const scoutRunId = String(live.scoutRunId || "").trim();
    if (!isRealScoutRunId(scoutRunId)) continue;
    const existing = byId.get(scoutRunId);
    byId.set(scoutRunId, {
      id: scoutRunId,
      questionId: live.questionId || existing?.questionId || "",
      name: live.name || existing?.name || "",
      status: live.status || existing?.status || "running",
      coverage: live.coverage || existing?.coverage || [],
      handoffMarkdown: existing?.handoffMarkdown || "",
      searchCount: live.searchCount ?? existing?.searchCount,
      fetchCount: live.fetchCount ?? existing?.fetchCount,
      error: live.error || existing?.error || "",
    });
  }

  return [...byId.values()].filter((scout) => isScoutShownOnBoard(
    scout,
    liveList.find((item) => item.scoutRunId === scout.id) || null,
    questionById.get(scout.questionId),
    questions,
  ));
}

export function resolveScoutLive(scout, liveScouts = {}, liveList = []) {
  const id = String(scout?.id || "").trim();
  if (isRealScoutRunId(id) && liveScouts[id]) return liveScouts[id];
  return liveList.find((item) => item.scoutRunId && item.scoutRunId === id)
    || liveList.find((item) => (
      item.questionId === scout?.questionId
      && item.status !== "waiting"
      && isRealScoutRunId(item.scoutRunId)
    ))
    || null;
}
