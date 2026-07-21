import { memo, useEffect, useState, useMemo } from "react";
import { ToolCard } from "./ToolCard";
import { PlanToolCard } from "./PlanToolCard.jsx";
import { isCreatePlanCard } from "@/lib/plan-ui-state.js";
import { StreamdownRenderer } from "./StreamdownRenderer";
import { EmbedBanner } from "./EmbedBanner.jsx";
import {
  ImagePreviewDialog,
  MarkdownLightboxImage,
} from "./MarkdownLightboxImage.jsx";
import { collectMessageEmbeds } from "@/lib/message-embeds.js";
import { isPostCompletionExtrasReady } from "@/lib/message-post-completion.js";
import { buildRenderGroups } from "@/lib/message-render-groups.js";
import { layoutAnswerProcessWithPlans } from "@/lib/answer-process.js";
import { TodoList } from "./TodoList";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { FileTypeIcon } from "@/components/FileTypeIcon.jsx";
import { LinearRing, LinearStatusDot, Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { cn } from "@/lib/utils";
import {
  isManualSkillCommand,
  parseUserSkillPrompt,
  userSkillChipBadges,
} from "@/lib/user-skill-prompt.js";
import { formatTimestamp } from "../../utils/time.js";
import { t } from "../../i18n/index.js";
import {
  hookEventI18nKey,
  isHookSegment,
  parseLegacyHookSegmentName,
} from "../../../shared/hook-ui.js";

import * as api from "@/hooks/use-api.js";
import { useRotatingLabel } from "@/hooks/use-rotating-label.js";
import { executionModeSkillContext } from "@/lib/skill-visibility.js";
import {
  useCurrentSessionId,
  useRuntimeMode,
} from "@/context/app-context.jsx";
import { getMessageModelIdentity } from "@/lib/message-model-identity.js";
import { ROLE_BADGE_CLASS, ROLE_PILLS } from "./PlanProgress.jsx";
import { PlanStepStatusGlyph } from "@/components/plan-step-icons.jsx";
import { PatchDiff } from "@pierre/diffs/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowCounterClockwise,
  Brain,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  Copy,
  FileText,
  Hammer,
  Moon,
  Play,
  Wrench,
  XCircle,
} from "@phosphor-icons/react";

const NEUTRAL_ROLE_BADGE =
  "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)";

const ROLE_STYLES = {
  you: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "You",
  },
  general: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "General",
  },
  coder: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Coder",
  },
  explorer: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Explorer",
  },
  architect: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Architect",
  },
  refactorer: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Refactorer",
  },
  writer: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Writer",
  },
  advisor: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Advisor",
  },
  planner: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Planner",
  },
  reviewer: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Reviewer",
  },
  tester: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Tester",
  },
  debugger: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Debugger",
  },
  summarizer: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Summarizer",
  },
  "plan-overview": {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Plan",
  },
  codewiki: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "CodeWiki",
  },
  system: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "System",
  },
  error: {
    badge:
      "border-[color-mix(in_srgb,var(--accent-red)_28%,transparent)] bg-[color-mix(in_srgb,var(--accent-red-bg)_55%,transparent)] text-(--accent-red)",
    label: "Error",
  },
  pending: {
    badge: NEUTRAL_ROLE_BADGE,
    label: "Pending",
  },
};

const SKILL_DOT_STYLES = {
  done: "bg-(--accent-green)",
  error: "bg-(--accent-red)",
  always: "bg-(--accent-purple)",
};

const TOOL_COLLAPSE_THRESHOLD = 1;
const PROCESS_META_CLASS = "msg-process-meta";
const COLLAPSE_ROW_CLASS =
  "msg-process-row flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[12px] hover:bg-(--bg-hover)";
const COLLAPSE_CHEVRON_CLASS =
  "size-[14px] shrink-0 text-(--text-process-detail)";
const COLLAPSE_ICON_CLASS =
  "flex size-[18px] shrink-0 items-center justify-center";

function compactBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function formatProcessDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "";
  const totalSeconds = Math.max(1, Math.round(value / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function resolveHintPhrases(listKey, fallbackKey) {
  const hints = t(listKey);
  if (Array.isArray(hints) && hints.length) return hints;
  const fallback = t(fallbackKey);
  return fallback ? [fallback] : [];
}

function resolveModeHintPhrases(kind, mode = "normal") {
  const context = executionModeSkillContext(mode);
  const coding = context === "coding";
  if (kind === "tooling") {
    return resolveHintPhrases(
      coding ? "toolingHintsCoding" : "toolingHintsDaily",
      "tooling",
    );
  }
  return resolveHintPhrases(
    coding ? "thinkingNowHintsCoding" : "thinkingNowHintsDaily",
    "thinkingNow",
  );
}

function RotatingStatusLabel({ phrases, active }) {
  const { label, visible } = useRotatingLabel(phrases, { active });
  return (
    <span className={cn("msg-process-rotating-label", !visible && "is-fading")}>
      {label}
    </span>
  );
}

function ThoughtBlock({ segment }) {
  const [open, setOpen] = useState(false);
  const runtimeMode = useRuntimeMode();
  const streaming = Boolean(segment.isStreaming);
  const thinkingPhrases = resolveModeHintPhrases(
    "thinking",
    runtimeMode,
  );

  return (
    <div className={cn("my-2", PROCESS_META_CLASS)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={COLLAPSE_ROW_CLASS}
        aria-expanded={open}
      >
        <CaretRight
          size={14}
          className={cn(
            COLLAPSE_CHEVRON_CLASS,
            "transition-transform",
            open && "rotate-90",
          )}
        />
        <span
          className={cn(COLLAPSE_ICON_CLASS, "text-(--text-process-detail)")}
        >
          {streaming ? <LinearRing size="md" /> : <Brain size={15} />}
        </span>
        {streaming ? (
          <RotatingStatusLabel phrases={thinkingPhrases} active />
        ) : (
          <span>{t("thought")}</span>
        )}
      </button>
      {open && (
        <div className="relative ml-4.5 mt-1.5 pl-8 before:absolute before:left-0 before:top-0 before:bottom-1 before:w-px before:bg-(--border-default)">
          <StreamdownRenderer
            text={segment.text}
            streaming={segment.isStreaming}
            className="msg-process-thought-body pl-5 text-[13px] italic leading-5"
            inlineEmbeds={false}
          />
        </div>
      )}
    </div>
  );
}

function renderInlineMarkdownPreview(text) {
  const value = String(text || "")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .trim();
  const parts = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(
        <strong
          key={`strong-${match.index}`}
          className="font-semibold text-current"
        >
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      parts.push(
        <code
          key={`code-${match.index}`}
          className="rounded bg-(--bg-tertiary) px-1 py-0.5 font-mono text-[0.92em] text-current"
        >
          {match[3]}
        </code>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }
  return parts.length ? parts : value;
}

function HandoffBlock({ segment }) {
  const [open, setOpen] = useState(false);
  const text = String(segment?.text || "").trim();
  if (!text) return null;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine =
    lines.find((line) => !/^(#{1,6}\s*)?[\w\s]+:\s*$/i.test(line)) ||
    lines[0] ||
    "";
  const preview =
    firstLine.length > 120
      ? `${firstLine.slice(0, 117).trimEnd()}...`
      : firstLine;

  return (
    <div className="my-2 text-(--text-primary)">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={COLLAPSE_ROW_CLASS}
        aria-expanded={open}
      >
        <CaretRight
          size={14}
          className={cn(
            COLLAPSE_CHEVRON_CLASS,
            "transition-transform",
            open && "rotate-90",
          )}
        />
        <span className={COLLAPSE_ICON_CLASS}>
          <span className="inline-block size-1.5 rounded-full bg-(--accent-blue)" />
        </span>
        <span className="font-medium">Handoff</span>
        <span className="min-w-0 flex-1 truncate text-(--text-muted)">
          {renderInlineMarkdownPreview(preview)}
        </span>
      </button>
      {open && (
        <div className="relative ml-4.5 mt-1.5 pl-8 before:absolute before:left-0 before:top-0 before:bottom-1 before:w-px before:bg-(--border-default)">
          <StreamdownRenderer
            text={text}
            streaming={false}
            className="pl-5 text-[13px] leading-5 text-(--text-secondary)"
          />
        </div>
      )}
    </div>
  );
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
    if (pending.every((group) => group.type === "tools")) {
      collapsed.push({
        type: "tools",
        cards: pending.flatMap((group) => group.cards || []),
      });
      pending = [];
      return;
    }
    if (shouldCollapseProcessGroups(pending)) {
      collapsed.push({
        type: "process",
        groups: pending,
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
  const showRing = notice.status === "running";
  const Icon =
    notice.status === "error"
      ? XCircle
      : notice.status === "done"
        ? CheckCircle
        : null;

  return (
    <div className="py-2 px-6">
      <div className="max-w-[860px] mx-auto flex justify-center">
        <div
          className={cn(
            "codemini-message-surface codemini-status-chip inline-flex max-w-full items-center gap-2 px-3 py-2 text-left text-xs",
            notice.status === "error"
              ? "border-(--accent-red)/30 bg-(--accent-red-bg) text-(--accent-red)"
              : "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)",
          )}
        >
          {showRing ? (
            <LinearRing size="md" />
          ) : (
            <Icon
              size={14}
              className={cn(
                "shrink-0",
                notice.status === "done" && "text-(--accent-green)",
              )}
            />
          )}
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
  const runtimeMode = useRuntimeMode();
  const planCards = cards.filter(isCreatePlanCard);
  const otherCards = cards.filter((card) => !isCreatePlanCard(card));
  const total = otherCards.length;
  const hasRunningTool = otherCards.some((card) => card.status === "running");
  const toolingPhrases = resolveModeHintPhrases(
    "tooling",
    runtimeMode,
  );
  const shouldUseSummaryHeader = total > TOOL_COLLAPSE_THRESHOLD;
  const runCount = otherCards.filter((card) => {
    const name = String(card.name || "").toLowerCase();
    return name === "run" || name.startsWith("run(");
  }).length;
  const summaryLabel =
    runCount === total
      ? t("toolGroupCommands").replace("{{count}}", total)
      : t("toolGroupTools").replace("{{count}}", total);

  return (
    <div className={cn("my-2", PROCESS_META_CLASS)}>
      {planCards.map((card) => (
        <PlanToolCard key={card.id || "create_plan"} card={card} />
      ))}
      {total > 0 && shouldUseSummaryHeader && (
        <button
          type="button"
          className={COLLAPSE_ROW_CLASS}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <CaretDown size={14} className={COLLAPSE_CHEVRON_CLASS} />
          ) : (
            <CaretRight size={14} className={COLLAPSE_CHEVRON_CLASS} />
          )}
          <span className={COLLAPSE_ICON_CLASS}>
            {hasRunningTool ? (
              <LinearStatusDot />
            ) : (
              <span className="inline-block size-1.5 rounded-full bg-(--accent-green)" />
            )}
          </span>
          <span>{summaryLabel}</span>
        </button>
      )}
      {total > 0 && (!shouldUseSummaryHeader || expanded) && (
        <div
          className={cn(
            "flex flex-col gap-2",
            shouldUseSummaryHeader &&
              "ml-4.5 mt-1 border-l border-(--border-default) pl-3",
          )}
        >
          {otherCards.map((card) => (
            <ToolCard key={card.id} card={card} />
          ))}
        </div>
      )}
      {hasRunningTool && (
        <div className="msg-process-meta__detail flex items-center gap-2 px-3 py-1.5 text-[11px] my-2">
          <Spinner />
          <RotatingStatusLabel phrases={toolingPhrases} active />
        </div>
      )}
    </div>
  );
}

function formatSkillNames(name = "") {
  return String(name || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith("/") ? item : `/${item}`))
    .join(", ");
}

function localizeHookEventName(eventName = "") {
  const raw = String(eventName || "").trim();
  if (!raw) return "";
  const key = hookEventI18nKey(raw);
  const translated = t(key);
  return translated === key ? raw : translated;
}

function resolveHookDisplayFields(badge = {}) {
  if (badge?.event || badge?.sourceLabel) {
    return {
      event: String(badge.event || "").trim(),
      sourceLabel: String(badge.sourceLabel || badge.name || "").trim(),
      toolName: String(badge.toolName || badge.matcher || "").trim(),
    };
  }
  const legacy = parseLegacyHookSegmentName(badge?.name);
  if (legacy) return legacy;
  return {
    event: "",
    sourceLabel: String(badge?.name || "").trim(),
    toolName: "",
  };
}

function formatHookActivityLabel(badge = {}) {
  const fields = resolveHookDisplayFields(badge);
  const eventLabel = localizeHookEventName(fields.event) || fields.event || t("hookActivity");
  const source = fields.sourceLabel || "hook";
  const tool = fields.toolName;
  const detail = tool
    ? t("hookActivityDetailTool")
        .replace("{{event}}", eventLabel)
        .replace("{{tool}}", tool)
        .replace("{{source}}", source)
    : t("hookActivityDetail")
        .replace("{{event}}", eventLabel)
        .replace("{{source}}", source);

  if (badge?.status === "running") {
    return t("hookActivityRunning").replace("{{detail}}", detail);
  }
  if (badge?.status === "error") {
    return t("hookActivityFailed").replace("{{detail}}", detail);
  }
  return t("hookActivityDone").replace("{{detail}}", detail);
}

function skillActivityLabel(badge) {
  if (isHookSegment(badge)) {
    return formatHookActivityLabel(badge);
  }
  const names = formatSkillNames(badge?.name);
  if (badge?.status === "running") {
    return t("skillUsing").replace("{{name}}", names);
  }
  if (badge?.status === "error") {
    return t("skillFailed").replace("{{name}}", names);
  }
  if (badge?.status === "always") {
    return t("skillAlwaysLoaded").replace("{{names}}", names);
  }
  return t("skillUsed").replace("{{name}}", names);
}

function activityKindLabel(badge) {
  return isHookSegment(badge) ? t("hookActivity") : t("skillActivity");
}

function SkillActivityList({ badges = [] }) {
  const visibleBadges = [];
  const seen = new Set();
  for (const badge of Array.isArray(badges) ? badges : []) {
    const key = `${String(badge?.status || "done")}::${String(badge?.name || "").trim()}`;
    if (!String(badge?.name || "").trim() || seen.has(key)) continue;
    seen.add(key);
    visibleBadges.push(badge);
  }
  if (!visibleBadges.length) return null;
  return (
    <div className={cn("my-2 flex flex-col gap-2", PROCESS_META_CLASS)}>
      {visibleBadges.map((badge, index) => (
        <div
          key={`${badge.name || "skill"}-${badge.status || "done"}-${index}`}
          className={cn(COLLAPSE_ROW_CLASS, "text-[13px]")}
        >
          <span
            className={cn(COLLAPSE_ICON_CLASS, "text-(--text-process-detail)")}
          >
            <Wrench size={14} />
          </span>
          <span>{activityKindLabel(badge)}</span>
          <span className="msg-process-meta__detail min-w-0 flex-1 truncate font-mono text-xs">
            {skillActivityLabel(badge)}
          </span>
          {badge.status === "running" ? (
            <LinearStatusDot className="shrink-0" />
          ) : (
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                SKILL_DOT_STYLES[badge.status] || SKILL_DOT_STYLES.done,
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function SkillActivityRow({ badge }) {
  if (!badge?.name) return null;
  return (
    <div className={cn("my-2", PROCESS_META_CLASS)}>
      <div className={cn(COLLAPSE_ROW_CLASS, "text-[13px]")}>
        <span
          className={cn(COLLAPSE_ICON_CLASS, "text-(--text-process-detail)")}
        >
          <Wrench size={14} />
        </span>
        <span>{activityKindLabel(badge)}</span>
        <span className="msg-process-meta__detail min-w-0 flex-1 truncate font-mono text-xs">
          {skillActivityLabel(badge)}
        </span>
        {badge.status === "running" ? (
          <LinearStatusDot className="shrink-0" />
        ) : (
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              SKILL_DOT_STYLES[badge.status] || SKILL_DOT_STYLES.done,
            )}
          />
        )}
      </div>
    </div>
  );
}

function ProcessGroup({ group }) {
  const [expanded, setExpanded] = useState(false);
  const toolCount = group.groups.reduce(
    (sum, item) =>
      item.type === "tools" ? sum + Math.max(1, item.cards?.length || 0) : sum,
    0,
  );
  const commandCount = group.groups.reduce((sum, item) => {
    if (item.type !== "tools") return sum;
    return (
      sum +
      (item.cards || []).filter((card) => {
        const name = String(card?.name || "").toLowerCase();
        return name === "run" || name.startsWith("run(");
      }).length
    );
  }, 0);
  const thoughtCount = group.groups.filter(
    (item) => item.type === "thinking",
  ).length;
  const label =
    thoughtCount === 0 && toolCount > 0
      ? commandCount === toolCount
        ? t("toolGroupCommands").replace("{{count}}", toolCount)
        : t("toolGroupTools").replace("{{count}}", toolCount)
      : t("processed");
  const details =
    thoughtCount === 0 && toolCount > 0
      ? ""
      : t("processedDetails")
          .replace("{{thoughts}}", thoughtCount)
          .replace("{{tools}}", toolCount);

  return (
    <div className={cn("my-2", PROCESS_META_CLASS)}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={COLLAPSE_ROW_CLASS}
        aria-expanded={expanded}
      >
        {expanded ? (
          <CaretDown size={14} className={COLLAPSE_CHEVRON_CLASS} />
        ) : (
          <CaretRight size={14} className={COLLAPSE_CHEVRON_CLASS} />
        )}
        <span className={COLLAPSE_ICON_CLASS}>
          <span className="inline-block size-1.5 rounded-full bg-(--accent-green)" />
        </span>
        <span>{label}</span>
        {details && (
          <span className="msg-process-meta__detail min-w-0 truncate">
            {details}
          </span>
        )}
      </button>
      {expanded && (
        <div className="relative ml-4.5 mt-2 flex flex-col pl-6 before:absolute before:left-0 before:top-0 before:bottom-1 before:w-px before:bg-(--border-default)">
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
    const path = String(change?.path || "");
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
    if (!byPath.has(path)) {
      byPath.set(path, {
        ...change,
        linesAdded: 0,
        linesRemoved: 0,
        changes: [],
        changeSetIds: [],
      });
      order.push(path);
    }
    const existing = byPath.get(path);
    existing.linesAdded += Number(change.linesAdded || 0);
    existing.linesRemoved += Number(change.linesRemoved || 0);
    const currentRank = actionRank[existing.action] || 0;
    const nextRank = actionRank[change.action] || 0;
    if (nextRank > currentRank) existing.action = change.action;
    if (!existing.diffPreview && change.diffPreview) {
      existing.diffPreview = change.diffPreview;
      existing.changedLine = change.changedLine;
    }
    if (change.diffPreview) existing.changes.push(change);
    if (
      change.changeSetId &&
      !existing.changeSetIds.includes(change.changeSetId)
    ) {
      existing.changeSetIds.push(change.changeSetId);
    }
  }
  return order
    .map((path) => {
      const change = byPath.get(path);
      const firstChange = change.changes[0];
      const lastChange = change.changes[change.changes.length - 1];
      if (firstChange?.action === "create" && lastChange?.action === "delete") {
        return null;
      }
      const createIndex = change.changes.findIndex(
        (item) => item.action === "create",
      );
      const createdThenEdited =
        createIndex >= 0 &&
        !change.changes
          .slice(createIndex + 1)
          .some((item) => item.action === "delete") &&
        change.changes
          .slice(createIndex + 1)
          .some((item) => item.action === "edit");
      const trackedChanges = change.changes.filter((item) => item.changeSetId);
      const revertedAt =
        trackedChanges.length > 0 &&
        trackedChanges.every((item) => item.revertedAt)
          ? trackedChanges[trackedChanges.length - 1].revertedAt
          : "";
      return {
        ...change,
        ...(createdThenEdited
          ? {
              action: "create",
              linesAdded: Math.max(
                0,
                Number(change.linesAdded || 0) -
                  Number(change.linesRemoved || 0),
              ),
              linesRemoved: 0,
              diffPreview: "",
              changes: [],
            }
          : {}),
        changeSetId:
          change.changeSetIds.length === 1 ? change.changeSetIds[0] : "",
        revertedAt,
      };
    })
    .filter(Boolean);
}

function getFileChangeSetIds(change) {
  return Array.isArray(change?.changeSetIds) && change.changeSetIds.length
    ? change.changeSetIds
    : change?.changeSetId
      ? [change.changeSetId]
      : [];
}

function getFileChangeUndoKey(change) {
  return getFileChangeSetIds(change).join("|");
}

function formatUndoError(error) {
  const message = error?.message || "";
  if (message.includes("Cannot undo this change cleanly"))
    return t("undoChangeConflict");
  return message || t("undoChangeFailed");
}

function basename(pathText) {
  const value = String(pathText || "").replace(/\\/g, "/");
  return value.split("/").filter(Boolean).pop() || value || "file";
}

function isUnifiedPatch(text) {
  const value = String(text || "");
  return (
    value.startsWith("diff --git ") ||
    value.includes("\ndiff --git ") ||
    value.includes("\n@@ ")
  );
}

function splitUnifiedPatches(patch) {
  const text = String(patch || "").trim();
  if (!text) return [];
  const matches = [...text.matchAll(/^diff --git /gm)];
  if (matches.length <= 1) return [text];
  return matches
    .map((match, index) => {
      const start = match.index || 0;
      const end =
        index + 1 < matches.length ? matches[index + 1].index : text.length;
      return text.slice(start, end).trim();
    })
    .filter(Boolean);
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
    const ob = new MutationObserver(() => setIsDark(getIsDark()));
    ob.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => ob.disconnect();
  }, []);
  return isDark ? "dark" : "light";
}

function buildFileChangePreviewLines(change) {
  return String(change?.diffPreview || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
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

function FileChangePreview({ change }) {
  const patch =
    Array.isArray(change?.changes) && change.changes.length
      ? change.changes
          .map((item) => item.diffPreview || "")
          .filter(Boolean)
          .join("\n")
      : String(change?.diffPreview || "");
  const themeType = usePatchThemeType();
  if (isUnifiedPatch(patch)) {
    const patches = splitUnifiedPatches(patch);
    return (
      <div className="max-h-[520px] overflow-auto bg-(--bg-primary) text-xs">
        {patches.map((singlePatch, index) => (
          <PatchDiff
            key={index}
            patch={singlePatch}
            options={{
              theme: { dark: "pierre-dark", light: "pierre-light" },
              themeType,
              diffStyle: "unified",
            }}
          />
        ))}
      </div>
    );
  }
  const lines = buildFileChangePreviewLines(change);
  if (!lines.length) return null;
  return (
    <div className="overflow-hidden bg-(--bg-primary)">
      <div className="max-h-[420px] overflow-auto font-mono text-xs leading-6">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={cn(
              "grid min-w-full grid-cols-[52px_max-content] border-l-3",
              line.type === "remove"
                ? "border-(--accent-red) bg-(--accent-red-bg)"
                : "border-(--accent-green) bg-(--accent-green-bg)",
            )}
          >
            <span className="select-none pr-3 text-right text-(--text-muted)">
              {line.number}
            </span>
            <span className="whitespace-pre pr-4 text-(--text-primary)">
              {line.text || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function summarizeFileChanges(changes = []) {
  let totalAdded = 0;
  let totalRemoved = 0;
  let edits = 0;
  let creates = 0;
  let deletes = 0;

  for (const change of changes) {
    totalAdded += Number(change?.linesAdded || 0);
    totalRemoved += Number(change?.linesRemoved || 0);
    if (change?.action === "create") creates += 1;
    else if (change?.action === "delete") deletes += 1;
    else edits += 1;
  }

  return {
    fileCount: changes.length,
    totalAdded,
    totalRemoved,
    edits,
    creates,
    deletes,
  };
}

function FileChangesOverviewBar({ changes }) {
  const stats = summarizeFileChanges(changes);
  if (!stats.fileCount) return null;

  const actionColors = {
    edit: "bg-(--accent-blue-bg) text-(--accent-blue)",
    create: "bg-(--accent-green-bg) text-(--accent-green)",
    delete: "bg-(--accent-red-bg) text-(--accent-red)",
  };

  const breakdown = [
    stats.edits > 0
      ? {
          key: "edit",
          label: t("fileChangesOverviewEdits").replace(
            "{{count}}",
            stats.edits,
          ),
        }
      : null,
    stats.creates > 0
      ? {
          key: "create",
          label: t("fileChangesOverviewCreates").replace(
            "{{count}}",
            stats.creates,
          ),
        }
      : null,
    stats.deletes > 0
      ? {
          key: "delete",
          label: t("fileChangesOverviewDeletes").replace(
            "{{count}}",
            stats.deletes,
          ),
        }
      : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--border-default) bg-(--bg-tertiary) px-3 py-2.5">
      <span className="text-xs font-medium text-(--text-primary)">
        {t("fileChangesOverview").replace("{{count}}", stats.fileCount)}
      </span>
      <span className="flex items-center gap-2 font-mono text-[11px]">
        {stats.totalAdded > 0 && (
          <span className="text-(--accent-green)">+{stats.totalAdded}</span>
        )}
        {stats.totalRemoved > 0 && (
          <span className="text-(--accent-red)">−{stats.totalRemoved}</span>
        )}
      </span>
      {/* {breakdown.length > 0 && (
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {breakdown.map((item) => (
            <span
              key={item.key}
              className={cn(
                "rounded px-[5px] py-px text-[10px] font-semibold",
                actionColors[item.key],
              )}
            >
              {item.label}
            </span>
          ))}
        </div>
      )} */}
    </div>
  );
}

function FileChangesSummary({ changes }) {
  const currentSessionId = useCurrentSessionId();
  const [openFiles, setOpenFiles] = useState(() => new Set());
  const [undoing, setUndoing] = useState(() => new Set());
  const [revertedUndoKeys, setRevertedUndoKeys] = useState(() => new Set());
  const [undoErrors, setUndoErrors] = useState(() => new Map());
  const [pendingUndo, setPendingUndo] = useState(null);
  const actionColors = {
    edit: "bg-(--accent-blue-bg) text-(--accent-blue)",
    create: "bg-(--accent-green-bg) text-(--accent-green)",
    delete: "bg-(--accent-red-bg) text-(--accent-red)",
  };
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
      const result =
        changeSetIds.length > 1
          ? await api.undoSessionChanges(currentSessionId, changeSetIds)
          : await api.undoSessionChange(
              currentSessionId,
              changeSetIds[0],
            );
      if (result?.error || result?.ok === false)
        throw new Error(result.message || t("undoChangeFailed"));
      setRevertedUndoKeys((prev) => new Set(prev).add(undoKey));
      setPendingUndo(null);
    } catch (error) {
      setUndoErrors((prev) =>
        new Map(prev).set(undoKey, formatUndoError(error)),
      );
    } finally {
      setUndoing((prev) => {
        const next = new Set(prev);
        next.delete(undoKey);
        return next;
      });
    }
  };

  if (!changes.length && !pendingUndo) return null;

  return (
    <>
      <div className="codemini-message-surface mt-6 overflow-hidden">
        <FileChangesOverviewBar changes={changes} />
        {changes.map((c, i) => {
          const key = `${c.path}-${i}`;
          const fileOpen = openFiles.has(key);
          const hasPreview = Boolean(
            c.diffPreview || (Array.isArray(c.changes) && c.changes.length),
          );
          const changeSetIds = getFileChangeSetIds(c);
          const undoKey = changeSetIds.join("|");
          const isReverted =
            undoKey && (revertedUndoKeys.has(undoKey) || Boolean(c.revertedAt));
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
                    <CaretDown
                      size={13}
                      className="shrink-0 text-(--text-muted)"
                    />
                  ) : (
                    <CaretRight
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
                    actionColors[c.action] ||
                      "bg-(--muted) text-(--text-muted)",
                  )}
                >
                  {c.action?.toUpperCase()}
                </span>
                <FileTypeIcon path={c.path} size="sm" />
                <span className="min-w-0 flex-1 truncate text-(--text-primary)">
                  {c.path}
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
                    title={
                      isReverted ? t("undoChangeReverted") : t("undoChange")
                    }
                    aria-label={
                      isReverted ? t("undoChangeReverted") : t("undoChange")
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (undoing.has(undoKey) || isReverted) return;
                      setPendingUndo({
                        path: c.path,
                        undoKey,
                        changeSetIds,
                        count: Math.max(1, changeSetIds.length),
                      });
                    }}
                    className={cn(
                      "ml-1 inline-flex h-6 shrink-0 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                      isReverted
                        ? "pointer-events-none gap-1 px-2 text-[11px] text-(--accent-green)"
                        : "w-6",
                      undoing.has(undoKey) && "pointer-events-none opacity-60",
                    )}
                  >
                    {undoing.has(undoKey) ? (
                      <LinearRing size="sm" />
                    ) : isReverted ? (
                      <>
                        <Check size={13} />
                        <span>{t("undoChangeReverted")}</span>
                      </>
                    ) : (
                      <ArrowCounterClockwise size={13} />
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
        description={
          (pendingUndo?.count || 0) > 1
            ? t("undoChangesDescription")
                .replace("{{path}}", pendingUndo?.path || "")
                .replace("{{count}}", pendingUndo?.count || 1)
            : t("undoChangeDescription").replace(
                "{{path}}",
                pendingUndo?.path || "",
              )
        }
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

function UserText({ text }) {
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
              run from the action palette or automatically when the inbox
              threshold is reached.
            </div>
          </TooltipContent>
        </Tooltip>
        {rest}
      </div>
    );
  }

  return <StreamdownRenderer text={text} streaming={false} />;
}

function UserSkillChips({ badges = [], skills = [], className }) {
  const items = userSkillChipBadges(badges);
  if (!items.length) return null;
  return (
    <div className={cn("flex max-w-full flex-wrap gap-1.5", className)}>
      {items.map(({ name, status }) => {
        const description =
          skills.find((item) => item.name === name)?.description || "";
        const always = status === "always";
        return (
          <Tooltip key={name}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "codemini-status-chip inline-flex max-w-full items-center gap-1.5 px-2 py-1 text-[12px]",
                  always
                    ? "border-(--border-default) bg-(--bg-secondary) text-(--text-secondary)"
                    : "border-(--accent-purple)/25 bg-(--accent-purple-bg) text-accent-purple",
                )}
              >
                <Hammer
                  size={14}
                  className={cn("shrink-0", always && "opacity-70")}
                />
                <span className="max-w-[220px] truncate">{name}</span>
              </span>
            </TooltipTrigger>
            {description ? (
              <TooltipContent
                side="top"
                sideOffset={8}
                className="max-w-75 px-4 py-3 leading-relaxed whitespace-normal"
              >
                {description}
              </TooltipContent>
            ) : null}
          </Tooltip>
        );
      })}
    </div>
  );
}

function UserAttachments({ attachments = [], className }) {
  const items = Array.isArray(attachments) ? attachments : [];
  if (!items.length) return null;

  return (
    <AttachmentGroup className={cn("max-w-full", className)}>
      {items.map((item) =>
        item?.kind === "image" && item.url ? (
          <UserImageAttachment key={item.id || item.url} item={item} />
        ) : (
          <Attachment key={item.id || item.name} size="sm">
            <AttachmentMedia>
              <FileText />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{item.name}</AttachmentTitle>
              <AttachmentDescription>
                {compactBytes(item.size)}
              </AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        ),
      )}
    </AttachmentGroup>
  );
}

function UserImageAttachment({ item }) {
  const [open, setOpen] = useState(false);
  const label = item.name || t("attachmentImage");

  return (
    <>
      <Attachment
        orientation="vertical"
        className="w-40 border-0 bg-transparent p-0 shadow-none focus-within:ring-0"
      >
        <AttachmentMedia
          variant="image"
          className="aspect-[4/3] w-full rounded-xl p-0"
        >
          <img
            src={item.url}
            alt={label}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        </AttachmentMedia>
        <AttachmentTrigger aria-label={label} onClick={() => setOpen(true)} />
      </Attachment>
      {open && (
        <ImagePreviewDialog
          src={item.url}
          alt={label}
          caption={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function parseSpecExecutionText(text = "") {
  const value = String(text || "").trim();
  const match = value.match(
    /^(Execute approved spec|执行已批准的 spec|Plan execute approved spec|计划执行已批准的 spec):\s*(.+?)(?:\r?\n|$)/,
  );
  if (!match) return null;
  const pathMatch = value.match(/(?:^|\r?\n)(?:Spec path|Spec 路径):\s*(.+)$/);
  return {
    title: match[2].trim() || "spec",
    filePath: pathMatch?.[1]?.trim() || "",
    mode:
      match[1] === "Plan execute approved spec" ||
      match[1] === "计划执行已批准的 spec"
        ? "plan"
        : "direct",
  };
}

function SpecExecutionCard({ details = {} }) {
  const title = String(details.title || "spec").trim();
  const filePath = String(details.filePath || "").trim();
  const mode = details.mode === "plan" ? "plan" : "direct";
  const modeLabel = mode === "plan" ? t("specPlanMode") : t("specDirectMode");
  return (
    <div className="codemini-linear-card w-full max-w-2xl rounded-lg p-3 text-left">
      <div className="flex items-start gap-3">
        {/* <span className="codemini-linear-icon mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
          <FileText size={16} weight="regular" />
        </span> */}
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                ROLE_BADGE_CLASS,
                "border-(--border-default) bg-(--bg-primary) text-(--text-secondary)",
              )}
            >
              SPEC
            </Badge>
            <Badge
              variant="outline"
              className="codemini-linear-pill h-5 rounded-md px-1.5 py-0 text-[10px] font-medium uppercase tracking-[0.04em] shadow-none"
            >
              <span className="inline-flex items-center gap-1">
                <Play size={9} weight="fill" />
                {modeLabel}
              </span>
            </Badge>
          </div>
          <div className="truncate text-[13px] font-medium leading-5 text-(--text-primary)">
            {title}
          </div>
          {filePath ? (
            <div
              className="truncate font-mono text-[10px] leading-5 text-(--text-muted)"
              title={filePath}
            >
              {filePath}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getMessageText(message) {
  const text = String(message?.text || "");
  if (text) return text;
  return (message?.segments || [])
    .filter((segment) => segment.type === "text" || segment.type === "handoff")
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

function ModelIdentityBadge({ sdkProvider, model }) {
  const identity = getMessageModelIdentity({ sdkProvider, model });
  if (!identity) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-8 max-w-full items-center gap-2.5 rounded-md px-1.5 text-[11px] text-(--text-muted)">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <img
              src={identity.logo}
              alt=""
              width={13}
              height={13}
              className="size-[13px] shrink-0 object-contain"
            />
            <span className="uppercase">{identity.sdkLabel}</span>
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            {identity.modelLogo ? (
              <img
                src={identity.modelLogo}
                alt=""
                width={13}
                height={13}
                className="size-[13px] shrink-0 object-contain"
              />
            ) : null}
            <span className="uppercase">{identity.model}</span>
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {identity.details}
      </TooltipContent>
    </Tooltip>
  );
}

function isMessageComplete(message, renderGroups = []) {
  if (message?.loading) return false;
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

/**
 * Post-completion extras (related links, file diffs) follow this message only.
 * Do not gate on session-wide live/streaming — that hides finished bubbles' links
 * for the whole next turn and remounts them when streaming ends.
 */
export function shouldShowPostCompletionExtras(message, messageComplete, hasContent) {
  if (!isPostCompletionExtrasReady({ messageComplete }) || !hasContent) return false;
  const planStep = message?.planStep;
  if (!planStep) return true;
  return String(planStep.role || "").toLowerCase() === "summarizer";
}

function shouldShowFileChanges(message, messageComplete, mergedFileChanges) {
  return shouldShowPostCompletionExtras(
    message,
    messageComplete,
    mergedFileChanges.length > 0,
  );
}

function MessageActions({
  text,
  usage = null,
  sdkProvider = "",
  model = "",
  showUsage = true,
  retryPrompt = "",
  canRetry = false,
  onRetry,
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

  const actionButtons = (
    <>
      <MessageActionButton
        label={t("copyMessage")}
        copiedLabel={t("copied")}
        copied={copied}
        disabled={!text}
        onClick={handleCopy}
      >
        <Copy size={17} />
      </MessageActionButton>
      {canRetry && (
        <MessageActionButton
          label={t("retry")}
          disabled={!retryPrompt}
          onClick={() => onRetry?.(retryPrompt)}
        >
          <ArrowCounterClockwise size={17} />
        </MessageActionButton>
      )}
    </>
  );

  return (
    <div className={cn("flex w-full items-center gap-1", className)}>
      {align !== "right" && (
        <div className="flex shrink-0 items-center gap-1">{actionButtons}</div>
      )}
      {showUsage && (
        <div
          className={cn(
            "flex min-w-0 items-center justify-end gap-1",
            align !== "right" && "ml-auto",
          )}
        >
          <ModelIdentityBadge sdkProvider={sdkProvider} model={model} />
          <UsageBadge usage={usage} />
        </div>
      )}
      {align === "right" && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actionButtons}
        </div>
      )}
    </div>
  );
}

function renderGroupItem(group, i) {
  if (group.type === "text") {
    return (
      <div key={`t-${i}-${group.isStreaming ? "s" : "d"}`} className="my-2">
        <StreamdownRenderer
          text={group.text}
          streaming={group.isStreaming}
          inlineEmbeds={false}
        />
      </div>
    );
  }
  if (group.type === "tools") {
    return <ToolGroup key={`tg-${i}`} cards={group.cards} />;
  }
  if (group.type === "thinking") {
    return <ThoughtBlock key={`th-${i}`} segment={group} />;
  }
  if (group.type === "handoff") {
    return <HandoffBlock key={`ho-${i}`} segment={group} />;
  }
  if (group.type === "skill") {
    return (
      <SkillActivityRow
        key={`sk-${i}-${group.name || "skill"}`}
        badge={group}
      />
    );
  }
  if (group.type === "process") {
    return <ProcessGroup key={`pg-${i}`} group={group} />;
  }
  return null;
}

function AnswerProcessFold({ groups, durationMs }) {
  const [expanded, setExpanded] = useState(false);
  const duration = formatProcessDuration(durationMs);
  const label = duration
    ? t("processedFor").replace("{{duration}}", duration)
    : t("processed");

  return (
    <div className="codemini-answer-fold my-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={COLLAPSE_ROW_CLASS}
        aria-expanded={expanded}
      >
        <CaretRight
          size={14}
          className={cn(
            COLLAPSE_CHEVRON_CLASS,
            "transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span
          className={cn(COLLAPSE_ICON_CLASS, "text-(--text-process-detail)")}
        >
          <span className="inline-block size-1.5 rounded-full bg-(--accent-blue)" />
        </span>
        <span className="font-medium">{label}</span>
      </button>
      {expanded && (
        <div className="relative ml-4.5 mt-2 flex flex-col pl-6 before:absolute before:left-0 before:top-0 before:bottom-1 before:w-px before:bg-(--border-default)">
          {groups.map((group, i) => renderGroupItem(group, i))}
        </div>
      )}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  skills = [],
  onRetry,
}) {
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
    sdkProvider,
    model,
    attachments = [],
  } = message;
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

  const answerLayout = useMemo(
    () =>
      layoutAnswerProcessWithPlans(
        renderGroups,
        message?.timestamp || message?.createdAt,
      ),
    [message?.createdAt, message?.timestamp, renderGroups],
  );
  const hasAnswerFold = answerLayout.hasFold;
  const preAnswerDuration = answerLayout.durationMs;
  const mergedFileChanges = useMemo(
    () => mergeFileChanges(fileChanges || []),
    [fileChanges],
  );
  const messageEmbeds = useMemo(
    () => collectMessageEmbeds(segments || []),
    [segments],
  );

  const rawMessageText = getMessageText(message) || legacyText || "";
  const rawResponseStatus = String(
    message.responseStatus || message.response_status || "",
  ).toLowerCase();
  const isStandaloneManualAbortDivider =
    role === "divider" &&
    (message.dividerType === "manual-abort" ||
      message.dividerType === "abort" ||
      rawResponseStatus === "aborted");
  const renderDivider = (label) => (
    <div data-message-id={message.id} className="py-3 px-6 text-center">
      <div className="max-w-[860px] mx-auto relative">
        <div className="border-t border-border" />
        <span className="text-xs text-(--text-muted) bg-(--bg-primary) px-2 absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
          {label}
        </span>
      </div>
    </div>
  );

  if (isStandaloneManualAbortDivider) {
    return null;
  }

  if (role === "divider") {
    return renderDivider(legacyText || "以上内容已压缩");
  }

  if (role === "system") {
    const dreamNotice = getDreamNotice(legacyText);
    if (dreamNotice) return null;

    if (
      String(legacyText || "").startsWith("Reflect skill") ||
      String(legacyText || "").startsWith("Reflect found no reusable skill candidate.")
    ) {
      return null;
    }

    const isWaitingReview =
      legacyText?.includes("等待计划审阅") ||
      legacyText?.includes("Waiting for plan review");
    if (isWaitingReview) {
      return null;
    }

    if (message.transientKey === "waiting-response") {
      return (
        <div data-message-id={message.id} className="py-2 my-[8px] px-6">
          <div className="max-w-[860px] mx-auto">
            <div
              className="msg-body streaming-cursor streaming-cursor--pending"
              role="status"
              aria-label={legacyText || t("waitingResponse")}
            />
          </div>
        </div>
      );
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

  if (role === "plan-overview") {
    const { planOverview } = message;
    const overview = planOverview || {};
    const steps = Array.isArray(overview.steps) ? overview.steps : [];

    return (
      <div data-message-id={message.id} className="py-2 my-2">
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className={cn(
              "codemini-status-chip inline-flex h-5 items-center px-1.5 py-0 text-[10px] font-medium uppercase tracking-[0.04em]",
              ROLE_STYLES["plan-overview"].badge,
            )}
          >
            {t("planTitle")}
          </span>
          {ts && <span className="text-[11px] text-(--text-muted)">{ts}</span>}
        </div>
        <div className="codemini-linear-card max-w-3xl flex flex-col gap-2.5 rounded-lg p-3">
          {overview.goal && (
            <p className="text-[13px] text-(--text-primary) leading-relaxed font-medium">
              {overview.goal}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-[13px]">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                    "codemini-linear-step",
                    step.status === "done" && "codemini-linear-step--done",
                    step.status === "failed" && "codemini-linear-step--failed",
                    step.status === "running" &&
                      "codemini-linear-step--running",
                  )}
                >
                  <PlanStepStatusGlyph step={step} index={i} />
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    ROLE_BADGE_CLASS,
                    ROLE_PILLS[step.role] ||
                      "border-(--border-default) bg-(--bg-primary) text-(--text-muted)",
                  )}
                >
                  {String(step.role || "step").toUpperCase()}
                </Badge>
                <span className="truncate text-(--text-secondary)">
                  {step.title}
                </span>
              </div>
            ))}
          </div>
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
  const userSkillPrompt = useMemo(() => {
    if (role !== "you" || !youText) return null;
    const parsed = parseUserSkillPrompt(youText);
    if (!isManualSkillCommand(parsed.skillName)) return null;
    return parsed;
  }, [role, youText]);
  const userSkillChips = useMemo(
    () => userSkillChipBadges(skillBadges, userSkillPrompt?.skillNames || []),
    [skillBadges, userSkillPrompt?.skillNames],
  );
  const userDisplayText = userSkillPrompt ? userSkillPrompt.prompt : youText;
  const messageText = role === "you" ? youText : rawMessageText;
  const messageComplete =
    role === "you" || isMessageComplete(message, renderGroups);
  const responseStatus = rawResponseStatus;
  const statusLooksLikeError =
    !message.manualAborted &&
    (responseStatus === "error" ||
      /^(Failed|Aborted):/i.test(messageText.trim()));
  const displayRole = statusLooksLikeError && role !== "you" ? "error" : role;
  const style = ROLE_STYLES[displayRole] || ROLE_STYLES.general;
  const retryPrompt = String(
    message.retryPrompt || message.retry_prompt || "",
  ).trim();
  const canRetry =
    displayRole === "error" &&
    responseStatus === "error" &&
    Boolean(retryPrompt) &&
    message.retryable !== false;
  const showActions = shouldShowMessageActions(message, messageComplete);
  const postCompletionReady = isPostCompletionExtrasReady({ messageComplete });
  const showFileChanges = shouldShowFileChanges(
    message,
    postCompletionReady,
    mergedFileChanges,
  );
  const showRelatedLinks = shouldShowPostCompletionExtras(
    message,
    postCompletionReady,
    messageEmbeds.length > 0,
  );
  const isPlanFlowMessage = !!planStep && role !== "you";
  const planFlowStatus = String(planStep?.status || "").toLowerCase();
  const specExecutionDetails =
    role === "you"
      ? message.specExecution || parseSpecExecutionText(youText)
      : null;

  return (
    <div
      data-message-id={message.id}
      data-plan-status={isPlanFlowMessage ? planFlowStatus : undefined}
      className={cn(
        "py-2 group/message",
        role === "you" && "flex justify-end mt-6",
        isPlanFlowMessage && "codemini-plan-flow",
      )}
    >
      {role === "you" ? (
        <div className="flex w-fit max-w-full flex-col items-end">
          {specExecutionDetails ? (
            <SpecExecutionCard details={specExecutionDetails} />
          ) : (
            <div className="codemini-message-surface codemini-user-bubble w-fit max-w-full rounded-2xl px-4 py-3">
              {(userSkillChips.length > 0 || attachments.length > 0) && (
                <div
                  className={cn(
                    "flex max-w-full flex-col gap-2",
                    userDisplayText && "mb-3",
                  )}
                >
                  {userSkillChips.length > 0 && (
                    <UserSkillChips badges={userSkillChips} skills={skills} />
                  )}
                  <UserAttachments attachments={attachments} />
                </div>
              )}
              {userDisplayText && <UserText text={userDisplayText} />}
              {startupTodos && <TodoList todos={startupTodos} />}
            </div>
          )}
          <MessageActions
            text={messageText}
            usage={usage}
            sdkProvider={sdkProvider}
            model={model}
            showUsage={messageComplete}
            retryPrompt={retryPrompt}
            canRetry={canRetry}
            onRetry={onRetry}
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
                "inline-flex h-5 items-center rounded-md border px-1.5 py-0 text-[10px] font-medium uppercase tracking-[0.04em]",
                style.badge,
              )}
            >
              {style.label}
            </span>
            {planStep?.title ? (
              <span className="min-w-0 truncate text-[12px] text-(--text-secondary)">
                {planStep.title}
              </span>
            ) : null}
            {planStep?.model ? (
              <span
                className="shrink-0 font-mono text-[10px] text-(--text-muted)"
                title={planStep.model}
              >
                {planStep.model}
              </span>
            ) : null}
            {ts && (
              <span className="text-[11px] text-(--text-muted)">{ts}</span>
            )}
          </div>

          <div className="flex flex-col">
            <SkillActivityList badges={skillBadges || []} />

            {messageComplete && hasAnswerFold ? (
              <>
                {answerLayout.items.map((item, i) => {
                  if (item.type === "fold") {
                    return (
                      <AnswerProcessFold
                        key={`fold-${i}`}
                        groups={item.groups}
                        durationMs={i === 0 ? preAnswerDuration : 0}
                      />
                    );
                  }
                  return renderGroupItem(item.group, i);
                })}
              </>
            ) : (
              renderGroups.map((group, i) => renderGroupItem(group, i))
            )}

            {planStep &&
              renderGroups.length === 0 &&
              planStep.status !== "done" &&
              planStep.status !== "failed" && (
                <div
                  className="msg-body streaming-cursor streaming-cursor--pending"
                  role="status"
                  aria-label="等待工具调用或模型输出"
                />
              )}

            {showRelatedLinks && <EmbedBanner items={messageEmbeds} />}

            {showFileChanges && (
              <FileChangesSummary changes={mergedFileChanges} />
            )}
            {message.manualAborted && (
              <p className="mt-2 text-xs text-(--text-muted)">
                {t("manualStopped")}
              </p>
            )}
            {!message.manualAborted && responseStatus === "aborted" && (
              <p className="mt-2 text-xs text-(--text-muted)">
                {t("requestAborted")}
              </p>
            )}
            <MessageActions
              text={messageText}
              usage={usage}
              sdkProvider={sdkProvider || planStep?.sdkProvider}
              model={model || planStep?.model}
              showUsage={showActions}
              retryPrompt={retryPrompt}
              canRetry={canRetry}
              onRetry={onRetry}
              className={cn("mt-2 min-h-8", !showActions && "hidden")}
            />
          </div>
        </div>
      )}
    </div>
  );
});
