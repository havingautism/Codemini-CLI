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
  return userSkillChipBadges(badges).map((badge) => badge.name);
}

export function selectedSkillBadges(skillNames = []) {
  return [...new Set(
    (Array.isArray(skillNames) ? skillNames : [])
      .map((name) => String(name || "").trim())
      .filter(Boolean),
  )].map((name) => ({ name, status: "selected" }));
}

export function normalizeSkillBadges(badges = []) {
  const byName = new Map();
  for (const badge of Array.isArray(badges) ? badges : []) {
    const status = String(badge?.status || "selected").trim() || "selected";
    if (status !== "selected" && status !== "always") continue;
    for (const rawName of String(badge?.name || "").split(",")) {
      const name = rawName.trim();
      if (!name) continue;
      const existing = byName.get(name);
      if (!existing || (existing.status === "always" && status === "selected")) {
        byName.set(name, { name, status });
      }
    }
  }
  return [...byName.values()];
}

export function userSkillChipBadges(badges = [], promptSkillNames = []) {
  return normalizeSkillBadges([
    ...(Array.isArray(badges) ? badges : []),
    ...selectedSkillBadges(promptSkillNames),
  ]);
}

export function skillBadgesFromSessionMessage(message = {}) {
  const explicit = Array.isArray(message.skillBadges)
    ? message.skillBadges
    : Array.isArray(message.skill_badges)
      ? message.skill_badges
      : [];
  const normalizedExplicit = explicit
    .map((badge) => ({
      name: String(badge?.name || "").trim(),
      status: String(badge?.status || "selected").trim() || "selected",
    }))
    .filter((badge) => badge.name);
  if (normalizedExplicit.length) return normalizeSkillBadges(normalizedExplicit);

  const names = Array.isArray(message.selectedSkillNames)
    ? message.selectedSkillNames
    : Array.isArray(message.selected_skill_names)
      ? message.selected_skill_names
      : [];
  return selectedSkillBadges(names);
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
