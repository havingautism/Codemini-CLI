import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();

export function withTokenUsageSession(sessionId, callback) {
  return context.run({ sessionId: String(sessionId || '') }, callback);
}

export function getTokenUsageSession() {
  return context.getStore()?.sessionId || '';
}
