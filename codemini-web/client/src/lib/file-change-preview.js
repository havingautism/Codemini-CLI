export function isUnifiedPatch(text) {
  const value = String(text || "");
  return (
    value.startsWith("diff --git ") ||
    value.startsWith("@@ ") ||
    value.includes("\ndiff --git ") ||
    value.includes("\n@@ ")
  );
}

export function collectFileChangePatch(change) {
  if (Array.isArray(change?.changes) && change.changes.length) {
    const joined = change.changes
      .map((item) => String(item?.diffPreview || "").trim())
      .filter(Boolean)
      .join("\n");
    if (joined) return joined;
  }
  return String(change?.diffPreview || "").trim();
}

export function resolveFileChangeSequenceAction(actions = []) {
  const sequence = actions
    .map((action) => String(action || "").trim())
    .filter(Boolean);
  if (!sequence.length) return "edit";

  const existedBefore = sequence[0] !== "create";
  const existsAfter = sequence[sequence.length - 1] !== "delete";
  if (!existedBefore && !existsAfter) return null;
  if (!existedBefore) return "create";
  return existsAfter ? "edit" : "delete";
}

function normalizeGitPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

export function reconcileFileChangesWithGit(fileChanges = [], gitFiles) {
  if (!Array.isArray(gitFiles)) return fileChanges;
  const statusByPath = new Map(
    gitFiles
      .map((file) => [normalizeGitPath(file?.path), file])
      .filter(([filePath]) => filePath),
  );
  return fileChanges.flatMap((change) => {
    const gitFile = statusByPath.get(normalizeGitPath(change?.path));
    if (!gitFile) return [];
    const action =
      gitFile.status === "?" || gitFile.status === "A"
        ? "create"
        : gitFile.status === "D"
          ? "delete"
          : "edit";
    return [{ ...change, action }];
  });
}

export function buildFileChangePreviewLines(previewText, action = "edit") {
  return String(previewText || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const signedMatch = line.match(/^([+-])(\d+)?\|\s?(.*)$/);
      if (signedMatch) {
        const number = signedMatch[2] || "";
        const type = signedMatch[1] === "-" ? "remove" : "add";
        return {
          marker: signedMatch[1],
          number,
          oldNumber: type === "remove" ? number : "",
          newNumber: type === "add" ? number : "",
          text: signedMatch[3] || "",
          type,
        };
      }
      const match = line.match(/^(\d+)\|\s?(.*)$/);
      const number = match ? match[1] : "";
      const type = action === "delete" ? "remove" : "add";
      return {
        marker: type === "remove" ? "-" : "+",
        number,
        oldNumber: type === "remove" ? number : "",
        newNumber: type === "add" ? number : "",
        text: match ? match[2] : line,
        type,
      };
    });
}

/** +/- and context lines from unified git patches (oplog). */
export function unifiedPatchToPreviewLines(patch) {
  const lines = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of String(patch || "").split(/\r?\n/)) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
        inHunk = true;
      }
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (!inHunk || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      lines.push({
        type: "add",
        marker: "+",
        number: String(newLine),
        oldNumber: "",
        newNumber: String(newLine),
        text: raw.slice(1),
      });
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      lines.push({
        type: "remove",
        marker: "-",
        number: String(oldLine),
        oldNumber: String(oldLine),
        newNumber: "",
        text: raw.slice(1),
      });
      oldLine += 1;
      continue;
    }
    if (raw.startsWith(" ")) {
      lines.push({
        type: "context",
        marker: " ",
        number: String(newLine || oldLine),
        oldNumber: String(oldLine),
        newNumber: String(newLine),
        text: raw.startsWith(" ") ? raw.slice(1) : raw,
      });
      oldLine += 1;
      newLine += 1;
    }
  }
  return lines;
}

export function resolveFileChangePreviewLines(patch, action = "edit") {
  const text = String(patch || "").trim();
  if (!text) return [];
  if (isUnifiedPatch(text)) return unifiedPatchToPreviewLines(text);
  return buildFileChangePreviewLines(text, action);
}
