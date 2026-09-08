import { trimInline } from './string-utils.js';
import {
  appendCrewEvent,
  buildCrewCompletionEvent,
  formatCrewReviewText,
  nextCrewReviewLoopState,
  patchCrewWorkerRecord,
} from './crew-store.js';
import {
  isCrewCommitAncestor,
  isCrewWorktreeDirty,
} from './crew-worktree.js';
import { saveSubAgentHandoff } from './subagent-handoff-store.js';
import { isCrewCancelSignal } from './crew-cancel.js';
import { buildCrewWorkerCompletedWake } from './crew-snapshot.js';

function formatPlanStepOutputForDisplay(text = '', maxChars = 6000) {
  const body = String(text || '').trim();
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
}

async function persistCrewCompletionEvent(workspaceRoot, input) {
  const event = buildCrewCompletionEvent(input);
  if (!event || !workspaceRoot) return;
  await appendCrewEvent(workspaceRoot, event).catch(() => null);
}

export async function runCrewWorkerJob({
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
  lockedCrewWorkerId,
  reviewingWorkerId,
  reviewingWorkerRecord,
  reviewCommit,
  pendingRebaseOnto,
  isCrewSurvey,
  crewDirty: initialCrewDirty,
  signal,
} = {}) {
  let childUsage = null;
  let crewDirty = initialCrewDirty;
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
              onCrewReviewVerdict: (verdict) => {
                reviewBox.verdict = verdict;
              },
            },
          }
        : config,
      model: stepModel,
      systemPrompt,
      onAgentEvent,
      requestToolApproval,
      signal,
      changeTracker: workerChangeTracker,
      backupManager: workerBackupManager,
      parentToolCallId: callId,
      tools: reviewingWorkerId
        ? [...resolvedTools, 'submit_crew_review']
        : resolvedTools,
      onUsage: (usage) => {
        childUsage = mergeModelUsage(childUsage, usage);
      },
      projectIsGit: Boolean(config?.runtime?.project_is_git),
      workspaceRoot: workerWorkspaceRoot,
    });
    const cancelled = isCrewCancelSignal(signal) || Boolean(output?.aborted && isCrewCancelSignal(signal));
    const failed = reviewingWorkerId
      ? Boolean(output?.hasErrorLine || cancelled)
      : subAgentRunFailed(output, cancelled ? signal : null);
    if (!cancelled && !reviewingWorkerId && workerWorkspaceRoot !== workspaceRoot) {
      crewDirty = await isCrewWorktreeDirty(workerWorkspaceRoot).catch(() => true);
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
    if (lockedCrewWorkerId && !reviewingWorkerId && !cancelled) {
      if (failed) {
        await patchCrewWorkerRecord(workspaceRoot, lockedCrewWorkerId, {
          runStatus: 'failed',
          dirty: crewDirty === true,
          runError: String(output?.error || output?.text || '').trim().slice(0, 400),
        }).catch(() => null);
      } else {
        const patch = {
          runStatus: 'completed',
          dirty: crewDirty === true,
          runError: '',
        };
        if (savedHandoff?.path) patch.lastHandoffPath = savedHandoff.path;
        await patchCrewWorkerRecord(workspaceRoot, lockedCrewWorkerId, patch).catch(() => null);
      }
    }
    if (
      !cancelled
      && !failed
      && pendingRebaseOnto
      && lockedCrewWorkerId
      && !reviewingWorkerId
      && crewDirty === false
    ) {
      const ontoDone = await isCrewCommitAncestor(
        workerWorkspaceRoot,
        pendingRebaseOnto,
      ).catch(() => false);
      if (ontoDone) {
        await patchCrewWorkerRecord(workspaceRoot, lockedCrewWorkerId, {
          landBase: pendingRebaseOnto,
          rebaseOnto: '',
        }).catch(() => null);
      }
    }
    let reviewPassed;
    let reviewLoopStopped;
    let reviewRound;
    if (!cancelled && !failed && reviewingWorkerId && reviewCommit) {
      const verdict = reviewBox.verdict;
      reviewPassed = verdict?.passed === true;
      const loop = nextCrewReviewLoopState(reviewingWorkerRecord, {
        passed: reviewPassed,
        findings: verdict?.findings || [],
      });
      reviewLoopStopped = loop.reviewLoopStopped;
      reviewRound = loop.reviewRound;
      await patchCrewWorkerRecord(workspaceRoot, reviewingWorkerId, {
        reviewedCommit: reviewCommit,
        reviewPassed,
        reviewText: verdict
          ? formatCrewReviewText(verdict)
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
    if (!cancelled) {
      await persistCrewCompletionEvent(workspaceRoot, {
        workerId: lockedCrewWorkerId,
        reviewOf: reviewingWorkerId,
        status: failed ? 'failed' : 'completed',
        dirty: crewDirty,
        workerKind: isCrewSurvey ? 'survey' : '',
        summary: completionSummary,
        handoffPath: savedHandoff?.path,
        reviewPassed,
        reviewLoopStopped,
        reviewRound,
      });
    }
    if (!cancelled && typeof onWake === 'function') {
      onWake(buildCrewWorkerCompletedWake({
        workerId: lockedCrewWorkerId,
        reviewOf: reviewingWorkerId,
        status: failed ? 'failed' : 'completed',
        dirty: crewDirty,
        workerKind: isCrewSurvey ? 'survey' : '',
        summary: completionSummary,
        handoffPath: savedHandoff?.path,
        reviewPassed,
        reviewLoopStopped,
        reviewRound,
      }));
    }
    return {
      ok: !failed && !cancelled,
      cancelled,
      workflowComplete: false,
      name: persona,
      role: persona,
      tools: resolvedTools,
      text: output.text || '',
      ...(childUsage ? { usage: childUsage } : {}),
      artifactPaths: output.artifactPaths || [],
      ...(savedHandoff ? { handoffPath: savedHandoff.path } : {}),
      ...(fileChanges.length ? { fileChanges } : {}),
      ...(crewDirty === undefined ? {} : { dirty: crewDirty }),
      message: compactSubAgentResultForParent({
        text: output.text,
        summary,
        handoffPath: savedHandoff?.path,
        artifactPaths: output.artifactPaths,
        ...(crewDirty === undefined ? {} : { dirty: crewDirty }),
        ...(isCrewSurvey ? { workerKind: 'survey' } : {}),
        ...(lockedCrewWorkerId && !reviewingWorkerId ? { workerId: lockedCrewWorkerId } : {}),
        ...(reviewingWorkerId ? {
          reviewOf: reviewingWorkerId,
          reviewPassed,
          ...(reviewLoopStopped === true ? { reviewLoopStopped: true, reviewRound } : {}),
        } : {}),
      }),
    };
  } catch (err) {
    const cancelled = isCrewCancelSignal(signal) || err?.crewCancel === true || err?.name === 'AbortError';
    emit({
      type: 'plan:step_done',
      toolCallId: callId,
      step: 1,
      total: 1,
      role: persona,
      title,
      status: cancelled && isCrewCancelSignal(signal) ? 'cancelled' : 'failed',
      taskId: dependencyTaskId,
      dependsOn: dependencyDependencies,
      summary: String(err?.message || err),
      sdkProvider: stepSdkProvider,
      model: stepModel,
      ...(childUsage ? { usage: childUsage, usageScope: 'subagent' } : {}),
    });
    if (!isCrewCancelSignal(signal) && lockedCrewWorkerId && !reviewingWorkerId) {
      await patchCrewWorkerRecord(workspaceRoot, lockedCrewWorkerId, {
        runStatus: 'failed',
        runError: String(err?.message || err).slice(0, 400),
      }).catch(() => null);
    }
    if (!isCrewCancelSignal(signal)) {
      await persistCrewCompletionEvent(workspaceRoot, {
        workerId: lockedCrewWorkerId,
        reviewOf: reviewingWorkerId,
        status: 'failed',
        summary: String(err?.message || err).slice(0, 200),
      });
    }
    if (!isCrewCancelSignal(signal) && typeof onWake === 'function') {
      onWake(buildCrewWorkerCompletedWake({
        workerId: lockedCrewWorkerId,
        reviewOf: reviewingWorkerId,
        status: 'failed',
        summary: String(err?.message || err).slice(0, 200),
      }));
    }
    return {
      ok: false,
      cancelled: isCrewCancelSignal(signal),
      error: String(err?.message || err),
      text: '',
      ...(childUsage ? { usage: childUsage } : {}),
    };
  } finally {
    if (typeof releaseInFlight === 'function') {
      releaseInFlight(lockedCrewWorkerId || reviewingWorkerId);
    }
  }
}
