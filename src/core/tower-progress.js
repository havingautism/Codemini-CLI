export function describeTowerWorkerProgress(worker = {}, { inFlightIds = [] } = {}) {
  const id = String(worker.id || '').trim();
  if (!id) return null;
  const flying = (Array.isArray(inFlightIds) ? inFlightIds : []).includes(id);
  const kind = String(worker.kind || '').trim().toLowerCase() || 'coder';
  let phase = 'idle';
  if (worker.integrated === true) phase = 'merged';
  else if (String(worker.runStatus || '').toLowerCase() === 'failed' && !flying) phase = 'failed';
  else if (flying && (worker.sealed || String(worker.runStatus || '').toLowerCase() === 'completed')) phase = 'reviewing';
  else if (flying || String(worker.runStatus || '').toLowerCase() === 'running') phase = 'running';
  else if (worker.dirty === true) phase = 'dirty';
  else if (kind === 'survey' && String(worker.runStatus || '').toLowerCase() === 'completed') phase = 'survey_done';
  else if (worker.sealed && worker.reviewPassed === true) phase = 'ready';
  else if (worker.sealed) phase = 'awaiting_review';
  else if (worker.runStatus) phase = String(worker.runStatus);
  return { id, kind, phase };
}

export function buildTowerProgressItems({ workers = [], inFlightIds = [] } = {}) {
  const ids = [...new Set((Array.isArray(inFlightIds) ? inFlightIds : []).map((item) => String(item || '').trim()).filter(Boolean))];
  const seen = new Set();
  const items = [];
  for (const worker of Array.isArray(workers) ? workers : []) {
    const item = describeTowerWorkerProgress(worker, { inFlightIds: ids });
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

export function shouldShowTowerProgressDock({ towerActive, workers = [], inFlightIds = [] } = {}) {
  if (!towerActive) return false;
  const items = buildTowerProgressItems({ workers, inFlightIds });
  if (!items.length) return false;
  return items.some((item) => item.phase !== 'merged');
}

export function formatTowerProgressLine(items = [], labels = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item.id} ${labels[item.phase] || item.phase}`)
    .join(' · ');
}
