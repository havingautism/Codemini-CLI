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

/** Git enriches historical snapshots; it must never erase them. */
export function enrichFileChangesWithGit(fileChanges = [], gitFiles, { gitKnown } = {}) {
  const resolvedKnown =
    typeof gitKnown === "boolean" ? gitKnown : Array.isArray(gitFiles);
  const statusByPath = new Map(
    resolvedKnown
      ? (Array.isArray(gitFiles) ? gitFiles : [])
          .map((file) => [normalizeGitPath(file?.path), file])
          .filter(([filePath]) => filePath)
      : [],
  );
  return (Array.isArray(fileChanges) ? fileChanges : []).map((change) => {
    if (!resolvedKnown) {
      return { ...change, workspace: { dirty: undefined } };
    }
    const gitFile = statusByPath.get(normalizeGitPath(change?.path));
    if (!gitFile) {
      return { ...change, workspace: { dirty: false } };
    }
    return {
      ...change,
      workspace: {
        dirty: true,
        status: gitFile.status,
      },
    };
  });
}

export function canShowFileChangeUndo(change) {
  const ids = Array.isArray(change?.changeSetIds)
    ? change.changeSetIds
    : change?.changeSetId
      ? [change.changeSetId]
      : [];
  if (!ids.filter(Boolean).length) return false;
  if (change?.revertedAt) return false;
  if (change?.workspace?.dirty === false) return false;
  return true;
}

export function summarizeFileChangesWorkspace(
  changes = [],
  gitFiles,
  gitStatus = "loading",
) {
  const total = Array.isArray(changes) ? changes.length : 0;
  if (!total) return { status: "empty", dirty: 0, clean: 0, total: 0 };
  if (gitStatus === "loading") {
    return { status: "loading", dirty: 0, clean: 0, total };
  }
  if (gitStatus === "error") {
    return { status: "error", dirty: 0, clean: 0, total };
  }
  let dirty = 0;
  let clean = 0;
  for (const change of changes) {
    if (change?.workspace?.dirty) dirty += 1;
    else clean += 1;
  }
  return { status: "ready", dirty, clean, total };
}

/** @deprecated Use enrichFileChangesWithGit — filtering history by git status erases transcript semantics. */
export function reconcileFileChangesWithGit(fileChanges = [], gitFiles) {
  return enrichFileChangesWithGit(fileChanges, gitFiles);
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
