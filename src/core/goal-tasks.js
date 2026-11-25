const taskId = /^[\p{L}\p{N}_-]+$/u;
const labels = {
  pending: '待执行', running: '执行中', delivered: '已交付', verified: '已验收',
  interrupted: '已中断，待核对', failed: '执行失败',
};

function ids(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.trim())) {
    throw new Error(name + '必须是标识数组。');
  }
  return [...new Set(value)].sort();
}

function requireExecuting(goal) {
  if (goal.status !== 'active' || goal.phase !== 'executing') throw new Error('当前目标不在执行阶段。');
}

function replaceTask(goal, task) {
  return { ...goal, tasks: goal.tasks.map(item => item.id === task.id ? task : item) };
}

export function updateGoalPlan(goal, input) {
  requireExecuting(goal);
  if (!Array.isArray(input)) throw new Error('任务计划必须是任务数组。');
  const previous = new Map((goal.tasks || []).map(item => [item.id, item]));
  const criteria = new Set(goal.criteria.map(item => item.id));
  const tasks = new Map();
  for (const entry of input) {
    const { id, title } = entry || {};
    if (typeof id !== 'string' || !taskId.test(id) || tasks.has(id)) {
      throw new Error('任务标识必须唯一，只能包含文字、数字、短横线或下划线。');
    }
    if (typeof title !== 'string' || !title.trim()) throw new Error('请填写任务说明。');
    const dependsOn = ids(entry.depends_on, '前置任务');
    const criterionIds = ids(entry.criterion_ids, '验收条件');
    if (criterionIds.some(cid => !criteria.has(cid))) throw new Error('任务引用了未知的验收条件。');
    const old = previous.get(id);
    const definition = { id, title: title.trim(), dependsOn, criterionIds };
    if (old?.attempts.length && (old.title !== definition.title ||
        JSON.stringify(old.dependsOn) !== JSON.stringify(dependsOn) ||
        JSON.stringify(old.criterionIds) !== JSON.stringify(criterionIds))) {
      throw new Error('已经执行过的任务须保留原标识、说明、依赖和验收条件：' + id);
    }
    tasks.set(id, { status: 'pending', attempts: [], ...old, ...definition });
  }
  for (const old of previous.values()) {
    if (old.attempts.length && !tasks.has(old.id)) throw new Error('计划缺少已有执行记录的任务：' + old.id);
  }
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error('任务依赖形成了循环：' + id);
    const task = tasks.get(id);
    if (!task) throw new Error('找不到前置任务：' + id);
    visiting.add(id);
    for (const dependency of task.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) visit(id);
  return { ...goal, tasks: [...tasks.values()] };
}

export function pendingGoalDependencies(goal, task) {
  const tasks = new Map(goal.tasks.map(item => [item.id, item]));
  const deferred = new Set(goal.criteria.filter(item => item.evidence === 'reply').map(item => item.id));
  const ready = new Map();
  function completed(id) {
    if (ready.has(id)) return ready.get(id);
    const item = tasks.get(id);
    // 正文在整轮回复结束时产生，允许先按交接推进下游；验收状态仍保留为待核对。
    const delivered = item?.status === 'delivered' &&
      (item.criterionIds.every(cid => deferred.has(cid)) || item.verification?.workspaceOnly);
    ready.set(id, false);
    const result = (item?.status === 'verified' || delivered) && item.dependsOn.every(completed);
    ready.set(id, result);
    return result;
  }
  return task.dependsOn.filter(id => !completed(id));
}

export function withdrawGoalTaskProof(task) {
  const { verification, ...delivery } = task;
  return { ...delivery, status: 'delivered', reviewReason: '证据或前置任务有变化，请重新核对。' };
}

export function refreshGoalTaskDependencies(goal) {
  const tasks = goal.tasks.map(task => task.verification && pendingGoalDependencies(goal, task).length
    ? withdrawGoalTaskProof(task) : task);
  return tasks.some((task, index) => task !== goal.tasks[index]) ? { ...goal, tasks } : goal;
}

export function startGoalTask(goal, id, attemptId, owner = 'subagent', model = '') {
  requireExecuting(goal);
  const task = goal.tasks?.find(item => item.id === id);
  if (!task) throw new Error('任务计划中没有此任务：' + id);
  if (!['main', 'subagent'].includes(owner) || typeof attemptId !== 'string' || !attemptId.trim()) {
    throw new Error('任务执行必须包含执行者和尝试标识。');
  }
  const latest = task.attempts.at(-1);
  if (task.status === 'running' && latest.id === attemptId && latest.owner === owner) return goal;
  if (task.status === 'running' || task.status === 'verified') throw new Error('任务正在执行或已经验收：' + id);
  if (goal.tasks.some(item => item.attempts.some(attempt => attempt.id === attemptId))) {
    throw new Error('任务尝试标识已被使用。');
  }
  if (owner === 'main' && goal.tasks.some(item => item.status === 'running' && item.attempts.at(-1)?.owner === 'main')) {
    throw new Error('主代理须先交付当前任务，再开始另一项。');
  }
  const blocked = pendingGoalDependencies(goal, task);
  if (blocked.length) throw new Error('请先完成前置任务：' + blocked.join('、'));
  const attempt = { id: attemptId, owner, model: String(model || '').trim(), iteration: goal.iteration, status: 'running' };
  const { verification, ...definition } = task;
  const next = replaceTask(goal, { ...definition, status: 'running', reviewReason: '', attempts: [...task.attempts, attempt] });
  return task.status === 'delivered' ? refreshGoalTaskDependencies(next) : next;
}

export function recordGoalTaskModel(goal, attemptId, model) {
  const name = typeof model === 'string' ? model.trim() : '';
  if (!name || goal.status !== 'active') return goal;
  const task = goal.tasks?.find(item => item.status === 'running' && item.attempts.at(-1)?.id === attemptId);
  if (!task) return goal;
  const last = task.attempts.at(-1);
  if (last.model?.toLowerCase() === name.toLowerCase()) return goal;
  const models = [...new Set([...(last.models || []), last.model, name].filter(Boolean))];
  const attempt = { ...last, model: name, ...(models.length > 1 ? { models } : {}) };
  return replaceTask(goal, { ...task, attempts: [...task.attempts.slice(0, -1), attempt] });
}

function settleAttempt(task, status) {
  return { ...task, status, attempts: [...task.attempts.slice(0, -1), { ...task.attempts.at(-1), status }] };
}

export function finishGoalTask(goal, id, attemptId, outcome) {
  if (goal.status !== 'active' || !['delivered', 'failed'].includes(outcome)) return goal;
  const task = goal.tasks?.find(item => item.id === id);
  if (task?.status !== 'running' || task.attempts.at(-1)?.id !== attemptId) return goal;
  return replaceTask(goal, settleAttempt(task, outcome));
}

export function interruptGoalTasks(goal) {
  if (!goal.tasks?.some(item => item.status === 'running')) return goal;
  return { ...goal, tasks: goal.tasks.map(task => task.status === 'running' ? settleAttempt(task, 'interrupted') : task) };
}

export function renderGoalTasks(goal) {
  if (!goal.tasks?.length) return '';
  const delegations = new Map((goal.delegations || []).map(item => [item.id, item]));
  return ['任务计划：', ...goal.tasks.map(task => {
    const last = task.attempts.at(-1);
    const state = task.status === 'delivered' && task.criterionIds.length ? '已交付，待验收' : labels[task.status];
    const details = [state];
    if (task.dependsOn.length) details.push('依赖 ' + task.dependsOn.join('、'));
    if (task.criterionIds.length) details.push('验收 ' + task.criterionIds.join('、'));
    if (last) details.push(`${last.owner === 'main' ? '主代理' : '子代理'}尝试 ${last.id}`);
    const handoff = task.attempts.findLast(attempt => delegations.get(attempt.id)?.handoffPath);
    if (handoff) details.push('交接 ' + delegations.get(handoff.id).handoffPath);
    if (task.verification) details.push('证据 ' + [...new Set(task.verification.checks.flatMap(check => check.evidenceIds))].join('、'));
    if (task.reviewReason && task.status === 'delivered') details.push(task.reviewReason);
    return `- [${task.id}] ${task.title}（${details.join('，')}）`;
  })].join('\n');
}
