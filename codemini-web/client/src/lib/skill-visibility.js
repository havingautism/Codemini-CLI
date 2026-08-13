import {
  executionModeSkillContext,
  skillAppliesToExecutionMode,
} from "../../../../src/core/skill-contexts.js";

export { executionModeSkillContext };

export function skillIsVisibleInExecutionMode(skill, mode = "normal") {
  if (!skill || skill.enabled === false) return false;
  return skillAppliesToExecutionMode(skill.contexts, mode);
}

export function filterSkillsForExecutionMode(skills, mode = "normal") {
  return (Array.isArray(skills) ? skills : []).filter((skill) =>
    skillIsVisibleInExecutionMode(skill, mode),
  );
}
