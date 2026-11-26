import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();

export function withTokenUsageSession(sessionId, callback) {
  return context.run({ ...context.getStore(), sessionId: String(sessionId || '') }, callback);
}

// 子代理可以切换会话，仍继承发起它的目标计量；其他并行会话互不影响。
export function withGoalUsageMeter(meter, callback) {
  return context.run({ ...context.getStore(), goalMeter: meter }, callback);
}

export function getGoalUsageMeter() {
  return context.getStore()?.goalMeter;
}

export function getTokenUsageSession() {
  return context.getStore()?.sessionId || '';
}
