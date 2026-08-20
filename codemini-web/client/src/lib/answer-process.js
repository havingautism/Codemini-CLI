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
  return ["tasks", "update_todos"].includes(
    String(card?.name || "").toLowerCase().replace(/\(.*$/, ""),
  );
}

function isUserInputCard(card) {
  return String(card?.name || "")
    .toLowerCase()
    .replace(/\(.*$/, "") === "request_user_input";
}

export function extractLatestTodoFromPlanSteps(steps = [], fallbackCard = null) {
  let todoCard = fallbackCard;
  const nextSteps = (Array.isArray(steps) ? steps : []).map((step) => {
    let changed = false;
    const segments = [];
    for (const segment of Array.isArray(step?.segments) ? step.segments : []) {
      if (segment?.type !== "tools" || !Array.isArray(segment.cards)) {
        segments.push(segment);
        continue;
      }
      const cards = segment.cards.filter((card) => {
        if (!isTodoCard(card)) return true;
        todoCard = card;
        changed = true;
        return false;
      });
      if (cards.length) segments.push(changed ? { ...segment, cards } : segment);
    }
    return changed ? { ...step, segments } : step;
  });
  return { steps: nextSteps, todoCard };
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

function extractUserInputFromGroup(group) {
  if (!group || typeof group !== "object") {
    return { userInputCards: [], rest: null };
  }

  if (group.type === "tools") {
    const cards = Array.isArray(group.cards) ? group.cards : [];
    const userInputCards = cards.filter(isUserInputCard);
    const otherCards = cards.filter((card) => !isUserInputCard(card));
    return {
      userInputCards,
      rest: otherCards.length ? { ...group, cards: otherCards } : null,
    };
  }

  if (group.type === "process") {
    const userInputCards = [];
    const restGroups = [];
    for (const inner of Array.isArray(group.groups) ? group.groups : []) {
      const extracted = extractUserInputFromGroup(inner);
      userInputCards.push(...extracted.userInputCards);
      if (extracted.rest) restGroups.push(extracted.rest);
    }
    return {
      userInputCards,
      rest: restGroups.length ? { ...group, groups: restGroups } : null,
    };
  }

  return { userInputCards: [], rest: group };
}

function isUserInputGroup(group) {
  if (group?.type === "tools") {
    return (group.cards || []).some(isUserInputCard);
  }
  if (group?.type === "process") {
    return extractUserInputFromGroup(group).userInputCards.length > 0;
  }
  return false;
}

function peelTrailingTextGroups(pending) {
  const textGroups = [];
  while (pending.at(-1)?.type === "text") {
    textGroups.unshift(pending.pop());
  }
  return textGroups;
}

function findFinalAnswerIndex(groups = []) {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group?.type === "text" && String(group.text || "").trim()) return index;
  }
  return -1;
}

export function extractLatestTodoFromGroups(groups = []) {
  let latestTodo = null;
  for (const group of Array.isArray(groups) ? groups : []) {
    const extracted = extractTodoFromGroup(group);
    if (extracted.todoCards.length) latestTodo = extracted.todoCards.at(-1);
  }
  return latestTodo;
}

function pullTodosFromGroups(groups = []) {
  const todoCards = [];
  const source = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    const extracted = extractTodoFromGroup(group);
    todoCards.push(...extracted.todoCards);
    if (extracted.rest) source.push(extracted.rest);
  }
  return { todoCards, source, latestTodo: todoCards.at(-1) || null };
}

function todoLayoutItem(latestTodo) {
  return latestTodo
    ? { type: "group", group: { type: "tools", cards: [latestTodo] } }
    : null;
}

/** Fold process groups; keep create_plan cards in chronological order before the final answer. */
export function layoutAnswerProcessWithPlans(
  groups = [],
  fallbackStartedAt = null,
  { fold = true, omitTodo = false } = {},
) {
  const { source, latestTodo } = pullTodosFromGroups(groups);
  const visibleTodo = omitTodo ? null : latestTodo;
  const answerIndex = findFinalAnswerIndex(source);
  const finalAnswer = answerIndex >= 0 ? source[answerIndex] : null;
  const hasFoldCandidate = Boolean(fold && finalAnswer && answerIndex > 0);

  if (!hasFoldCandidate) {
    const parkedTodo = todoLayoutItem(visibleTodo);
    return {
      hasFold: false,
      hasTodo: Boolean(latestTodo),
      items: [
        ...source.map((group) => ({ type: "group", group })),
        ...(parkedTodo ? [parkedTodo] : []),
      ],
      durationMs: 0,
    };
  }

  const beforeAnswer = source.slice(0, answerIndex);
  const trailing = source.slice(answerIndex + 1);
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
    if (isUserInputGroup(group)) {
      const { userInputCards, rest } = extractUserInputFromGroup(group);
      const precedingText = peelTrailingTextGroups(pendingProcess);
      if (rest) pendingProcess.push(rest);
      flushProcess();
      for (const textGroup of precedingText) {
        items.push({ type: "group", group: textGroup });
      }
      if (userInputCards.length) {
        items.push({ type: "group", group: { type: "tools", cards: userInputCards } });
      }
      continue;
    }
    pendingProcess.push(group);
  }
  flushProcess();
  const parkedTodo = todoLayoutItem(visibleTodo);
  if (parkedTodo) items.push(parkedTodo);
  items.push({ type: "group", group: finalAnswer });
  for (const group of trailing) {
    items.push({ type: "group", group });
  }

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
    hasTodo: Boolean(latestTodo),
    items,
    durationMs,
  };
}
