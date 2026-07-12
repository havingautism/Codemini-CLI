function parseTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function groupStartedAt(group) {
  if (group?.type === "process") {
    const starts = (group.groups || []).map(groupStartedAt).filter(Number.isFinite);
    return starts.length ? Math.min(...starts) : null;
  }
  if (group?.type === "tools") {
    const starts = (group.cards || [])
      .map((card) => parseTimestamp(card?.startedAt))
      .filter(Number.isFinite);
    return starts.length ? Math.min(...starts) : null;
  }
  return parseTimestamp(group?.startedAt);
}

export function splitAnswerProcessGroups(groups = [], fallbackStartedAt = null) {
  const source = Array.isArray(groups) ? groups : [];
  const finalAnswer = source.at(-1);
  const hasFinalAnswer =
    finalAnswer?.type === "text" && String(finalAnswer.text || "").trim();
  const hasFold = Boolean(hasFinalAnswer && source.length > 1);
  if (!hasFold) {
    return {
      hasFold: false,
      processGroups: [],
      answerGroups: source,
      durationMs: 0,
    };
  }

  const processGroups = source.slice(0, -1);
  const answerStartedAt = parseTimestamp(finalAnswer.startedAt);
  const starts = processGroups.map(groupStartedAt).filter(Number.isFinite);
  const fallback = parseTimestamp(fallbackStartedAt);
  if (Number.isFinite(fallback)) starts.push(fallback);
  const durationMs =
    Number.isFinite(answerStartedAt) && starts.length
      ? Math.max(0, answerStartedAt - Math.min(...starts))
      : 0;

  return {
    hasFold: true,
    processGroups,
    answerGroups: [finalAnswer],
    durationMs,
  };
}
