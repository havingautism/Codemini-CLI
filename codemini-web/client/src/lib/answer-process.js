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

function isCreatePlanCard(card) {
  const name = String(card?.name || "")
    .toLowerCase()
    .replace(/\(.*$/, "");
  return name === "create_plan" || name === "run_subagent" || Boolean(card?.planRun);
}

function isTodoCard(card) {
  return String(card?.name || "").toLowerCase().replace(/\(.*$/, "") === "update_todos";
}

function extractTodoFromGroup(group) {
  if (!group || typeof group !== "object") return { todoCards: [], rest: null };
  if (group.type === "tools") {
    const cards = Array.isArray(group.cards) ? group.cards : [];
    const todoCards = cards.filter(isTodoCard);
    const otherCards = cards.filter((card) => !isTodoCard(card));
    return {
      todoCards,
      rest: otherCards.length ? { ...group, cards: otherCards } : null,
    };
  }
  if (group.type === "process") {
    const todoCards = [];
    const restGroups = [];
    for (const inner of Array.isArray(group.groups) ? group.groups : []) {
      const extracted = extractTodoFromGroup(inner);
      todoCards.push(...extracted.todoCards);
      if (extracted.rest) restGroups.push(extracted.rest);
    }
    return {
      todoCards,
      rest: restGroups.length ? { ...group, groups: restGroups } : null,
    };
  }
  return { todoCards: [], rest: group };
}

/**
 * Pull create_plan cards out of a tools/process group so they never stay inside a fold.
 * Returns { planCards, rest } where rest is null when the group is empty after extraction.
 */
export function extractCreatePlanFromGroup(group) {
  if (!group || typeof group !== "object") {
    return { planCards: [], rest: null };
  }

  if (group.type === "tools") {
    const cards = Array.isArray(group.cards) ? group.cards : [];
    const planCards = cards.filter(isCreatePlanCard);
    const otherCards = cards.filter((card) => !isCreatePlanCard(card));
    return {
      planCards,
      rest: otherCards.length ? { ...group, cards: otherCards } : null,
    };
  }

  if (group.type === "process") {
    const planCards = [];
    const restGroups = [];
    for (const inner of Array.isArray(group.groups) ? group.groups : []) {
      const extracted = extractCreatePlanFromGroup(inner);
      planCards.push(...extracted.planCards);
      if (extracted.rest) restGroups.push(extracted.rest);
    }
    return {
      planCards,
      rest: restGroups.length ? { ...group, groups: restGroups } : null,
    };
  }

  return { planCards: [], rest: group };
}

function isCreatePlanGroup(group) {
  if (group?.type === "tools") {
    return (group.cards || []).some(isCreatePlanCard);
  }
  if (group?.type === "process") {
    return (group.groups || []).some((inner) => extractCreatePlanFromGroup(inner).planCards.length > 0);
  }
  return false;
}

/** Fold process groups; keep create_plan cards in chronological order before the final answer. */
export function layoutAnswerProcessWithPlans(groups = [], fallbackStartedAt = null) {
  const todoCards = [];
  const source = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    const extracted = extractTodoFromGroup(group);
    todoCards.push(...extracted.todoCards);
    if (extracted.rest) source.push(extracted.rest);
  }
  const latestTodo = todoCards.at(-1);
  const finalAnswer = source.at(-1);
  const hasFinalAnswer =
    finalAnswer?.type === "text" && String(finalAnswer.text || "").trim();
  const hasFoldCandidate = Boolean(hasFinalAnswer && source.length > 1);

  if (!hasFoldCandidate) {
    return {
      hasFold: false,
      items: [
        ...source.map((group) => ({ type: "group", group })),
        ...(latestTodo ? [{ type: "group", group: { type: "tools", cards: [latestTodo] } }] : []),
      ],
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

  const pushPlanCards = (planCards) => {
    if (!planCards.length) return;
    flushProcess();
    items.push({ type: "group", group: { type: "tools", cards: planCards } });
  };

  for (const group of beforeAnswer) {
    if (isCreatePlanGroup(group)) {
      const { planCards, rest } = extractCreatePlanFromGroup(group);
      if (rest) pendingProcess.push(rest);
      pushPlanCards(planCards);
      continue;
    }
    pendingProcess.push(group);
  }
  flushProcess();
  if (latestTodo) {
    items.push({ type: "group", group: { type: "tools", cards: [latestTodo] } });
  }
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
