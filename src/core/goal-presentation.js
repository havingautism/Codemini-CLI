import { getGoalRetryVerificationId } from './goal-state.js';
import { sha256 } from './crypto-utils.js';

function excerpt(value, limit = 480) {
  if (typeof value !== 'string') return '';
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

function evidenceSummary(item) {
  return {
    id: item.id, source: item.source, kind: item.kind, summary: item.summary || '',
    criterionIds: item.criterionIds || [], artifactPath: item.artifactPath || '',
    ...(item.revalidatedFrom ? { revalidatedFrom: item.revalidatedFrom } : {}),
    ...(Number.isInteger(item.exitCode) ? { exitCode: item.exitCode } : {}),
  };
}

// 旧版只对子代理工具调用写入“委派编号/工具调用编号”。前缀有歧义时不推测归属。
function legacyAttemptId(callId, workerIds) {
  if (!callId) return null;
  let match = null;
  for (let i = callId.indexOf('/'); i >= 0; i = callId.indexOf('/', i + 1)) {
    const prefix = callId.slice(0, i);
    if (workerIds.has(prefix)) {
      if (match) return null;
      match = prefix;
    }
  }
  return match;
}

// 只取界面需要的字段。工具证据和验收引用分开，以免复用前次结果被误读为又执行了一次。
export function projectGoalPresentation(goal) {
  if (!goal?.id) return null;
  const tasks = goal.tasks || [];
  const workerIds = new Set(tasks.flatMap(t => (t.attempts || [])
    .filter(a => a.owner === 'subagent').map(a => a.id)));
  const evidenceByAttempt = new Map();
  const evidenceById = new Map();
  const lastFileByCall = new Map();
  let epoch = '';
  for (const item of goal.observations || []) {
    const evidence = evidenceSummary(item);
    if (item.kind === 'change') epoch = item.id;
    if (item.artifactPath && item.toolCallId) {
      const key = JSON.stringify([item.toolCallId, item.checkKey, item.criterionIds]);
      const previous = lastFileByCall.get(key);
      // 旧记录可凭变更编号与原证据重算续用编号。相同工具再次真实读取会产生另一类编号。
      if (!evidence.revalidatedFrom && epoch && previous &&
          item.id === 'ev-' + sha256(JSON.stringify([epoch, previous])).slice(0, 32)) {
        evidence.revalidatedFrom = previous;
      }
      lastFileByCall.set(key, item.id);
    }
    evidenceById.set(item.id, evidence);
    if (evidence.revalidatedFrom) continue;
    const id = item.attemptId || legacyAttemptId(item.toolCallId, workerIds);
    if (!id) continue;
    if (!evidenceByAttempt.has(id)) evidenceByAttempt.set(id, []);
    evidenceByAttempt.get(id).push(evidence);
  }
  const handoffs = new Map((goal.delegations || []).filter(d => d.handoffPath).map(d => [d.id, d]));
  return {
    id: goal.id, version: goal.version, objective: goal.objective, status: goal.status,
    criteria: (goal.criteria || []).map(({ id, text }) => ({ id, text })),
    retryVerificationId: getGoalRetryVerificationId(goal),
    tasks: tasks.map(task => ({
      id: task.id, title: task.title, dependsOn: task.dependsOn || [], criterionIds: task.criterionIds || [],
      status: task.status, reviewReason: excerpt(task.reviewReason), hasCurrentProof: Boolean(task.verification),
      attempts: (task.attempts || []).map((attempt, index) => {
        const handoff = handoffs.get(attempt.id);
        const reviews = attempt.reviews || [];
        const latest = index === task.attempts.length - 1;
        return {
          id: attempt.id, iteration: attempt.iteration, owner: attempt.owner, model: attempt.model || '',
          status: attempt.status,
          handoff: handoff ? { path: handoff.handoffPath, summary: excerpt(handoff.summary) } : null,
          evidence: evidenceByAttempt.get(attempt.id) || [],
          reviews: reviews.map((review, j) => ({
            decision: review.decision, reason: excerpt(review.reason), gatekeeperModel: review.gatekeeperModel || '',
            workspaceOnly: Boolean(review.workspaceOnly),
            current: Boolean(latest && j === reviews.length - 1 && task.verification && review.decision === 'completed'),
            checks: (review.checks || []).map(check => ({
              criterionId: check.criterionId, evidenceIds: check.evidenceIds,
              evidence: (check.evidenceIds || []).map(id => evidenceById.get(id)).filter(Boolean),
            })),
          })),
        };
      }),
    })),
  };
}
