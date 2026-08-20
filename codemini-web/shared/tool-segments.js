export function addToolToSegments(segments, toolCard) {
  const source = Array.isArray(segments) ? segments : [];
  if (source.length === 0) return [{ type: "tools", cards: [toolCard] }];
  const last = source[source.length - 1];
  if (last?.type === "tools" && Array.isArray(last.cards)) {
    return [
      ...source.slice(0, -1),
      { ...last, cards: [...last.cards, toolCard] },
    ];
  }
  return [...source, { type: "tools", cards: [toolCard] }];
}

export function isStreamToolId(toolId) {
  return String(toolId || "").startsWith("stream-tool-");
}

export function toolCardMatches(card, tool) {
  const cardId = String(card?.id || "");
  const toolId = String(
    tool && typeof tool === "object" ? tool.id || "" : tool || "",
  );
  if (cardId && cardId === toolId) return true;
  const cardName = String(card?.name || "");
  const toolName = String(
    tool && typeof tool === "object" ? tool.name || "" : "",
  );
  return (
    isStreamToolId(cardId) &&
    toolId &&
    !isStreamToolId(toolId) &&
    cardName &&
    cardName === toolName
  );
}

export function updateToolInSegments(segments, tool, updater) {
  let updated = false;
  const next = (Array.isArray(segments) ? segments : []).map((segment) => {
    if (segment?.type !== "tools" || !Array.isArray(segment.cards)) {
      return segment;
    }
    const index = segment.cards.findIndex((card) =>
      toolCardMatches(card, tool),
    );
    if (index === -1) return segment;
    updated = true;
    const cards = [...segment.cards];
    cards[index] = updater(cards[index]);
    return { ...segment, cards };
  });
  return { segments: next, updated };
}

export function hasToolInSegments(segments, tool) {
  return (Array.isArray(segments) ? segments : []).some(
    (segment) =>
      segment?.type === "tools" &&
      Array.isArray(segment.cards) &&
      segment.cards.some((card) => toolCardMatches(card, tool)),
  );
}

export function updateToolInMessages(messages, tool, updater) {
  let updated = false;
  const nextMessages = (Array.isArray(messages) ? messages : []).map(
    (message) => {
      const result = updateToolInSegments(message.segments, tool, updater);
      if (!result.updated) return message;
      updated = true;
      return { ...message, segments: result.segments };
    },
  );
  return { messages: nextMessages, updated };
}

export function upsertToolCardInSegments(segments, toolCard) {
  let found = false;
  const source = (Array.isArray(segments) ? segments : []).map((segment) => {
    if (segment?.type !== "tools" || !Array.isArray(segment.cards)) {
      return segment;
    }
    const index = segment.cards.findIndex((card) =>
      toolCardMatches(card, toolCard),
    );
    if (index === -1) return segment;
    found = true;
    const cards = [...segment.cards];
    cards[index] = { ...cards[index], ...toolCard };
    return { ...segment, cards };
  });
  return found ? source : addToolToSegments(source, toolCard);
}

export function upsertSingletonToolCardInSegments(segments, toolCard) {
  const singletonName = String(toolCard?.name || "").toLowerCase();
  const matchesSingleton = (card) => {
    const cardName = String(card?.name || "").toLowerCase();
    return ["tasks", "update_todos"].includes(singletonName)
      ? ["tasks", "update_todos"].includes(cardName)
      : cardName === singletonName;
  };
  let found = false;
  const source = (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      if (segment?.type !== "tools" || !Array.isArray(segment.cards)) {
        return segment;
      }
      const cards = [];
      for (const card of segment.cards) {
        if (!matchesSingleton(card)) {
          cards.push(card);
        } else if (!found) {
          cards.push({ ...card, ...toolCard });
          found = true;
        }
      }
      return cards.length ? { ...segment, cards } : null;
    })
    .filter(Boolean);
  return found ? source : upsertToolCardInSegments(source, toolCard);
}
