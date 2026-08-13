import {
  confirmResearchPlan,
  createResearchSession,
  deleteResearchSession,
  getResearchSessionDetail,
  listResearchSessions,
  updateResearchRunState,
  updateResearchSession,
} from '../../src/core/research-store.js';
import {
  abortResearchRun,
  getActiveResearchRun,
  runResearchLeadTurn,
} from '../../src/core/research-runtime.js';

const runClients = new Map();
const queuedRuns = new Set();

function isResearchRunInFlight(sessionId) {
  const id = String(sessionId || '');
  return queuedRuns.has(id) || Boolean(getActiveResearchRun(id));
}

function getRecoverableResearchDetail(sessionId) {
  const id = String(sessionId || '');
  let detail = getResearchSessionDetail(id);
  if (detail?.runState === 'running' && !isResearchRunInFlight(id)) {
    updateResearchRunState(id, {
      state: 'paused',
      phase: detail.lastRunPhase,
      error: 'The previous research run was interrupted and can be resumed.',
    });
    detail = getResearchSessionDetail(id);
  }
  return detail;
}

export function shouldAutoWriteResearchResult(phase, result) {
  return phase === 'investigating' && result?.readyForReport === true;
}

export function isResearchReportComplete(session) {
  return session?.phase === 'done' && Boolean(String(session?.reportMarkdown || '').trim());
}

function broadcast(sessionId, payload) {
  const clients = runClients.get(String(sessionId || ''));
  if (!clients?.size) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}

export function listResearchSessionsForApi({ query = '' } = {}) {
  return {
    sessions: listResearchSessions({ query }).map((session) => ({
      id: session.id,
      title: session.plan?.title || '',
      question: session.question,
      phase: session.phase,
      runState: session.runState,
      lastRunPhase: session.lastRunPhase,
      goal: session.preferences?.goal || '',
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
    })),
  };
}

export function getResearchSessionForApi(sessionId) {
  const detail = getRecoverableResearchDetail(sessionId);
  if (!detail) return null;
  return {
    session: detail,
    running: isResearchRunInFlight(sessionId),
  };
}

export function createResearchSessionForApi(body = {}) {
  const session = createResearchSession({
    question: body.question,
    preferences: body.preferences || {
      goal: body.goal,
      constraints: body.constraints,
      clarify: body.clarify,
    },
    seed: body.seed || body.seeds || [],
    budget: body.budget || {},
    phase: 'planning',
  });
  return { ok: true, session: getResearchSessionDetail(session.id) };
}

export function updateResearchPlanForApi(sessionId, body = {}) {
  const current = getResearchSessionDetail(sessionId);
  if (!current) throw new Error('research session not found');
  if (!['planning', 'awaiting_plan_confirm'].includes(current.phase)) {
    throw new Error('research plan can only be edited before investigation starts');
  }
  if (isResearchRunInFlight(sessionId)) throw new Error('research run already in progress');
  const plan = body.plan && typeof body.plan === 'object' ? body.plan : body;
  const updated = updateResearchSession(sessionId, {
    plan,
    phase: body.phase || (current.phase === 'planning' ? 'awaiting_plan_confirm' : current.phase),
    runState: 'idle',
    lastRunPhase: 'planning',
    lastError: '',
    preferences: plan?.goal ? { goal: String(plan.goal) } : undefined,
  });
  return { ok: true, session: getResearchSessionDetail(updated.id) };
}

export function confirmResearchPlanForApi(sessionId, body = {}) {
  const current = getResearchSessionDetail(sessionId);
  if (!current) throw new Error('research session not found');
  if (!['planning', 'awaiting_plan_confirm'].includes(current.phase)) {
    return { ok: true, alreadyConfirmed: true, session: current };
  }
  if (isResearchRunInFlight(sessionId)) throw new Error('research run already in progress');
  const detail = confirmResearchPlan(sessionId, body?.plan || null);
  return { ok: true, session: detail };
}

export function deleteResearchSessionForApi(sessionId) {
  abortResearchRun(sessionId);
  const ok = deleteResearchSession(sessionId);
  if (!ok) throw new Error('research session not found');
  return { ok: true };
}

export function abortResearchSessionForApi(sessionId) {
  const ok = abortResearchRun(sessionId);
  return { ok };
}

export async function startResearchRunForApi(sessionId, {
  phase,
  config,
  model,
  workspaceRoot,
  userPrompt,
} = {}) {
  const id = String(sessionId || '');
  if (isResearchRunInFlight(id)) {
    return {
      ok: true,
      started: false,
      alreadyRunning: true,
      session: getRecoverableResearchDetail(id),
    };
  }
  const detail = getRecoverableResearchDetail(id);
  if (!detail) throw new Error('research session not found');

  const resolvedPhase = phase || (
    detail.phase === 'awaiting_plan_confirm' || detail.phase === 'planning'
      ? 'planning'
      : detail.phase === 'done' || detail.phase === 'writing' || detail.phase === 'ready_for_report'
        ? 'writing'
        : 'investigating'
  );

  if (resolvedPhase === 'planning') {
    if (!['planning', 'awaiting_plan_confirm'].includes(detail.phase)) {
      throw new Error('planning can only be retried before investigation starts');
    }
  } else if (
    resolvedPhase === 'investigating'
    && !['investigating', 'failed', 'incomplete'].includes(detail.phase)
  ) {
    throw new Error('confirm the plan before investigating');
  } else if (resolvedPhase === 'writing') {
    if (!['ready_for_report', 'writing', 'done'].includes(detail.phase)) {
      throw new Error('research evidence is not ready for report generation');
    }
    updateResearchSession(sessionId, { phase: 'writing' });
  }

  updateResearchRunState(id, {
    state: 'running',
    phase: resolvedPhase,
    error: '',
  });
  queuedRuns.add(id);

  queueMicrotask(async () => {
    let currentRunPhase = resolvedPhase;
    try {
      queuedRuns.delete(id);
      broadcast(id, { type: 'run:start', phase: resolvedPhase });
      const runPhase = (runPhaseName, runUserPrompt) => runResearchLeadTurn({
        sessionId: id,
        phase: runPhaseName,
        config,
        model,
        workspaceRoot,
        userPrompt: runUserPrompt,
        onEvent: (evt) => broadcast(id, evt),
      });
      let result = await runPhase(resolvedPhase, userPrompt);
      let writingRequested = resolvedPhase === 'writing';
      if (result?.aborted) {
        updateResearchRunState(id, { state: 'paused', phase: currentRunPhase, error: '' });
      }
      if (
        resolvedPhase === 'planning'
        && !result?.aborted
        && getResearchSessionDetail(id)?.phase !== 'awaiting_plan_confirm'
      ) {
        throw new Error('research planner did not submit a valid plan');
      }
      if (shouldAutoWriteResearchResult(resolvedPhase, result)) {
        currentRunPhase = 'writing';
        updateResearchSession(id, {
          phase: 'writing',
          runState: 'running',
          lastRunPhase: 'writing',
          lastError: '',
        });
        writingRequested = true;
        result = await runPhase('writing');
        if (result?.aborted) {
          updateResearchRunState(id, { state: 'paused', phase: 'writing', error: '' });
        }
      }
      if (writingRequested && !result?.aborted) {
        let latest = getResearchSessionDetail(id);
        if (!isResearchReportComplete(latest)) {
          result = await runPhase('writing');
          latest = getResearchSessionDetail(id);
        }
        if (result?.aborted) {
          updateResearchRunState(id, { state: 'paused', phase: 'writing', error: '' });
        } else if (!isResearchReportComplete(latest)) {
          throw new Error('research writer did not submit a final report');
        }
      }
      if (!result?.aborted) {
        const latest = getResearchSessionDetail(id);
        updateResearchRunState(id, {
          state: latest?.phase === 'done' ? 'completed' : 'idle',
          phase: currentRunPhase,
          error: '',
        });
      }
      broadcast(id, {
        type: 'run:done',
        ok: result?.ok !== false,
        aborted: Boolean(result?.aborted),
        session: getResearchSessionDetail(id),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateResearchRunState(id, {
        state: 'failed',
        phase: currentRunPhase,
        error: message,
      });
      broadcast(id, {
        type: 'run:error',
        error: message,
        phase: currentRunPhase,
        session: getResearchSessionDetail(id),
      });
    } finally {
      queuedRuns.delete(id);
    }
  });

  return {
    ok: true,
    started: true,
    phase: resolvedPhase,
    session: getResearchSessionDetail(id),
  };
}

export function subscribeResearchRun(sessionId, res) {
  const id = String(sessionId || '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId: id })}\n\n`);
  const detail = getResearchSessionDetail(id);
  if (detail) {
    res.write(`data: ${JSON.stringify({ type: 'session', session: detail })}\n\n`);
  }
  if (isResearchRunInFlight(id)) {
    res.write(`data: ${JSON.stringify({ type: 'run:status', running: true })}\n\n`);
  }
  const clients = runClients.get(id) || new Set();
  clients.add(res);
  runClients.set(id, clients);
  res.on('close', () => {
    clients.delete(res);
    if (clients.size === 0) runClients.delete(id);
  });
}
