export function hasConversationContent(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((message) => {
    const role = String(message?.role || "").toLowerCase();
    return role !== "system" && role !== "divider";
  });
}

function isAssistantReply(message) {
  if (!message || message.transientKey) return false;
  const role = String(message.role || "").toLowerCase();
  return role !== "" && role !== "system" && role !== "divider" && role !== "you" && role !== "user";
}

export function isSupersededWaitingResponse(messages = [], index = 0) {
  const list = Array.isArray(messages) ? messages : [];
  const message = list[index];
  if (message?.transientKey !== "waiting-response") return false;
  if (list.slice(index + 1).some(isAssistantReply)) return true;
  // The placeholder is appended after HTTP 202. A fast turn — Send now, or
  // any reply that starts during that round-trip — already has its empty
  // assistant bubble (and that bubble's loader) before this row exists.
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const item = list[cursor];
    const role = String(item?.role || "").toLowerCase();
    if (role === "you" || role === "user") return false;
    if (isAssistantReply(item)) return true;
  }
  return false;
}

