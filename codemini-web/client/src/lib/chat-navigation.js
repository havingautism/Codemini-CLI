export function getActiveMessageIndex({
  viewportTop,
  viewportHeight,
  isAtTop,
  isAtBottom,
  messageRects,
}) {
  if (messageRects.length === 0) return -1;
  if (isAtTop) return 0;
  if (isAtBottom) return messageRects.length - 1;

  const viewportCenter = viewportTop + viewportHeight / 2;
  let activeIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  messageRects.forEach((rect, index) => {
    const messageCenter = rect.top + (rect.bottom - rect.top) / 2;
    const distance = Math.abs(messageCenter - viewportCenter);
    if (distance < closestDistance) {
      activeIndex = index;
      closestDistance = distance;
    }
  });
  return activeIndex;
}
