const DEFAULT_END_THRESHOLD_PX = 8;

export function isViewportAtEnd(node, threshold = DEFAULT_END_THRESHOLD_PX) {
  if (!node) return true;
  return node.scrollHeight - node.clientHeight - node.scrollTop <= threshold;
}

export function syncViewportAfterResize(node, shouldFollowEnd) {
  if (!node || !shouldFollowEnd) return false;
  node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  return true;
}

/** Layout/programmatic scrolls must not clear stick-to-bottom intent. */
export function resolveFollowEnd(prevFollow, { atEnd, isUserDriven, reason = '' }) {
  if (reason === 'navigation') return false;
  if (!isUserDriven) return prevFollow;
  return atEnd;
}
