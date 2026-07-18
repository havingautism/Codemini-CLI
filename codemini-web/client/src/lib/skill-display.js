const LOCAL_SOURCES = new Set([
  "builtin",
  "web-create",
  "web-move",
  "reindex",
]);

export function packageSourceKey(source = "") {
  const raw = String(source || "").trim();
  if (!raw || LOCAL_SOURCES.has(raw)) return "";

  const tree = raw.match(
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/tree\/(.+?)\/?$/i,
  );
  if (tree) {
    const subPath = tree[3].split("/").slice(1).join("/").toLowerCase();
    const base = `https://github.com/${tree[1]}/${tree[2]}`.toLowerCase();
    return subPath ? `${base}#${subPath}` : base;
  }

  let url = raw;
  const ssh = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) {
    url = `https://github.com/${ssh[1]}/${ssh[2]}`;
  } else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url)) {
    url = `https://github.com/${url}`;
  } else if (!/^https:\/\/github\.com\//i.test(url)) {
    return "";
  }

  url = url
    .replace(/\/$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
  return url;
}

export function skillPackageGroupKey(skill = {}) {
  if (!skillPackageIsUpdatable(skill)) return "";
  const sourceKey = packageSourceKey(skill.packageSource || skill.source);
  if (!sourceKey) return "";
  return sourceKey;
}

export function groupSkillsByPackage(skills = []) {
  const packages = new Map();
  const ungrouped = [];

  for (const skill of skills) {
    const key = skillPackageGroupKey(skill);
    if (!key) {
      ungrouped.push(skill);
      continue;
    }
    const existing = packages.get(key);
    if (existing) {
      existing.items.push(skill);
      continue;
    }
    packages.set(key, {
      key,
      packageName:
        skill.packageName ||
        skill.packageSource ||
        skill.source ||
        skill.name ||
        key,
      packageSource: skill.packageSource || skill.source || "",
      scope: skill.scope,
      author: skillAuthorLabel(skill),
      representative: skill,
      items: [skill],
    });
  }

  const packageGroups = [...packages.values()]
    .map((group) => ({
      ...group,
      items: sortSkillsByAuthor(group.items),
    }))
    .sort((left, right) => {
      const authorOrder = String(left.author || "").localeCompare(
        String(right.author || ""),
      );
      if (authorOrder) return authorOrder;
      return String(left.packageName || "").localeCompare(
        String(right.packageName || ""),
      );
    });

  return {
    packages: packageGroups,
    ungrouped: sortSkillsByAuthor(ungrouped),
  };
}

export function skillPackageIsUpdatable(skill = {}) {
  if (!skill || skill.scope === "builtin") return false;
  const source = String(skill.packageSource || skill.source || "").trim();
  return Boolean(packageSourceKey(source));
}

export function skillsInSamePackage(skills = [], skill = {}) {
  if (!skillPackageIsUpdatable(skill)) return [];
  const key = packageSourceKey(skill.packageSource || skill.source);
  return skills.filter((item) => {
    if (item.scope === "builtin") return false;
    return packageSourceKey(item.packageSource || item.source) === key;
  });
}

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
