import { formatToolLabel, parseToolDisplayName } from "../../../../src/core/tool-display.js";
import { isMcpToolName } from "../../../../src/core/mcp-tool-display.js";

const FILE_ARG_TOOLS = new Set(["read", "edit", "create", "write", "delete"]);
const FILE_PATH_KEYS = new Set(["path", "file", "file_path", "target"]);
const FILE_CONTENT_KEYS = new Set(["content", "new_content"]);

export function extractToolName(name) {
  const match = String(name).match(/^(\w+)/);
  return match ? match[1] : name;
}

export function isRequestUserInputCard(card) {
  return extractToolName(card?.name) === "request_user_input";
}

export function isTodoToolCard(card) {
  const name = extractToolName(card?.name);
  return name === "tasks" || name === "update_todos";
}

/** Conversation-page widgets (todo board, ask-user form). Trajectory inspect should skip these. */
export function isConversationVisualToolCard(card) {
  return isRequestUserInputCard(card) || isTodoToolCard(card);
}

export function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function getTodoToolItems(args, result) {
  const parsedArgs = parseMaybeJson(args) || {};
  const parsedResult = parseMaybeJson(result) || {};
  const todos = parsedResult.newTodos || parsedResult.tasks || parsedArgs.tasks || parsedResult.todos || parsedArgs.todos;
  if (!Array.isArray(todos)) return [];
  return todos
    .map((item) => ({
      content: String(item?.content || item?.activeForm || "").trim(),
      status: ["pending", "in_progress", "completed"].includes(item?.status)
        ? item.status
        : "pending",
    }))
    .filter((item) => item.content);
}

function decodeJsonStringFragment(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return String(raw || "")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function extractStringFieldFromPartialJson(text, fieldNames, { allowUnclosed = false } = {}) {
  const source = String(text || "");
  for (const fieldName of fieldNames) {
    const keyPattern = new RegExp(`"${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"`, "g");
    const match = keyPattern.exec(source);
    if (!match) continue;
    let raw = "";
    let escaped = false;
    for (let index = match.index + match[0].length; index < source.length; index += 1) {
      const ch = source[index];
      if (escaped) {
        raw += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        raw += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        return decodeJsonStringFragment(raw);
      }
      raw += ch;
    }
    if (allowUnclosed && raw) return decodeJsonStringFragment(raw);
  }
  return "";
}

export function extractKeyArg(args, toolName) {
  if (!args) return "";
  let obj = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      return FILE_ARG_TOOLS.has(toolName)
        ? extractStringFieldFromPartialJson(args, FILE_PATH_KEYS)
        : args;
    }
  }
  if (typeof obj !== "object") return String(obj);
  if (toolName === "apply_patch") {
    const patchText = String(obj.patch_text || "");
    const paths = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
      .map((match) => String(match[1] || "").trim())
      .filter(Boolean);
    if (paths.length > 1) return `${paths[0]} +${paths.length - 1}`;
    if (paths.length === 1) return paths[0];
  }
  const keyMap = {
    read: "path",
    edit: "path",
    create: "path",
    write: "path",
    apply_patch: "patch_text",
    delete: "path",
    run: "command",
    grep: "pattern",
    glob: "pattern",
    list: "path",
    web_fetch: "url",
    web_search: "query",
    skill: "name",
  };
  const key = keyMap[toolName];
  if (key && obj[key] != null) return String(obj[key]);
  if (toolName === "skill") {
    const query = String(obj?.query || "").trim();
    if (query) return query;
  }
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.length > 0 && v.length < 200) return v;
  }
  return "";
}

export function getFileToolMeta(toolName, args, result, summary, fileChange, resultMeta, fileChanges) {
  if (!["edit", "create", "write", "apply_patch", "delete"].includes(toolName)) return null;
  const parsedArgs = parseMaybeJson(args) || {};
  const parsedResult = {
    ...(parseMaybeJson(result) || {}),
    ...(resultMeta && typeof resultMeta === "object" ? resultMeta : {}),
  };
  const structuredChanges = Array.isArray(fileChanges) && fileChanges.length
    ? fileChanges
    : (fileChange ? [fileChange] : []);
  const requestedPath = String(parsedResult.path || parsedArgs.path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  const structuredChange =
    structuredChanges.find(
      (change) =>
        String(change?.path || "")
          .replace(/\\/g, "/")
          .replace(/^\.\//, "") === requestedPath,
    ) || structuredChanges.find((change) => change && typeof change === "object") || {};
  const capturedPatch = String(structuredChange.diffPreview || "");
  const pathText =
    parsedResult.path ||
    structuredChange.path ||
    parsedArgs.path ||
    "";
  const added = Number(
    parsedResult.lines_added ??
      parsedResult.linesAdded ??
      structuredChange.linesAdded ??
      0,
  );
  const removed = Number(
    parsedResult.lines_removed ??
      parsedResult.linesRemoved ??
      structuredChange.linesRemoved ??
      0,
  );
  const oldText =
    toolName === "edit"
      ? parsedArgs.old_text
      : "";
  const newText =
    toolName === "edit"
      ? (parsedArgs.new_text ?? parsedArgs.new_content ?? parsedArgs.content)
      : (toolName === "create" || toolName === "write")
        ? (parsedArgs.content ?? extractStringFieldFromPartialJson(args, FILE_CONTENT_KEYS, { allowUnclosed: true }))
      : "";
  const changedLine = Number(
    parsedResult.changed_line ||
      structuredChange.changedLine ||
      parsedArgs.line ||
      0,
  );
  return {
    path: String(pathText || extractKeyArg(args, toolName) || ""),
    action: String(
      parsedResult.action ||
        structuredChange.action ||
        (toolName === "create" || toolName === "write" ? parsedResult.action || toolName : toolName),
    ),
    added,
    removed,
    changedLine,
    diffPreview: String(
      capturedPatch || structuredChange.diffPreview || parsedResult.diff_preview || "",
    ),
    oldText: typeof oldText === "string" ? oldText : "",
    newText: typeof newText === "string" ? newText : "",
    summary: String(summary || ""),
    backupPath: String(parsedResult.backupPath || ""),
    backupRelativePath: String(parsedResult.backupRelativePath || ""),
    backupCreated: parsedResult.backupCreated === true,
    backupReused: parsedResult.backupReused === true,
    backupSkipped: parsedResult.backupSkipped === true,
    backupError: String(parsedResult.backupError || ""),
    backupReason: String(parsedResult.backupReason || ""),
  };
}

export function resolveToolHeaderParts(card, toolName, fileMeta) {
  const rawName = String(card?.name || toolName || "").trim();
  const parsed = parseToolDisplayName(card.displayName || "");
  // MCP cards must always recompute from the tool id + registered server name.
  // Stale stream displayNames like "Mcp Fetchmcp Fetch" must not win.
  const preferredLabel = isMcpToolName(rawName)
    ? formatToolLabel(rawName)
    : (
      String(parsed.label || "").trim()
      && String(parsed.label || "").trim() !== rawName
        ? String(parsed.label || "").trim()
        : formatToolLabel(rawName || toolName)
    );

  if (fileMeta?.path) {
    return {
      label: preferredLabel,
      arg: fileMeta.path,
      wrapArg: false,
    };
  }
  if (parsed.arg) {
    return { label: preferredLabel, arg: parsed.arg, wrapArg: true };
  }
  const keyArg = extractKeyArg(card.arguments, toolName);
  if (keyArg) {
    return { label: preferredLabel, arg: keyArg, wrapArg: true };
  }
  return { label: preferredLabel, arg: "", wrapArg: false };
}
