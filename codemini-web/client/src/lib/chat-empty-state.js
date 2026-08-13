export function hasConversationContent(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((message) => {
    const role = String(message?.role || "").toLowerCase();
    return role !== "system" && role !== "divider";
  });
}
