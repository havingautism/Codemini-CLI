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

function isCreatePlanGroup(group) {
  return (
    group?.type === "tools" &&
    Array.isArray(group.cards) &&
    group.cards.some((card) => {
      const name = String(card?.name || "")
        .toLowerCase()
        .replace(/\(.*$/, "");
      return name === "create_plan" || Boolean(card?.planRun);
    })
  );
}

/** Fold process groups; keep create_plan cards in chronological order before the final answer. */
export function layoutAnswerProcessWithPlans(groups = [], fallbackStartedAt = null) {
  const source = Array.isArray(groups) ? groups : [];
  const finalAnswer = source.at(-1);
  const hasFinalAnswer =
    finalAnswer?.type === "text" && String(finalAnswer.text || "").trim();
  const hasFoldCandidate = Boolean(hasFinalAnswer && source.length > 1);

  if (!hasFoldCandidate) {
    return {
      hasFold: false,
      items: source.map((group) => ({ type: "group", group })),
      durationMs: 0,
    };
  }

  const beforeAnswer = source.slice(0, -1);
  const items = [];
  let pendingProcess = [];

  const flushProcess = () => {
    if (!pendingProcess.length) return;
    items.push({ type: "fold", groups: pendingProcess });
    pendingProcess = [];
  };

  for (const group of beforeAnswer) {
    if (isCreatePlanGroup(group)) {
      const planCards = (group.cards || []).filter((card) => {
        const name = String(card?.name || "")
          .toLowerCase()
          .replace(/\(.*$/, "");
        return name === "create_plan" || Boolean(card?.planRun);
      });
      const otherCards = (group.cards || []).filter((card) => {
        const name = String(card?.name || "")
          .toLowerCase()
          .replace(/\(.*$/, "");
        return !(name === "create_plan" || Boolean(card?.planRun));
      });
      if (otherCards.length) {
        pendingProcess.push({ ...group, cards: otherCards });
      }
      flushProcess();
      if (planCards.length) {
        items.push({ type: "group", group: { type: "tools", cards: planCards } });
      }
      continue;
    }
    pendingProcess.push(group);
  }
  flushProcess();
  items.push({ type: "group", group: finalAnswer });

  const foldGroups = items
    .filter((item) => item.type === "fold")
    .flatMap((item) => item.groups || []);
  const answerStartedAt = parseTimestamp(finalAnswer.startedAt);
  const starts = foldGroups.map(groupStartedAt).filter(Number.isFinite);
  const fallback = parseTimestamp(fallbackStartedAt);
  if (Number.isFinite(fallback)) starts.push(fallback);
  const durationMs =
    Number.isFinite(answerStartedAt) && starts.length
      ? Math.max(0, answerStartedAt - Math.min(...starts))
      : 0;

  return {
    hasFold: items.some((item) => item.type === "fold" && item.groups?.length),
    items,
    durationMs,
  };
}
