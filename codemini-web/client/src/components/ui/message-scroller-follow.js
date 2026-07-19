const DEFAULT_END_THRESHOLD_PX = 4;

export function isViewportAtEnd(node, threshold = DEFAULT_END_THRESHOLD_PX) {
  if (!node) return true;
  return node.scrollHeight - node.clientHeight - node.scrollTop <= threshold;
}

export function syncViewportAfterResize(node, shouldFollowEnd) {
  if (!node || !shouldFollowEnd) return false;
  node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
  return true;
}
