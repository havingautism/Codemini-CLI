import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGoalLogProgress, watchGoalWork } from '../src/core/goal-work.js';
import { getBuiltinTools } from '../src/core/tools.js';

test('等待任务按退避间隔核对活动，出现新进展后重新计算静默检查', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const controller = new AbortController();
  const reports = [];
  let cursor = 0;
  let pause = '';
  await watchGoalWork({ signal: controller.signal, name: '测试进程', intervalMs: 1000,
    inspect: () => ({ cursor, progress: cursor }), report: (status, summary) => reports.push({ status, summary }),
    pause: reason => { pause = reason; controller.abort(); } });
  async function tick(ms) {
    t.mock.timers.tick(ms);
    await Promise.resolve();
  }
  await tick(1000);
  await tick(1999);
  assert.equal(reports.length, 2);
  cursor++;
  await tick(1);
  assert.match(reports.at(-1).summary, /观察到新的进展/);
  await tick(4000);
  await tick(4000);
  assert.equal(pause, '');
  await tick(4000);
  assert.match(pause, /连续三次.*核对任务输出/);
  assert.equal(reports.length, 6);
});

test('分流拼接完整记录，只在可识别计数超过历史最高值时更新进展', () => {
  const logs = createGoalLogProgress();
  logs.write('stdout', '# pass 1');
  logs.write('stderr', '等待中 2026-01-01\n等待中 2026-01-02\n');
  assert.equal(logs.snapshot().progress, 0);
  logs.write('stdout', '2\n# pass 11\n# pass 12\n');
  assert.deepEqual(logs.snapshot(), { progress: 1, last: '# pass 12' });
  logs.write('stdout', '分片 3/20\r分片 3/20\r分片 2/20\r分片 4/20\r');
  logs.write('stderr', '18 tests passed\n18 tests passed\n');
  logs.write('stdout', '\x1b[32m进度：45%\x1b[0m\r进度：43%\r进度：110%\r');
  assert.deepEqual(logs.snapshot(), { progress: 5, last: '进度：45%' });
  logs.write('stdout', ' '.repeat(2400));
  logs.write('stdout', '1000\n');
  assert.equal(logs.snapshot().progress, 5);
  logs.write('stderr', '已完成3个用例\n已完成3个用例\n');
  assert.deepEqual(logs.snapshot(), { progress: 6, last: '已完成3个用例' });
});

test('重复心跳、递增日志编号和 Unix 时间戳只更新活动，连续无进展时暂停', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const controller = new AbortController();
  const reports = [];
  const logs = createGoalLogProgress();
  let cursor = 1;
  let reason;
  await watchGoalWork({ signal: controller.signal, name: '分片构建', intervalMs: 10,
    inspect: () => ({ cursor, ...logs.snapshot() }), report: (_status, summary) => reports.push(summary),
    pause: message => { reason = message; controller.abort(); } });
  for (const ms of [10, 20, 40]) {
    cursor++;
    logs.write('stdout', `等待中\n${cursor}\n${1700000000 + cursor}\n${1700000000000 + cursor}\n`);
    t.mock.timers.tick(ms);
    await Promise.resolve();
  }
  assert.match(reason, /连续三次.*核对/);
  assert.match(reports.at(-1), /任务仍有活动.*未观察到新的进展/);
});

test('持续推进的任务到达硬等待上限时立即暂停，提前完成会撤销时限', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  for (const complete of [false, true]) {
    const controller = new AbortController();
    let progress = 0;
    let reason;
    const finish = await watchGoalWork({ signal: controller.signal, name: '导出', intervalMs: 10, maxWaitMs: 15,
      inspect: () => ({ progress, cursor: progress }), report: () => {},
      pause: message => { reason = message; controller.abort(); } });
    progress++;
    t.mock.timers.tick(10);
    await Promise.resolve();
    if (complete) await finish('completed', '已交付');
    t.mock.timers.tick(4);
    assert.equal(reason, undefined);
    t.mock.timers.tick(1);
    await Promise.resolve();
    if (complete) assert.equal(reason, undefined);
    else assert.match(reason, /达到等待上限/);
  }
});

test('任务已完成或目标中止后不会再发进度检查或误报卡住', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const aborted of [false, true]) {
    const controller = new AbortController();
    const events = [];
    const finish = await watchGoalWork({ signal: controller.signal, name: '测试任务', intervalMs: 10,
      inspect: () => ({ cursor: 1 }), report: status => events.push(status),
      notifyInterrupted: () => events.push('interrupted'),
      pause: () => assert.fail('任务已结束') });
    if (aborted) controller.abort();
    await finish('completed', '已结束');
    controller.abort();
    t.mock.timers.tick(1000);
    assert.deepEqual(events, ['running', aborted ? 'interrupted' : 'completed']);
  }
});

test('暂停只终止目标正在等待的命令，已就绪的常驻服务可继续使用', { timeout: 15000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-owned-process-'));
  await fs.writeFile(path.join(root, 'serve.cjs'), "console.log('ready-to-use');setTimeout(() => {}, 10000);");
  await fs.writeFile(path.join(root, 'batch.cjs'), "setTimeout(() => console.log('done'), 10000);");
  const shell = process.platform === 'win32' ? 'powershell' : 'bash';
  const config = { shell: { default: shell }, policy: { safe_mode: false }, sandbox: { mode: 'danger-full-access' } };
  const started = Promise.withResolvers();
  const controller = new AbortController();
  const tools = getBuiltinTools({ workspaceRoot: root, config,
    watchGoalShell: async () => { started.resolve(); return () => {}; } });
  let server;
  t.after(async () => {
    controller.abort();
    if (server?.task_id) await tools.handlers.stop_background_task({ task_id: server.task_id });
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const run = tools.handlers[process.platform === 'win32' ? 'Powershell' : 'Bash'];
  server = await run({ command: 'node serve.cjs', run_in_background: true, success_matchers: ['ready-to-use'] },
    { signal: controller.signal });
  assert.equal(server.status, 'running');
  const pending = run({ command: 'node batch.cjs', run_in_background: true }, { signal: controller.signal });
  await started.promise;
  controller.abort();
  const stopped = await pending;
  assert.equal(stopped.aborted, true);
  assert.equal(stopped.failed, true);
  assert.equal((await tools.handlers.get_background_task({ task_id: stopped.completed_task_id })).status, 'stopped');
  assert.equal((await tools.handlers.get_background_task({ task_id: server.task_id })).status, 'running');
});

test('普通会话启动有限后台命令时仍立即拿到任务句柄', { timeout: 15000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-ordinary-process-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await fs.writeFile(path.join(root, 'batch.cjs'), "console.log('batch-started');setTimeout(() => console.log('done'), 600);");
  const shell = process.platform === 'win32' ? 'powershell' : 'bash';
  const { handlers } = getBuiltinTools({ workspaceRoot: root,
    config: { shell: { default: shell }, policy: { safe_mode: false }, sandbox: { mode: 'danger-full-access' } } });
  const task = await handlers[process.platform === 'win32' ? 'Powershell' : 'Bash']({
    command: 'node batch.cjs', run_in_background: true, success_matchers: ['batch-started'],
  });
  assert.equal(task.background, true);
  assert.equal(task.status, 'running');
  let result = task;
  while (result.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 50));
    result = await handlers.get_background_task({ task_id: task.task_id });
  }
  assert.equal(result.exit_code, 0);
});

test('实际后台命令的重复心跳、标准错误与跨块计数分别进入活动和进展', { timeout: 15000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-process-progress-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await fs.writeFile(path.join(root, 'progress.cjs'), [
    "console.log('heartbeat\\nheartbeat');",
    "process.stdout.write('已完成2');",
    "process.stderr.write('shard 2/10\\nshard 2/10\\n');",
    "setTimeout(() => process.stdout.write('3\\n已完成24'), 50);",
  ].join('\n'));
  let snapshot;
  const shell = process.platform === 'win32' ? 'powershell' : 'bash';
  const { handlers } = getBuiltinTools({ workspaceRoot: root,
    config: { shell: { default: shell }, policy: { safe_mode: false }, sandbox: { mode: 'danger-full-access' } },
    watchGoalShell: async (_name, inspect) => () => { snapshot = inspect(); } });
  const result = await handlers[process.platform === 'win32' ? 'Powershell' : 'Bash']({
    command: 'node progress.cjs', run_in_background: true,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(snapshot.cursor > 0);
  assert.equal(snapshot.progress, 3);
  assert.match(snapshot.detail, /最近进展：(?:已完成24|shard 2\/10)/);
});
