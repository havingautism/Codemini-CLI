export const USER_ACTION_COMMAND_NAMES = new Set([
  "dream",
  "compact",
  "capture",
  "inbox",
  "reflect",
]);

const USER_SKILL_LINE_RE = /^skill:\[([^\]]*)\]\s*([\s\S]*)$/;

export function isManualSkillCommand(skillName) {
  const name = String(skillName || "").trim();
  return Boolean(name) && !USER_ACTION_COMMAND_NAMES.has(name);
}

export function skillNamesFromBadges(badges = []) {
  return [...new Set(
    (Array.isArray(badges) ? badges : [])
      .filter((badge) => badge?.status === "selected" || badge?.status === "always")
      .flatMap((badge) => String(badge?.name || "").split(","))
      .map((name) => name.trim())
      .filter(Boolean),
  )];
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
