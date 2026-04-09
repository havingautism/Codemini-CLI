const PLAN_STATUS_SET = new Set(['pending_approval', 'approved', 'completed', 'failed', 'draft']);

function normalizePlanStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return '';
  if (PLAN_STATUS_SET.has(status)) return status;
  return status;
}

function normalizePlanStep(step) {
  const title = String(step?.title || '').trim();
  const role = String(step?.role || '').trim();
  const task = String(step?.task || '').trim();
  if (!title && !role && !task) return null;
  return { title, role, task };
}

export function normalizePlanState(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {
    status: normalizePlanStatus(value.status),
    source: String(value.source || '').trim(),
    goal: String(value.goal || '').trim(),
    filePath: String(value.filePath || '').trim(),
    summary: String(value.summary || '').trim(),
    finalSummary: String(value.finalSummary || '').trim()
  };
  if (Array.isArray(value.steps)) {
    out.steps = value.steps.map(normalizePlanStep).filter(Boolean);
  }
  return out;
}
