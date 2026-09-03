import { trimInline } from './string-utils.js';
import {
  formatTowerReviewText,
  nextTowerReviewLoopState,
  patchTowerWorkerRecord,
} from './tower-store.js';
import {
  isTowerCommitAncestor,
  isTowerWorktreeDirty,
} from './tower-worktree.js';
import { saveSubAgentHandoff } from './subagent-handoff-store.js';
import { buildTowerWorkerCompletedWake } from './tower-snapshot.js';

function formatPlanStepOutputForDisplay(text = '', maxChars = 6000) {
  const body = String(text || '').trim();
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
}

export async function runTowerWorkerJob({
  runSubAgentTask,
  subAgentRunFailed,
  compactSubAgentResultForParent,
  collectPlanImplementationFileChanges,
  subAgentAllowListMayMutate,
  mergeModelUsage,
  emit,
  onWake,
  releaseInFlight,
  callId,
  persona,
  policyKey,
  taskRole,
  title,
  dependencyTaskId,
  dependencyDependencies,
  workerTask,
  workerWorkspaceRoot,
  workerChangeTracker,
  workerBackupManager,
  session,
  workspaceRoot,
  config,
  stepModel,
  systemPrompt,
  onAgentEvent,
  requestToolApproval,
  resolvedTools,
  toolAllowList,
  assignedTasks,
  declaredGoal,
  taskPrompt,
  summary,
  stepSdkProvider,
  lockedTowerWorkerId,
  reviewingWorkerId,
  reviewingWorkerRecord,
  reviewCommit,
  pendingRebaseOnto,
  isTowerSurvey,
  towerDirty: initialTowerDirty,
} = {}) {
  let childUsage = null;
  let towerDirty = initialTowerDirty;
  try {
    const reviewBox = { verdict: null };
    const output = await runSubAgentTask({
      role: taskRole,
      task: workerTask,
      initialTasks: assignedTasks,
      goal: declaredGoal,
      priorSteps: [],
      parentSession: session,
      config: reviewingWorkerId
        ? {
            ...config,
            runtime: {
              ...(config.runtime || {}),
              onTowerReviewVerdict: (verdict) => {
                reviewBox.verdict = verdict;
              },
            },
          }
        : config,
      model: stepModel,
      systemPrompt,
      onAgentEvent,
      requestToolApproval,
      signal: undefined,
      changeTracker: workerChangeTracker,
      backupManager: workerBackupManager,
      parentToolCallId: callId,
      tools: reviewingWorkerId
        ? [...resolvedTools, 'submit_tower_review']
        : resolvedTools,
      onUsage: (usage) => {
        childUsage = mergeModelUsage(childUsage, usage);
      },
      projectIsGit: Boolean(config?.runtime?.project_is_git),
      workspaceRoot: workerWorkspaceRoot,
    });
    const failed = reviewingWorkerId
      ? Boolean(output?.hasErrorLine)
      : subAgentRunFailed(output, null);
    if (!reviewingWorkerId && workerWorkspaceRoot !== workspaceRoot) {
      towerDirty = await isTowerWorktreeDirty(workerWorkspaceRoot).catch(() => true);
    }
    const savedHandoff = failed
      ? null
      : await saveSubAgentHandoff({
          workspaceRoot,
          sessionId: session.id,
          handoffId: callId,
          name: persona,
          task: taskPrompt,
          summary,
          text: output.text,
          artifactPaths: output.artifactPaths,
        }).catch(() => null);
    if (lockedTowerWorkerId && !reviewingWorkerId) {
      if (failed) {
        await patchTowerWorkerRecord(workspaceRoot, lockedTowerWorkerId, {
          runStatus: 'failed',
          dirty: towerDirty === true,
          runError: String(output?.error || output?.text || '').trim().slice(0, 400),
        }).catch(() => null);
      } else {
        const patch = {
          runStatus: 'completed',
          dirty: towerDirty === true,
          runError: '',
        };
        if (savedHandoff?.path) patch.lastHandoffPath = savedHandoff.path;
        await patchTowerWorkerRecord(workspaceRoot, lockedTowerWorkerId, patch).catch(() => null);
      }
    }
    if (
      !failed
      && pendingRebaseOnto
      && lockedTowerWorkerId
      && !reviewingWorkerId
      && towerDirty === false
    ) {
      const ontoDone = await isTowerCommitAncestor(
        workerWorkspaceRoot,
        pendingRebaseOnto,
      ).catch(() => false);
      if (ontoDone) {
        await patchTowerWorkerRecord(workspaceRoot, lockedTowerWorkerId, {
          landBase: pendingRebaseOnto,
          rebaseOnto: '',
        }).catch(() => null);
      }
    }
    let reviewPassed;
    let reviewLoopStopped;
    let reviewRound;
    if (!failed && reviewingWorkerId && reviewCommit) {
      const verdict = reviewBox.verdict;
      reviewPassed = verdict?.passed === true;
      const loop = nextTowerReviewLoopState(reviewingWorkerRecord, {
        passed: reviewPassed,
        findings: verdict?.findings || [],
      });
      reviewLoopStopped = loop.reviewLoopStopped;
      reviewRound = loop.reviewRound;
      await patchTowerWorkerRecord(workspaceRoot, reviewingWorkerId, {
        reviewedCommit: reviewCommit,
        reviewPassed,
        reviewText: verdict
          ? formatTowerReviewText(verdict)
          : String(output.text || '').trim(),
        ...loop,
      }).catch(() => null);
    }
    emit({
      type: 'plan:step_done',
      toolCallId: callId,
      step: 1,
      total: 1,
      role: persona,
      title,
      status: failed ? 'failed' : 'done',
      taskId: dependencyTaskId,
      dependsOn: dependencyDependencies,
      summary: trimInline(output.text || '', 160),
      output: formatPlanStepOutputForDisplay(output.text || ''),
      sdkProvider: stepSdkProvider,
      model: stepModel,
      ...(savedHandoff ? { handoffPath: savedHandoff.path } : {}),
      ...(childUsage ? { usage: childUsage, usageScope: 'subagent' } : {}),
    });
    const fileChanges = subAgentAllowListMayMutate(resolvedTools)
      ? collectPlanImplementationFileChanges([
          { role: policyKey, messages: output.messages || [] },
        ])
      : [];
    const completionSummary = trimInline(output.text || '', 200);
    if (typeof onWake === 'function') {
      onWake(buildTowerWorkerCompletedWake({
        workerId: lockedTowerWorkerId,
        reviewOf: reviewingWorkerId,
        status: failed ? 'failed' : 'completed',
        dirty: towerDirty,
        workerKind: isTowerSurvey ? 'survey' : '',
        summary: completionSummary,
        handoffPath: savedHandoff?.path,
        reviewPassed,
        reviewLoopStopped,
        reviewRound,
      }));
    }
    return {
      ok: !failed,
      workflowComplete: false,
      name: persona,
      role: persona,
      tools: resolvedTools,
      text: output.text || '',
      ...(childUsage ? { usage: childUsage } : {}),
      artifactPaths: output.artifactPaths || [],
      ...(savedHandoff ? { handoffPath: savedHandoff.path } : {}),
      ...(fileChanges.length ? { fileChanges } : {}),
      ...(towerDirty === undefined ? {} : { dirty: towerDirty }),
      message: compactSubAgentResultForParent({
        text: output.text,
        summary,
        handoffPath: savedHandoff?.path,
        artifactPaths: output.artifactPaths,
        ...(towerDirty === undefined ? {} : { dirty: towerDirty }),
        ...(isTowerSurvey ? { workerKind: 'survey' } : {}),
        ...(lockedTowerWorkerId && !reviewingWorkerId ? { workerId: lockedTowerWorkerId } : {}),
        ...(reviewingWorkerId ? {
          reviewOf: reviewingWorkerId,
          reviewPassed,
          ...(reviewLoopStopped === true ? { reviewLoopStopped: true, reviewRound } : {}),
        } : {}),
      }),
    };
  } catch (err) {
    emit({
      type: 'plan:step_done',
      toolCallId: callId,
      step: 1,
      total: 1,
      role: persona,
      title,
      status: 'failed',
      taskId: dependencyTaskId,
      dependsOn: dependencyDependencies,
      summary: String(err?.message || err),
      sdkProvider: stepSdkProvider,
      model: stepModel,
      ...(childUsage ? { usage: childUsage, usageScope: 'subagent' } : {}),
    });
    if (lockedTowerWorkerId && !reviewingWorkerId) {
      await patchTowerWorkerRecord(workspaceRoot, lockedTowerWorkerId, {
        runStatus: 'failed',
        runError: String(err?.message || err).slice(0, 400),
      }).catch(() => null);
    }
    if (typeof onWake === 'function') {
      onWake(buildTowerWorkerCompletedWake({
        workerId: lockedTowerWorkerId,
        reviewOf: reviewingWorkerId,
        status: 'failed',
        summary: String(err?.message || err).slice(0, 200),
      }));
    }
    return {
      ok: false,
      error: String(err?.message || err),
      text: '',
      ...(childUsage ? { usage: childUsage } : {}),
    };
  } finally {
    if (typeof releaseInFlight === 'function') {
      releaseInFlight(lockedTowerWorkerId || reviewingWorkerId);
    }
  }
}
