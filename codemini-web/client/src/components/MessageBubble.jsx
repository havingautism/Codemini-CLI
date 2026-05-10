import { useState, useMemo } from "react";
import { ToolCard } from "./ToolCard";
import { StreamdownRenderer } from "./StreamdownRenderer";
import { TodoList } from "./TodoList";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "../../utils/time.js";
import { t } from "../../i18n/index.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCircle2, Loader2, Moon, XCircle } from "lucide-react";

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

const TOOL_COLLAPSE_THRESHOLD = 3;

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
  const shouldCollapse = total > TOOL_COLLAPSE_THRESHOLD && !expanded;
  const hiddenCount = total - TOOL_COLLAPSE_THRESHOLD;
  const visibleCards = shouldCollapse
    ? cards.slice(total - TOOL_COLLAPSE_THRESHOLD)
    : cards;

  return (
    <div className="space-y-2 my-2">
      {shouldCollapse && hiddenCount > 0 && (
        <button
          type="button"
          className="block w-full py-1.5 px-3 text-[11px] text-(--accent-blue) cursor-pointer text-left bg-transparent border-0"
          onClick={() => setExpanded(true)}
        >
          +{hiddenCount} more tool calls
        </button>
      )}
      {visibleCards.map((card) => (
        <ToolCard key={card.id} card={card} />
      ))}
      {expanded && total > TOOL_COLLAPSE_THRESHOLD && (
        <button
          type="button"
          className="block w-full py-1.5 px-3 text-[11px] text-(--accent-blue) cursor-pointer text-left bg-transparent border-0"
          onClick={() => setExpanded(false)}
        >
          Collapse {hiddenCount} older tool calls
        </button>
      )}
    </div>
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
    () => buildRenderGroups(segments || []),
    [segments],
  );

  if (role === "divider") {
    return (
      <div className="py-3 px-6 text-center">
        <div className="max-w-[860px] mx-auto relative">
          <div className="border-t border-border" />
          <span className="text-xs text-(--text-muted) bg-(--bg-primary) px-2 absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
            {text || "以上内容已压缩"}
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
      <div className="py-2 px-6 text-xs text-(--text-muted) text-center">
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

  return (
    <div className={cn("py-2 my-[22px]", role === "you" && "flex justify-end")}>
      {role === "you" ? (
        <div className="w-fit max-w-full bg-(--bg-tertiary) rounded-2xl px-4 py-3">
          {youText && <UserText text={youText} skills={skills} />}
          {startupTodos && <TodoList todos={startupTodos} />}
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

          {fileChanges?.length > 0 && (
            <div className="mt-2 border border-(--border-default) rounded-lg bg-(--bg-secondary) p-3">
              <div className="text-xs font-semibold text-(--text-secondary) mb-1">
                {t("fileChanges")}
              </div>
              {fileChanges.map((c, i) => {
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
        </div>
      )}
    </div>
  );
}
