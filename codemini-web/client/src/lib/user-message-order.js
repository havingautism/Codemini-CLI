function isCrewWakeDivider(message) {
  return message?.role === "divider" && message?.dividerType === "crew-wake";
}

/** Place an accepted user turn after the pre-submit anchor and any wake
 * dividers that landed while HTTP 202 was in flight, and before this turn's
 * assistant bubble. */
export function placeAcceptedUserMessage(messages, message, anchorId = "") {
  const list = Array.isArray(messages) ? messages.slice() : [];
  const id = String(message?.id || "").trim();
  if (id && list.some((item) => item?.id === id)) return list;
  const anchor = String(anchorId || "").trim();
  const anchorIndex = anchor ? list.findIndex((item) => item?.id === anchor) : -1;
  const start = anchorIndex >= 0 ? anchorIndex + 1 : list.length;
  let insertAt = list.length;
  for (let index = start; index < list.length; index += 1) {
    if (isCrewWakeDivider(list[index])) continue;
    insertAt = index;
    break;
  }
  list.splice(insertAt, 0, message);
  return list;
}
