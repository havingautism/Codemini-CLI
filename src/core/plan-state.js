const PLAN_STATUS_SET = new Set(['draft', 'ready', 'running', 'completed', 'failed']);

function normalizePlanStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return '';
  if (PLAN_STATUS_SET.has(status)) return status;
  return status;
}

function normalizePlanStep(step) {
  const id = String(step?.id || '').trim();
  const title = String(step?.title || '').trim();
  const role = String(step?.role || '').trim();
  const task = String(step?.task || '').trim();
  const status = String(step?.status || '').trim();
  const outputRef = String(step?.outputRef || '').trim();
  const output = typeof step?.output === 'string' ? step.output : '';
  if (!id && !title && !role && !task) return null;
  return {
    ...(id ? { id } : {}),
    title,
    role,
    task,
    ...(status ? { status } : {}),
    ...(outputRef ? { outputRef } : {}),
    ...(output ? { output } : {})
  };
}

export function normalizePlanState(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {
    status: normalizePlanStatus(value.status),
    source: String(value.source || '').trim(),
    id: String(value.id || '').trim(),
    goal: String(value.goal || '').trim(),
    filePath: String(value.filePath || '').trim(),
    specRef: String(value.specRef || value.specPath || '').trim(),
    summary: String(value.summary || '').trim(),
    finalSummary: String(value.finalSummary || '').trim()
  };
  if (Array.isArray(value.steps)) {
    out.steps = value.steps.map(normalizePlanStep).filter(Boolean);
  }
  if (Array.isArray(value.candidates)) {
    out.candidates = value.candidates.filter((item) => item && typeof item === 'object').map((item) => ({ ...item }));
  }
  return out;
}
