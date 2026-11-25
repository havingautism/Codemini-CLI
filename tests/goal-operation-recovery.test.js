import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isReplayableShellQuery } from '../src/core/command-risk.js';
import { parseGoalCommand } from '../src/core/goal-command.js';
import { createGoalRunner } from '../src/core/goal-runner.js';
import { closeMcpClient, getMcpToolBundle } from '../src/core/mcp-client.js';
import { createSession, loadSession, readSessionGoal } from '../src/core/session-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createToolRuntime } from '../src/core/tool-runtime.js';
import { getBuiltinTools } from '../src/core/tools.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';

const ownerFlag = '--goal-operation-owner';
const tool = 'mcp__tickets__create';
const args = { title: '工单正文不应持久化到操作记录' };
const create = { action: 'create', objective: '创建工单并答复', acceptance: [{ text: '答复工单状态', evidence: 'reply' }], maxRounds: 1 };

function makeRunner(session, execute) {
  return createGoalRunner({ getSession: () => session, workspaceRoot: session.projectDir, busy: () => false, execute,
    settings: () => ({ model: '执行', config: { model: { fast_name: '验收' } }, requestCompletion: async ({ messages }) => {
      const packet = JSON.parse(messages.at(-1).content);
      return { text: JSON.stringify({ decision: 'completed', reason: '已交付回复。',
        checks: [{ criterionId: 'c1', evidenceIds: packet.observations.map(obs => obs.id) }] }) };
    } }) });
}

function mcpRuntime(url) {
  return createToolRuntime(getMcpToolBundle({ mcp: { servers: [{ id: 'tickets', transport: 'http', url,
    cachedTools: [{ name: 'create', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }] }] } }));
}

async function runOwner(workspace, url) {
  process.once('disconnect', () => process.exit(0));
  const session = await createSession(workspace);
  process.send({ sessionId: session.id });
  const runtime = mcpRuntime(url);
  const runner = makeRunner(session, async () => {
    await runtime.execute(tool, args, { toolCallId: 'first', workspaceRoot: workspace });
    process.send({ receipted: true });
    return new Promise(() => {});
  });
  throw new Error('持有进程提前结束：' + (await runner.command(create)).text);
}

async function checkFailureWindow(t, point, resolution) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-operation-'));
  t.after(async () => {
    await closeMcpClient('tickets');
    closeSqliteDatabasesForTests(root);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const effects = [];
  const applied = Promise.withResolvers();
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body);
    if (rpc.id == null) { res.writeHead(202).end(); return; }
    let result;
    if (rpc.method === 'initialize') {
      result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: '工单', version: '1' } };
    } else if (rpc.method === 'tools/call') {
      effects.push(rpc.params);
      applied.resolve();
      if (point === 'pending' && effects.length === 1) return;
      result = { content: [{ type: 'text', text: '已受理' }], structuredContent: { id: effects.length } };
    } else throw new Error('未预期的请求：' + rpc.method);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  await withCodeminiGlobalDir(path.join(root, 'global'), async () => {
    const owner = fork(import.meta.filename, [ownerFlag, root, url], { execArgv: [], windowsHide: true });
    const exited = once(owner, 'exit');
    try {
      const [ready] = await once(owner, 'message', { signal: AbortSignal.timeout(15000) });
      const receipted = point === 'returned' && once(owner, 'message', { signal: AbortSignal.timeout(15000) });
      await Promise.race([applied.promise, exited.then(() => { throw new Error('工单提交前持有进程退出'); })]);
      if (receipted) assert.equal((await receipted)[0].receipted, true);
      const before = readSessionGoal(ready.sessionId);
      assert.equal(before.operations.length, 1);
      const [op] = before.operations;
      assert.equal(op.status, point);
      assert.equal(op.callId, 'first');
      assert.ok(!JSON.stringify(op).includes(args.title));
      if (point === 'returned') assert.match(op.summary, /ID 1/);
      owner.kill('SIGKILL');
      await exited;

      const session = await loadSession(ready.sessionId);
      const runtime = mcpRuntime(url);
      let executions = 0;
      const runner = makeRunner(session, async () => {
        executions++;
        const submit = () => runtime.execute(tool, args, { toolCallId: 'new-provider-id', workspaceRoot: path.join(root, 'worker') });
        if (resolution === 'retry') await submit();
        else await assert.rejects(submit, /已有记录/);
        return { type: 'assistant', text: '工单已受理。' };
      });
      if (point === 'pending') {
        for (const command of ['/goal resume', '/goal resume', '/goal edit 重新创建工单', '/goal clear']) {
          const response = await runner.command(parseGoalCommand(command));
          assert.ok(response.text.includes('/goal resolve ' + op.id));
          assert.equal(executions, 0);
          assert.equal(effects.length, 1);
        }
        await runner.command(parseGoalCommand(`/goal resolve ${op.id} ${resolution}`));
      }
      const finished = await runner.command(parseGoalCommand('/goal resume'));
      assert.equal(session.goalState.status, 'completed', finished.text);
      assert.equal(executions, 1);
      assert.equal(effects.length, resolution === 'retry' ? 2 : 1);
      if (resolution === 'retry') assert.notEqual(session.goalState.operations[1].id, op.id);
    } finally {
      if (owner.connected) owner.kill('SIGKILL');
      await exited;
    }
  });
}

if (process.send && process.argv[2] === ownerFlag) {
  await runOwner(process.argv[3], process.argv[4]);
} else {
  test('外部 MCP 已写入、回执前真实杀进程，连续恢复及修改无法重发，核实后接续', { timeout: 30000 }, t => checkFailureWindow(t, 'pending', 'done'));
  test('回执缺失时用户明确允许再次提交，产生新的操作号', { timeout: 30000 }, t => checkFailureWindow(t, 'pending', 'retry'));
  test('回执写入后真实杀进程，恢复时更换调用编号也不会重发', { timeout: 30000 }, t => checkFailureWindow(t, 'returned'));
  test('可重复查询仅接受完整的只读命令，未知选项、复合命令与后台探测仍须对账', () => {
    for (const command of ['git status --short', 'git --no-pager diff --name-status -- src/main.js', 'git ls-files', 'pwd']) {
      assert.equal(isReplayableShellQuery({ command }), true, command);
    }
    for (const command of ['git status && git push', 'git status > out.txt', 'git status | cmd', 'git status; git commit',
      'git status\ngit push', 'git diff --output=out.txt', 'git diff --ext-diff', 'git diff --textconv', 'git -c diff.external=helper diff',
      'git diff --name-only -- $(script)', 'git commit', 'custom-inspector']) {
      assert.equal(isReplayableShellQuery({ command }), false, command);
    }
    assert.equal(isReplayableShellQuery({ command: 'git status', httpProbe: { url: 'http://localhost/' } }), false);
  });
  test('真实 Shell 暂停重开后重查新文件，忽略的 cwd/workdir 不能绕开写入收据', { timeout: 30000 }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-recheck-'));
    const workspace = path.join(root, 'project');
    await fs.mkdir(workspace);
    execFileSync('git', ['init', '--quiet'], { cwd: workspace, windowsHide: true });
    await fs.writeFile(path.join(workspace, 'tracked.txt'), '验收基准\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: workspace, windowsHide: true, stdio: 'ignore' });
    await fs.writeFile(path.join(workspace, 'tracked.txt'), '尚待修复\n');
    const shell = process.platform === 'win32' ? 'powershell' : 'bash';
    const echoServer = { id: 'recheck', command: process.execPath, args: [path.join(import.meta.dirname, 'fixtures', 'mcp-echo-server.js')],
      cachedTools: [{ name: 'echo', annotations: { readOnlyHint: true } }] };
    const bundle = getBuiltinTools({ workspaceRoot: workspace, config: {
      shell: { default: shell, timeout_ms: 5000 }, sandbox: { mode: 'danger-full-access' },
      policy: { safe_mode: false }, mcp: { servers: [echoServer] },
    } });
    const runtime = createToolRuntime(bundle);
    const name = bundle.definitions.find(def => /^(Bash|Powershell)$/iu.test(def.function.name)).function.name;
    const query = () => runtime.execute(name, { command: 'git status --short' });
    const check = () => runtime.execute(name, { command: 'git diff --quiet -- tracked.txt' });
    const mcpQuery = () => runtime.execute('mcp__recheck__echo', { value: '已检查' });
    const write = { command: 'git status --short >> result.txt' };
    t.after(async () => {
      await closeMcpClient(echoServer.id);
      await bundle.dispose();
      closeSqliteDatabasesForTests(root);
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
    });
    await withCodeminiGlobalDir(path.join(root, 'global'), async () => {
      const session = await createSession(workspace);
      const observed = Promise.withResolvers();
      const first = makeRunner(session, async (_prompt, _event, { signal }) => {
        assert.doesNotMatch((await query()).stdout, /after-pause/);
        assert.equal((await check()).code, 1);
        assert.equal((await mcpQuery()).content[0].text, 'echo:已检查');
        await runtime.execute(name, write, { workspaceRoot: workspace, toolCallId: 'write' });
        observed.resolve();
        await once(signal, 'abort');
        return { type: 'assistant', aborted: true, text: '' };
      });
      const running = first.command(create);
      await Promise.race([observed.promise, running.then(answer => assert.fail(answer.text))]);
      await first.command({ action: 'pause' });
      await running;
      const paused = await loadSession(session.id);
      assert.equal(paused.goalState.operations.length, 1);
      await fs.writeFile(path.join(workspace, 'after-pause.txt'), '新文件');
      await fs.writeFile(path.join(workspace, 'tracked.txt'), '验收基准\n');
      const originalOutput = await fs.readFile(path.join(workspace, 'result.txt'));
      const second = makeRunner(paused, async () => {
        assert.match((await query()).stdout, /after-pause/);
        assert.equal((await check()).code, 0);
        assert.equal((await mcpQuery()).content[0].text, 'echo:已检查');
        for (const extra of [{ cwd: '.' }, { workdir: 'ignored' }]) {
          await assert.rejects(runtime.execute(name, { ...write, ...extra }, { workspaceRoot: root }), /已有记录/);
        }
        return { type: 'assistant', text: '已检查最新文件。' };
      });
      const result = await second.command({ action: 'resume' });
      assert.equal(paused.goalState.status, 'completed', result.text);
      assert.equal(paused.goalState.operations.length, 1);
      assert.deepEqual(await fs.readFile(path.join(workspace, 'result.txt')), originalOutput);
    });
  });
  test('Shell 批准后的重复调用各自记账，普通会话及本地读取仍沿用各自入口', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-shell-'));
    t.after(async () => {
      closeSqliteDatabasesForTests(root);
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
    });
    await withCodeminiGlobalDir(path.join(root, 'global'), async () => {
      const session = await createSession(root);
      let calls = 0;
      const runtime = createToolRuntime({ handlers: {
        read: async () => '内容',
        Powershell: async (_args, ctx) => {
          calls++;
          if (ctx.toolCallId) {
            const op = readSessionGoal(session.id).operations.at(-1);
            assert.equal(op.status, 'pending');
            assert.equal(op.callId, ctx.toolCallId);
          }
          return { code: 0, stdout: '私有输出' };
        },
      } });
      const shellArgs = { command: 'gh issue create --title 敏感参数' };
      const runner = makeRunner(session, async () => {
        await runtime.execute('read', {});
        assert.deepEqual(session.goalState.operations, []);
        for (const toolCallId of ['A', 'B']) await runtime.execute('Powershell', shellArgs, { toolCallId });
        return { type: 'assistant', text: '工单已受理。' };
      });
      await runner.command(create);
      assert.equal(session.goalState.status, 'completed');
      const ops = readSessionGoal(session.id).operations;
      assert.equal(ops.length, 2);
      assert.notEqual(ops[0].id, ops[1].id);
      assert.equal(ops[0].key, ops[1].key);
      assert.equal(ops[1].summary, '退出码 0');
      assert.equal(ops[1].label, 'Powershell gh issue create');
      assert.doesNotMatch(JSON.stringify(ops), /敏感参数|私有输出/);
      await runtime.execute('Powershell', shellArgs);
      assert.deepEqual(readSessionGoal(session.id).operations, ops);
      assert.equal(calls, 3);
    });
  });
}
