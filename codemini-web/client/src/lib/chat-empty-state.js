export function hasConversationContent(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((message) => {
    const role = String(message?.role || "").toLowerCase();
    return role !== "system" && role !== "divider";
  });
}

export function isSupersededWaitingResponse(messages = [], index = 0) {
  const message = Array.isArray(messages) ? messages[index] : null;
  if (message?.transientKey !== "waiting-response") return false;
  return messages.slice(index + 1).some((item) => {
    if (item?.transientKey) return false;
    const role = String(item?.role || "").toLowerCase();
    return role !== "" && role !== "system" && role !== "divider" && role !== "you" && role !== "user";
  });
}

