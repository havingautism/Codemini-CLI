import {
  applyGoalVerdict, beginGoalIteration, createGoalState, markGoalVerifying,
  pauseGoal, recordGoalDelegation, recordGoalObservation, renderGoalContext, resumeGoal,
} from './goal-state.js';
import { createGoalEvidenceCollector, reviewGoal } from './goal-verification.js';
import { randomUUID } from 'node:crypto';
import { readSessionGoal, saveSessionGoal } from './session-store.js';

const reply = (text) => ({ type: 'system', text, output: text });
const localOwners = new Set();

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
      saveSessionGoal(session, pauseGoal(session.goalState, '上次运行已中断，使用 /goal resume 核对现场并继续。'));
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

  const save = async (next) => {
    const session = getSession();
    if (next === session.goalState) return;
    saveSessionGoal(session, next.status === 'active'
      ? { ...next, ownerPid: process.pid, ownerToken } : next);
  };
  const current = () => getSession().goalState;
  const describe = () => current() ? renderGoalContext(current()) : '当前会话没有目标。';
  const stop = (reason = '用户暂停了目标。') => {
    if (!controller || current()?.status !== 'active') return false;
    controller?.abort({ continueInPlace: true });
    return save(pauseGoal(current(), reason));
  };

  async function drive(signal, onEvent) {
    let recovering = current().phase === 'executing';
    while (!signal.aborted && current().status === 'active') {
      if (current().phase === 'ready') await save(beginGoalIteration(current()));
      if (signal.aborted || current().status !== 'active') break;
      if (current().phase === 'executing') {
        const collector = createGoalEvidenceCollector({ workspaceRoot, goal: current() });
        const accept = async (observations) => {
          if (!observations?.length) return;
          let next = current();
          for (const observation of observations) next = recordGoalObservation(next, observation);
          await save(next);
        };
        await accept(await collector.start());
        if (signal.aborted) break;
        const delegationIds = new Map();
        const hooks = {
          context: () => renderGoalContext(current()),
          delegationId: (callId) => delegationIds.get(callId) || callId,
          async started(event) {
            await accept(await collector.beginTool(event));
            const { toolName, args, callId } = event;
            if (toolName !== 'run_subagent') return;
            // 部分提供商会在恢复后重用工具调用编号，已有交接必须保留。
            const id = current().delegations.some((item) => item.id === callId) ? randomUUID() : callId;
            delegationIds.set(callId, id);
            await save(recordGoalDelegation(current(), {
              id, name: args.name || args.role, summary: args.prompt, status: 'running',
            }));
          },
          async result(event) {
            await accept(await collector.recordToolResult(event));
            if (event.toolName !== 'run_subagent') return;
            const result = event.result || {};
            await save(recordGoalDelegation(current(), {
              id: hooks.delegationId(event.callId), name: event.args.name || event.args.role,
              status: result.ok ? 'completed' : 'failed',
              summary: result.message || result.error || result.text,
              handoffPath: result.handoffPath, workerId: result.workerId,
            }));
          },
        };
        const instruction = recovering
          ? '恢复目标。本轮曾中断，请先核对已有改动、子任务与证据，再继续未完成的工作。'
          : '执行目标：' + current().objective + '\n请取得与验收项直接相关的工具证据。';
        recovering = false;
        const executorModel = settings().model;
        const result = await execute(instruction, onEvent, { goalHooks: hooks, signal });
        await accept(await collector.finish());
        if (signal.aborted || current().status !== 'active') break;
        if (result.aborted || result.workflowComplete || result.type !== 'assistant' || result.stopReason === 'incomplete_retries') {
          await save(pauseGoal(current(), result.text || '执行中断，等待恢复。'));
          break;
        }
        await save(markGoalVerifying(current(), result.text, executorModel));
      }
      if (signal.aborted || current().phase !== 'verifying') break;
      const verdict = await reviewGoal({ goal: current(), workspaceRoot, ...settings(), signal });
      if (signal.aborted || current().status !== 'active') break;
      await save(applyGoalVerdict(current(), verdict));
    }
  }

  return {
    get running() { return Boolean(controller); },
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
      if (parsed.action === 'resume' && controller?.signal.aborted && finished) {
        await finished;
      }
      if (controller || busy()) return reply('当前会话正在执行任务，请先等待或暂停。');
      const previous = current();
      let next;
      try {
        if (parsed.action === 'create') {
          if (previous && ['active', 'paused', 'exhausted'].includes(previous.status)) {
            return reply('此会话已有可继续的目标。请使用 /goal 查看、/goal resume 恢复，或在新会话中创建另一个目标。');
          }
          next = createGoalState({ objective: parsed.objective, criteria: parsed.acceptance,
            constraints: parsed.constraints?.join('\n'), maxIterations: parsed.maxRounds });
        } else {
          if (!previous) return reply('当前会话没有可以恢复的目标。');
          if (!['paused', 'exhausted'].includes(previous.status)) return reply(describe());
          next = resumeGoal(previous, { extraIterations: parsed.extraRounds });
        }
      } catch (error) { return reply(error.message); }
      controller = new AbortController();
      ownerToken = randomUUID();
      localOwners.add(ownerToken);
      const { signal } = controller;
      finished = (async () => {
        try {
          await save(next);
        } catch (error) {
          if (error.code !== 'GOAL_STATE_CONFLICT') throw error;
          const session = getSession();
          session.goalState = readSessionGoal(session.id);
          return reply('目标状态已被其他运行更新。\n' + describe());
        }
        try {
          await drive(signal, onEvent);
        } catch (error) {
          if (current().status === 'active') await save(pauseGoal(current(), '目标执行中断：' + error.message));
        }
        return reply(describe());
      })();
      try { return await finished; } finally {
        localOwners.delete(ownerToken);
        controller = null;
        finished = null;
      }
    },
  };
}
