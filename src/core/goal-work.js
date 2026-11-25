import { stripVTControlCharacters } from 'node:util';

// 只识别完整的计数记录，同一个计数器倒退或重播时保留原来的最高值。
const COUNTERS = [
  /^(?:\[|(?:分片|步骤|用例|shard|step|tests?)\s*[:：#]?\s*)?(\d+)\s*\/\s*(\d+)(?:\]|$|\s)/iu,
  /^(?:(?:进度|progress)\s*[:：]?\s*)?(\d+(?:\.\d+)?)\s*%$/iu,
  /^ok\s+(\d+)(?:$|\s)/iu,
  /^#\s*pass\s+(\d+)$/iu,
  /^已完成\s*(\d+)\s*(?:个?用例|个?分片|个?步骤)?$/u,
  /^(\d+)\s*(?:tests? passed|passed|个?用例(?:已)?通过)$/iu,
];

export function createGoalLogProgress() {
  const highest = new Map();
  const pending = new Map();
  let progress = 0;
  let last = '';
  function observe(raw) {
    const line = stripVTControlCharacters(raw).trim();
    for (const pattern of COUNTERS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const value = Number(match[1]);
      if (!Number.isFinite(value) || (match[2] && value > Number(match[2])) || (line.endsWith('%') && value > 100)) return;
      if (value > (highest.get(pattern) ?? -1)) {
        highest.set(pattern, value);
        progress++;
        last = line.slice(0, 150);
      }
      return;
    }
  }
  return {
    write(stream, text) {
      const lines = text.split(/[\r\n]/u);
      let partial = pending.get(stream) ?? '';
      for (let i = 0; i < lines.length; i++) {
        // 超长记录丢弃至下一行，防止截断的后半行被误识别为独立计数。
        if (partial !== false) partial = partial.length + lines[i].length > 2048 ? false : partial + lines[i];
        if (i === lines.length - 1) break;
        if (partial !== false) observe(partial);
        partial = '';
      }
      pending.set(stream, partial);
    },
    snapshot: () => ({ progress, last }),
  };
}

// 长任务由完成事件唤醒。定时器检查进展并上报仍有活动的任务，不消耗模型轮次。
export async function watchGoalWork({ signal, name, inspect, report, pause, notifyInterrupted, maxWaitMs, intervalMs = 30 * 60_000 }) {
  const startedAt = Date.now();
  let previous = inspect();
  let quietChecks = 0;
  let delay = intervalMs;
  let timer;
  let closed = false;
  function close() {
    closed = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', interrupt);
  }
  function interrupt() {
    close();
    // 暂停时状态机统一写入 interrupted；这里只通知等待中的界面。
    notifyInterrupted?.();
  }
  function schedule() {
    const nextCheck = maxWaitMs == null ? delay : Math.min(delay, Math.max(0, maxWaitMs - (Date.now() - startedAt)));
    timer = setTimeout(() => check().catch(error => {
      if (!closed) pause('无法检查' + name + '的等待状态：' + error.message);
    }), nextCheck);
    timer.unref?.();
  }
  async function check() {
    if (closed) return;
    const elapsedMs = Date.now() - startedAt;
    if (maxWaitMs != null && elapsedMs >= maxWaitMs) {
      await pause(`${name}已达到等待上限 ${maxWaitMs / 1000} 秒。请核对任务输出，再用 /goal resume 继续。`);
      return;
    }
    const snapshot = inspect();
    const progressed = snapshot.progress !== previous.progress;
    const active = snapshot.cursor !== previous.cursor;
    previous = snapshot;
    quietChecks = progressed ? 0 : quietChecks + 1;
    const elapsed = Math.floor(elapsedMs / 1000);
    const detail = progressed ? '观察到新的进展。' : active ? '任务仍有活动，本次未观察到新的进展。' : '本次未观察到新的进展，任务仍在等待。';
    await report('running', `已等待 ${elapsed} 秒。${detail}${snapshot.detail || ''}`);
    if (closed) return;
    if (quietChecks >= 3) {
      await pause(name + '连续三次检查没有可观察的新进展。请核对任务输出，再用 /goal resume 继续。');
      return;
    }
    delay = Math.min(delay * 2, 4 * intervalMs);
    schedule();
  }
  if (!signal.aborted) {
    signal.addEventListener('abort', interrupt, { once: true });
    try {
      await report('running', '等待任务完成。' + (previous.detail || ''));
      if (!closed) schedule();
    } catch (error) {
      close();
      throw error;
    }
  } else close();
  return async (status, summary, details) => {
    if (closed) return;
    close();
    await report(status, summary, details);
  };
}
