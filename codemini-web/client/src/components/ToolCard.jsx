import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FilePenLine,
  FileText,
  Folder,
  Globe,
  Search,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "../../utils/time.js";

const TOOL_ICONS = {
  read: FileText,
  edit: FilePenLine,
  write: FilePenLine,
  delete: Trash2,
  run: Terminal,
  grep: Search,
  glob: Folder,
  list: Folder,
  web_fetch: Globe,
  web_search: Search,
  default: Wrench,
};

function extractToolName(name) {
  const match = String(name).match(/^(\w+)/);
  return match ? match[1] : name;
}

function extractKeyArg(args, toolName) {
  if (!args) return "";
  let obj = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      return args;
    }
  }
  if (typeof obj !== "object") return String(obj);
  const keyMap = {
    read: "path",
    edit: "path",
    write: "path",
    delete: "path",
    run: "command",
    grep: "pattern",
    glob: "pattern",
    list: "path",
    web_fetch: "url",
    web_search: "query",
  };
  const key = keyMap[toolName];
  if (key && obj[key] != null) return String(obj[key]);
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.length > 0 && v.length < 200) return v;
  }
  return "";
}

function formatDetail(value) {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  const text = value.trim();
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return value;
  }
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function basename(pathText) {
  const value = String(pathText || "").replace(/\\/g, "/");
  return value.split("/").filter(Boolean).pop() || value;
}

function getNestedEdit(args) {
  if (!args || typeof args !== "object") return {};
  return args.edit && typeof args.edit === "object" ? args.edit : args;
}

function getFileToolMeta(toolName, args, result, summary) {
  if (!["edit", "write", "delete"].includes(toolName)) return null;
  const parsedArgs = parseMaybeJson(args) || {};
  const parsedResult = parseMaybeJson(result) || {};
  const edit = getNestedEdit(parsedArgs);
  const pathText =
    parsedResult.path ||
    parsedArgs.path ||
    parsedArgs.file ||
    parsedArgs.file_path ||
    "";
  const added = Number(
    parsedResult.lines_added ?? parsedResult.linesAdded ?? 0,
  );
  const removed = Number(
    parsedResult.lines_removed ?? parsedResult.linesRemoved ?? 0,
  );
  const oldText = edit.old_text ?? edit.old_string ?? parsedArgs.old_text;
  const newText =
    edit.new_text ??
    edit.new_string ??
    edit.new_content ??
    edit.content ??
    parsedArgs.new_text ??
    parsedArgs.content;
  const changedLine = Number(parsedResult.changed_line || parsedArgs.line || 0);
  return {
    path: String(pathText || extractKeyArg(args, toolName) || ""),
    action: String(
      parsedResult.action || (toolName === "write" ? "write" : toolName),
    ),
    added,
    removed,
    changedLine,
    diffPreview: String(parsedResult.diff_preview || ""),
    oldText: typeof oldText === "string" ? oldText : "",
    newText: typeof newText === "string" ? newText : "",
    summary: String(summary || ""),
  };
}

function buildPreviewLines(meta) {
  if (!meta) return [];
  if (meta.oldText || meta.newText) {
    const oldLines = meta.oldText
      ? meta.oldText.split(/\r?\n/).slice(0, 6)
      : [];
    const newLines = meta.newText
      ? meta.newText.split(/\r?\n/).slice(0, 6)
      : [];
    return [
      ...oldLines.map((text, idx) => ({
        type: "remove",
        number: meta.changedLine ? meta.changedLine + idx : "",
        text,
      })),
      ...newLines.map((text, idx) => ({
        type: "add",
        number: meta.changedLine ? meta.changedLine + idx : "",
        text,
      })),
    ].slice(0, 10);
  }
  const preview =
    meta.diffPreview || meta.summary.split("\n").slice(1).join("\n");
  return String(preview || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => {
      const match = line.match(/^(\d+)\|\s?(.*)$/);
      return {
        type: "add",
        number: match ? match[1] : "",
        text: match ? match[2] : line,
      };
    });
}

function FilePreview({ meta }) {
  const lines = buildPreviewLines(meta);
  if (!lines.length) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-(--border-default) bg-(--bg-secondary)">
      <div className="flex items-center gap-2 border-b border-(--border-default) px-3 py-2 font-mono text-xs">
        <span className="min-w-0 flex-1 truncate text-(--text-primary)">
          {basename(meta.path) || "file"}
        </span>
        {meta.added > 0 && (
          <span className="text-(--accent-green)">+{meta.added}</span>
        )}
        {meta.removed > 0 && (
          <span className="text-(--accent-red)">-{meta.removed}</span>
        )}
      </div>
      <div className="max-h-64 overflow-auto font-mono text-xs leading-6">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={cn(
              "grid grid-cols-[42px_1fr] border-l-3 px-0",
              line.type === "remove"
                ? "border-(--accent-red) bg-(--accent-red-bg)"
                : "border-(--accent-green) bg-(--accent-green-bg)",
            )}
          >
            <span className="select-none pr-3 text-right text-(--text-muted)">
              {line.number}
            </span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre text-(--text-primary)">
              {line.text || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_STYLES = {
  running: "bg-[var(--accent-blue)] animate-pulse",
  done: "bg-[var(--accent-green)]",
  error: "bg-[var(--accent-red)]",
  blocked: "bg-[var(--accent-orange)]",
};
const TOOL_ROW_CLASS =
  "flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-[13px] hover:bg-[var(--bg-hover)]";
const TOOL_CHEVRON_CLASS = "size-[14px] shrink-0 text-(--text-muted)";
const TOOL_ICON_CLASS =
  "flex size-[18px] shrink-0 items-center justify-center rounded text-(--text-muted)";

export function ToolCard({ card }) {
  const [open, setOpen] = useState(false);
  const toolName = extractToolName(card.name);
  const Icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const keyArg = extractKeyArg(card.arguments, toolName);
  const fileMeta = getFileToolMeta(
    toolName,
    card.arguments,
    card.result,
    card.summary,
  );
  const nameText = fileMeta?.path || keyArg || card.name;

  const sections = [];
  if (card.arguments != null && card.arguments !== "")
    sections.push(["Arguments", formatDetail(card.arguments)]);
  if (card.summary && !fileMeta)
    sections.push(["Summary", String(card.summary)]);
  if (card.result && !fileMeta)
    sections.push(["Result", formatDetail(card.result)]);

  return (
    <div
      className={cn(
        "overflow-hidden bg-transparent",
        card.status === "error" &&
          "rounded-md ring-1 ring-[var(--accent-red)]/25",
        card.status === "blocked" &&
          "rounded-md ring-1 ring-[var(--accent-orange)]/25",
      )}
    >
      <div
        className={TOOL_ROW_CLASS}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown size={14} className={TOOL_CHEVRON_CLASS} />
        ) : (
          <ChevronRight size={14} className={TOOL_CHEVRON_CLASS} />
        )}
        <span className={TOOL_ICON_CLASS}>
          <Icon size={14} />
        </span>
        <span className="font-medium capitalize text-(--text-secondary)">
          {toolName}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs font-normal text-(--text-muted)">
          {nameText}
        </span>
        {fileMeta?.added > 0 && (
          <span className="font-mono text-xs text-(--accent-green)">
            +{fileMeta.added}
          </span>
        )}
        {fileMeta?.removed > 0 && (
          <span className="font-mono text-xs text-(--accent-red)">
            -{fileMeta.removed}
          </span>
        )}
        {card.durationMs != null && (
          <span className="text-[11px] text-[var(--text-muted)] font-mono ml-auto shrink-0">
            {formatDuration(card.durationMs)}
          </span>
        )}
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            STATUS_STYLES[card.status] || "bg-[var(--muted)]",
          )}
        />
      </div>

      {open && (
        <div className="pb-2 pl-8 pr-2">
          {fileMeta ? (
            <>
              {fileMeta.summary && (
                <div className="text-xs text-(--text-muted) pt-1">
                  {fileMeta.summary.split("\n")[0]}
                </div>
              )}
              <FilePreview meta={fileMeta} />
            </>
          ) : sections.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">
              No details yet
            </div>
          ) : (
            sections.map(([label, value], i) => (
              <div key={i}>
                <div className="mt-2 mb-1 text-[10px] font-bold uppercase tracking-[0.4px] text-[var(--text-muted)]">
                  {label}
                </div>
                <pre className="m-0 p-2 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-mono text-xs leading-relaxed max-h-100 overflow-x-auto whitespace-pre-wrap break-words">
                  {value}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
