export const USER_ACTION_COMMAND_NAMES = new Set([
  "dream",
  "compact",
  "capture",
  "inbox",
  "reflect",
]);

const USER_SKILL_LINE_RE = /^skill:\[([^\]]*)\]\s*([\s\S]*)$/;
const USER_COMMAND_LINE_RE = /^command:\[([^\]]+)\]\s*([\s\S]*)$/;

export function isManualSkillCommand(skillName) {
  const name = String(skillName || "").trim();
  return Boolean(name) && !USER_ACTION_COMMAND_NAMES.has(name);
}

export function parseUserSkillPrompt(text) {
  const value = String(text || "").trim();
  const match = value.match(USER_SKILL_LINE_RE);
  if (!match) {
    return { skillName: null, skillNames: [], prompt: value };
  }
  const skillNames = [...new Set(
    match[1].split(",").map((name) => name.trim()).filter(Boolean)
  )];
  return {
    skillName: skillNames[0] || null,
    skillNames,
    prompt: String(match[2] || "").trim()
  };
}

export function buildUserSkillLine(skillNames, prompt = "") {
  const names = (Array.isArray(skillNames) ? skillNames : [skillNames])
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  if (!names.length) return String(prompt || "").trim();
  const body = String(prompt || "").trim();
  return `skill:[${[...new Set(names)].join(",")}]${body ? ` ${body}` : ""}`;
}

export function isUserCommandDirective(text) {
  const value = String(text || "").trim();
  const match = value.match(USER_COMMAND_LINE_RE);
  if (!match) return false;
  return Boolean(String(match[1] || "").trim());
}
