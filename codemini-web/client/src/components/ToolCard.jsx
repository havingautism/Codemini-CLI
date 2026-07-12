import { useEffect, useState } from "react";
import {
  Archive,
  CaretDown,
  CaretRight,
  FileText,
  Folder,
  Globe,
  ListChecks,
  MagnifyingGlass,
  PencilLine,
  Terminal,
  Trash,
  Wrench,
} from "@phosphor-icons/react";
import { LinearStatusDot } from "@/components/ui/spinner";
import { FileTypeIcon } from "@/components/FileTypeIcon.jsx";
import { cn } from "@/lib/utils";
import {
  extractToolName,
  getFileToolMeta,
  resolveToolHeaderParts,
} from "@/lib/tool-card-display.js";
import { t } from "../../i18n/index.js";
import { PatchDiff } from "@pierre/diffs/react";

const TOOL_ICONS = {
  read: FileText,
  edit: PencilLine,
  create: PencilLine,
  write: PencilLine,
  apply_patch: PencilLine,
  create_plan: ListChecks,
  create_spec: FileText,
  delete: Trash,
  run: Terminal,
  grep: MagnifyingGlass,
  glob: Folder,
  list: Folder,
  web_fetch: Globe,
  web_search: MagnifyingGlass,
  default: Wrench,
};

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

function basename(pathText) {
  const value = String(pathText || "").replace(/\\/g, "/");
  return value.split("/").filter(Boolean).pop() || value;
}

function splitPathForDisplay(pathText) {
  const value = String(pathText || "");
  const normalized = value.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) return { dir: "", name: value };
  return {
    dir: normalized.slice(0, slashIndex + 1),
    name: normalized.slice(slashIndex + 1) || value,
  };
}

function isUnifiedPatch(text) {
  const value = String(text || "");
  return value.startsWith("diff --git ") || value.includes("\ndiff --git ") || value.includes("\n@@ ");
}

function usePatchThemeType() {
  const getIsDark = () =>
    document.documentElement.classList.contains("dark") ||
    document.documentElement.dataset.theme === "dark";
  const [isDark, setIsDark] = useState(() => (typeof document === "undefined" ? true : getIsDark()));
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const observer = new MutationObserver(() => setIsDark(getIsDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => observer.disconnect();
  }, []);
  return isDark ? "dark" : "light";
}

function buildPreviewLines(meta) {
  if (!meta) return [];
  const preview =
    meta.diffPreview || meta.summary.split("\n").slice(1).join("\n");
  if (preview) {
    return String(preview)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const signedMatch = line.match(/^([+-])(\d+)?\|\s?(.*)$/);
        if (signedMatch) {
          return {
            type: signedMatch[1] === "-" ? "remove" : "add",
            number: signedMatch[2] || "",
            text: signedMatch[3] || "",
          };
        }
        const match = line.match(/^(\d+)\|\s?(.*)$/);
        return {
          type: "add",
          number: match ? match[1] : "",
          text: match ? match[2] : line,
        };
      });
  }
  if (meta.oldText || meta.newText) {
    const oldLines = meta.oldText ? meta.oldText.split(/\r?\n/) : [];
    const newLines = meta.newText ? meta.newText.split(/\r?\n/) : [];
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
    ];
  }
  return [];
}

function FilePreview({ meta }) {
  const themeType = usePatchThemeType();
  if (isUnifiedPatch(meta?.diffPreview)) {
    return (
      <div className="mt-2 max-h-[420px] overflow-auto rounded-md border border-(--border-default) bg-(--bg-secondary) text-xs">
        <PatchDiff
          patch={meta.diffPreview}
          options={{
            theme: { dark: "pierre-dark", light: "pierre-light" },
            themeType,
            diffStyle: "unified",
          }}
        />
      </div>
    );
  }
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

function BackupNotice({ meta }) {
  if (!meta?.backupPath && !meta?.backupSkipped && !meta?.backupError) return null;
  const pathText = meta.backupRelativePath || meta.backupPath;
  const label = meta.backupReused
    ? t("backupReused")
    : meta.backupCreated
      ? t("backupCreated")
      : meta.backupSkipped
        ? t("backupSkipped")
        : t("backupReady");
  const detail = meta.backupError
    ? meta.backupError
    : pathText || meta.backupReason || "";
  return (
    <div className="mt-2 flex min-w-0 items-start gap-2 rounded-md border border-(--border-default) bg-(--bg-secondary) px-3 py-2 text-xs">
      <Archive size={14} className="mt-0.5 shrink-0 text-(--accent-blue)" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-(--text-primary)">{label}</div>
        {detail && (
          <div className="mt-0.5 truncate font-mono text-[11px] text-(--text-muted)">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_STYLES = {
  done: "bg-[var(--accent-green)]",
  error: "bg-[var(--accent-red)]",
  blocked: "bg-[var(--accent-orange)]",
};
const TOOL_ROW_CLASS =
  "msg-process-row flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-[13px] hover:bg-[var(--bg-hover)]";
const TOOL_CHEVRON_CLASS = "size-[14px] shrink-0 text-(--text-process-detail)";
const TOOL_ICON_CLASS =
  "flex size-[18px] shrink-0 items-center justify-center rounded text-(--text-process-detail)";
const RUN_TOOL_ICON_CLASS =
  "flex h-4 w-5 shrink-0 items-center justify-center rounded-[3px] border border-[color:color-mix(in_srgb,var(--text-process-detail)_45%,transparent)] text-(--text-process-detail)";
const FILE_PATH_ARG_TOOLS = new Set(["read", "edit", "create", "write", "delete"]);

function FilePathArgument({ path, wrapped = false }) {
  const { dir, name } = splitPathForDisplay(path);
  return (
    <span
      className="msg-process-meta__detail ml-1 flex min-w-0 items-center font-mono text-xs font-normal leading-[18px]"
      title={path}
    >
      {wrapped ? "(" : null}
      {dir && <span className="min-w-0 truncate">{dir}</span>}
      <span className="flex shrink-0 items-center gap-1.5">
        <FileTypeIcon path={path} size="sm" />
        <span>{name}</span>
      </span>
      {wrapped ? ")" : null}
    </span>
  );
}

export function ToolCard({ card }) {
  const [open, setOpen] = useState(false);
  const toolName = extractToolName(card.name);
  const Icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const fileMeta = getFileToolMeta(
    toolName,
    card.arguments,
    card.result,
    card.summary,
    card.fileChange,
    card.resultMeta,
    card.fileChanges,
  );
  const { label: toolLabel, arg: toolArg, wrapArg } = resolveToolHeaderParts(
    card,
    toolName,
    fileMeta,
  );
  const shouldRenderFileArg =
    Boolean(fileMeta?.path) ||
    (wrapArg && FILE_PATH_ARG_TOOLS.has(toolName) && Boolean(toolArg));

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
        "codemini-message-surface msg-process-meta relative overflow-hidden after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-transparent after:content-['']",
        card.status === "error" &&
          "after:border-[color:color-mix(in_srgb,var(--accent-red)_32%,transparent)]",
        card.status === "blocked" &&
          "after:border-[color:color-mix(in_srgb,var(--accent-orange)_32%,transparent)]",
      )}
    >
      <div className={TOOL_ROW_CLASS} onClick={() => setOpen(!open)}>
        {open ? (
          <CaretDown size={14} className={TOOL_CHEVRON_CLASS} />
        ) : (
          <CaretRight size={14} className={TOOL_CHEVRON_CLASS} />
        )}
        <span className={toolName === "run" ? RUN_TOOL_ICON_CLASS : TOOL_ICON_CLASS}>
          <Icon size={toolName === "run" ? 13 : 14} />
        </span>
        <span className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap leading-[18px]">
          <span className="shrink-0">{toolLabel}</span>
          {toolArg ? (
            shouldRenderFileArg ? (
              <FilePathArgument
                path={fileMeta?.path || toolArg}
                wrapped={wrapArg || Boolean(fileMeta?.path)}
              />
            ) : wrapArg ? (
              <span className="msg-process-meta__detail ml-1 flex min-w-0 items-center overflow-hidden text-ellipsis font-mono text-xs font-normal leading-[18px]">
                ({toolArg})
              </span>
            ) : null
          ) : null}
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
        {fileMeta?.backupPath && (
          <span className="inline-flex items-center gap-1 rounded bg-(--accent-blue-bg) px-1.5 py-0.5 text-[10px] font-medium text-(--accent-blue)">
            <Archive size={11} />
            {fileMeta.backupReused ? t("backupReusedShort") : t("backupShort")}
          </span>
        )}
        {card.status === "running" ? (
          <LinearStatusDot className="shrink-0" />
        ) : (
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              STATUS_STYLES[card.status] || "bg-[var(--muted)]",
            )}
          />
        )}
      </div>

      {open && (
        <div className="pb-2 pl-8 pr-2">
          {fileMeta ? (
            <>
              {fileMeta.summary && (
                <div className="text-xs text-(--text-muted) pt-1 pl-1">
                  {fileMeta.summary.split("\n")[0]}
                </div>
              )}
              <BackupNotice meta={fileMeta} />
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
