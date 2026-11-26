import { randomUUID } from 'node:crypto';
import { finishGoalTask, recordGoalTaskModel, renderGoalTasks, startGoalTask, updateGoalPlan } from './goal-tasks.js';
import { verifyGoalTask } from './goal-state.js';
import { reviewGoal } from './goal-verification.js';

// 计划和尝试在分发工具前落盘；异步验收返回时须核对原目标和原尝试。
export function createGoalTaskRunner({ current, save, signal, workspaceRoot, settings }) {
  const goalId = current().id;
  const active = () => !signal.aborted && current()?.id === goalId && current().status === 'active';
  const requireActive = () => {
    if (!active()) throw new Error('本次目标执行已结束。');
  };
  const taskFor = id => current()?.tasks?.find(task => task.id === id);
  const reviews = new Map();

  async function reviewDelivery(id) {
    const goal = current();
    const task = taskFor(id);
    if (!active() || task?.status !== 'delivered' || !task.criterionIds.length) return;
    const criteria = goal.criteria.filter(item => task.criterionIds.includes(item.id) && item.evidence !== 'reply');
    // 聊天正文只在本轮回复结束后才产生，由总目标验收一并核对。
    if (!criteria.length) return;
    const attempt = task.attempts.at(-1);
    if (!attempt?.model) return;
    const config = settings();
    const workspaceOnly = criteria.length < task.criterionIds.length;
    const scoped = { ...goal, objective: task.title, parentObjective: goal.objective, criteria, workspaceOnly,
      executorModel: attempt.model, taskExecutorModels: attempt.models };
    const verdict = await reviewGoal({ goal: scoped, workspaceRoot, ...config, signal });
    if (!active()) return;
    const latest = taskFor(id);
    if (latest?.status !== 'delivered' || latest.attempts.at(-1)?.id !== attempt.id) return;
    save(verifyGoalTask(current(), id, { ...verdict, workspaceOnly,
      observedThrough: goal.observations.at(-1)?.id || '' }));
  }

  async function reviewOnce(id) {
    if (reviews.has(id)) return reviews.get(id);
    const review = reviewDelivery(id).finally(() => reviews.delete(id));
    reviews.set(id, review);
    await review;
  }

  return {
    reviewDelivery: reviewOnce,
    async reviewPendingDeliveries(taskId, newPlan) {
      if (!active()) return;
      const visited = new Set();
      const candidates = [];
      function visit(id) {
        if (visited.has(id)) return;
        visited.add(id);
        const revised = newPlan?.find(item => item.id === id);
        for (const dependency of revised?.depends_on || taskFor(id)?.dependsOn || []) visit(dependency);
        candidates.push(id);
      }
      if (taskId) visit(taskId);
      else for (const task of current().tasks || []) visit(task.id);
      for (const id of candidates) {
        if (!active()) return;
        const task = taskFor(id);
        if (task?.status !== 'delivered') continue;
        const last = task.attempts.at(-1)?.reviews?.at(-1);
        if (taskId && last?.observedThrough === (current().observations.at(-1)?.id || '')) continue;
        await reviewOnce(id);
      }
    },

    async updatePlan({ tasks, main_task: action } = {}) {
      requireActive();
      if (!tasks && !action) throw new Error('请提供任务计划或主代理任务操作。');
      let next = tasks ? updateGoalPlan(current(), tasks) : current();
      if (action?.action === 'start') {
        next = startGoalTask(next, action.id, randomUUID(), 'main', settings().model);
      } else if (action?.action === 'deliver') {
        const task = next.tasks?.find(item => item.id === action.id);
        const attempt = task?.attempts.at(-1);
        if (task?.status !== 'running' || attempt?.owner !== 'main') throw new Error('请先由主代理承接该任务，再提交交付。');
        next = finishGoalTask(next, task.id, attempt.id, 'delivered');
      } else if (action) {
        throw new Error('主代理任务操作须为 start 或 deliver。');
      }
      save(next);
      if (action?.action === 'deliver') await reviewOnce(action.id);
      requireActive();
      return renderGoalTasks(current());
    },

    claimDelegation(taskId, attemptId) {
      requireActive();
      if (!taskId && !current().tasks?.length) return;
      if (!taskId) throw new Error('已有目标任务计划；请在委派中填写对应的 goal_task_id。');
      save(startGoalTask(current(), taskId, attemptId, 'subagent'));
    },

    workerModel(attemptId, model) {
      requireActive();
      save(recordGoalTaskModel(current(), attemptId, model));
    },

    evidenceEvent(event) {
      const task = current()?.tasks?.find(item => {
        const attempt = item.attempts.at(-1);
        if (item.status !== 'running' || !attempt) return false;
        return event.parentDelegationId ? attempt.id === event.parentDelegationId : attempt.owner === 'main';
      });
      if (!task) return event;
      const tagged = { ...event, attemptId: task.attempts.at(-1).id };
      if (event.criterionIds != null || event.args?.criterion_ids != null) return tagged;
      const ids = task.criterionIds.filter(id => current().criteria.some(item => item.id === id && item.evidence !== 'reply'));
      return ids.length ? { ...tagged, criterionIds: ids } : tagged;
    },
  };
}
