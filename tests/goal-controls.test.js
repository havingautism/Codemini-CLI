import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isImmediateGoalControl, parseGoalCommand } from '../src/core/goal-command.js';
import { createGoalRunner } from '../src/core/goal-runner.js';
import { beginGoalIteration, createGoalState, markGoalVerifying, pauseGoal, recordGoalObservation } from '../src/core/goal-state.js';
import { createGoalEvidenceCollector } from '../src/core/goal-verification.js';
import { readTextWindow } from '../src/core/read-window.js';
import { createSession, loadSession, readSessionGoal, saveSession, saveSessionGoal } from '../src/core/session-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';

async function withSession(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-controls-'));
  try {
    await withCodeminiGlobalDir(root, async () => {
      const session = await createSession(root);
      await run(session);
    });
  } finally {
    closeSqliteDatabasesForTests(root);
    await fs.rm(root, { recursive: true, force: true });
  }
}

function makeRunner(session, execute, review) {
  const requestCompletion = ({ messages, model }) => {
    const packet = JSON.parse(messages.at(-1).content);
    if (model === '验收') {
      if (review) return review(packet);
      return { text: JSON.stringify({ decision: 'completed', reason: '已核对正文。', checks: [
        { criterionId: 'c1', evidenceIds: [packet.observations.at(-1).id] },
      ] }) };
    }
    const classify = messages[0].content.includes('原始 id');
    return { text: JSON.stringify({ criteria: [classify ? { id: 'c1', evidence: 'reply' }
      : { text: packet.objective, evidence: 'reply' }] }) };
  };
  return createGoalRunner({
    getSession: () => session, workspaceRoot: session.projectDir, busy: () => false, execute,
    settings: () => ({ model: '执行', config: { model: { fast_name: '验收' } }, requestCompletion }),
  });
}

for (const owner of ['主代理', '子代理']) {
  test(owner + '领取后继任务前刷新工作区，并利用新证据复验前置交付', async () => {
    await withSession(async session => {
      const workspace = path.join(session.projectDir, 'workspace');
      await fs.mkdir(workspace);
      session.projectDir = workspace;
      const file = path.join(workspace, 'config.txt');
      await fs.writeFile(file, 'ready');
      let checked = false;
      const runner = makeRunner(session, async (_instruction, _event, { goalHooks: hooks }) => {
        const observe = async callId => {
          const read = await readTextWindow(file);
          const event = { toolName: 'read', callId, args: { path: file, criterion_ids: ['c1'] } };
          await hooks.started(event);
          await hooks.result({ ...event, result: { ...read, path: file, content: read.lines[0].text, phase: 'content' } });
        };
        await hooks.updatePlan({ tasks: [
          { id: 'A', title: '核对配置', criterion_ids: ['c1'] },
          { id: 'B', title: '交付结果', depends_on: ['A'] },
        ], main_task: { id: 'A', action: 'start' } });
        await observe('first-read');
        await hooks.updatePlan({ main_task: { id: 'A', action: 'deliver' } });
        assert.equal(session.goalState.tasks[0].status, 'verified');
        await fs.writeFile(file, 'broken');
        const event = { toolName: 'run_subagent', callId: 'worker-B', args: { goal_task_id: 'B', prompt: '交付' } };
        const claim = () => owner === '子代理' ? hooks.started(event) : hooks.updatePlan({ main_task: { id: 'B', action: 'start' } });
        await assert.rejects(claim, /前置/);
        assert.equal(session.goalState.tasks[1].attempts.length, 0);
        assert.equal(session.goalState.tasks[0].status, 'delivered');
        await fs.writeFile(file, 'ready-again');
        await observe('fresh-read');
        await claim();
        assert.equal(session.goalState.tasks[0].status, 'verified');
        assert.equal(session.goalState.tasks[0].attempts.length, 1);
        if (owner === '子代理') await hooks.result({ ...event, result: { ok: true } });
        else await hooks.updatePlan({ main_task: { id: 'B', action: 'deliver' } });
        checked = true;
        return { type: 'assistant', text: '配置核对完毕。' };
      }, packet => {
        const observed = packet.observations.findLast(item => item.artifactPath === 'config.txt' && item.summary.includes('ready'));
        return { text: JSON.stringify({ decision: observed ? 'completed' : 'continue', reason: '按当前文件内容核对。',
          checks: [{ criterionId: 'c1', evidenceIds: observed ? [observed.id] : [] }] }) };
      });
      const result = await runner.command({ action: 'create', objective: '核对配置并安排交付',
        acceptance: [{ id: 'c1', text: '配置内容为就绪状态', evidence: 'workspace' }] });
      assert.ok(checked, result.text);
      assert.equal(session.goalState.status, 'completed', result.text);
    });
  });
}

test('清除和编辑是控制命令，预算仅接受正安全整数', () => {
  assert.deepEqual(parseGoalCommand('/goal clear'), { action: 'clear' });
  assert.equal(parseGoalCommand('/goal edit').action, 'error');
  assert.equal(parseGoalCommand('/goal edit 改目标').action, 'edit');
  assert.ok(isImmediateGoalControl('/goal edit 改目标\n验收：有完整答复'));
  assert.ok(isImmediateGoalControl('/goal clear'));
  for (const key of ['Token预算', 'TOKEN预算', '令牌预算']) {
    assert.equal(parseGoalCommand('/goal 工作 ' + key + '：123').tokenBudget, 123);
    assert.equal(parseGoalCommand('/goal edit 工作 ' + key + '：125').tokenBudget, 125);
  }
  for (const value of ['0', '-1', '5.5', '9007199254740992']) {
    assert.equal(parseGoalCommand('/goal 工作 Token预算：' + value).action, 'error');
    assert.equal(parseGoalCommand('/goal resume --add-tokens ' + value).action, 'error');
  }
  assert.deepEqual(parseGoalCommand('/goal resume --add-tokens 10000'), { action: 'resume', extraTokens: 10000 });
  assert.deepEqual(parseGoalCommand('/goal resume +2 --add-tokens 10000'), { action: 'resume', extraRounds: 2, extraTokens: 10000 });
});

test('等待上限在会话重开后仍约束新委派，限时暂停不消耗下一轮', async (t) => {
  for (const [value, ms] of [['2秒', 2000], ['15分钟', 900000], ['1小时', 3600000]]) {
    assert.equal(parseGoalCommand('/goal 构建 等待上限：' + value).maxWaitMs, ms);
  }
  for (const value of ['0秒', '-1秒', '30', '1.2分钟', '9007199254740992小时']) {
    assert.equal(parseGoalCommand('/goal 构建 等待上限：' + value).action, 'error');
  }
  await withSession(async (session) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    for (const resume of [false, true]) {
      const ready = Promise.withResolvers();
      const runner = makeRunner(resume ? await loadSession(session.id) : session, async (_prompt, _onEvent, { goalHooks, signal }) => {
        if (resume) await goalHooks.started({ toolName: 'run_subagent', args: { name: '检查分片' }, callId: 'resumed-child' });
        else await goalHooks.watchShell('后台命令 构建', () => ({ cursor: 0, progress: 0 }));
        const interrupted = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        ready.resolve();
        await interrupted;
        return { type: 'assistant', aborted: true, text: '已中断' };
      });
      const run = runner.command(parseGoalCommand(resume ? '/goal resume' : '/goal 输出构建结果 等待上限：1秒'));
      await ready.promise;
      t.mock.timers.tick(999);
      assert.equal(readSessionGoal(session.id).status, 'active');
      t.mock.timers.tick(1);
      await run;
      const goal = readSessionGoal(session.id);
      assert.equal(goal.maxWaitMs, 1000);
      assert.equal(goal.iteration, 1);
      assert.equal(goal.status, 'paused');
      assert.match(goal.reason, /达到等待上限 1 秒/);
      assert.match(goal.reason, resume ? /检查分片/ : /后台命令/);
    }
  });
});

test('运行中连续补充会取消旧执行，原调用按最终要求接续并废弃旧交接', async () => {
  await withSession(async (session) => {
    const first = Promise.withResolvers();
    const release = Promise.withResolvers();
    const prompts = [];
    const runner = makeRunner(session, async (prompt, _onEvent, { goalHooks }) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        const event = { toolName: 'run_subagent', args: { name: '旧子任务' }, callId: 'old-child' };
        await goalHooks.started(event);
        first.resolve();
        await release.promise;
        await goalHooks.result({ ...event, result: { ok: true } });
        return { type: 'assistant', text: '旧结果' };
      }
      return { type: 'assistant', text: '新结果' };
    });
    const run = runner.command(parseGoalCommand('/goal 输出文字 轮数：1'));
    await first.promise;
    const original = readSessionGoal(session.id);
    assert.equal(original.delegations.length, 1);
    await runner.command({ action: 'steer', text: '使用中文' });
    await runner.command({ action: 'steer', text: '只需一行' });
    const revised = readSessionGoal(session.id);
    assert.match(revised.objective, /输出文字[\s\S]+使用中文[\s\S]+只需一行/);
    assert.notEqual(revised.id, original.id);
    assert.deepEqual(revised.delegations, []);
    release.resolve();
    assert.match((await run).text, /新结果/);
    const goal = readSessionGoal(session.id);
    assert.equal(prompts.length, 2);
    assert.equal(goal.status, 'completed');
    assert.equal(goal.iteration, 1);
    assert.equal(goal.report, '新结果');
    assert.deepEqual(goal.delegations, []);
  });
});

test('正在验收时编辑会重新执行，过期的完成判定不会写到新目标', async () => {
  await withSession(async (session) => {
    const waiting = Promise.withResolvers();
    const release = Promise.withResolvers();
    const reviews = [];
    const runner = makeRunner(session, async (prompt) => ({ type: 'assistant', text: prompt }), async (packet) => {
      const goal = packet.objective;
      reviews.push(goal);
      if (reviews.length === 1) { waiting.resolve(); await release.promise; }
      return { text: JSON.stringify({ decision: 'completed', reason: goal, checks: [
        { criterionId: 'c1', evidenceIds: [packet.observations.at(-1).id] },
      ] }) };
    });
    const run = runner.command(parseGoalCommand('/goal 写第一版'));
    await waiting.promise;
    const changed = await runner.command(parseGoalCommand('/goal edit 写第二版 验收：回复有第二版'));
    assert.match(changed.text, /已修改/);
    release.resolve();
    await run;
    const done = readSessionGoal(session.id);
    assert.deepEqual(reviews, ['写第一版', '写第二版']);
    assert.equal(done.status, 'completed');
    assert.equal(done.verdicts.length, 1);
    assert.equal(done.verdicts[0].reason, '写第二版');
    assert.equal(done.criteria[0].text, '回复有第二版');
  });
});

test('活动目标清除后，迟到的回复、旧会话写入及重开均不会复活它', async () => {
  await withSession(async (session) => {
    const waiting = Promise.withResolvers();
    const release = Promise.withResolvers();
    const runner = makeRunner(session, async () => {
      waiting.resolve();
      await release.promise;
      return { type: 'assistant', text: '迟到的结果' };
    });
    const run = runner.command(parseGoalCommand('/goal 写一行字'));
    await waiting.promise;
    const stale = await loadSession(session.id);
    assert.match((await runner.command(parseGoalCommand('/goal clear'))).text, /已清除/);
    assert.equal(readSessionGoal(session.id), null);
    assert.throws(() => saveSessionGoal(stale, stale.goalState), { code: 'GOAL_STATE_CONFLICT' });
    await saveSession(stale);
    release.resolve();
    await run;
    assert.equal((await loadSession(session.id)).goalState, undefined);
    assert.match((await runner.command(parseGoalCommand('/goal status'))).text, /没有目标/);
    assert.deepEqual(await runner.command({ action: 'steer', text: '普通聊天' }), { type: 'noop', goalControl: false });
  });
});

test('暂停后编辑不偷偷执行或重置已有消耗，重开时能恢复新的要求', async () => {
  await withSession(async (session) => {
    const original = createGoalState({ objective: '旧条件', criteria: ['旧验收'], maxIterations: 8, tokenBudget: 20000 });
    saveSessionGoal(session, pauseGoal({ ...original, tokensUsed: 400, unreportedRequests: 2, activeMs: 7654, iteration: 3 }));
    const runner = makeRunner(session, () => assert.fail('暂停期间不应运行'));
    await runner.command(parseGoalCommand('/goal edit 新条件'));
    const stored = (await loadSession(session.id)).goalState;
    assert.equal(stored.status, 'paused');
    assert.equal(stored.objective, '新条件');
    assert.equal(stored.tokensUsed, 400);
    assert.equal(stored.activeMs, 7654);
    assert.equal(stored.tokenBudget, 20000);
    assert.equal(stored.maxIterations, 8);
    assert.equal(stored.iteration, 3);
  });
});

test('两个运行时不能抢改活动目标，启动方清除后可立即在同会话创建新目标', async () => {
  await withSession(async (session) => {
    const waiting = Promise.withResolvers();
    const release = Promise.withResolvers();
    const prompts = [];
    const owner = makeRunner(session, async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) { waiting.resolve(); await release.promise; }
      return { type: 'assistant', text: prompt };
    });
    const oldRun = owner.command(parseGoalCommand('/goal 旧任务'));
    await waiting.promise;
    const other = makeRunner(await loadSession(session.id), () => assert.fail('竞争方不应执行'));
    const held = readSessionGoal(session.id);
    for (const command of ['/goal edit 抢占', '/goal clear']) {
      assert.match((await other.command(parseGoalCommand(command))).text, /另一个运行时/);
      assert.deepEqual(readSessionGoal(session.id), held);
    }
    await owner.command(parseGoalCommand('/goal clear'));
    const newRun = owner.command(parseGoalCommand('/goal 新任务'));
    assert.equal(prompts.length, 1);
    release.resolve();
    await oldRun;
    await newRun;
    const final = readSessionGoal(session.id);
    assert.equal(prompts.length, 2);
    assert.equal(final.status, 'completed');
    assert.equal(final.objective, '新任务');
    assert.equal(final.verdicts.length, 1);
  });
});

test('恢复旧版混合目标只补分缺失项，在原验收轮复用答复原文和文件证据', async () => {
  await withSession(async (session) => {
    const workspace = path.join(session.projectDir, '项目');
    await fs.mkdir(workspace);
    const file = path.join(workspace, '交付.txt');
    await fs.writeFile(file, '已交付');
    const replyCriterion = { id: 'answer-8', text: '聊天中逐个列出 1 到 100' };
    const fileCriterion = { id: 'file-3', text: '文件中包含“已交付”', evidence: 'workspace' };
    const legacy = beginGoalIteration(createGoalState({
      objective: '准备交付并数数', criteria: [replyCriterion, fileCriterion], maxIterations: 1,
    }));
    const read = await readTextWindow(file);
    const collector = createGoalEvidenceCollector({ workspaceRoot: workspace, goal: legacy });
    const [proof] = await collector.recordToolResult({ toolName: 'read', callId: 'original',
      args: { criterion_ids: [fileCriterion.id] },
      result: { ...read, path: file, content: read.lines[0].text, phase: 'content' },
    });
    const report = Array.from({ length: 100 }, (_, i) => i + 1).join('、');
    saveSessionGoal(session, pauseGoal(markGoalVerifying(recordGoalObservation(legacy, proof), report, '执行')));
    const reopened = await loadSession(session.id);
    const req = [];
    const runner = createGoalRunner({
      getSession: () => reopened, workspaceRoot: workspace, busy: () => false,
      execute: () => assert.fail('原轮次已交付，不应重做外部操作'),
      settings: () => ({ model: '执行', config: { model: { fast_name: '验收' } }, requestCompletion: ({ messages, model }) => {
        req.push(model);
        const input = JSON.parse(messages.at(-1).content);
        if (model === '执行') {
          assert.deepEqual(input.criteria, [replyCriterion]);
          return { text: JSON.stringify({ criteria: [{ id: replyCriterion.id, evidence: 'reply' }] }) };
        }
        const reply = input.observations.find(item => item.source === 'reply');
        assert.equal(reply.summary, report);
        assert.ok(input.observations.some(item => item.id === proof.id));
        return { text: JSON.stringify({ decision: 'completed', reason: '本轮原文与文件均已核对。', checks: [
          { criterionId: replyCriterion.id, evidenceIds: [reply.id] },
          { criterionId: fileCriterion.id, evidenceIds: [proof.id] },
        ] }) };
      } }),
    });
    await runner.command({ action: 'status' });
    assert.equal(readSessionGoal(session.id).criteria[0].evidence, undefined);
    await runner.command({ action: 'resume' });
    const goal = readSessionGoal(session.id);
    assert.equal(goal.id, legacy.id);
    assert.equal(goal.iteration, 1);
    assert.equal(goal.status, 'completed');
    assert.deepEqual(goal.criteria, [{ ...replyCriterion, evidence: 'reply' }, fileCriterion]);
    await runner.command({ action: 'resume' });
    assert.deepEqual(req, ['执行', '验收']);
    assert.equal(readSessionGoal(session.id).version, goal.version);
  });
});

test('旧版执行中的目标恢复原轮次，已完成的旧目标保持原状', async () => {
  await withSession(async (session) => {
    const original = createGoalState({ objective: '写短句', criteria: ['只输出关键词'], maxIterations: 3 });
    const legacy = { ...beginGoalIteration(original), iteration: 3 };
    saveSessionGoal(session, pauseGoal(legacy));
    let executions = 0;
    const runner = makeRunner(session, async (prompt) => {
      assert.match(prompt, /恢复目标/);
      executions++;
      return { type: 'assistant', text: '关键词' };
    });
    await runner.command({ action: 'resume' });
    const done = readSessionGoal(session.id);
    assert.equal(done.status, 'completed');
    assert.equal(done.iteration, 3);
    assert.deepEqual(done.criteria, [{ id: 'c1', text: '只输出关键词', evidence: 'reply' }]);
    assert.equal(executions, 1);
    const completedLegacy = saveSessionGoal(session, { ...done, criteria: original.criteria });
    await runner.command({ action: 'resume' });
    assert.deepEqual(readSessionGoal(session.id), completedLegacy);
  });
});
