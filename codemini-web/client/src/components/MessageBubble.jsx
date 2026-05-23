import { useEffect, useState, useMemo } from "react";
import { ToolCard } from "./ToolCard";
import { StreamdownRenderer } from "./StreamdownRenderer";
import { TodoList } from "./TodoList";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "../../utils/time.js";
import { t } from "../../i18n/index.js";
import * as api from "@/hooks/use-api.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Brain,
  Loader2,
  Moon,
  RotateCcw,
} from "lucide-react";

const ROLE_STYLES = {
  you: { badge: "bg-(--accent-blue-bg) text-(--accent-blue)", label: "You" },
  general: {
    badge: "bg-(--accent-green-bg) text-(--accent-green)",
    label: "General",
  },
  coder: {
    badge: "bg-(--accent-green-bg) text-(--accent-green)",
    label: "Coder",
  },
  advisor: {
    badge: "bg-(--accent-blue-bg) text-(--accent-blue)",
    label: "Advisor",
  },
  planner: {
    badge: "bg-(--accent-purple-bg) text-(--accent-purple)",
    label: "Planner",
  },
  reviewer: {
    badge: "bg-(--accent-orange-bg) text-(--accent-orange)",
    label: "Reviewer",
  },
  tester: {
    badge: "bg-(--accent-blue-bg) text-(--accent-blue)",
    label: "Tester",
  },
  summarizer: {
    badge: "bg-(--accent-cyan-bg) text-(--accent-cyan)",
    label: "Summarizer",
  },
  system: { badge: "bg-(--muted) text-(--muted-foreground)", label: "System" },
  error: { badge: "bg-(--accent-red-bg) text-(--accent-red)", label: "Error" },
  pending: {
    badge: "bg-(--accent-cyan-bg) text-(--accent-cyan)",
    label: "Pending",
  },
};

const SKILL_BADGE_STYLES = {
  running: "bg-(--accent-blue-bg) text-(--accent-blue)",
  done: "bg-(--accent-green-bg) text-(--accent-green)",
  error: "bg-(--accent-red-bg) text-(--accent-red)",
  auto: "bg-(--accent-purple-bg) text-(--accent-purple)",
};

const TOOL_COLLAPSE_THRESHOLD = 1;
const COLLAPSE_ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3 py-2 text-left text-[12px] text-(--text-secondary) hover:bg-(--bg-hover)";
const COLLAPSE_CHEVRON_CLASS = "size-[14px] shrink-0 text-(--text-muted)";
const COLLAPSE_ICON_CLASS =
  "flex size-[18px] shrink-0 items-center justify-center";

function formatThoughtDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "";
  const totalSeconds = value > 0 ? Math.max(0.1, value / 1000) : 0;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatProcessDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "";
  return formatThoughtDuration(value);
}

function getThoughtElapsed(segment, tick) {
  if (!segment.isStreaming && Number.isFinite(Number(segment.durationMs))) {
    return Math.max(0, Number(segment.durationMs));
  }
  const start = Date.parse(segment.startedAt || "");
  if (!Number.isFinite(start)) return null;
  const end = segment.isStreaming ? tick : Date.parse(segment.endedAt || "");
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function ThoughtBlock({ segment }) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    if (!segment.isStreaming) return undefined;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [segment.isStreaming]);

  const elapsed = formatThoughtDuration(getThoughtElapsed(segment, tick));
  const label = segment.isStreaming
    ? t("thinkingNow")
    : elapsed
      ? t("thoughtFor").replace("{{duration}}", elapsed)
      : t("thought");

  return (
    <div className="my-3 text-(--text-primary)">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(COLLAPSE_ROW_CLASS, "font-medium")}
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={cn(
            COLLAPSE_CHEVRON_CLASS,
            "transition-transform",
            open && "rotate-90",
          )}
        />
        <span className={COLLAPSE_ICON_CLASS}>
          {segment.isStreaming ? (
            <Loader2 size={14} className="animate-spin text-(--accent-cyan)" />
          ) : (
            <Brain size={15} />
          )}
        </span>
        <span>{label}</span>
        {segment.isStreaming && elapsed && <span>{elapsed}</span>}
      </button>
      {open && (
        <div className="relative ml-4.5 mt-1.5 pl-8 before:absolute before:left-0 before:top-0 before:bottom-1 before:w-px before:bg-(--border-default)">
          <StreamdownRenderer
            text={segment.text}
            streaming={segment.isStreaming}
            className="pl-5 text-[13px] italic leading-5 text-(--text-secondary)"
          />
        </div>
      )}
    </div>
  );
}

function getToolDurationMs(cards = []) {
  return cards.reduce((sum, card) => {
    const value = Number(card?.durationMs);
    return Number.isFinite(value) ? sum + Math.max(0, value) : sum;
  }, 0);
}

function getThinkingDurationMs(segment) {
  const value = Number(segment?.durationMs);
  if (Number.isFinite(value)) return Math.max(0, value);
  return getThoughtElapsed(segment, Date.now()) || 0;
}

function isProcessGroup(group) {
  return group?.type === "thinking" || group?.type === "tools";
}

function isProcessGroupRunning(group) {
  if (group?.type === "thinking") return group.isStreaming;
  if (group?.type === "tools") {
    return (group.cards || []).some((card) => card.status === "running");
  }
  return false;
}

function getProcessGroupItemCount(group) {
  if (group?.type === "thinking") return 1;
  if (group?.type === "tools") return Math.max(1, group.cards?.length || 0);
  return 0;
}

function getProcessGroupDurationMs(group) {
  if (group?.type === "thinking") return getThinkingDurationMs(group);
  if (group?.type === "tools") return getToolDurationMs(group.cards || []);
  return 0;
}

function shouldCollapseProcessGroups(groups) {
  if (!groups.length || groups.some(isProcessGroupRunning)) return false;
  const itemCount = groups.reduce(
    (sum, group) => sum + getProcessGroupItemCount(group),
    0,
  );
  const toolCount = groups.reduce(
    (sum, group) =>
      group.type === "tools"
        ? sum + Math.max(1, group.cards?.length || 0)
        : sum,
    0,
  );
  return itemCount >= 4 || (toolCount >= 2 && groups.length >= 3);
}

function collapseProcessGroups(groups, { disabled = false } = {}) {
  if (disabled) return groups;
  const collapsed = [];
  let pending = [];

  const flush = () => {
    if (!pending.length) return;
    if (shouldCollapseProcessGroups(pending)) {
      collapsed.push({
        type: "process",
        groups: pending,
        durationMs: pending.reduce(
          (sum, group) => sum + getProcessGroupDurationMs(group),
          0,
        ),
      });
    } else {
      collapsed.push(...pending);
    }
    pending = [];
  };

  for (const group of groups) {
    if (isProcessGroup(group)) {
      pending.push(group);
      continue;
    }
    flush();
    collapsed.push(group);
  }
  flush();
  return collapsed;
}

function ToolGroup({ cards }) {
  const [expanded, setExpanded] = useState(false);
  const total = cards.length;
  const hasRunningTool = cards.some((card) => card.status === "running");
  const shouldUseSummaryHeader = total > TOOL_COLLAPSE_THRESHOLD;
  const runCount = cards.filter((card) => {
    const name = String(card.name || "").toLowerCase();
    return name === "run" || name.startsWith("run(");
  }).length;
  const summaryLabel =
    runCount === total
      ? t("toolGroupCommands").replace("{{count}}", total)
      : t("toolGroupTools").replace("{{count}}", total);

  return (
    <div className="my-2">
      {shouldUseSummaryHeader && (
        <button
          type="button"
          className={COLLAPSE_ROW_CLASS}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown size={14} className={COLLAPSE_CHEVRON_CLASS} />
          ) : (
            <ChevronRight size={14} className={COLLAPSE_CHEVRON_CLASS} />
          )}
          <span className={COLLAPSE_ICON_CLASS}>
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                hasRunningTool
                  ? "animate-pulse bg-(--accent-blue)"
                  : "bg-(--accent-green)",
              )}
            />
          </span>
          <span className="font-medium">{summaryLabel}</span>
          {/* {!expanded && (
            <span className="text-(--text-muted)">{t("toolGroupExpand")}</span>
          )} */}
        </button>
      )}
      {(!shouldUseSummaryHeader || expanded) && (
        <div
          className={cn(
            "space-y-1",
            shouldUseSummaryHeader &&
              "relative ml-4.5 pl-6 mt-2 before:absolute before:left-0 before:top-0 before:bottom-1 before:w-px before:bg-(--border-default)",
          )}
        >
          {cards.map((card) => (
            <ToolCard key={card.id} card={card} />
          ))}
        </div>
      )}
      {hasRunningTool && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-(--text-muted)">
          <Spinner className="text-(--accent-cyan)" />
          <span>{t("tooling")}</span>
        </div>
      )}
    </div>
  );
}

function ProcessGroup({ group }) {
  const [expanded, setExpanded] = useState(false);
  const duration = formatProcessDuration(group.durationMs);
  const label = duration
    ? t("processedFor").replace("{{duration}}", duration)
    : t("processed");
  const toolCount = group.groups.reduce(
    (sum, item) =>
      item.type === "tools" ? sum + Math.max(1, item.cards?.length || 0) : sum,
    0,
  );
  const thoughtCount = group.groups.filter(
    (item) => item.type === "thinking",
  ).length;

  return (
    <div className="my-3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={COLLAPSE_ROW_CLASS}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown size={14} className={COLLAPSE_CHEVRON_CLASS} />
        ) : (
          <ChevronRight size={14} className={COLLAPSE_CHEVRON_CLASS} />
        )}
        <span className={COLLAPSE_ICON_CLASS}>
          <span className="inline-block size-1.5 rounded-full bg-(--accent-green)" />
        </span>
        <span className="font-medium">{label}</span>
        <span className="min-w-0 truncate text-(--text-muted)">
          {t("processedDetails")
            .replace("{{thoughts}}", thoughtCount)
            .replace("{{tools}}", toolCount)}
        </span>
      </button>
      {expanded && (
        <div className="relative ml-4.5 mt-2 space-y-1 pl-6 before:absolute before:left-0 before:top-0 before:bottom-1 before:w-px before:bg-(--border-default)">
          {group.groups.map((item, index) => {
            if (item.type === "thinking") {
              return <ThoughtBlock key={`p-th-${index}`} segment={item} />;
            }
            if (item.type === "tools") {
              return <ToolGroup key={`p-tg-${index}`} cards={item.cards} />;
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

function mergeFileChanges(fileChanges = []) {
  const byPath = new Map();
  const order = [];
  const seen = new Set();
  const actionRank = { delete: 3, create: 2, edit: 1 };
  for (const change of fileChanges) {
    const path = decodeDisplayPath(change?.path || "");
    if (!path) continue;
    const fingerprint = JSON.stringify({
      path,
      action: change.action || "",
      linesAdded: Number(change.linesAdded || 0),
      linesRemoved: Number(change.linesRemoved || 0),
      changedLine: Number(change.changedLine || 0),
      diffPreview: change.diffPreview || "",
      changeSetId: change.changeSetId || "",
    });
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const key = path;
    if (!byPath.has(key)) {
      byPath.set(key, {
        ...change,
        path,
        linesAdded: 0,
        linesRemoved: 0,
        diffPreview: "",
        changes: [],
        changeSetIds: [],
      });
      order.push(key);
    }
    const existing = byPath.get(key);
    existing.linesAdded += Number(change.linesAdded || 0);
    existing.linesRemoved += Number(change.linesRemoved || 0);
    const currentRank = actionRank[existing.action] || 0;
    const nextRank = actionRank[change.action] || 0;
    if (nextRank > currentRank) existing.action = change.action;
    if (change.diffPreview) {
      existing.changes.push({ ...change, path });
    }
    if (change.changeSetId && !existing.changeSetIds.includes(change.changeSetId)) {
      existing.changeSetIds.push(change.changeSetId);
    }
    if (!existing.diffPreview && change.diffPreview) {
      existing.diffPreview = change.diffPreview;
      existing.changedLine = change.changedLine;
    }
  }
  return order.map((key) => {
    const change = byPath.get(key);
    return {
      ...change,
      changeSetId: change.changeSetIds.length === 1 ? change.changeSetIds[0] : "",
    };
  });
}

function getFileChangeSetIds(change) {
  return Array.isArray(change?.changeSetIds) && change.changeSetIds.length
    ? change.changeSetIds
    : (change?.changeSetId ? [change.changeSetId] : []);
}

function getFileChangeUndoKey(change) {
  return getFileChangeSetIds(change).join("|");
}

function formatUndoError(error) {
  const message = error?.message || "";
  if (message.includes("Cannot undo this change cleanly")) {
    return t("undoChangeConflict");
  }
  return message || t("undoChangeFailed");
}

function decodeDisplayPath(pathText) {
  const value = String(pathText || "");
  if (!/(?:\/[0-7]{3}){2,}/.test(value)) return value;
  return value.replace(/((?:\/[0-7]{3}){2,})/g, (match) => {
    const bytes = match
      .split("/")
      .filter(Boolean)
      .map((part) => parseInt(part, 8));
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    } catch {
      return match;
    }
  });
}

function basename(pathText) {
  const value = decodeDisplayPath(pathText).replace(/\\/g, "/");
  return value.split("/").filter(Boolean).pop() || value || "file";
}

function buildFileChangePreviewLines(change) {
  const raw = String(change?.diffPreview || "");
  const unified = raw.includes("\ndiff --git ") || raw.startsWith("diff --git ") || raw.includes("\n@@ ");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      if (unified) {
        const type = line.startsWith("+") && !line.startsWith("+++")
          ? "add"
          : line.startsWith("-") && !line.startsWith("---")
            ? "remove"
            : line.startsWith("@@") || line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")
              ? "meta"
              : "context";
        return { number: "", text: line, type };
      }
      const signedMatch = line.match(/^([+-])(\d+)?\|\s?(.*)$/);
      if (signedMatch) {
        return {
          number: signedMatch[2] || "",
          text: signedMatch[3] || "",
          type: signedMatch[1] === "-" ? "remove" : "add",
        };
      }
      const match = line.match(/^(\d+)\|\s?(.*)$/);
      return {
        number: match ? match[1] : "",
        text: match ? match[2] : line,
        type: change.action === "delete" ? "remove" : "add",
      };
    });
}

function FileChangePreviewChunk({ change }) {
  const lines = buildFileChangePreviewLines(change);
  if (!lines.length) return null;
  return (
    <>
      {lines.map((line, idx) => (
        <div
          key={idx}
          className={cn(
            "grid min-w-full grid-cols-[52px_max-content] border-l-3",
            line.type === "remove" &&
              "border-(--accent-red) bg-(--accent-red-bg)",
            line.type === "add" &&
              "border-(--accent-green) bg-(--accent-green-bg)",
            (line.type === "meta" || line.type === "context") &&
              "border-transparent bg-transparent",
          )}
        >
          <span className="select-none pr-3 text-right text-(--text-muted)">
            {line.number}
          </span>
          <span
            className={cn(
              "whitespace-pre pr-4",
              line.type === "meta"
                ? "text-(--text-muted)"
                : "text-(--text-primary)",
            )}
          >
            {line.text || " "}
          </span>
        </div>
      ))}
    </>
  );
}

function FileChangePreview({ change }) {
  const chunks = Array.isArray(change?.changes) && change.changes.length
    ? change.changes
    : [change];
  const visibleChunks = chunks.filter((chunk) => buildFileChangePreviewLines(chunk).length > 0);
  if (!visibleChunks.length) return null;
  return (
    <div className="overflow-hidden bg-(--bg-primary)">
      <div className="max-h-[420px] overflow-auto font-mono text-xs leading-6">
        {visibleChunks.map((chunk, idx) => (
          <div key={`${chunk.changeSetId || idx}-${idx}`} className="border-t border-(--border-default) first:border-t-0">
            {visibleChunks.length > 1 && (
              <div className="px-3 py-1 text-[10px] uppercase tracking-[0.3px] text-(--text-muted)">
                Change {idx + 1}
                {chunk.linesAdded != null && (
                  <span className="ml-2 text-(--accent-green)">+{chunk.linesAdded}</span>
                )}
                {chunk.linesRemoved != null && (
                  <span className="ml-1 text-(--accent-red)">-{chunk.linesRemoved}</span>
                )}
              </div>
            )}
            <FileChangePreviewChunk change={chunk} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FileChangesSummary({ changes }) {
  const [openFiles, setOpenFiles] = useState(() => new Set());
  const [undoing, setUndoing] = useState(() => new Set());
  const [hiddenUndoKeys, setHiddenUndoKeys] = useState(() => new Set());
  const [undoErrors, setUndoErrors] = useState(() => new Map());
  const [pendingUndo, setPendingUndo] = useState(null);
  const actionColors = {
    edit: "bg-(--accent-blue-bg) text-(--accent-blue)",
    create: "bg-(--accent-green-bg) text-(--accent-green)",
    delete: "bg-(--accent-red-bg) text-(--accent-red)",
  };
  const visibleChanges = changes.filter((change) => {
    const undoKey = getFileChangeUndoKey(change);
    return !undoKey || !hiddenUndoKeys.has(undoKey);
  });

  const confirmUndoChange = async () => {
    if (!pendingUndo || undoing.has(pendingUndo.undoKey)) return;
    const { undoKey, changeSetIds } = pendingUndo;
    setUndoErrors((prev) => {
      const next = new Map(prev);
      next.delete(undoKey);
      return next;
    });
    setUndoing((prev) => new Set(prev).add(undoKey));
    try {
      for (const id of [...changeSetIds].reverse()) {
        const result = await api.undoSessionChange(id);
        if (result?.error || result?.ok === false) {
          throw new Error(result.message || t("undoChangeFailed"));
        }
      }
      setHiddenUndoKeys((prev) => new Set(prev).add(undoKey));
      setOpenFiles((prev) => {
        const next = new Set(prev);
        next.delete(pendingUndo.rowKey);
        return next;
      });
      setPendingUndo(null);
    } catch (error) {
      setUndoErrors((prev) => new Map(prev).set(undoKey, formatUndoError(error)));
    } finally {
      setUndoing((prev) => {
        const next = new Set(prev);
        next.delete(undoKey);
        return next;
      });
    }
  };

  if (!visibleChanges.length && !pendingUndo) return null;

  return (
    <>
    <div className="mt-6 overflow-hidden rounded-lg border border-(--border-default) bg-(--bg-secondary)">
      {visibleChanges.map((c, i) => {
        const key = `${c.path}-${i}`;
        const fileOpen = openFiles.has(key);
        const hasPreview = Boolean(c.diffPreview || (Array.isArray(c.changes) && c.changes.length));
        const changeSetIds = getFileChangeSetIds(c);
        const undoKey = changeSetIds.join("|");
        return (
          <div
            key={key}
            className="border-t border-(--border-default) first:border-t-0"
          >
            <div
              role="button"
              tabIndex={hasPreview ? 0 : -1}
              onClick={() => {
                if (!hasPreview) return;
                setOpenFiles((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
              className={cn(
                "flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2.5 text-left font-mono text-xs",
                hasPreview
                  ? "cursor-pointer hover:bg-(--bg-hover)"
                  : "cursor-default",
              )}
            >
              {hasPreview ? (
                fileOpen ? (
                  <ChevronDown
                    size={13}
                    className="shrink-0 text-(--text-muted)"
                  />
                ) : (
                  <ChevronRight
                    size={13}
                    className="shrink-0 text-(--text-muted)"
                  />
                )
              ) : (
                <span className="w-[13px] shrink-0" />
              )}
              <span
                className={cn(
                  "rounded px-[5px] py-px text-[10px] font-semibold",
                  actionColors[c.action] || "bg-(--muted) text-(--text-muted)",
                )}
              >
                {c.action?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-(--text-primary)">
                {c.path}
                {Array.isArray(c.changes) && c.changes.length > 1 && (
                  <span className="ml-2 text-[10px] text-(--text-muted)">
                    {c.changes.length} changes
                  </span>
                )}
              </span>
              {c.linesAdded != null && (
                <span className="text-[11px] text-(--accent-green)">
                  +{c.linesAdded}
                </span>
              )}
              {c.linesRemoved != null && (
                <span className="text-[11px] text-(--accent-red)">
                  -{c.linesRemoved}
                </span>
              )}
              {changeSetIds.length > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  title={t("undoChange")}
                  aria-label={t("undoChange")}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (undoing.has(undoKey)) return;
                    setUndoErrors((prev) => {
                      const next = new Map(prev);
                      next.delete(undoKey);
                      return next;
                    });
                    setPendingUndo({
                      path: c.path,
                      rowKey: key,
                      undoKey,
                      changeSetIds,
                      count: Math.max(1, Array.isArray(c.changes) ? c.changes.length : 1),
                    });
                  }}
                  className={cn(
                    "ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                    undoing.has(undoKey) && "pointer-events-none opacity-60",
                  )}
                >
                  {undoing.has(undoKey) ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RotateCcw size={13} />
                  )}
                </span>
              )}
            </div>
            {undoKey && undoErrors.has(undoKey) && (
              <div className="border-t border-(--border-default) px-3 py-2 text-xs text-(--accent-red)">
                {undoErrors.get(undoKey)}
              </div>
            )}
            {fileOpen && (
              <div className="border-t border-(--border-default)">
                <FileChangePreview change={c} />
              </div>
            )}
          </div>
        );
      })}
    </div>
    <ConfirmDialog
      open={Boolean(pendingUndo)}
      title={t("undoChangeConfirm")}
      description={(pendingUndo?.count || 0) > 1
        ? t("undoChangesDescription")
            .replace("{{path}}", pendingUndo?.path || "")
            .replace("{{count}}", pendingUndo?.count || 1)
        : t("undoChangeDescription").replace("{{path}}", pendingUndo?.path || "")}
      confirmLabel={t("undoChange")}
      loadingLabel={t("undoingChange")}
      loading={Boolean(pendingUndo && undoing.has(pendingUndo.undoKey))}
      onOpenChange={(open) => {
        if (!open) setPendingUndo(null);
      }}
      onConfirm={confirmUndoChange}
    />
    </>
  );
}

// Merge adjacent tool segments (possibly separated by empty text) into merged render groups
function buildRenderGroups(segments) {
  const groups = [];
  let pendingTools = [];

  const flushTools = () => {
    if (pendingTools.length > 0) {
      groups.push({ type: "tools", cards: pendingTools });
      pendingTools = [];
    }
  };

  for (const seg of segments) {
    if (seg.type === "tools") {
      pendingTools.push(...seg.cards);
    } else if (seg.type === "text") {
      if (seg.text) {
        // Non-empty text breaks the tool group
        flushTools();
        groups.push({
          type: "text",
          text: seg.text,
          isStreaming: seg.isStreaming,
        });
      }
      // Empty text between tools: skip, keep accumulating
    } else if (seg.type === "thinking") {
      if (seg.text) {
        flushTools();
        groups.push({ type: "thinking", ...seg });
      }
    }
  }
  flushTools();
  return groups;
}

function UserText({ text, skills = [] }) {
  const match = String(text || "").match(/^(\/([A-Za-z0-9_-]+))(\s+[\s\S]*)?$/);
  if (!match) return <StreamdownRenderer text={text} streaming={false} />;

  const [, token, skillName, rest = ""] = match;
  if (skillName === "dream") {
    return (
      <div className="msg-body whitespace-pre-wrap text-(--text-primary)">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-md bg-(--accent-cyan-bg) px-1.5 py-0.5 text-(--accent-cyan) font-mono text-[0.92em] cursor-help align-baseline">
              <Moon size={13} />
              {token}
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={8}
            className="max-w-75 px-4 py-3 leading-relaxed whitespace-normal"
          >
            <div className="font-semibold mb-1.5">Dream</div>
            <div className="text-(--text-secondary)">
              Consolidates memory inbox entries and stale memory buckets. It can
              run manually with /dream or automatically when the inbox threshold
              is reached.
            </div>
          </TooltipContent>
        </Tooltip>
        {rest}
      </div>
    );
  }

  const skill = skills.find((s) => s.name === skillName);
  if (!skill) return <StreamdownRenderer text={text} streaming={false} />;

  return (
    <div className="msg-body whitespace-pre-wrap text-(--text-primary)">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center rounded-md bg-(--accent-purple-bg) px-1.5 py-0.5 text-accent-purple font-mono text-[0.92em] cursor-help align-baseline">
            {token}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={8}
          className="max-w-75 px-4 py-3 leading-relaxed whitespace-normal"
        >
          <div className="font-semibold mb-1.5">{skill.name}</div>
          <div className="text-(--text-secondary)">
            {skill.description || "No description"}
          </div>
        </TooltipContent>
      </Tooltip>
      {rest}
    </div>
  );
}

function getMessageText(message) {
  const text = String(message?.text || "");
  if (text) return text;
  return (message?.segments || [])
    .filter((segment) => segment.type === "text")
    .map((segment) => String(segment.text || ""))
    .join("");
}

async function writeClipboard(text) {
  const value = String(text || "");
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  return ok;
}

function MessageActionButton({
  label,
  copiedLabel,
  copied = false,
  disabled = false,
  onClick,
  children,
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={copied ? copiedLabel || label : label}
          disabled={disabled}
          onClick={onClick}
          className="inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary) disabled:cursor-not-allowed disabled:opacity-45"
        >
          {copied ? <Check size={17} /> : children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {copied ? copiedLabel || label : label}
      </TooltipContent>
    </Tooltip>
  );
}

function formatUsageNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  if (number >= 1_000_000)
    return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
  if (number >= 1000)
    return `${(number / 1000).toFixed(number >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(number));
}

function getUsageSummary(usage) {
  if (!usage || typeof usage !== "object") return null;
  const total = Number(usage.totalTokens || 0);
  const input = Number(usage.inputTokens || 0);
  const output = Number(usage.outputTokens || 0);
  const cached = Number(usage.cachedInputTokens || 0);
  const cacheMiss = Number(usage.cacheMissInputTokens || 0);
  const cacheWrite = Number(usage.cacheWriteInputTokens || 0);
  const reasoning = Number(usage.reasoningOutputTokens || 0);
  const requests = Number(usage.requests || 0);
  if (
    ![total, input, output, cached, cacheWrite, reasoning].some(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;
  const cacheBase =
    cacheMiss > 0 || cacheWrite > 0 ? cached + cacheMiss + cacheWrite : input;
  const cachePct = cacheBase > 0 ? (cached / cacheBase) * 100 : 0;
  const labelParts = [
    `${formatUsageNumber(total || input + output)} ${t("usageTokens")}`,
  ];
  if (cached > 0 || input > 0) {
    labelParts.push(
      `${t("usageCache")} ${formatUsageNumber(cached)} (${cachePct.toFixed(1)}%)`,
    );
  }
  const detailParts = [
    `${t("usageInput")} ${formatUsageNumber(input)}`,
    `${t("usageOutput")} ${formatUsageNumber(output)}`,
    `${t("usageTotal")} ${formatUsageNumber(total || input + output)}`,
  ];
  if (cached > 0 || input > 0)
    detailParts.push(
      `${t("usageCacheHit")} ${formatUsageNumber(cached)} (${cachePct.toFixed(1)}%)`,
    );
  if (cacheMiss > 0)
    detailParts.push(`${t("usageCacheMiss")} ${formatUsageNumber(cacheMiss)}`);
  if (cacheWrite > 0)
    detailParts.push(
      `${t("usageCacheWrite")} ${formatUsageNumber(cacheWrite)}`,
    );
  if (reasoning > 0)
    detailParts.push(`${t("usageReasoning")} ${formatUsageNumber(reasoning)}`);
  if (requests > 1)
    detailParts.push(t("usageRequests").replace("{{count}}", requests));
  return {
    label: labelParts.join(" · "),
    details: detailParts.join(" · "),
  };
}

function UsageBadge({ usage }) {
  const summary = getUsageSummary(usage);
  if (!summary) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-8 max-w-full items-center truncate rounded-md px-1.5 text-[11px] text-(--text-muted)">
          {summary.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {summary.details}
      </TooltipContent>
    </Tooltip>
  );
}

function isMessageComplete(message, renderGroups = []) {
  if (message?.isComplete === false) return false;
  if (
    message?.planStep &&
    !["done", "failed"].includes(String(message.planStep.status || ""))
  ) {
    return false;
  }
  const groups = Array.isArray(renderGroups) ? renderGroups : [];
  const hasStreamingSegment = (segment) => {
    if (!segment || typeof segment !== "object") return false;
    if (segment.isStreaming) return true;
    if (segment.type === "tools") {
      return (segment.cards || []).some((card) => card.status === "running");
    }
    if (segment.type === "process") {
      return (segment.groups || []).some(hasStreamingSegment);
    }
    return false;
  };
  return !groups.some(hasStreamingSegment);
}

function shouldShowMessageActions(message, messageComplete) {
  if (!messageComplete) return false;
  const planStep = message?.planStep;
  if (!planStep) return true;
  return (
    String(planStep.role || "").toLowerCase() === "summarizer" &&
    Number(planStep.step) === Number(planStep.total)
  );
}

function MessageActions({
  text,
  usage = null,
  showUsage = true,
  align = "left",
  className,
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await writeClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        align === "right" ? "justify-end" : "justify-start",
        className,
      )}
    >
      <MessageActionButton
        label={t("copyMessage")}
        copiedLabel={t("copied")}
        copied={copied}
        disabled={!text}
        onClick={handleCopy}
      >
        <Copy size={17} />
      </MessageActionButton>
      {showUsage && <UsageBadge usage={usage} />}
    </div>
  );
}

export function MessageBubble({ message, skills = [] }) {
  const {
    role,
    segments,
    skillBadges,
    fileChanges,
    startupTodos,
    text: legacyText,
    timestamp,
    planStep,
    usage,
  } = message;
  const style = ROLE_STYLES[role] || ROLE_STYLES.general;
  const ts = timestamp ? formatTimestamp(timestamp) : "";

  const renderGroups = useMemo(() => {
    const groups = buildRenderGroups(segments || []);
    const hasStreamingText = groups.some(
      (group) => group.type === "text" && group.isStreaming,
    );
    const messageInProgress =
      message?.isComplete === false ||
      (message?.planStep &&
        !["done", "failed"].includes(String(message.planStep.status || "")));
    return collapseProcessGroups(groups, {
      disabled: hasStreamingText || messageInProgress,
    });
  }, [message?.isComplete, message?.planStep, segments]);
  const mergedFileChanges = useMemo(
    () => mergeFileChanges(fileChanges || []),
    [fileChanges],
  );

  if (role === "divider") {
    return (
      <div data-message-id={message.id} className="py-3 px-6 text-center">
        <div className="max-w-[860px] mx-auto relative">
          <div className="border-t border-border" />
          <span className="text-xs text-(--text-muted) bg-(--bg-primary) px-2 absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
            {legacyText || "以上内容已压缩"}
          </span>
        </div>
      </div>
    );
  }

  if (role === "system") {
    const isWaitingReview =
      legacyText?.includes("等待计划审阅") ||
      legacyText?.includes("Waiting for plan review");
    if (isWaitingReview) {
      return null;
    }

    return (
      <div
        data-message-id={message.id}
        className="py-2 px-6 text-xs text-(--text-muted) text-center"
      >
        <div className="max-w-[860px] mx-auto px-3 py-1">
          {legacyText}
          {startupTodos && <TodoList todos={startupTodos} />}
        </div>
      </div>
    );
  }

  const youText =
    role === "you"
      ? legacyText ||
        segments
          ?.filter((s) => s.type === "text")
          .map((s) => s.text)
          .join("") ||
        ""
      : "";
  const messageText = role === "you" ? youText : getMessageText(message);
  const messageComplete =
    role === "you" || isMessageComplete(message, renderGroups);
  const showActions = shouldShowMessageActions(message, messageComplete);

  return (
    <div
      data-message-id={message.id}
      className={cn(
        "py-2 my-[22px] group/message",
        role === "you" && "flex justify-end",
      )}
    >
      {role === "you" ? (
        <div className="flex w-fit max-w-full flex-col items-end">
          <div className="w-fit max-w-full bg-(--bg-tertiary) rounded-2xl px-4 py-3">
            {youText && <UserText text={youText} skills={skills} />}
            {startupTodos && <TodoList todos={startupTodos} />}
          </div>
          <MessageActions
            text={messageText}
            usage={usage}
            showUsage={messageComplete}
            align="right"
            className={cn(
              "mt-1 min-h-8 opacity-0 pointer-events-none transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100",
              !showActions && "hidden",
            )}
          />
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={cn(
                "inline-flex items-center px-2 py-px rounded-full text-[11px] font-semibold uppercase tracking-[0.3px]",
                style.badge,
              )}
            >
              {style.label}
            </span>
            {ts && (
              <span className="text-[11px] text-(--text-muted)">{ts}</span>
            )}
          </div>

          {renderGroups.map((group, i) => {
            if (group.type === "text") {
              return (
                <StreamdownRenderer
                  key={`t-${i}-${group.isStreaming ? "s" : "d"}`}
                  text={group.text}
                  streaming={group.isStreaming}
                />
              );
            }
            if (group.type === "tools") {
              return <ToolGroup key={`tg-${i}`} cards={group.cards} />;
            }
            if (group.type === "thinking") {
              return <ThoughtBlock key={`th-${i}`} segment={group} />;
            }
            if (group.type === "process") {
              return <ProcessGroup key={`pg-${i}`} group={group} />;
            }
            return null;
          })}

          {planStep &&
            renderGroups.length === 0 &&
            planStep.status !== "done" &&
            planStep.status !== "failed" && (
              <div className="text-[12px] text-(--text-muted) inline-flex items-center gap-1.5">
                <span className="inline-block size-1 rounded-full bg-(--accent-blue) animate-pulse" />
                <span>等待工具调用或模型输出…</span>
              </div>
            )}

          {skillBadges?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {skillBadges.map((b, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
                    SKILL_BADGE_STYLES[b.status],
                  )}
                >
                  {b.status === "auto"
                    ? `${t("skillAuto")}: ${b.name}`
                    : `${b.name} - ${t("skill" + b.status.charAt(0).toUpperCase() + b.status.slice(1))}`}
                </span>
              ))}
            </div>
          )}

          {mergedFileChanges.length > 0 && (
            <FileChangesSummary changes={mergedFileChanges} />
          )}
          <MessageActions
            text={messageText}
            usage={usage}
            showUsage={showActions}
            className={cn("mt-2 min-h-8", !showActions && "hidden")}
          />
        </div>
      )}
    </div>
  );
}
