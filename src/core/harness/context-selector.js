export function selectContextBlocks(blocks = [], { requiredIds = [], maxBlocks = 20 } = {}) {
  const required = new Set(requiredIds.map(String));
  const ranked = (Array.isArray(blocks) ? blocks : []).map((block) => ({
    ...block,
    id: String(block?.id || ''),
    required: required.has(String(block?.id || '')) || block?.required === true,
    score: Number(block?.score ?? block?.relevance ?? 0),
  })).filter((block) => block.id);
  const kept = ranked.filter((block) => block.required || block.score >= 0.5)
    .sort((a, b) => Number(b.required) - Number(a.required) || b.score - a.score)
    .slice(0, Math.max(1, Number(maxBlocks) || 20));
  const keptIds = new Set(kept.map((block) => block.id));
  return { kept, decisions: ranked.map((block) => ({ id: block.id, kept: keptIds.has(block.id), score: block.score, reason: block.required ? 'required' : keptIds.has(block.id) ? 'relevant' : 'low_relevance' })) };
}

