import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGoalRunner } from '../src/core/goal-runner.js';
import { beginGoalIteration, createGoalState, pauseGoal } from '../src/core/goal-state.js';
import { readTextWindow } from '../src/core/read-window.js';
import { createSession, loadSession, readSessionGoal, saveSessionGoal } from '../src/core/session-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';

const artifact = 'result.txt';
const expectedText = '项目已就绪';
const create = { action: 'create', objective: '检查项目状态文件',
  acceptance: ['result.txt 包含“项目已就绪”'], maxRounds: 1 };
const resume = { action: 'resume', extraRounds: 0 };
const ownerFlag = '--goal-crash-owner';

async function observeFile(workspace, hooks) {
  const call = { toolName: 'read', callId: 'read-result', args: { path: artifact } };
  await hooks.started(call);
  const read = await readTextWindow(path.join(workspace, artifact));
  await hooks.result({ ...call,
    result: { ...read, path: artifact, phase: 'content', content: read.lines[0].text } });
  return { type: 'assistant', text: '已检查项目状态文件。' };
}

function makeRunner(session, execute, requestCompletion, busy = () => false) {
  return createGoalRunner({
    getSession: () => session, workspaceRoot: session.projectDir, busy, execute,
    settings: () => ({ model: 'executor', config: { model: { fast_name: 'reviewer' } }, requestCompletion }),
  });
}

// 只在指定阶段已经写入 SQLite、并且执行或验收实际进入该阶段后，才允许父进程模拟崩溃。
async function startOwner(workspace, phase, repeatRead) {
  process.once('disconnect', () => process.exit(0));
  const session = await createSession(workspace);
  const hold = () => {
    process.send({ sessionId: session.id, pid: process.pid, phase: readSessionGoal(session.id).phase });
    return new Promise(() => {});
  };
  const runner = makeRunner(session, async (_prompt, _event, { goalHooks }) => {
    if (phase === 'executing') {
      if (repeatRead) await observeFile(workspace, goalHooks);
      return hold();
    }
    return observeFile(workspace, goalHooks);
  }, hold);
  const reply = await runner.command(create);
  throw new Error('持有者在预期的中断点之前已退出：' + reply.text);
}

async function checkCrashRecovery(phase, { changeArtifact = false, repeatRead = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-crash-'));
  const workspace = path.join(root, 'project');
  try {
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, artifact), repeatRead ? '项目仍在准备中' : expectedText);
    await withCodeminiGlobalDir(path.join(root, 'global'), async () => {
      const args = [ownerFlag, workspace, phase];
      if (repeatRead) args.push('--repeat-read');
      const owner = fork(import.meta.filename, args, { execArgv: [], windowsHide: true });
      const exited = once(owner, 'exit');
      try {
        const [ready] = await Promise.race([
          once(owner, 'message', { signal: AbortSignal.timeout(30000) }),
          exited.then(([code]) => { throw new Error('持有进程提前结束，退出码 ' + code); }),
        ]);
        assert.equal(ready.pid, owner.pid);
        assert.equal(ready.phase, phase);
        const session = await loadSession(ready.sessionId);
        const before = session.goalState;
        assert.equal(before.status, 'active');
        assert.equal(before.ownerPid, owner.pid);
        assert.equal(before.iteration, 1);
        assert.deepEqual(before.verdicts, []);
        assert.equal(before.observations.length, phase === 'verifying' || repeatRead ? 1 : 0);

        const prompts = [];
        const reviews = [];
        const runner = makeRunner(session, async (prompt, _event, { goalHooks }) => {
          prompts.push(prompt);
          if (repeatRead) await fs.writeFile(path.join(workspace, artifact), expectedText);
          return observeFile(workspace, goalHooks);
        }, async ({ messages }) => {
          const { observations } = JSON.parse(messages.at(-1).content);
          reviews.push(observations);
          return { text: JSON.stringify({ decision: 'completed', reason: '文件内容符合标准。',
            checks: [{ criterionId: 'c1', evidenceIds: observations.map(item => item.id) }] }) };
        });
        for (const command of [{ action: 'status' }, { action: 'pause' }, resume]) {
          await runner.command(command);
          assert.deepEqual(readSessionGoal(session.id), before);
        }
        assert.deepEqual(prompts, []);
        assert.deepEqual(reviews, []);

        assert.equal(owner.kill('SIGKILL'), true);
        await exited;
        assert.deepEqual(readSessionGoal(session.id), before);
        await runner.command({ action: 'status' });
        const paused = readSessionGoal(session.id);
        assert.equal(paused.status, 'paused');
        assert.equal(paused.resumePhase, phase);
        assert.equal(paused.iteration, 1);
        assert.deepEqual(paused.observations, before.observations);
        if (changeArtifact) await fs.writeFile(path.join(workspace, artifact), '项目仍在准备中');
        await runner.command(resume);
        const finished = (await loadSession(session.id)).goalState;
        assert.equal(finished.id, before.id);
        assert.equal(finished.iteration, 1);
        assert.equal(finished.maxIterations, 1);
        assert.equal(finished.ownerPid, undefined);
        assert.equal(finished.verdicts.length, 1);
        assert.equal(finished.verdicts[0].iteration, 1);
        assert.equal(prompts.length, phase === 'executing' ? 1 : 0);
        if (phase === 'executing') assert.match(prompts[0], /恢复/);
        if (changeArtifact) {
          assert.equal(finished.status, 'exhausted');
          assert.equal(finished.verdicts[0].accepted, 'continue');
          assert.deepEqual(reviews, []);
        } else {
          assert.equal(finished.status, 'completed');
          assert.equal(finished.verdicts[0].accepted, 'completed');
          assert.equal(reviews.length, 1);
          assert.equal(reviews[0].length, 1);
          assert.match(reviews[0][0].summary, /项目已就绪/);
          assert.deepEqual(finished.verdicts[0].checks[0].evidenceIds, [finished.observations.at(-1).id]);
          if (phase === 'verifying') assert.deepEqual(finished.observations, before.observations);
          if (repeatRead) {
            const original = before.observations[0];
            const latest = finished.observations.at(-1);
            assert.equal(latest.toolCallId, original.toolCallId);
            assert.notEqual(latest.artifactHash, original.artifactHash);
            assert.notEqual(latest.id, original.id);
          }
        }
      } finally {
        if (owner.connected) owner.disconnect();
        await exited;
      }
    });
  } finally {
    closeSqliteDatabasesForTests(root);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.send && process.argv[2] === ownerFlag) {
  await startOwner(process.argv[3], process.argv[4], process.argv[5] === '--repeat-read');
} else {
  test('跨进程：执行中崩溃后在同一轮取得证据并完成', () => checkCrashRecovery('executing'));
  test('跨进程：验收中崩溃后复用证据，仅重新验收', () => checkCrashRecovery('verifying'));
  test('跨进程：验收中崩溃后文件已变，旧证据无法完成目标', () => checkCrashRecovery('verifying', { changeArtifact: true }));
  test('跨进程：执行恢复后重用工具调用编号，采纳修复后重新读取的证据', () => checkCrashRecovery('executing', { repeatRead: true }));

  test('提取自然目标时暂停，重开后重新提取并从第一轮执行', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-infer-'));
    t.after(async () => {
      closeSqliteDatabasesForTests(root);
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
    });
    await withCodeminiGlobalDir(path.join(root, '.codemini'), async () => {
      const session = await createSession(root);
      const entered = Promise.withResolvers();
      const first = makeRunner(session, () => assert.fail('提取期间不应开始执行'), async ({ signal }) => {
        entered.resolve();
        await once(signal, 'abort');
        return { text: '{}' };
      });
      const running = first.command({ ...create, criteriaPending: 'infer' });
      await entered.promise;
      await first.command({ action: 'pause' });
      await running;
      const saved = await loadSession(session.id);
      assert.equal(saved.goalState.iteration, 0);
      assert.equal(saved.goalState.criteriaPending, 'infer');
      assert.equal(saved.goalState.resumePhase, 'ready');

      await fs.writeFile(path.join(root, artifact), expectedText);
      const second = makeRunner(saved, (_prompt, _event, { goalHooks }) => observeFile(root, goalHooks),
        async ({ messages }) => {
          const input = JSON.parse(messages.at(-1).content);
          if (!input.observations) return { text: JSON.stringify({ criteria: [{ text: create.acceptance[0], evidence: 'workspace' }] }) };
          return { text: JSON.stringify({ decision: 'completed', reason: '文件内容已核对。',
            checks: [{ criterionId: 'c1', evidenceIds: [input.observations[0].id] }] }) };
        });
      await second.command(resume);
      const finished = readSessionGoal(session.id);
      assert.equal(finished.status, 'completed');
      assert.equal(finished.iteration, 1);
      assert.equal(finished.criteriaPending, undefined);
    });
  });

  test('两个实例同时恢复同一版本，竞争方返回当前进度且只有一份验收记录', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-race-'));
    t.after(async () => {
      closeSqliteDatabasesForTests(root);
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
    });
    await withCodeminiGlobalDir(path.join(root, '.codemini'), async () => {
      const first = await createSession(root);
      const goal = createGoalState({ objective: create.objective, criteria: create.acceptance, maxIterations: 1 });
      const paused = saveSessionGoal(first, pauseGoal(beginGoalIteration(goal)));
      const second = await loadSession(first.id);
      const release = Promise.withResolvers();
      let winnerTask;
      let executions = 0;
      const execute = () => {
        executions++;
        return { type: 'assistant', text: '仍需核对。' };
      };
      const winner = makeRunner(first, async () => {
        await release.promise;
        return execute();
      });
      const contender = makeRunner(second, execute, undefined, () => {
        // 此时竞争方已读取暂停版本。让另一实例先写入 SQLite，再让竞争方提交同一版本。
        winnerTask = winner.command(resume);
        return false;
      });
      try {
        const reply = await contender.command(resume);
        const active = readSessionGoal(first.id);
        assert.equal(reply.type, 'system');
        assert.match(reply.text, /进行中/);
        assert.match(reply.text, /轮次：1\/1/);
        assert.equal(active.version, paused.version + 1);
        assert.equal(active.status, 'active');
        assert.deepEqual(second.goalState, active);
      } finally {
        release.resolve();
        await winnerTask;
      }
      const finished = readSessionGoal(first.id);
      assert.equal(executions, 1);
      assert.equal(finished.id, paused.id);
      assert.equal(finished.iteration, 1);
      assert.equal(finished.status, 'exhausted');
      assert.deepEqual(finished.verdicts.map(item => item.accepted), ['continue']);
    });
  });
}
