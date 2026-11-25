import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GOAL_COMMAND, isImmediateGoalControl, parseGoalCommand } from '../src/core/goal-command.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createWebRuntimeApi } from '../codemini-web/server.js';

test('目标命令保留多行正文、引号和顺序，并解析验证清单与轮数', () => {
  const command = parseGoalCommand('/goal 目标：修复导出 "A B"\n第二段\n验收条件：\n1. 文件名完整；数据正确\n- 空表可导出\n约束：保留 API\n轮数：2');
  assert.deepEqual(command, {
    action: 'create', objective: '修复导出 "A B"\n第二段',
    acceptance: ['文件名完整', '数据正确', '空表可导出'], constraints: ['保留 API'], maxRounds: 2,
  });
  assert.equal(parseGoalCommand('/goal 修复导出 验收：回归通过').maxRounds, 5);
  assert.equal(GOAL_COMMAND.kind, 'command');
  assert.equal(parseGoalCommand('/goal-other'), null);
});

test('目标命令引导补充验收，拒绝错误预算，并区分可立即执行的控制', () => {
  assert.match(parseGoalCommand('/goal 修复导出').message, /验收/);
  assert.match(parseGoalCommand('/goal 验收：测试通过').message, /目标/);
  assert.deepEqual(parseGoalCommand('/goal status'), { action: 'status' });
  assert.deepEqual(parseGoalCommand('/goal pause'), { action: 'pause' });
  assert.deepEqual(parseGoalCommand('/goal resume'), { action: 'resume' });
  assert.deepEqual(parseGoalCommand('/goal resume +2'), { action: 'resume', extraRounds: 2 });
  for (const invalid of ['0', '-2', '1.5', '101']) {
    assert.equal(parseGoalCommand(`/goal 导出 验收：文件正确 轮数：${invalid}`).action, 'error');
    assert.equal(parseGoalCommand(`/goal resume ${invalid}`).action, 'error');
  }
  assert.ok(isImmediateGoalControl(' /goal '));
  assert.ok(isImmediateGoalControl('/goal pause'));
  assert.equal(isImmediateGoalControl('/goal resume'), false);
  assert.equal(isImmediateGoalControl('/goal pause 有参数'), false);
});

test('运行中的 Web 会话可独立查询和暂停，创建或恢复必须走普通回合入口', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-api-'));
  const old = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  t.after(async () => {
    closeSqliteDatabasesForTests(dir);
    if (old === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = old;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const received = [];
  const bridge = { handleGoalControl(text) { received.push(text); return { type: 'system', text: '当前目标' }; } };
  const handle = createWebRuntimeApi({
    pool: { entries: new Map([['active', { bridge }]]) },
    ensureSession: async (id) => assert.equal(id, 'active'),
  });
  const request = async (text) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ sessionId: 'active', text }))]);
    Object.assign(req, { method: 'POST', url: '/api/chat/goal/control', headers: {} });
    let status, body;
    const res = { writeHead(code) { status = code; }, end(data) { body = JSON.parse(data); } };
    assert.equal(await handle(req, res), true);
    return { status, body };
  };
  for (const text of ['/goal', '/goal pause']) {
    const response = await request(text);
    assert.equal(response.status, 200);
    assert.equal(response.body.text, '当前目标');
  }
  assert.equal((await request('/goal resume')).status, 400);
  assert.equal((await request('/goal 执行 验收：检查')).status, 400);
  assert.deepEqual(received, ['/goal', '/goal pause']);
});
