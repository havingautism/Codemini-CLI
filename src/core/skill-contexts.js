const SKILL_CONTEXTS = new Set(['coding', 'daily']);

export function normalizeSkillContexts(value) {
  const raw = Array.isArray(value) ? value : [];
  const contexts = Array.from(new Set(
    raw.map((item) => String(item || '').trim().toLowerCase()).filter((item) => SKILL_CONTEXTS.has(item))
  ));
  return contexts.length > 0 ? contexts : ['coding', 'daily'];
}

export function executionModeSkillContext(mode = 'normal') {
  const normalized = String(mode || '').trim().toLowerCase();
  return ['plan', 'code', 'coding', 'spec'].includes(normalized) ? 'coding' : 'daily';
}

export function skillAppliesToExecutionMode(contexts, executionMode) {
  return normalizeSkillContexts(contexts).includes(executionModeSkillContext(executionMode));
}

export function skillIsEligible(skillsConfig = {}, name = '', executionMode = 'normal', command = null) {
  const configured = skillsConfig?.enabled?.[name];
  if (configured === false) return false;
  if (configured !== true && command?.metadata?.enabled === false) return false;
  return skillAppliesToExecutionMode(skillsConfig?.contexts?.[name], executionMode);
}
