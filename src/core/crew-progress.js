export function crewIdentityMatchesWorker(target = {}, workerId = '') {
  const id = String(workerId || '').trim().toLowerCase();
  if (!id) return false;
  const values = [
    target.name,
    target.resume,
    target.review,
    target.role,
    target.id,
    target.workerId,
    target.worker_id,
    target.persona,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (values.includes(id)) return true;
  const title = String(target.title || target.label || '').trim().toLowerCase();
  if (!title) return false;
  if (title === id) return true;
  return (
    title === `crew worker · ${id}`
    || title === `crew review · ${id}`
    || title === `crew survey · ${id}`
    || title.endsWith(`· ${id}`)
    || title.endsWith(`: ${id}`)
  );
}

export function cancelWorkerIdFromPayload(payload = {}) {
  const args = payload.arguments || payload.toolCall?.arguments || payload;
  const direct = String(args?.worker_id || args?.id || args?.resume || '').trim();
  if (direct) return direct;
  const label = String(payload.displayName || payload.name || payload.toolName || '').trim();
  const match = label.match(/cancel\s*worker\s*\(([^)]+)\)/i);
  return match ? String(match[1] || '').trim() : '';
}

export function describeCrewWorkerProgress(worker = {}, { inFlightIds = [] } = {}) {
  const id = String(worker.id || '').trim();
  if (!id) return null;
  const flying = (Array.isArray(inFlightIds) ? inFlightIds : []).includes(id);
  const kind = String(worker.kind || '').trim().toLowerCase() || 'coder';
  let phase = 'idle';
  if (worker.integrated === true) phase = 'merged';
  else if (String(worker.runStatus || '').toLowerCase() === 'failed' && !flying) phase = 'failed';
  else if (String(worker.runStatus || '').toLowerCase() === 'queued') phase = 'queued';
  else if (flying && (
    worker.sealed
    || worker.dirty === false
    || String(worker.runStatus || '').toLowerCase() === 'completed'
  )) phase = 'reviewing';
  else if (flying || String(worker.runStatus || '').toLowerCase() === 'running') phase = 'running';
  else if (worker.dirty === true) phase = 'dirty';
  else if (kind === 'survey' && String(worker.runStatus || '').toLowerCase() === 'completed') phase = 'survey_done';
  else if (worker.sealed && worker.reviewPassed === true) phase = 'ready';
  else if (worker.sealed) phase = 'awaiting_review';
  else if (worker.runStatus) phase = String(worker.runStatus);
  return { id, kind, phase };
}

export function buildCrewProgressItems({ workers = [], inFlightIds = [] } = {}) {
  const ids = [...new Set((Array.isArray(inFlightIds) ? inFlightIds : []).map((item) => String(item || '').trim()).filter(Boolean))];
  const seen = new Set();
  const items = [];
  for (const worker of Array.isArray(workers) ? workers : []) {
    const item = describeCrewWorkerProgress(worker, { inFlightIds: ids });
    if (!item) continue;
    seen.add(item.id);
    items.push(item);
  }
  for (const id of ids) {
    if (seen.has(id)) continue;
    items.push({ id, kind: 'coder', phase: 'running' });
  }
  return items;
}

export function shouldShowCrewProgressDock({ crewActive, workers = [], inFlightIds = [] } = {}) {
  if (!crewActive) return false;
  const items = buildCrewProgressItems({ workers, inFlightIds });
  if (!items.length) return false;
  return items.some((item) => item.phase !== 'merged');
}

export function formatCrewProgressLine(items = [], labels = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item.id} ${labels[item.phase] || item.phase}`)
    .join(' · ');
}
