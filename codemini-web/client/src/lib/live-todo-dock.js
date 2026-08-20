import { extractLatestTodoFromGroups } from "./answer-process.js";
import { buildRenderGroups } from "./message-render-groups.js";
import { getTodoToolItems } from "./tool-card-display.js";

function isLiveAssistantMessage(message) {
  const role = String(message?.role || "");
  return Boolean(role) && role !== "you" && role !== "divider";
}

/** Latest in-progress assistant todo, docked above the composer while busy. */
export function findLiveTodoDock(messages = [], { busy = false } = {}) {
  if (!busy) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isLiveAssistantMessage(message)) continue;
    const card = extractLatestTodoFromGroups(buildRenderGroups(message.segments || []));
    if (!card) return null;
    const todos = getTodoToolItems(card.arguments, card.result);
    if (!todos.length) return null;
    return {
      messageId: message.id,
      card,
      todos,
    };
  }
  return null;
}
