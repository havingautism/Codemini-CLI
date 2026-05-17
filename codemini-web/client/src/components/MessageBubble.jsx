import { useEffect, useState, useMemo } from "react";
import { ToolCard } from "./ToolCard";
import { StreamdownRenderer } from "./StreamdownRenderer";
import { TodoList } from "./TodoList";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "../../utils/time.js";
import { t } from "../../i18n/index.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Brain,
  Loader2,
  Moon,
  XCircle,
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
  if (!Number.isFinite(Number(ms))) return "";
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
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
    <div className="my-3 text-(--text-secondary)">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(COLLAPSE_ROW_CLASS, "font-medium text-(--text-muted) hover:text-(--text-primary)")}
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={cn(COLLAPSE_CHEVRON_CLASS, "transition-transform", open && "rotate-90")}
        />
        <span className={COLLAPSE_ICON_CLASS}>
          {segment.isStreaming ? (
            <Loader2 size={14} className="animate-spin text-(--accent-cyan)" />
          ) : (
            <Brain size={15} />
          )}
        </span>
        <span>{label}</span>
        {segment.isStreaming && elapsed && (
          <span className="text-(--text-muted)">{elapsed}</span>
        )}
      </button>
      {open && (
        <StreamdownRenderer
          text={segment.text}
          streaming={segment.isStreaming}
          className="mt-2 pl-[52px] text-[13px] italic leading-6 text-(--text-secondary)"
        />
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
  const itemCount = groups.reduce((sum, group) => sum + getProcessGroupItemCount(group), 0);
  const toolCount = groups.reduce((sum, group) => (
    group.type === "tools" ? sum + Math.max(1, group.cards?.length || 0) : sum
  ), 0);
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
        durationMs: pending.reduce((sum, group) => sum + getProcessGroupDurationMs(group), 0),
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

function getDreamNotice(text) {
  const value = String(text || "");
  if (value === "Dream triggered...") {
    return {
      status: "running",
      title: "Dream started",
      description: "Auto memory consolidation is running in the background.",
    };
  }
  if (value === "Dream complete") {
    return {
      status: "done",
      title: "Dream complete",
      description: "Memory consolidation finished.",
    };
  }
  if (value.startsWith("Dream done")) {
    return {
      status: "done",
      title: value,
      description: "Memory inbox and stale buckets were consolidated.",
    };
  }
  if (value.startsWith("Dream failed:")) {
    return {
      status: "error",
      title: "Dream failed",
      description:
        value.slice("Dream failed:".length).trim() || "Unknown error.",
    };
  }
  return null;
}

function DreamNotice({ notice }) {
  const Icon =
    notice.status === "running"
      ? Loader2
      : notice.status === "error"
        ? XCircle
        : CheckCircle2;

  return (
    <div className="py-2 px-6">
      <div className="max-w-[860px] mx-auto flex justify-center">
        <div
          className={cn(
            "inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs shadow-sm",
            notice.status === "error"
              ? "border-(--accent-red)/30 bg-(--accent-red-bg) text-(--accent-red)"
              : "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
          )}
        >
          <Icon
            size={14}
            className={cn(
              "shrink-0",
              notice.status === "running" &&
                "animate-spin text-(--accent-cyan)",
              notice.status === "done" && "text-(--accent-green)",
            )}
          />
          <div className="min-w-0">
            <div className="font-medium text-(--text-primary) truncate">
              {notice.title}
            </div>
            {notice.description && (
              <div className="mt-0.5 text-(--text-muted) truncate">
                {notice.description}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
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
  const duration = formatThoughtDuration(group.durationMs);
  const label = duration
    ? t("processedFor").replace("{{duration}}", duration)
    : t("processed");
  const toolCount = group.groups.reduce((sum, item) => (
    item.type === "tools" ? sum + Math.max(1, item.cards?.length || 0) : sum
  ), 0);
  const thoughtCount = group.groups.filter((item) => item.type === "thinking").length;

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
  const actionRank = { delete: 3, create: 2, edit: 1 };
  for (const change of fileChanges) {
    const path = String(change?.path || "");
    if (!path) continue;
    if (!byPath.has(path)) {
      byPath.set(path, { ...change, linesAdded: 0, linesRemoved: 0 });
      order.push(path);
    }
    const existing = byPath.get(path);
    existing.linesAdded += Number(change.linesAdded || 0);
    existing.linesRemoved += Number(change.linesRemoved || 0);
    const currentRank = actionRank[existing.action] || 0;
    const nextRank = actionRank[change.action] || 0;
    if (nextRank > currentRank) existing.action = change.action;
  }
  return order.map((path) => byPath.get(path));
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

function MessageActions({ text, align = "left", className }) {
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
  } = message;
  const style = ROLE_STYLES[role] || ROLE_STYLES.general;
  const ts = timestamp ? formatTimestamp(timestamp) : "";

  const renderGroups = useMemo(
    () => {
      const groups = buildRenderGroups(segments || []);
      const hasStreamingText = groups.some((group) => group.type === "text" && group.isStreaming);
      return collapseProcessGroups(groups, { disabled: hasStreamingText });
    },
    [segments],
  );
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
    const dreamNotice = getDreamNotice(legacyText);
    if (dreamNotice) return <DreamNotice notice={dreamNotice} />;

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
            align="right"
            className="mt-1 min-h-8 opacity-0 pointer-events-none transition-opacity group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100"
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
            <div className="mt-2 border border-(--border-default) rounded-lg bg-(--bg-secondary) p-3">
              <div className="text-xs font-semibold text-(--text-secondary) mb-1">
                {t("fileChanges")}
              </div>
              {mergedFileChanges.map((c, i) => {
                const actionColors = {
                  edit: "bg-(--accent-blue-bg) text-(--accent-blue)",
                  create: "bg-(--accent-green-bg) text-(--accent-green)",
                  delete: "bg-(--accent-red-bg) text-(--accent-red)",
                };
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs py-0.5 font-mono"
                  >
                    <span
                      className={cn(
                        "text-[10px] font-semibold px-[5px] py-px rounded",
                        actionColors[c.action] ||
                          "bg-(--muted) text-(--text-muted)",
                      )}
                    >
                      {c.action?.toUpperCase()}
                    </span>
                    <span className="truncate flex-1 text-(--text-primary)">
                      {c.path}
                    </span>
                    {c.linesAdded != null && (
                      <span className="text-(--accent-green) text-[11px]">
                        +{c.linesAdded}
                      </span>
                    )}
                    {c.linesRemoved != null && (
                      <span className="text-(--accent-red) text-[11px]">
                        -{c.linesRemoved}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <MessageActions text={messageText} className="mt-2 min-h-8" />
        </div>
      )}
    </div>
  );
}
