import { randomUUID } from 'node:crypto';

const statuses = new Set(['active', 'paused', 'exhausted', 'completed', 'failed']);
const activePhases = new Set(['ready', 'executing', 'verifying']);
const observationKinds = new Set(['pass', 'fail', 'environment_error', 'change', 'observation']);
const decisions = new Set(['completed', 'continue', 'unreachable', 'pause']);
const statusLabels = { active: '进行中', paused: '已暂停', exhausted: '预算已耗尽', completed: '已完成', failed: '失败' };
const phaseLabels = { ready: '等待开始下一轮', executing: '执行中', verifying: '独立验收中', stopped: '已停止' };
const workerLabels = { running: '执行中', queued: '排队中', completed: '已完成', done: '已完成', failed: '失败', interrupted: '已中断，待核对' };
const observationLabels = { pass: '通过', fail: '失败', environment_error: '环境异常', change: '工作区变更', observation: '工具观测' };

function excerpt(text, limit) {
  const value = cleanText(text);
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function textList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(cleanText).filter(Boolean))];
}

function normalizeCriteria(value) {
  const entries = typeof value === 'string' ? value.split(/\r?\n/) : value;
  if (!Array.isArray(entries)) return [];
  const criteria = [];
  const seen = new Set();
  for (const entry of entries) {
    const text = cleanText(typeof entry === 'string' ? entry : entry?.text);
    if (!text) continue;
    const id = cleanText(entry?.id) || `c${criteria.length + 1}`;
    if (seen.has(id)) throw new Error('验收标准标识重复。');
    seen.add(id);
    const evidence = entry?.evidence;
    criteria.push({ id, text, ...(['workspace', 'reply'].includes(evidence) ? { evidence } : {}) });
  }
  return criteria;
}

function normalizeDefinition(input) {
  const objective = cleanText(input?.objective);
  const criteria = normalizeCriteria(input?.criteria);
  const maxIterations = input?.maxIterations ?? 5;
  if (!objective || !criteria.length) throw new Error('请填写目标和至少一项可验证的验收标准。');
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 100) throw new Error('轮次预算必须是 1 到 100 之间的整数。');
  const constraints = Array.isArray(input.constraints) ? textList(input.constraints).join('\n') : cleanText(input.constraints);
  const pending = input.criteriaPending;
  return { objective, criteria, constraints, maxIterations,
    ...(['infer', 'classify'].includes(pending) ? { criteriaPending: pending } : {}) };
}

export function createGoalState(input) {
  return {
    id: randomUUID(), version: 0, ...normalizeDefinition(input), status: 'active', phase: 'ready',
    iteration: 0, resumePhase: null, reason: '', report: '', observations: [], verdicts: [], delegations: [],
  };
}

// 存储层接受没有目标的历史会话。损坏的目标不能作为继续执行的依据。
export function normalizeGoalState(value) {
  if (!value || !cleanText(value.id) || !statuses.has(value.status)) return null;
  let definition;
  try { definition = normalizeDefinition(value); } catch { return null; }
  if (!Number.isSafeInteger(value.iteration) || value.iteration < 0 || value.iteration > definition.maxIterations) return null;
  const phase = value.status === 'active' ? value.phase : 'stopped';
  if (value.status === 'active' && !activePhases.has(phase)) return null;
  const observations = Array.isArray(value.observations) ? value.observations : [];
  if (observations.some(item => !item || !cleanText(item.id) || !observationKinds.has(item.kind) ||
      !Array.isArray(item.criterionIds))) return null;
  return {
    id: value.id, version: Number.isSafeInteger(value.version) && value.version >= 0 ? value.version : 0,
    ...(value.status === 'active' && Number.isSafeInteger(value.ownerPid) && value.ownerPid > 0 && cleanText(value.ownerToken)
      ? { ownerPid: value.ownerPid, ownerToken: value.ownerToken } : {}),
    ...definition, status: value.status, phase, iteration: value.iteration,
    ...(cleanText(value.executorModel) ? { executorModel: cleanText(value.executorModel) } : {}),
    resumePhase: value.status === 'paused' && activePhases.has(value.resumePhase) ? value.resumePhase : null,
    reason: cleanText(value.reason), report: typeof value.report === 'string' ? value.report : '',
    observations: structuredClone(observations),
    verdicts: structuredClone(Array.isArray(value.verdicts) ? value.verdicts : []),
    delegations: structuredClone(Array.isArray(value.delegations) ? value.delegations : []),
  };
}

function stopGoal(goal, status, reason, resumePhase = null) {
  const { ownerPid, ownerToken, ...rest } = goal;
  return { ...rest, status, phase: 'stopped', reason, resumePhase };
}

export function beginGoalIteration(goal) {
  if (goal.status !== 'active' || goal.phase !== 'ready' || goal.criteriaPending) return goal;
  if (goal.iteration >= goal.maxIterations) {
    return stopGoal(goal, 'exhausted', '已用完轮次预算。');
  }
  return { ...goal, iteration: goal.iteration + 1, phase: 'executing' };
}

export function setInferredGoalCriteria(goal, entries) {
  if (!goal.criteriaPending || goal.status !== 'active' || goal.phase !== 'ready') return goal;
  const criteria = normalizeCriteria(entries);
  if (!criteria.length) throw new Error('未能从目标提取验收条件。');
  const { criteriaPending, ...resolved } = goal;
  return { ...resolved, criteria };
}

export function markGoalVerifying(goal, report = '', executorModel = '') {
  if (goal.status !== 'active' || goal.phase !== 'executing') return goal;
  return { ...goal, phase: 'verifying', report: typeof report === 'string' ? report : '',
    ...(cleanText(executorModel) ? { executorModel: cleanText(executorModel) } : {}) };
}

export function pauseGoal(goal, reason = '') {
  if (goal.status !== 'active') return goal;
  const delegations = goal.delegations.map(item => ['running', 'queued'].includes(item.status)
    ? { ...item, status: 'interrupted' } : item);
  return stopGoal({ ...goal, delegations }, 'paused', cleanText(reason) || '目标已暂停。', goal.phase);
}

export function resumeGoal(goal, { extraIterations = 0 } = {}) {
  if (!['paused', 'exhausted'].includes(goal.status)) throw new Error('仅可继续已暂停或预算耗尽的目标。');
  const maxIterations = goal.maxIterations + extraIterations;
  if (!Number.isSafeInteger(extraIterations) || extraIterations < 0 || !Number.isSafeInteger(maxIterations)) {
    throw new Error('增加的轮次必须为非负整数。');
  }
  if (maxIterations > 100) throw new Error('目标的总轮次预算不能超过 100。');
  if (goal.status === 'exhausted' && extraIterations === 0) throw new Error('轮次预算已耗尽，请指定增加的轮次。');
  const phase = goal.status === 'paused' && activePhases.has(goal.resumePhase) ? goal.resumePhase : 'ready';
  return { ...goal, status: 'active', phase, resumePhase: null, maxIterations, reason: '' };
}

export function recordGoalDelegation(goal, input) {
  const id = cleanText(input?.id);
  if (goal.status !== 'active' || !id) return goal;
  const previous = goal.delegations.find(item => item.id === id);
  const entry = {
    id, iteration: previous?.iteration ?? goal.iteration, name: cleanText(input.name) || previous?.name || '',
    status: cleanText(input.status) || previous?.status || 'running',
    summary: cleanText(input.summary) || previous?.summary || '',
    handoffPath: cleanText(input.handoffPath) || previous?.handoffPath || '',
    workerId: cleanText(input.workerId) || previous?.workerId || '',
  };
  const delegations = previous
    ? goal.delegations.map(item => item.id === id ? entry : item)
    : [...goal.delegations, entry];
  return { ...goal, delegations };
}

export function recordGoalObservation(goal, input) {
  const id = cleanText(input?.id);
  if (goal.status !== 'active' || !id || !observationKinds.has(input.kind)) return goal;
  if (goal.observations.some(item => item.id === id)) return goal;
  const validIds = new Set(goal.criteria.map(item => item.id));
  const requested = textList(input.criterionIds);
  if (requested.some(item => !validIds.has(item))) return goal;
  const criterionIds = requested;
  const observation = {
    id, iteration: goal.iteration, kind: input.kind, criterionIds, source: cleanText(input.source),
    revision: cleanText(input.revision), summary: cleanText(input.summary).slice(0, 4000),
    toolCallId: cleanText(input.toolCallId), checkKey: cleanText(input.checkKey),
    artifactPath: cleanText(input.artifactPath), artifactHash: cleanText(input.artifactHash),
  };
  if (Number.isSafeInteger(input.exitCode)) observation.exitCode = input.exitCode;
  return { ...goal, observations: [...goal.observations, observation] };
}

// 重新读取旧观察前检查版本与变更。变更无特定范围时，全部旧观察均需复验。
function applicableEvidence(goal, criterionId, currentRevision, proposedChecks = []) {
  const replyCriterion = goal.criteria.find(item => item.id === criterionId)?.evidence === 'reply';
  const bindings = new Set();
  const collectReferences = checks => {
    for (const check of checks) {
      if (check.criterionId === criterionId) for (const id of check.evidenceIds) bindings.add(id);
    }
  };
  for (const verdict of goal.verdicts) collectReferences(verdict.checks);
  collectReferences(proposedChecks);
  const boundChecks = new Set(goal.observations.filter(item =>
    item.checkKey && (item.criterionIds.includes(criterionId) || bindings.has(item.id))).map(item => item.checkKey));
  let evidence = [];
  for (const item of goal.observations) {
    if (item.kind === 'change' && (!item.criterionIds.length || item.criterionIds.includes(criterionId))) {
      evidence = [];
      continue;
    }
    if ((item.source === 'reply') !== replyCriterion) continue;
    if (replyCriterion && (item.iteration !== goal.iteration || !item.criterionIds.includes(criterionId))) continue;
    const linked = item.criterionIds.includes(criterionId) ||
      (!item.criterionIds.length && (bindings.has(item.id) || boundChecks.has(item.checkKey)));
    if (!linked || !item.source || !item.summary || !item.revision) continue;
    if (currentRevision && item.revision !== currentRevision) continue;
    if (item.kind === 'change') continue;
    evidence.push(item);
  }
  return evidence;
}

// 同一检查在同一版本复跑后以新结果为准。不同检查之间保留分歧，提示复验。
function latestChecks(evidence) {
  const byCheck = new Map();
  for (const item of evidence) byCheck.set(item.kind === 'observation' ? item.id : item.checkKey || item.id, item);
  return [...byCheck.values()];
}

function normalizeChecks(value) {
  return (Array.isArray(value) ? value : []).filter(check => cleanText(check?.criterionId)).map(check => ({
    criterionId: cleanText(check.criterionId), evidenceIds: textList(check.evidenceIds),
  }));
}

function groundedVerdict(goal, record) {
  if (!record.currentRevision) return false;
  const checks = new Map(record.checks.map(check => [check.criterionId, check.evidenceIds]));
  if (checks.size !== record.checks.length || record.checks.some(check => !goal.criteria.some(criterion => criterion.id === check.criterionId))) return false;
  const unreachable = record.decision === 'unreachable';
  const supported = criterion => {
    const evidence = latestChecks(applicableEvidence(goal, criterion.id, record.currentRevision, record.checks));
    const cited = checks.get(criterion.id) || [];
    if (!cited.length) return false;
    if (!unreachable && evidence.some(item => item.kind === 'fail')) return false;
    const items = cited.map(id => evidence.find(item => item.id === id));
    if (items.some(item => !item)) return false;
    if (unreachable) return items.some(item => item.kind === 'fail') && items.every(item => ['fail', 'observation'].includes(item.kind));
    return items.every(item => ['pass', 'observation'].includes(item.kind));
  };
  return unreachable ? Boolean(record.reason) && goal.criteria.some(supported) : goal.criteria.every(supported);
}

export function applyGoalVerdict(goal, input = {}) {
  if (goal.status !== 'active' || goal.phase !== 'verifying') return goal;
  const decision = decisions.has(input.decision) ? input.decision : 'pause';
  const record = {
    iteration: goal.iteration, decision, reason: cleanText(input.reason),
    observationCount: goal.observations.length, maxIterations: goal.maxIterations, report: goal.report,
    currentRevision: cleanText(input.currentRevision || input.revision),
    executorModel: cleanText(input.executorModel), gatekeeperModel: cleanText(input.gatekeeperModel),
    checks: normalizeChecks(input.checks),
  };
  let accepted = decision;
  let reason = record.reason;
  if (decision !== 'pause' && (!record.executorModel || !record.gatekeeperModel ||
      record.executorModel.toLowerCase() === record.gatekeeperModel.toLowerCase())) {
    accepted = 'pause';
    reason = '独立验收模型不可用，请检查模型配置后继续验收。';
  } else if ((decision === 'completed' || decision === 'unreachable') && !groundedVerdict(goal, record)) {
    accepted = 'continue';
    reason = '验收结论缺少与当前版本和验收项对应的有效机器证据。';
  }
  const result = { ...goal, verdicts: [...goal.verdicts, { ...record, accepted, resultReason: reason }], reason };
  if (accepted === 'pause') return pauseGoal(result, reason || '验收已暂停。');
  if (accepted === 'completed' || accepted === 'unreachable') {
    return stopGoal(result, accepted === 'completed' ? 'completed' : 'failed', reason);
  }
  if (goal.iteration >= goal.maxIterations) {
    return stopGoal(result, 'exhausted', reason || '目标尚待验收，轮次预算已耗尽。');
  }
  return { ...result, phase: 'ready' };
}

export function renderGoalSummary(goal) {
  const progress = `目标${statusLabels[goal.status]}（轮次 ${goal.iteration}/${goal.maxIterations}）`;
  return goal.reason ? progress + '。' + excerpt(goal.reason, 200) : progress;
}

export function renderGoalContext(goal, { fullReport = false } = {}) {
  if (!goal) return '';
  const priorities = goal.criteria.map(criterion => {
    const applicable = latestChecks(applicableEvidence(goal, criterion.id, ''));
    const failed = applicable.some(item => item.kind === 'fail');
    const passed = applicable.some(item => item.kind === 'pass' || item.kind === 'observation');
    const last = goal.observations.findLast(item => item.criterionIds.includes(criterion.id) || item.kind === 'change' && !item.criterionIds.length);
    const result = (rank, label, text) => ({ rank, label, text, criterion });
    if (goal.status === 'completed') return result(3, '验收通过', '');
    const rejected = goal.verdicts.at(-1);
    if (rejected?.accepted === 'unreachable' && rejected.checks.some(check => check.criterionId === criterion.id && check.evidenceIds.length)) {
      return result(3, '验收判定不可达', '');
    }
    if (last?.kind === 'environment_error') return result(0, '验证环境异常', `先修复验证环境，再检查 [${criterion.id}]`);
    if (failed && passed) return result(0, '证据冲突', `证据冲突，复验 [${criterion.id}]`);
    if (failed) return result(1, '检查失败', `修复失败原因后复验 [${criterion.id}]`);
    if (!passed && last?.kind === 'change') return result(2, '证据过期', `版本已变，重新验证 [${criterion.id}]`);
    if (!passed && criterion.evidence === 'reply') return result(2, '待交付回复', `在本轮回复中直接交付 [${criterion.id}] 所要求的内容`);
    if (!passed) return result(2, '证据不足', `尚缺机器证据，验证 [${criterion.id}]`);
    return result(3, '已有证据，待独立验收', `提交 [${criterion.id}] 的当前证据给独立验收员`);
  });
  const next = [...priorities].sort((a, b) => a.rank - b.rank)[0];
  return [
    `状态：${statusLabels[goal.status]}，阶段：${phaseLabels[goal.phase]}`,
    `目标：${goal.objective}`,
    goal.criteriaPending && '正在从目标中提取验收条件。',
    '验收标准：', ...priorities.map(({ criterion, label }) => `- [${criterion.id}] ${criterion.text}（${label}）`),
    goal.constraints && `约束：${goal.constraints}`,
    `轮次：${goal.iteration}/${goal.maxIterations}`, goal.reason && `上次结果：${goal.reason}`,
    goal.status === 'paused' && `恢复阶段：${phaseLabels[goal.resumePhase] || '等待开始下一轮'}。使用 /goal resume 继续。`,
    goal.status === 'exhausted' && '如需继续，可用 /goal resume +2 增加两轮。',
    next?.text && !['completed', 'failed'].includes(goal.status) && `建议下一步：${next.text}`,
    goal.report && (fullReport ? goal.report : `最近执行报告：${excerpt(goal.report, 1200)}`),
    ...goal.delegations.slice(-8).map(item => `子任务 ${item.id}（${workerLabels[item.status] || item.status}）：${excerpt(item.name, 100)} ${excerpt(item.summary, 250)} ${excerpt(item.handoffPath, 180)}`.trimEnd()),
    ...goal.observations.slice(-8).map(item => `观察 ${item.id}（${observationLabels[item.kind]}）：${excerpt(item.summary, 280)}`),
  ].filter(Boolean).join('\n');
}
