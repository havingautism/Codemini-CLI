import {
  applyGoalVerdict, beginGoalIteration, createGoalState, markGoalVerifying,
  goalVerdictEvent, pauseGoal, recordGoalDelegation, recordGoalObservation, renderGoalContext, renderGoalSummary, resumeGoal, setInferredGoalCriteria,
} from './goal-state.js';
import { createGoalEvidenceCollector, inferGoalCriteria, reviewGoal } from './goal-verification.js';
import { integerSequenceRange } from './goal-count-verification.js';
import { randomUUID } from 'node:crypto';
import { sha256 } from './crypto-utils.js';
import { watchGoalWork } from './goal-work.js';
import { readSessionGoal, saveSessionGoal } from './session-store.js';
import { withGoalUsageMeter } from './token-usage-context.js';
import { normalizeModelUsage } from './model-usage.js';
import { goalResolutionHint, resolveGoalOperation, unresolvedGoalOperations, withGoalOperations } from './goal-operations.js';

const reply = (text) => ({ type: 'system', text, output: text });
const localOwners = new Set();

function reviseGoal(previous, parsed) {
  const steering = parsed.action === 'steer';
  const objective = steering ? previous.objective + '\n用户补充（冲突时以本次要求为准）：' + parsed.text : parsed.objective;
  const revised = createGoalState({
    objective,
    criteria: steering ? previous.criteria : parsed.acceptance,
    criteriaPending: steering ? 'infer' : parsed.criteriaPending,
    constraints: steering ? previous.constraints : parsed.constraints,
    maxIterations: parsed.maxRounds ?? previous.maxIterations,
    tokenBudget: parsed.tokenBudget ?? previous.tokenBudget,
    maxWaitMs: parsed.maxWaitMs ?? previous.maxWaitMs,
  });
  // 中断的这一轮按新要求重新执行。已用完的轮次、Token 和时间仍计在同一预算上。
  const phase = previous.status === 'paused' ? previous.resumePhase : previous.phase;
  revised.iteration = previous.iteration - (['executing', 'verifying'].includes(phase) ? 1 : 0);
  if (revised.maxIterations < revised.iteration) throw new Error('新的轮数预算不能小于已经用完的轮数。');
  revised.tokensUsed = previous.tokensUsed;
  revised.unreportedRequests = previous.unreportedRequests;
  revised.activeMs = previous.activeMs;
  revised.operations = previous.operations;
  return revised;
}

export async function waitForGoalInput(observer, form, signal) {
  const skipped = { status: 'skipped', answers: {} };
  if (signal.aborted) return skipped;
  const pending = Promise.withResolvers();
  const cancel = () => pending.resolve(skipped);
  signal.addEventListener('abort', cancel, { once: true });
  try { return await Promise.race([observer(form, { signal }), pending.promise]); }
  finally { signal.removeEventListener('abort', cancel); }
}

function hasLiveOwner(goal) {
  if (!goal?.ownerPid || !goal.ownerToken) return false;
  if (goal.ownerPid === process.pid) return localOwners.has(goal.ownerToken);
  try { process.kill(goal.ownerPid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

export function recoverInterruptedGoal(session) {
  if (session.goalState?.status === 'active' && !hasLiveOwner(session.goalState)) {
    try {
      const missing = unresolvedGoalOperations(session.goalState).length > 0;
      saveSessionGoal(session, pauseGoal(session.goalState, missing
        ? '上次运行中断时仍有操作未收到回执，请核对后再恢复。' : '上次运行已中断，使用 /goal resume 核对现场并继续。'));
    } catch (error) {
      if (error.code !== 'GOAL_STATE_CONFLICT') throw error;
      session.goalState = readSessionGoal(session.id);
    }
  }
}

// 裁剪完成后生成请求副本，避免污染历史消息、摘要和工具调用配对。
export function withGoalContext(messages, context) {
  if (!context) return messages;
  const index = messages.findLastIndex((item) => item.role === 'user');
  if (index < 0) return [...messages, { role: 'user', content: context }];
  const original = messages[index].content;
  const content = Array.isArray(original)
    ? [...original, { type: 'text', text: context }]
    : String(original || '') + '\n\n' + context;
  return messages.map((item, at) => at === index ? { ...item, content } : item);
}

// 每个会话只允许一个前台目标循环。工具仍通过普通聊天运行时执行。
export function createGoalRunner({ getSession, execute, settings, workspaceRoot, busy }) {
  let controller;
  let finished;
  let ownerToken;
  let activeSince;
  let revisionPending = false;

  const save = (next) => {
    const session = getSession();
    if (next === session.goalState) return;
    const now = Math.floor(performance.now());
    const elapsed = activeSince != null ? now - activeSince : 0;
    // 只累计本进程实际持有目标的区间，重启后不计入离线等待。
    next = { ...next, activeMs: next.activeMs + Math.max(0, elapsed) };
    saveSessionGoal(session, next.status === 'active'
      ? { ...next, ownerPid: process.pid, ownerToken } : next);
    activeSince = next.status === 'active' ? now : undefined;
  };
  const current = () => getSession().goalState;
  const describe = () => current() ? renderGoalContext({ ...current(),
    activeMs: current().activeMs + (activeSince == null ? 0 : Math.floor(performance.now()) - activeSince) }) : '当前会话没有目标。';
  const stop = (reason = '用户暂停了目标。') => {
    if (!controller || current()?.status !== 'active') return false;
    controller?.abort({ continueInPlace: true });
    return save(pauseGoal(current(), reason));
  };

  async function drive(signal, onEvent) {
    const missingAtStart = current().unreportedRequests;
    let open = true;
    const meter = {
      beforeRequest() {
        if (!open || signal.aborted || current()?.status !== 'active') throw new Error('目标执行已结束。');
        const goal = current();
        if (goal.tokenBudget == null) return;
        const reason = goal.tokensUsed >= goal.tokenBudget
          ? 'Token 预算已耗尽，请用 /goal resume --add-tokens 10000 增加预算。'
          : goal.unreportedRequests > missingAtStart
            ? '提供商未报告本次消耗，无法核对 Token 预算。请检查用量配置后恢复。' : '';
        if (reason) {
          stop(reason);
          throw new Error(reason);
        }
      },
      finishRequest(usage) {
        const goal = current();
        if (!open || !goal) return;
        const normalized = normalizeModelUsage(usage);
        save(normalized ? { ...goal, tokensUsed: goal.tokensUsed + normalized.totalTokens }
          : { ...goal, unreportedRequests: goal.unreportedRequests + 1 });
      },
    };
    try {
      await withGoalOperations({ current, save, stop, signal },
        () => withGoalUsageMeter(meter, () => runIterations(signal, onEvent, meter)));
    }
    finally { open = false; }
  }

  async function runIterations(signal, onEvent, meter) {
    let recovering = current().phase === 'executing';
    if (current().criteriaPending) {
      const criteria = await inferGoalCriteria({ goal: current(), ...settings(), signal });
      if (signal.aborted) return;
      const resolved = setInferredGoalCriteria(current(), criteria);
      // 旧版在送审前已把本轮完整答复和工具观测落盘。补登记正文即可复核，无需重放原操作。
      const replies = resolved.phase === 'verifying' && resolved.report && criteria.some(item => item.evidence === 'reply')
        ? await createGoalEvidenceCollector({ workspaceRoot, goal: resolved }).recordReply(resolved.report) : [];
      if (signal.aborted) return;
      await save(replies.reduce(recordGoalObservation, resolved));
    }
    while (!signal.aborted && current().status === 'active') {
      if (current().phase !== 'verifying') meter.beforeRequest();
      if (current().phase === 'ready') await save(beginGoalIteration(current()));
      if (signal.aborted || current().status !== 'active') break;
      if (current().phase === 'executing') {
        const collector = createGoalEvidenceCollector({ workspaceRoot, goal: current() });
        const accept = async (observations) => {
          if (signal.aborted || !observations?.length) return;
          let next = current();
          for (const observation of observations) next = recordGoalObservation(next, observation);
          await save(next);
        };
        await accept(await collector.start());
        if (signal.aborted) break;
        const delegationIds = new Map();
        const workers = new Map();
        const monitors = new AbortController();
        const watch = (id, name, inspect) => watchGoalWork({
          signal: AbortSignal.any([signal, monitors.signal]), name, inspect, pause: stop, maxWaitMs: current().maxWaitMs,
          notifyInterrupted: () => onEvent?.({ type: 'goal:waiting', id, name, status: 'interrupted', summary: '等待已中断，恢复后将核对现场。' }),
          async report(status, summary, details) {
            if (signal.aborted || current()?.status !== 'active') return;
            await save(recordGoalDelegation(current(), { ...details, id, name, status, summary }));
            onEvent?.({ type: 'goal:waiting', id, name, status, summary });
          },
        });
        const hooks = {
          async watchShell(name, inspect, parentCallId) {
            const parent = workers.get(parentCallId);
            parent?.shells.add(inspect);
            const finish = await watch('shell-' + randomUUID(), name, inspect);
            return async (...args) => {
              if (parent?.shells.delete(inspect)) parent.finishedShellProgress += inspect().progress;
              await finish(...args);
            };
          },
          workerActivity(callId, event) {
            const worker = workers.get(callId);
            if (!worker) return;
            worker.cursor++;
            if (event?.type === 'tool:end') {
              worker.completedTools.add(sha256(JSON.stringify([event.name, event.arguments])));
            }
          },
          context: () => signal.aborted ? '' : renderGoalContext(current()),
          delegationId: (callId) => delegationIds.get(callId) || callId,
          async started(event) {
            await accept(await collector.beginTool(event));
            if (signal.aborted) return;
            const { toolName, args, callId } = event;
            if (toolName !== 'run_subagent') return;
            // 部分提供商会在恢复后重用工具调用编号，已有交接必须保留。
            const id = current().delegations.some((item) => item.id === callId) ? randomUUID() : callId;
            delegationIds.set(callId, id);
            const worker = { cursor: 0, shells: new Set(), finishedShellProgress: 0, completedTools: new Set() };
            workers.set(callId, worker);
            worker.finish = await watch(id, args.name || args.role || '子代理', () => {
              const shells = Array.from(worker.shells, inspect => inspect());
              return {
                cursor: [worker.cursor, ...shells.map(shell => shell.cursor)].join('/'),
                progress: shells.reduce((sum, shell) => sum + shell.progress, worker.finishedShellProgress + worker.completedTools.size),
                detail: String(args.prompt || '').slice(0, 150),
              };
            });
          },
          async result(event) {
            await accept(await collector.recordToolResult(event));
            if (signal.aborted) return;
            if (event.toolName !== 'run_subagent') return;
            const result = event.result || {};
            const worker = workers.get(event.callId);
            await worker?.finish?.(result.ok ? 'completed' : 'failed', result.message || result.error || result.text,
              { handoffPath: result.handoffPath, workerId: result.workerId });
            workers.delete(event.callId);
          },
        };
        const instruction = recovering
          ? '恢复目标。本轮曾中断，请先核对已有改动、子任务与证据，再继续未完成的工作。'
          : '执行目标：' + current().objective;
        const limits = integerSequenceRange(current());
        let guidance = current().criteria.some(item => item.evidence === 'reply')
          ? '直接在回复中完整交付要求的文本。已有且仍有效的工具证据请沿用，不要重复已验证的外部操作；文件、行为或外部状态缺少证据时再针对性核对。'
          : '请取得与验收项直接相关的工具证据。';
        if (limits) {
          guidance = '仅输出从 ' + limits[0] + ' 到 ' + limits[1] + ' 的连续阿拉伯数字，包含两端，用顿号、逗号或换行分隔。不要加标题、解释、结束语或 Markdown。';
          const previous = current().verdicts.at(-1);
          if (previous?.verifierKind === 'integer_sequence') guidance += '\n上次数列核对结果：' + previous.resultReason;
        }
        recovering = false;
        const executorModel = settings().model;
        let result;
        try {
          result = await execute(instruction + '\n' + guidance, onEvent, { goalHooks: hooks, signal });
        } finally {
          monitors.abort();
        }
        await accept(await collector.finish());
        if (signal.aborted || current().status !== 'active') break;
        if (result.aborted || result.workflowComplete || result.type !== 'assistant' || result.stopReason === 'incomplete_retries') {
          await save(pauseGoal(current(), result.text || '执行中断，等待恢复。'));
          break;
        }
        const observations = await collector.recordReply(result.text);
        if (signal.aborted || current().status !== 'active') break;
        const next = observations.reduce(recordGoalObservation, current());
        await save(markGoalVerifying(next, result.text, executorModel));
      }
      if (signal.aborted || current().phase !== 'verifying') break;
      const verdict = await reviewGoal({ goal: current(), workspaceRoot, ...settings(), signal });
      if (signal.aborted || current().status !== 'active') break;
      save(applyGoalVerdict(current(), verdict));
      onEvent?.(goalVerdictEvent(current()));
    }
  }

  return {
    get running() { return Boolean(controller); },
    get acceptingSteering() { return Boolean(controller && current()?.status === 'active'); },
    stop,
    async close() {
      if (controller) {
        await stop('会话关闭，目标进度已保存。');
        await finished;
      }
    },
    async command(parsed, onEvent) {
      if (parsed.action === 'error') return reply(parsed.message);
      if (!controller) {
        const session = getSession();
        session.goalState = readSessionGoal(session.id);
        recoverInterruptedGoal(session);
      }
      if (parsed.action === 'status') return reply(describe());
      if (!controller && current()?.status === 'active' && hasLiveOwner(current())) {
        return reply('目标正在另一个运行时执行。请在启动它的会话中暂停。');
      }
      if (parsed.action === 'pause') {
        await stop();
        return reply(describe());
      }
      if (parsed.action === 'resolve') {
        if (controller) return reply('请等待当前工具执行结束后再核对操作。');
        try {
          save(resolveGoalOperation(current(), parsed.id, parsed.resolution));
          return reply(describe());
        } catch (error) { return reply(error.message); }
      }
      const pending = unresolvedGoalOperations(current());
      if (pending.length && ['resume', 'clear', 'edit', 'steer'].includes(parsed.action)) {
        return reply('有工具调用正在执行或回执尚未确认。' + pending.map(goalResolutionHint).join('\n'));
      }
      if (parsed.action === 'clear' || parsed.action === 'edit' || parsed.action === 'steer') {
        const previous = current();
        if (parsed.action === 'steer' && (!controller || previous?.status !== 'active')) {
          return { type: 'noop', goalControl: false };
        }
        if (!previous) return reply('当前会话没有目标。');
        try {
          if (parsed.action === 'clear') {
            saveSessionGoal(getSession(), null);
            revisionPending = false;
            activeSince = undefined;
            controller?.abort({ continueInPlace: true });
            return reply('当前目标已清除。');
          }
          const active = Boolean(controller && previous.status === 'active');
          const revised = reviseGoal(previous, parsed);
          if (revised.iteration === revised.maxIterations) {
            const reason = '已修改目标，原有轮数已用完。使用 /goal resume +2 增加两轮后继续。';
            save({ ...revised, status: 'exhausted', phase: 'stopped', reason });
            controller?.abort({ continueInPlace: true });
            return reply(reason);
          }
          save(active ? revised : pauseGoal(revised, '已保存新目标，使用 /goal resume 开始执行。'));
          if (active) {
            revisionPending = true;
            controller.abort({ continueInPlace: true });
          }
          const action = parsed.action === 'edit' ? '已修改目标' : '已将补充加入目标';
          return reply(action + (active ? '，正在按新要求继续。' : '。使用 /goal resume 继续。'));
        } catch (error) { return reply(error.message); }
      }
      if (controller?.signal.aborted && finished &&
          (parsed.action === 'resume' || (parsed.action === 'create' && !current()))) {
        await finished;
        if (!controller) {
          const session = getSession();
          session.goalState = readSessionGoal(session.id);
          recoverInterruptedGoal(session);
        }
      }
      if (controller || busy()) return reply('当前会话正在执行任务，请先等待或暂停。');
      const previous = current();
      let next;
      try {
        if (parsed.action === 'create') {
          if (previous && ['active', 'paused', 'exhausted'].includes(previous.status)) {
            return reply('此会话已有可继续的目标。使用 /goal edit 修改、/goal clear 清除，或 /goal resume 恢复。');
          }
          next = createGoalState({ objective: parsed.objective, criteria: parsed.acceptance,
            constraints: parsed.constraints?.join('\n'), maxIterations: parsed.maxRounds,
            criteriaPending: parsed.criteriaPending, tokenBudget: parsed.tokenBudget, maxWaitMs: parsed.maxWaitMs });
        } else {
          if (!previous) return reply('当前会话没有可以恢复的目标。');
          if (!['paused', 'exhausted'].includes(previous.status)) return reply(describe());
          next = resumeGoal(previous, { extraIterations: parsed.extraRounds, extraTokens: parsed.extraTokens });
          if (!next.criteriaPending && next.criteria.some(item => !item.evidence)) next.criteriaPending = 'classify';
        }
      } catch (error) { return reply(error.message); }
      controller = new AbortController();
      ownerToken = randomUUID();
      localOwners.add(ownerToken);
      finished = (async () => {
        try {
          await save(next);
        } catch (error) {
          if (error.code !== 'GOAL_STATE_CONFLICT') throw error;
          const session = getSession();
          session.goalState = readSessionGoal(session.id);
          return reply('目标状态已被其他运行更新。\n' + describe());
        }
        for (;;) {
          const { signal } = controller;
          try {
            if (!signal.aborted) await drive(signal, onEvent);
          } catch (error) {
            if (!signal.aborted && current()?.status === 'active') await save(pauseGoal(current(), '目标执行中断：' + error.message));
          }
          if (!revisionPending || current()?.status !== 'active') break;
          revisionPending = false;
          controller = new AbortController();
        }
        const goal = current();
        if (!goal) return reply('当前目标已清除。');
        const fullReport = goal.status === 'completed' && goal.criteria.some(item => item.evidence === 'reply');
        return { ...reply(renderGoalContext(goal, { fullReport })), goalSummary: renderGoalSummary(goal) };
      })();
      try { return await finished; } finally {
        localOwners.delete(ownerToken);
        controller = null;
        finished = null;
        revisionPending = false;
      }
    },
  };
}
