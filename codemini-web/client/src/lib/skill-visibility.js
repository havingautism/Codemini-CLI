const CODING_MODES = new Set(["plan", "code", "coding", "spec"]);

export function executionModeSkillContext(mode = "normal") {
  return CODING_MODES.has(String(mode || "").trim().toLowerCase())
    ? "coding"
    : "daily";
}

export function skillIsVisibleInExecutionMode(skill, mode = "normal") {
  if (!skill || skill.enabled === false) return false;
  const contexts = Array.isArray(skill.contexts)
    ? skill.contexts.map((context) => String(context || "").trim().toLowerCase())
    : ["coding", "daily"];
  return contexts.includes(executionModeSkillContext(mode));
}

export function filterSkillsForExecutionMode(skills, mode = "normal") {
  return (Array.isArray(skills) ? skills : []).filter((skill) =>
    skillIsVisibleInExecutionMode(skill, mode),
  );
}
