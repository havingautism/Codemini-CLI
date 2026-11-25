import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { watchGoalWork } from '../src/core/goal-work.js';
import { getBuiltinTools } from '../src/core/tools.js';

test('等待任务按退避间隔核对活动，出现新进展后重新计算静默检查', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const controller = new AbortController();
  const reports = [];
  let cursor = 0;
  let pause = '';
  await watchGoalWork({ signal: controller.signal, name: '测试进程', intervalMs: 1000,
    inspect: () => ({ cursor }), report: (status, summary) => reports.push({ status, summary }),
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
  assert.match(reports.at(-1).summary, /观察到新的活动/);
  await tick(4000);
  await tick(4000);
  assert.equal(pause, '');
  await tick(4000);
  assert.match(pause, /连续三次.*核对任务输出/);
  assert.equal(reports.length, 6);
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
