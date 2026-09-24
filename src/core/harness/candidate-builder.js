export function buildToolCandidates(definitions = [], { allowed = null, reliability = [], cooldown = new Set() } = {}) {
  const allowedSet = allowed ? new Set(allowed.map(String)) : null;
  const stats = new Map((Array.isArray(reliability) ? reliability : []).map((item) => [String(item.tool_name), item]));
  return (Array.isArray(definitions) ? definitions : []).map((definition) => {
    const id = String(definition?.function?.name || definition?.name || '').trim();
    if (!id || (allowedSet && !allowedSet.has(id)) || cooldown.has(id)) return null;
    const stat = stats.get(id);
    return {
      id, type: 'tool', description: String(definition?.function?.description || '').slice(0, 500),
      allowed: true, reliability: Number.isFinite(Number(stat?.reliability)) ? Number(stat.reliability) : 0.5,
      successes: Number(stat?.successes || 0), failures: Number(stat?.failures || 0) + Number(stat?.timeouts || 0) + Number(stat?.permission_errors || 0),
      lastError: String(stat?.last_error || ''),
    };
  }).filter(Boolean);
}

export function filterCandidates(candidates = [], { requireAllowed = true, minReliability = 0 } = {}) {
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) =>
    (!requireAllowed || candidate.allowed !== false) && Number(candidate.reliability ?? 0.5) >= Number(minReliability));
}

