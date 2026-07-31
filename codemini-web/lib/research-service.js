import {
  confirmResearchPlan,
  createResearchSession,
  deleteResearchSession,
  getResearchSessionDetail,
  listResearchSessions,
  updateResearchSession,
} from '../../src/core/research-store.js';
import {
  abortResearchRun,
  getActiveResearchRun,
  runResearchLeadTurn,
} from '../../src/core/research-runtime.js';

const runClients = new Map();

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
      question: session.question,
      phase: session.phase,
      goal: session.preferences?.goal || '',
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
    })),
  };
}

export function getResearchSessionForApi(sessionId) {
  const detail = getResearchSessionDetail(sessionId);
  if (!detail) return null;
  return {
    session: detail,
    running: Boolean(getActiveResearchRun(sessionId)),
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
  const plan = body.plan && typeof body.plan === 'object' ? body.plan : body;
  const updated = updateResearchSession(sessionId, {
    plan,
    phase: body.phase || (current.phase === 'planning' ? 'awaiting_plan_confirm' : current.phase),
    preferences: plan?.goal ? { goal: String(plan.goal) } : undefined,
  });
  return { ok: true, session: getResearchSessionDetail(updated.id) };
}

export function confirmResearchPlanForApi(sessionId, body = {}) {
  if (body?.plan) {
    updateResearchSession(sessionId, { plan: body.plan });
  }
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
  if (getActiveResearchRun(sessionId)) {
    throw new Error('research run already in progress');
  }
  const detail = getResearchSessionDetail(sessionId);
  if (!detail) throw new Error('research session not found');

  const resolvedPhase = phase || (
    detail.phase === 'awaiting_plan_confirm' || detail.phase === 'planning'
      ? 'planning'
      : detail.phase === 'done' || detail.phase === 'writing' || detail.phase === 'ready_for_report'
        ? 'writing'
        : 'investigating'
  );

  if (resolvedPhase === 'planning' && detail.phase === 'planning') {
    // keep
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

  queueMicrotask(async () => {
    try {
      broadcast(sessionId, { type: 'run:start', phase: resolvedPhase });
      const runPhase = (runPhaseName, runUserPrompt) => runResearchLeadTurn({
        sessionId,
        phase: runPhaseName,
        config,
        model,
        workspaceRoot,
        userPrompt: runUserPrompt,
        onEvent: (evt) => broadcast(sessionId, evt),
      });
      let result = await runPhase(resolvedPhase, userPrompt);
      let writingRequested = resolvedPhase === 'writing';
      if (shouldAutoWriteResearchResult(resolvedPhase, result)) {
        updateResearchSession(sessionId, { phase: 'writing' });
        writingRequested = true;
        result = await runPhase('writing');
      }
      if (writingRequested && !result?.aborted) {
        let latest = getResearchSessionDetail(sessionId);
        if (!isResearchReportComplete(latest)) {
          result = await runPhase('writing');
          latest = getResearchSessionDetail(sessionId);
        }
        if (!isResearchReportComplete(latest)) {
          updateResearchSession(sessionId, { phase: 'failed' });
          throw new Error('research writer did not submit a final report');
        }
      }
      broadcast(sessionId, {
        type: 'run:done',
        ok: result?.ok !== false,
        aborted: Boolean(result?.aborted),
        session: getResearchSessionDetail(sessionId),
      });
    } catch (error) {
      broadcast(sessionId, {
        type: 'run:error',
        error: error instanceof Error ? error.message : String(error),
        session: getResearchSessionDetail(sessionId),
      });
    }
  });

  return {
    ok: true,
    started: true,
    phase: resolvedPhase,
    session: getResearchSessionDetail(sessionId),
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
  if (getActiveResearchRun(id)) {
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
