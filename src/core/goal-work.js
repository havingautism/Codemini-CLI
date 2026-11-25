// 长任务由完成事件唤醒。定时器只检查是否仍有可观察的活动，不消耗模型轮次。
export async function watchGoalWork({ signal, name, inspect, report, pause, notifyInterrupted, intervalMs = 30 * 60_000 }) {
  const startedAt = Date.now();
  let cursor = inspect().cursor;
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
    timer = setTimeout(() => check().catch(error => {
      if (!closed) pause('无法检查' + name + '的等待状态：' + error.message);
    }), delay);
    timer.unref?.();
  }
  async function check() {
    if (closed) return;
    const snapshot = inspect();
    const progressed = snapshot.cursor !== cursor;
    cursor = snapshot.cursor;
    quietChecks = progressed ? 0 : quietChecks + 1;
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const detail = progressed ? '观察到新的活动。' : '本次检查没有观察到新的活动。';
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
      await report('running', '等待任务完成。' + (inspect().detail || ''));
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
