// Retry only the latest user turn. Never silently discard later conversation.
export function hasRecordedFileChanges(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasRecordedFileChanges);
  for (const [key, item] of Object.entries(value)) {
    if (['fileChanges', 'file_changes', 'tool_file_changes'].includes(key) && Array.isArray(item) && item.length) return true;
    if (key === 'fileChange' && item && typeof item === 'object') return true;
    if (item && typeof item === 'object' && hasRecordedFileChanges(item)) return true;
  }
  return false;
}

export function prepareRetryTurn(messages = [], userTurnIndex) {
  const users = messages.flatMap((message, index) =>
    message?.role === 'user' && message.model_context !== true ? [index] : []);
  if (!Number.isInteger(userTurnIndex) || userTurnIndex !== users.length - 1 || userTurnIndex < 0) {
    throw new Error('Only the latest user turn can be retried.');
  }
  const index = users[userTurnIndex];
  if (hasRecordedFileChanges(messages.slice(index + 1))) {
    throw new Error('A turn with file changes cannot be retried.');
  }
  const user = messages[index];
  return { messages: messages.slice(0, index + 1), user };
}
