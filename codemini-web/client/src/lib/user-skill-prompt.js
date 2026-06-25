export const USER_ACTION_COMMAND_NAMES = new Set([
  "dream",
  "compact",
  "capture",
  "inbox",
  "reflect",
]);

const USER_SKILL_LINE_RE = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/;

export function isManualSkillCommand(skillName) {
  const name = String(skillName || "").trim();
  return Boolean(name) && !USER_ACTION_COMMAND_NAMES.has(name);
}

export function parseUserSkillPrompt(text) {
  const value = String(text || "").trim();
  const match = value.match(USER_SKILL_LINE_RE);
  if (!match) {
    return { skillName: null, prompt: value };
  }
  return {
    skillName: match[1],
    prompt: String(match[2] || "").trim(),
  };
}

export function buildUserSkillLine(skillName, prompt = "") {
  const name = String(skillName || "").trim();
  if (!name) return String(prompt || "").trim();
  const body = String(prompt || "").trim();
  return body ? `/${name} ${body}` : `/${name}`;
}
