const SPEC_STATUS_SET = new Set(['pending_approval', 'approved', 'saved', 'rejected']);

function normalizeSpecStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return '';
  if (status === 'pending_spec_approval') return 'pending_approval';
  if (SPEC_STATUS_SET.has(status)) return status;
  return status;
}

export function normalizeSpecState(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {
    status: normalizeSpecStatus(value.status),
    source: String(value.source || '').trim(),
    goal: String(value.goal || '').trim(),
    summary: String(value.summary || '').trim(),
    specPath: String(value.specPath || value.filePath || '').trim(),
    specText: String(value.specText || '').trim()
  };
  return out;
}
