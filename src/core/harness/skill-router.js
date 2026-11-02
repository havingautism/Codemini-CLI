import { filterCandidates } from './candidate-builder.js';

export function buildSkillCandidates(skills = [], { enabled = {}, reliability = [] } = {}) {
  const stats = new Map((Array.isArray(reliability) ? reliability : []).map((item) => [String(item.name || item.skill_name), item]));
  return (Array.isArray(skills) ? skills : []).map((skill) => {
    const id = String(skill?.name || skill?.id || '').trim();
    if (!id || enabled[id] === false) return null;
    const stat = stats.get(id);
    return { id, type: 'skill', description: String(skill.description || skill.summary || '').slice(0, 500), allowed: true, reliability: Number(stat?.reliability ?? 0.5) };
  }).filter(Boolean);
}

export function selectRouteFallback(candidates = [], { minProbability = 0.55, minMargin = 0.12 } = {}) {
  const usable = filterCandidates(candidates);
  if (!usable.length) return { choice: 'none', reason: 'no_candidate' };
  const ranked = [...usable].sort((a, b) => Number(b.probability || b.reliability || 0) - Number(a.probability || a.reliability || 0));
  const first = Number(ranked[0].probability ?? ranked[0].reliability ?? 0.5);
  const second = Number(ranked[1]?.probability ?? ranked[1]?.reliability ?? 0);
  if (first < minProbability || first - second < minMargin) return { choice: 'ask_user', reason: 'low_confidence', candidates: ranked };
  return { choice: ranked[0].id, reason: 'highest_probability', candidates: ranked };
}

