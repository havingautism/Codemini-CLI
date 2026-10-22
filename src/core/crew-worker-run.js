import { trimInline } from './string-utils.js';
import {
  appendCrewEvent,
  applyCrewReviewOutcome,
  buildCrewCompletionEvent,
  buildCrewReviewVerdictPrompt,
  listCrewMissionsFromState,
  listCrewWorkersFromState,
  listUnreadCrewInbox,
  patchCrewWorkerRecord,
  readCrewStateFile,
} from './crew-store.js';
import { findCrewMissionForWorker } from './crew-missions.js';
import {
  isCrewCommitAncestor,
  isCrewWorktreeDirty,
  listCrewChangedFiles,
} from './crew-worktree.js';
import { saveSubAgentHandoff } from './subagent-handoff-store.js';
import { isCrewCancelSignal } from './crew-cancel.js';
import {
  buildCrewWorkerCompletedWake,
  compactCrewWorkerTurnResultForParent,
} from './crew-snapshot.js';

export async function settleCrewMission({ workspaceRoot, workerId, dirty = false } = {}) {
  const state = await readCrewStateFile(workspaceRoot);
  const worker = listCrewWorkersFromState(state).find((item) => item.id === workerId);
  const kind = worker?.kind === 'survey' ? 'survey' : 'build';
  if (dirty) {
    return {
      runError: kind === 'survey'
        ? 'Survey worktree is dirty. Revert edits. Do not commit.'
        : 'Worktree is dirty. Commit the source changes before finishing.',
    };
  }
  const unread = listUnreadCrewInbox(state, { to: workerId });
  if (unread.length) {
    return {
      runError: `Unread crew mail (${unread.length}). Read it before finishing.`,
    };
  }
  const changed = await listCrewChangedFiles(workspaceRoot, state?.base, worker?.branch);
  const missions = listCrewMissionsFromState(state);
  const mission = missions.find((item) => item.workerId === workerId || item.id === worker?.missionId);
  if (mission?.status === 'completed' || mission?.status === 'merged') {
    return { runError: '' };
  }
  if (kind === 'survey') {
    if (changed.length) {
      return {
        runError: `Survey changed ${changed.slice(0, 5).join(', ')}. Revert those files, then call crew_complete.`,
      };
    }
    return {
      runError: 'Call crew_complete with the survey report before this mission can be completed.',
    };
  }
  if (!changed.length) {
    return {
      runError: 'Build mission has no commits against the base. Commit the work, then call crew_complete.',
    };
  }
  return {
    runError: 'Call crew_complete with a report before this mission can be completed.',
  };
}

function formatPlanStepOutputForDisplay(text = '', maxChars = 6000) {
  const body = String(text || '').trim();
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
}

/** Tool cards from the worker sub-session (includes crew_complete after streaming ends). */
export function buildSubagentToolSegmentsFromMessages(messages = []) {
  const toolCardsById = new Map();
  const toolCards = [];
  const source = Array.isArray(messages) ? messages : [];
  for (const msg of source) {
    if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const id = String(tc?.id || `tool-${toolCards.length + 1}`);
        if (toolCardsById.has(id)) continue;
        const card = {
          id,
          name: tc?.function?.name || tc?.name || 'tool',
          arguments: tc?.function?.arguments || tc?.arguments || {},
          status: tc?.status || 'done',
          durationMs: Number.isFinite(Number(tc?.durationMs)) ? Number(tc.durationMs) : null,
          summary: tc?.summary || '',
          result: '',
        };
        toolCardsById.set(id, card);
        toolCards.push(card);
      }
    } else if (msg?.role === 'tool') {
      const id = String(msg.tool_call_id || '');
      const card = toolCardsById.get(id);
      if (!card) continue;
      card.result = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      if (typeof msg.tool_summary === 'string' && msg.tool_summary.trim()) card.summary = msg.tool_summary.trim();
      if (Number.isFinite(Number(msg.tool_duration_ms))) card.durationMs = Number(msg.tool_duration_ms);
      if (typeof msg.tool_status === 'string' && msg.tool_status.trim()) card.status = msg.tool_status.trim();
    }
  }
  return toolCards.length > 0 ? [{ type: 'tools', cards: toolCards }] : [];
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
  let missionGate = null;
  let missionSubmittedDuringRun = false;
  let workerWakeStatus = '';
  try {
    const reviewBox = { verdict: null };
    const crewActor = reviewingWorkerId
      ? `reviewer:${reviewingWorkerId}`
      : String(lockedCrewWorkerId || '').trim();
    const output = await runSubAgentTask({
      role: taskRole,
      task: workerTask,
      initialTasks: assignedTasks,
      goal: declaredGoal,
      priorSteps: [],
      parentSession: session,
      extraRolePrompt: reviewingWorkerId ? buildCrewReviewVerdictPrompt() : '',
      config: {
        ...config,
        runtime: {
          ...(config.runtime || {}),
          crew_session: true,
          crew_project_root: workspaceRoot,
          ...(crewActor ? { crew_actor: crewActor } : {}),
          ...(reviewingWorkerId
            ? {
                onCrewReviewVerdict: (verdict) => {
                  reviewBox.verdict = verdict;
                },
              }
            : {}),
        },
      },
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
        workerWakeStatus = 'failed';
        await patchCrewWorkerRecord(workspaceRoot, lockedCrewWorkerId, {
          runStatus: 'failed',
          dirty: crewDirty === true,
          runError: String(output?.error || output?.text || '').trim().slice(0, 400),
        }).catch(() => null);
      } else {
        const stateAfter = (await readCrewStateFile(workspaceRoot)) || {};
        const workerAfter = listCrewWorkersFromState(stateAfter).find((item) => item.id === lockedCrewWorkerId);
        const missionAfter = findCrewMissionForWorker(listCrewMissionsFromState(stateAfter), workerAfter);
        missionSubmittedDuringRun = missionAfter?.status === 'completed';
        if (missionSubmittedDuringRun) {
          workerWakeStatus = '';
          await patchCrewWorkerRecord(workspaceRoot, lockedCrewWorkerId, {
            runStatus: 'completed',
            dirty: crewDirty === true,
            runError: '',
            ...(savedHandoff?.path ? { lastHandoffPath: savedHandoff.path } : {}),
          }).catch(() => null);
        } else {
          const gate = missionGate = await settleCrewMission({
            workspaceRoot,
            workerId: lockedCrewWorkerId,
            dirty: crewDirty === true,
          });
          workerWakeStatus = 'awaiting_submit';
          await patchCrewWorkerRecord(workspaceRoot, lockedCrewWorkerId, {
            runStatus: 'awaiting_submit',
            dirty: crewDirty === true,
            runError: gate.runError,
            ...(savedHandoff?.path ? { lastHandoffPath: savedHandoff.path } : {}),
          }).catch(() => null);
        }
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
    let reviewIncomplete;
    if (!cancelled && !failed && reviewingWorkerId && reviewCommit) {
      const applied = await applyCrewReviewOutcome({
        cwd: workspaceRoot,
        workerId: reviewingWorkerId,
        workerRecord: reviewingWorkerRecord,
        reviewCommit,
        verdict: reviewBox.verdict,
        outputText: output.text,
      });
      reviewPassed = applied.reviewPassed;
      reviewLoopStopped = applied.reviewLoopStopped;
      reviewRound = applied.reviewRound;
      reviewIncomplete = applied.reviewIncomplete === true;
    }
    const stepSegments = buildSubagentToolSegmentsFromMessages(output.messages || []);
    emit({
      type: 'plan:step_done',
      toolCallId: callId,
      step: 1,
      total: 1,
      role: persona,
      title,
      status: cancelled ? 'cancelled' : failed ? 'failed' : 'done',
      taskId: dependencyTaskId,
      dependsOn: dependencyDependencies,
      summary: trimInline(output.text || '', 160),
      output: formatPlanStepOutputForDisplay(output.text || ''),
      sdkProvider: stepSdkProvider,
      model: stepModel,
      ...(stepSegments.length ? { stepSegments } : {}),
      ...(savedHandoff ? { handoffPath: savedHandoff.path } : {}),
      ...(childUsage ? { usage: childUsage, usageScope: 'subagent' } : {}),
    });
    const fileChanges = subAgentAllowListMayMutate(resolvedTools)
      ? collectPlanImplementationFileChanges([
          { role: policyKey, messages: output.messages || [] },
        ])
      : [];
    const completionSummary = trimInline(
      [missionGate?.runError, output.text].filter(Boolean).join(' '),
      200,
    );
    const shouldWakeWorker = !cancelled && (
      reviewingWorkerId
      || workerWakeStatus === 'failed'
      || workerWakeStatus === 'awaiting_submit'
    );
    if (shouldWakeWorker) {
      const wakeStatus = reviewingWorkerId
        ? (failed ? 'failed' : 'completed')
        : workerWakeStatus;
      await persistCrewCompletionEvent(workspaceRoot, {
        workerId: lockedCrewWorkerId,
        reviewOf: reviewingWorkerId,
        status: wakeStatus === 'awaiting_submit' ? 'interrupted' : wakeStatus,
        dirty: crewDirty,
        workerKind: isCrewSurvey ? 'survey' : '',
        summary: completionSummary,
        handoffPath: savedHandoff?.path,
        reviewPassed,
        reviewLoopStopped,
        reviewRound,
        reviewIncomplete,
      });
    }
    if (shouldWakeWorker && typeof onWake === 'function') {
      onWake(buildCrewWorkerCompletedWake({
        workerId: lockedCrewWorkerId,
        reviewOf: reviewingWorkerId,
        status: reviewingWorkerId
          ? (failed ? 'failed' : 'completed')
          : workerWakeStatus,
        dirty: crewDirty,
        workerKind: isCrewSurvey ? 'survey' : '',
        summary: completionSummary,
        handoffPath: savedHandoff?.path,
        reviewPassed,
        reviewLoopStopped,
        reviewRound,
        reviewIncomplete,
        name: reviewingWorkerId
          ? String(reviewingWorkerRecord?.name || '').trim()
          : String(persona || '').trim(),
      }));
    }
    const parentMessage = lockedCrewWorkerId && !reviewingWorkerId
      ? compactCrewWorkerTurnResultForParent({
        text: output.text,
        summary,
        handoffPath: savedHandoff?.path,
        workerId: lockedCrewWorkerId,
        missionSubmitted: missionSubmittedDuringRun,
        submitHint: missionGate?.runError,
      })
      : compactSubAgentResultForParent({
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
          ...(reviewIncomplete === true ? { reviewIncomplete: true } : {}),
          ...(reviewLoopStopped === true ? { reviewLoopStopped: true, reviewRound } : {}),
        } : {}),
      });
    return {
      ok: !failed && !cancelled && reviewIncomplete !== true,
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
      message: parentMessage,
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
        name: reviewingWorkerId
          ? String(reviewingWorkerRecord?.name || '').trim()
          : String(persona || '').trim(),
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

export async function emitCrewMissionSubmitWake({
  workspaceRoot,
  result,
  onWake,
} = {}) {
  if (!result?.ok || !workspaceRoot) return;
  const wakeStatus = String(result.wakeStatus || 'completed').trim();
  await persistCrewCompletionEvent(workspaceRoot, {
    workerId: result.workerId,
    status: wakeStatus === 'awaiting_submit' ? 'interrupted' : wakeStatus,
    dirty: result.dirty,
    workerKind: result.workerKind,
    summary: String(result.report || result.message || '').slice(0, 200),
  });
  if (typeof onWake !== 'function') return;
  onWake(buildCrewWorkerCompletedWake({
    workerId: result.workerId,
    status: wakeStatus,
    dirty: result.dirty,
    workerKind: result.workerKind,
    summary: String(result.report || '').slice(0, 200),
    name: result.workerName,
  }));
}
