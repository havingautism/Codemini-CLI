export function describeSkillActivity(copy, name, { done = false, failed = false } = {}) {
  if (failed) return `${copy.runtime.skillFailed}: /${name}`;
  if (done) return `${copy.toolActivity.doneSkill}: /${name}`;
  return `${copy.toolActivity.doingSkill}: /${name}`;
}

export function describeAutoSkillActivity(copy, names) {
  const safeNames = Array.isArray(names) ? names.filter(Boolean) : [];
  if (safeNames.length === 0) return '';
  return copy.runtime.autoSkillInjected(safeNames);
}

export function formatAutoSkillBadge(copy, names) {
  const safeNames = Array.isArray(names) ? names.filter(Boolean) : [];
  if (safeNames.length === 0) return '';
  const [first, ...rest] = safeNames;
  const suffix = rest.length > 0 ? ` +${rest.length}` : '';
  const prefix = copy?.roleLabels?.system === 'SYSTEM' ? 'AUTO' : '自动';
  return `${prefix} /${first}${suffix}`;
}
