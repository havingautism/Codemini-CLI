import { useEffect, useState } from "react";
import {
  Archive,
  ArrowSquareOut,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  ListChecks,
  MagnifyingGlass,
  PencilLine,
  Terminal,
  Trash,
  Wrench,
} from "@phosphor-icons/react";
import { LinearRing } from "@/components/ui/spinner";
import { FileTypeIcon } from "@/components/FileTypeIcon.jsx";
import {
  DisclosureLeading,
} from "@/components/DisclosureLeading.jsx";
import { TodoCard } from "@/components/TodoList.jsx";
import {
  requestFromToolCard,
  resultFromToolCard,
  UserInputCard,
} from "@/components/UserInputDialog.jsx";
import { useApp } from "@/context/app-context.jsx";
import { openWorkspaceFile } from "@/hooks/use-api.js";
import { cn } from "@/lib/utils";
import { interactiveRequestForSession } from "@/lib/session-ui-state.js";
import { isShellToolName } from "@/lib/tool-names.js";
import {
  extractToolName,
  FILE_PATH_ARG_TOOLS,
  getConversationToolOutput,
  getFileToolMeta,
  getTodoToolItems,
  isRequestUserInputCard,
  isTodoToolCard,
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
  run_subagent: ListChecks,
  tasks: ListChecks,
  create_spec: FileText,
  delete: Trash,
  run: Terminal,
  Bash: Terminal,
  Powershell: Terminal,
  grep: MagnifyingGlass,
  glob: Folder,
  list: Folder,
  web_fetch: Globe,
  web_search: MagnifyingGlass,
  default: Wrench,
};

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
  return (
    value.startsWith("diff --git ") ||
    value.includes("\ndiff --git ") ||
    value.includes("\n@@ ")
  );
}

function usePatchThemeType() {
  const getIsDark = () =>
    document.documentElement.classList.contains("dark") ||
    document.documentElement.dataset.theme === "dark";
  const [isDark, setIsDark] = useState(() =>
    typeof document === "undefined" ? true : getIsDark(),
  );
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const observer = new MutationObserver(() => setIsDark(getIsDark()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
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

export function FilePreview({ meta }) {
  const themeType = usePatchThemeType();
  if (isUnifiedPatch(meta?.diffPreview)) {
    return (
      <div className="mt-2 max-h-[420px] overflow-auto rounded-md border border-(--border-default) bg-(--tool-detail-bg) text-xs">
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
    <div className="mt-2 overflow-hidden rounded-md border border-(--border-default) bg-(--tool-detail-bg)">
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

export function BackupNotice({ meta }) {
  if (!meta?.backupPath && !meta?.backupSkipped && !meta?.backupError)
    return null;
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

function UserInputToolCard({ card }) {
  const { state, actions } = useApp();
  const pending = interactiveRequestForSession(state, "userInput");
  const result = resultFromToolCard(card);
  const live = Boolean(pending) && !result;
  const request = live ? pending : requestFromToolCard(card);
  return (
    <UserInputCard
      request={request}
      result={live ? null : result}
      onRespond={
        live
          ? (id, response) =>
              actions.respondToUserInput(id, response, pending?.sessionId)
          : undefined
      }
    />
  );
}

const STATUS_STYLES = {
  running: "bg-[var(--accent-orange)]",
  done: "bg-[var(--accent-green)]",
  error: "bg-[var(--accent-red)]",
  blocked: "bg-[var(--accent-orange)]",
};
const TOOL_ROW_CLASS =
  "codemini-disclosure-row msg-process-row gap-1";
const DETAIL_PRE_CLASS =
  "m-0 max-h-100 overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-(--text-primary)";
const TOOL_ICON_CLASS =
  "flex size-4 shrink-0 items-center justify-center text-(--text-process-detail)";
const RUN_TOOL_ICON_CLASS =
  "flex h-4 w-5 shrink-0 items-center justify-center rounded-[3px] border border-[color:color-mix(in_srgb,var(--text-process-detail)_45%,transparent)] text-(--text-process-detail)";

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

function ToolCardIcon({ toolName, Icon }) {
  return (
    <span
      className={isShellToolName(toolName) ? RUN_TOOL_ICON_CLASS : TOOL_ICON_CLASS}
    >
      <Icon size={isShellToolName(toolName) ? 12 : 14} />
    </span>
  );
}

function ToolCardHeaderMeta({
  toolName,
  toolLabel,
  toolArg,
  shouldRenderFileArg,
  fileMeta,
  wrapArg,
}) {
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap leading-6">
        <span className="shrink-0">{toolLabel}</span>
        {toolArg ? (
          shouldRenderFileArg ? (
            <FilePathArgument
              path={fileMeta?.path || toolArg}
              wrapped={wrapArg || Boolean(fileMeta?.path)}
            />
          ) : wrapArg ? (
            <span className="msg-process-meta__detail ml-1 block min-w-0 flex-1 truncate font-mono text-xs font-normal leading-6">
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
    </>
  );
}

export function ToolCard({
  card,
  defaultOpen = false,
  collapsible = true,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [fileAction, setFileAction] = useState("");
  const [fileActionError, setFileActionError] = useState("");
  const showDetails = !collapsible || open;
  const toolName = extractToolName(card.name);
  const Icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const isTasksTool = isTodoToolCard(card);
  const todoItems = isTasksTool
    ? getTodoToolItems(card.arguments, card.result)
    : [];
  if (isTasksTool) {
    return (
      <TodoCard todos={todoItems} persistKey={card?.id || ""} />
    );
  }
  if (isRequestUserInputCard(card)) {
    return <UserInputToolCard card={card} />;
  }
  const fileMeta = getFileToolMeta(
    toolName,
    card.arguments,
    card.result,
    card.summary,
    card.fileChange,
    card.resultMeta,
    card.fileChanges,
  );
  const {
    label: toolLabel,
    arg: toolArg,
    wrapArg,
  } = resolveToolHeaderParts(card, toolName, fileMeta);
  const shouldRenderFileArg =
    Boolean(fileMeta?.path) ||
    (wrapArg && FILE_PATH_ARG_TOOLS.has(toolName) && Boolean(toolArg));
  const filePath = String(fileMeta?.path || (shouldRenderFileArg ? toolArg : "")).trim();
  const canOpenFile =
    Boolean(filePath) &&
    card.status !== "running" &&
    card.status !== "blocked" &&
    toolName !== "delete";

  const handleFileAction = async (event, action) => {
    event.stopPropagation();
    if (!canOpenFile || fileAction) return;
    setFileActionError("");
    setFileAction(action);
    try {
      const result = await openWorkspaceFile(filePath, action);
      if (result?.error || result?.ok === false) {
        throw new Error(result?.message || t("openFileFailed"));
      }
    } catch (error) {
      setFileActionError(String(error?.message || t("openFileFailed")));
    } finally {
      setFileAction("");
    }
  };

  const hasFilePreview = Boolean(fileMeta);
  const conversationOutput = getConversationToolOutput(card, { hasFilePreview });
  const showBody = showDetails && (hasFilePreview || Boolean(conversationOutput));

  return (
    <div className="codemini-disclosure msg-process-meta relative">
      <div className={cn(TOOL_ROW_CLASS, !collapsible && "cursor-default hover:bg-transparent")}>
        {collapsible ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 bg-transparent p-0 text-left"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <DisclosureLeading open={open}>
              <ToolCardIcon toolName={toolName} Icon={Icon} />
            </DisclosureLeading>
            <ToolCardHeaderMeta
              toolName={toolName}
              toolLabel={toolLabel}
              toolArg={toolArg}
              shouldRenderFileArg={shouldRenderFileArg}
              fileMeta={fileMeta}
              wrapArg={wrapArg}
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <DisclosureLeading expandable={false}>
              <ToolCardIcon toolName={toolName} Icon={Icon} />
            </DisclosureLeading>
            <ToolCardHeaderMeta
              toolName={toolName}
              toolLabel={toolLabel}
              toolArg={toolArg}
              shouldRenderFileArg={shouldRenderFileArg}
              fileMeta={fileMeta}
              wrapArg={wrapArg}
            />
          </div>
        )}
        {canOpenFile && (
          <div
            className="flex h-6 shrink-0 items-center gap-0.5"
            role="group"
            aria-label={`${t("openFile")} / ${t("revealFile")}: ${basename(filePath)}`}
          >
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-md text-(--text-muted) opacity-80 transition-[background-color,color,opacity,transform] duration-100 hover:bg-(--bg-hover) hover:text-(--accent-blue) hover:opacity-100 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--accent-blue) disabled:cursor-wait disabled:opacity-40 motion-reduce:transform-none motion-reduce:transition-none"
              onClick={(event) => handleFileAction(event, "open")}
              aria-label={`${t("openFile")}: ${basename(filePath)}`}
              title={`${t("openFile")}: ${filePath}`}
              disabled={Boolean(fileAction)}
            >
              {fileAction === "open" ? (
                <LinearRing size="sm" />
              ) : (
                <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-md text-(--text-muted) opacity-80 transition-[background-color,color,opacity,transform] duration-100 hover:bg-(--bg-hover) hover:text-(--accent-blue) hover:opacity-100 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--accent-blue) disabled:cursor-wait disabled:opacity-40 motion-reduce:transform-none motion-reduce:transition-none"
              onClick={(event) => handleFileAction(event, "reveal")}
              aria-label={`${t("revealFile")}: ${basename(filePath)}`}
              title={`${t("revealFile")}: ${filePath}`}
              disabled={Boolean(fileAction)}
            >
              {fileAction === "reveal" ? (
                <LinearRing size="sm" />
              ) : (
                <FolderOpen size={14} weight="bold" aria-hidden="true" />
              )}
            </button>
          </div>
        )}
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            STATUS_STYLES[card.status] || "bg-[var(--muted)]",
          )}
        />
      </div>
      {fileActionError && (
        <div
          role="alert"
          className="mx-1 mb-1 rounded-md bg-(--accent-red-bg) px-2.5 py-2 text-xs text-(--accent-red)"
        >
          {fileActionError}
        </div>
      )}

      {showBody && (
        <div
          className={cn(
            hasFilePreview
              ? "codemini-fold-body px-1 pb-1"
              : "codemini-disclosure-payload",
          )}
        >
          {fileMeta ? (
            <>
              <BackupNotice meta={fileMeta} />
              <FilePreview meta={fileMeta} />
            </>
          ) : (
            <pre className={DETAIL_PRE_CLASS}>{conversationOutput}</pre>
          )}
        </div>
      )}
    </div>
  );
}
