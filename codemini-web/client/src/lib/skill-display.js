const LOCAL_SOURCES = new Set([
  "builtin",
  "web-create",
  "web-move",
  "reindex",
]);

export function skillAuthorLabel(skill = {}) {
  const source = String(skill.packageSource || "").trim();
  const localSource = String(skill.source || "").trim();
  if (!source || (localSource && LOCAL_SOURCES.has(localSource))) return "";

  const github = source.match(
    /github\.com[/:]([^/\s]+)\/[^/\s]+?(?:\.git)?(?:\/|$)/i,
  );
  if (github) return github[1];

  const ownerRepo = source.replace(/\\/g, "/").match(
    /^(?:https?:\/\/)?([^/\s]+)\/[^/\s]+/,
  );
  return ownerRepo?.[1] || "";
}

function secondarySortValue(skill) {
  const mode = skill?.mode === "auto_attach"
    ? "agent_requested"
    : skill?.mode || "agent_requested";
  return {
    modeRank: mode === "always" ? 0 : 1,
    enabledRank: skill?.enabled === false ? 1 : 0,
    priority: Number.isFinite(Number(skill?.priority))
      ? Number(skill.priority)
      : 0,
    name: String(skill?.name || "").toLowerCase(),
  };
}

export function sortSkillsByAuthor(skills = []) {
  return [...skills].sort((left, right) => {
    const leftAuthor = skillAuthorLabel(left);
    const rightAuthor = skillAuthorLabel(right);
    if (!leftAuthor && rightAuthor) return -1;
    if (leftAuthor && !rightAuthor) return 1;
    const authorOrder = leftAuthor.localeCompare(rightAuthor);
    if (authorOrder) return authorOrder;

    const a = secondarySortValue(left);
    const b = secondarySortValue(right);
    return (
      a.modeRank - b.modeRank ||
      a.enabledRank - b.enabledRank ||
      b.priority - a.priority ||
      a.name.localeCompare(b.name)
    );
  });
}
