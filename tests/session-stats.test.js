import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionStats,
  recordToolEvent,
  truncateErrorMessage,
  truncateErrorDetail,
  getSessionStats,
  getSessionErrorDetails,
  clearSessionErrors,
} from '../src/core/session-stats.js';

test('记录成功工具调用按类型累加计数', () => {
  let stats = createSessionStats();
  stats = recordToolEvent(stats, { type: 'tool:end', name: 'read' });
  stats = recordToolEvent(stats, { type: 'tool:end', name: 'read' });
  stats = recordToolEvent(stats, { type: 'tool:end', name: 'edit' });
  assert.deepEqual(stats.toolCalls, { read: 2, edit: 1 });
  assert.deepEqual(stats.errors, []);
});

test('失败与被拦截也计入计数并进入错误摘要', () => {
  let stats = createSessionStats();
  stats = recordToolEvent(stats, { type: 'tool:error', name: 'run', summary: 'boom' });
  stats = recordToolEvent(stats, { type: 'tool:blocked', name: 'run', summary: 'denied' });
  assert.deepEqual(stats.toolCalls, { run: 2 });
  assert.equal(stats.errors.length, 2);
  assert.equal(stats.errors[0].category, 'error');
  assert.equal(stats.errors[0].tool, 'run');
  assert.equal(stats.errors[1].category, 'blocked');
  assert.equal(stats.errors[1].message, 'denied');
});

test('错误摘要只保留最近 3 条', () => {
  let stats = createSessionStats();
  for (const n of [1, 2, 3, 4, 5]) {
    stats = recordToolEvent(stats, { type: 'tool:error', name: 'run', summary: `err ${n}` });
  }
  assert.equal(stats.errors.length, 3);
  assert.deepEqual(stats.errors.map((e) => e.message), ['err 3', 'err 4', 'err 5']);
});

test('错误消息截断到 100 字以内', () => {
  const long = 'x'.repeat(300);
  assert.equal(truncateErrorMessage(long).length, 100);
  assert.equal(truncateErrorMessage('short'), 'short');
});

test('截断不重写消息内已有的占位符（字节级保留）', () => {
  const msg = 'read failed: [Truncated: 5231 lines omitted]';
  assert.equal(truncateErrorMessage(msg), msg);
});

test('未初始化统计时从空开始', () => {
  const stats = recordToolEvent(undefined, { type: 'tool:end', name: 'read' });
  assert.deepEqual(stats.toolCalls, { read: 1 });
});

test('getSessionStats 对无统计的会话返回空统计', () => {
  assert.deepEqual(getSessionStats(null), createSessionStats());
  assert.deepEqual(getSessionStats({}), createSessionStats());
});

test('完整错误详情保存在 errorDetails，摘要与详情并存', () => {
  let stats = createSessionStats();
  stats = recordToolEvent(stats, {
    type: 'tool:error',
    name: 'run',
    summary: 'short summary',
    detail: 'full stack line 1\nline 2\nline 3',
  });
  assert.equal(stats.errors.length, 1);
  assert.equal(stats.errors[0].message, 'short summary');
  assert.equal(stats.errorDetails.length, 1);
  assert.equal(stats.errorDetails[0].message, 'full stack line 1\nline 2\nline 3');
});

test('无 detail 时完整详情回退到摘要', () => {
  let stats = createSessionStats();
  stats = recordToolEvent(stats, { type: 'tool:error', name: 'run', summary: 'boom' });
  assert.equal(stats.errorDetails[0].message, 'boom');
});

test('完整详情也有界（截断到上限）且最多保留最近 3 条', () => {
  let stats = createSessionStats();
  const long = 'y'.repeat(3000);
  for (const n of [1, 2, 3, 4]) {
    stats = recordToolEvent(stats, { type: 'tool:error', name: 'run', detail: `err ${n} ${long}` });
  }
  assert.equal(stats.errorDetails.length, 3);
  assert.equal(stats.errorDetails[0].message.startsWith('err 2 '), true);
  assert.ok(stats.errorDetails[0].message.length <= 2000);
});

test('truncateErrorDetail 截断到上限', () => {
  assert.equal(truncateErrorDetail('x'.repeat(3000)).length, 2000);
  assert.equal(truncateErrorDetail('short'), 'short');
});

test('getSessionErrorDetails 读取完整详情、对无统计会话返回空数组', () => {
  const session = { stats: recordToolEvent(createSessionStats(), { type: 'tool:error', name: 'run', detail: 'detail' }) };
  assert.equal(getSessionErrorDetails(session).length, 1);
  assert.deepEqual(getSessionErrorDetails(null), []);
});

test('clearSessionErrors 清空摘要与详情但保留工具计数', () => {
  let stats = createSessionStats();
  stats = recordToolEvent(stats, { type: 'tool:end', name: 'read' });
  stats = recordToolEvent(stats, { type: 'tool:error', name: 'run', detail: 'detail' });
  const cleared = clearSessionErrors(stats);
  assert.deepEqual(cleared.errors, []);
  assert.deepEqual(cleared.errorDetails, []);
  assert.equal(cleared.errorCount, 0);
  assert.deepEqual(cleared.toolCalls, { read: 1, run: 1 });
});

test('errorCount 记录本会话失败总数，不受摘要上限约束', () => {
  let stats = createSessionStats();
  for (const n of [1, 2, 3, 4, 5]) {
    stats = recordToolEvent(stats, { type: 'tool:error', name: 'run', summary: `err ${n}` });
  }
  assert.equal(stats.errorCount, 5);
  assert.equal(stats.errors.length, 3);
});
