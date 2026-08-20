import { useMemo, useState } from "react";
import { Avatar, Style } from "@dicebear/core";
import bottts from "@dicebear/styles/bottts.json" with { type: "json" };
import {
  CaretDown,
  CaretRight,
  UserCircle,
} from "@phosphor-icons/react";
import { SessionOrb } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StreamdownRenderer } from "@/components/StreamdownRenderer.jsx";
import { ToolCard } from "@/components/ToolCard.jsx";
import { UsageBadge } from "@/components/UsageBadge.jsx";
import { extractLatestTodoFromPlanSteps } from "@/lib/answer-process.js";
import { getTodoToolItems } from "@/lib/tool-card-display.js";
import { cn } from "@/lib/utils";
import { planPhaseTitle, shouldExpandPlanStep } from "@/lib/plan-ui-state.js";
import { isShellToolName } from "@/lib/tool-names.js";
import { t } from "../../i18n/index.js";

const ROW_CLASS =
  "msg-process-row flex min-h-11 cursor-pointer select-none items-center gap-2.5 px-3 py-2.5 text-[13px] transition-colors duration-150 hover:bg-[var(--bg-hover)] focus-visible:relative focus-visible:z-10";
const CHEVRON_CLASS = "size-[14px] shrink-0 text-(--text-process-detail)";
const ICON_CLASS =
  "flex size-6 shrink-0 items-center justify-center rounded-full bg-(--bg-tertiary) text-(--text-secondary)";
const FOLD_ROW_CLASS =
  "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text-secondary)";
const SUBAGENT_AVATAR_STYLE = new Style(bottts);

const STATUS_DOT = {
  completed: "bg-[var(--accent-green)]",
  failed: "bg-[var(--accent-red)]",
  aborted: "bg-[var(--accent-orange)]",
  waiting: "bg-[var(--accent-orange)]",
  blocked: "bg-[var(--accent-orange)]",
};

const STATUS_LABEL_KEY = {
  planning: "subagentStatusReady",
  executing: "subagentStatusRunning",
  waiting: "subagentStatusWaiting",
  completed: "subagentStatusDone",
  blocked: "subagentStatusBlocked",
  failed: "subagentStatusFailed",
  aborted: "subagentStatusAborted",
};

function statusLabel(phase) {
  return t(STATUS_LABEL_KEY[phase] || "subagentStatusReady");
}

function isRunSubagentCard(card) {
  return String(card?.name || "").toLowerCase() === "run_subagent";
}

function isProcessSegment(segment) {
  return segment?.type === "thinking" || segment?.type === "tools";
}

function SubagentAvatar({ seed }) {
  const src = useMemo(
    () =>
      new Avatar(SUBAGENT_AVATAR_STYLE, {
        seed,
        size: 48,
        borderRadius: 50,
        backgroundColor: ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf"],
      }).toDataUri(),
    [seed],
  );

  return <img src={src} alt="" className="size-6 rounded-full" />;
}

function splitStepSegments(segments = []) {
  const process = [];
  const answers = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (isProcessSegment(segment)) process.push(segment);
    else if (
      (segment?.type === "text" || segment?.type === "handoff") &&
      String(segment.text || "").trim()
    ) {
      answers.push(segment);
    }
  }
  return { process, answers };
}

function StepProcessFold({ segments }) {
  const [expanded, setExpanded] = useState(false);
  const toolCount = segments.reduce((sum, item) => {
    if (item.type !== "tools") return sum;
    return sum + Math.max(1, item.cards?.length || 0);
  }, 0);
  const commandCount = segments.reduce((sum, item) => {
    if (item.type !== "tools") return sum;
    return (
      sum +
      (item.cards || []).filter((card) => {
        const name = String(card?.name || "").toLowerCase();
        return isShellToolName(name);
      }).length
    );
  }, 0);
  const thoughtCount = segments.filter(
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

  if (!segments.length) return null;

  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={FOLD_ROW_CLASS}
        aria-expanded={expanded}
      >
        {expanded ? (
          <CaretDown size={13} className="shrink-0" />
        ) : (
          <CaretRight size={13} className="shrink-0" />
        )}
        <span className="inline-block size-1.5 rounded-full bg-(--accent-green)" />
        <span>{label}</span>
        {details ? (
          <span className="min-w-0 truncate opacity-70">{details}</span>
        ) : null}
      </button>
      {expanded ? (
        <div className="relative ml-3.5 mt-2 flex flex-col gap-1.5 border-l border-(--border-default) pl-3">
          {segments.map((item, index) => {
            if (item.type === "thinking") {
              return (
                <div
                  key={`th-${index}`}
                  className="text-[12px] italic leading-5 text-(--text-secondary)"
                >
                  <StreamdownRenderer
                    text={item.text}
                    streaming={item.isStreaming}
                    inlineEmbeds={false}
                  />
                </div>
              );
            }
            if (item.type === "tools") {
              return (
                <div key={`tools-${index}`} className="flex flex-col gap-1.5">
                  {(item.cards || []).map((card) => (
                    <ToolCard
                      key={card.id || `${card.name}-${index}`}
                      card={card}
                      embedded
                    />
                  ))}
                </div>
              );
            }
            return null;
          })}
        </div>
      ) : null}
    </div>
  );
}

function StepAnswer({ segment }) {
  const isHandoff = segment?.type === "handoff";
  const [open, setOpen] = useState(!isHandoff);
  const text = String(segment?.text || "").trim();
  if (!text) return null;

  if (!isHandoff) {
    return (
      <div className="text-[13px] leading-relaxed text-(--text-secondary)">
        <StreamdownRenderer
          text={text}
          streaming={segment.isStreaming}
          inlineEmbeds={false}
        />
      </div>
    );
  }

  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "";
  const preview =
    firstLine.length > 120
      ? `${firstLine.slice(0, 117).trimEnd()}...`
      : firstLine;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={FOLD_ROW_CLASS}
        aria-expanded={open}
      >
        {open ? (
          <CaretDown size={13} className="shrink-0" />
        ) : (
          <CaretRight size={13} className="shrink-0" />
        )}
        <span className="inline-block size-1.5 rounded-full bg-(--accent-blue)" />
        <span className="font-medium text-(--text-secondary)">
          {t("subagentHandoff")}
        </span>

        <span className="flex-1" />
      </button>
      {open ? (
        <ScrollArea
          type="auto"
          className="mt-2 h-64 rounded-md bg-(--bg-primary)"
          viewportClassName="px-3 py-2 text-[12px] leading-relaxed text-(--text-secondary)"
        >
          <StreamdownRenderer
            text={text}
            streaming={false}
            inlineEmbeds={false}
          />
        </ScrollArea>
      ) : null}
    </div>
  );
}

function StepBody({ step }) {
  const segments = Array.isArray(step?.segments) ? step.segments : [];
  const { process, answers } = splitStepSegments(segments);
  const hasContent =
    process.length > 0 || answers.length > 0 || Boolean(step?.summary);
  const running = String(step?.status || "").toLowerCase() === "running";
  const waiting = String(step?.status || "").toLowerCase() === "waiting";

  if (!hasContent) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 py-1 text-[12px] text-(--text-muted)">
          {running ? (
            <>
              <SessionOrb state="thinking" />
              <span>{t("thinking")}</span>
            </>
          ) : waiting ? (
            <>
              <span className="size-1.5 rounded-full bg-(--accent-orange)" />
              <span>{t("subagentStatusWaiting")}</span>
            </>
          ) : (
            "—"
          )}
        </div>
        {step?.usage ? (
          <div className="flex justify-end">
            <UsageBadge usage={step.usage} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {process.length > 0 && <StepProcessFold segments={process} />}
      {answers.map((segment, index) => (
        <StepAnswer key={`ans-${index}`} segment={segment} />
      ))}
      {step?.summary && answers.length === 0 && (
        <div className="whitespace-pre-wrap text-[12px] text-(--text-secondary)">
          {step.summary}
        </div>
      )}
      {step?.usage ? (
        <div className="flex justify-end">
          <UsageBadge usage={step.usage} />
        </div>
      ) : null}
    </div>
  );
}

function SubagentTaskDetails({ task }) {
  const text = String(task || "").trim();
  if (!text) return null;

  return (
    <div className="mb-2 flex items-start gap-2.5 rounded-lg border border-(--border-default) bg-(--bg-primary) px-2.5 py-2 text-[11px] leading-relaxed">
      <span className="shrink-0 pt-px font-medium text-(--text-muted)">
        {t("planStepTask")}
      </span>
      <ScrollArea
        type="auto"
        className="max-h-48 min-w-0 flex-1"
        viewportClassName="max-h-48 pr-2 text-(--text-secondary)"
      >
        <StreamdownRenderer
          text={text}
          streaming={false}
          inlineEmbeds={false}
        />
      </ScrollArea>
    </div>
  );
}

function SubagentDependencyDetails({ step, dependsOn = [] }) {
  const dependencies =
    Array.isArray(step?.dependsOn) && step.dependsOn.length
      ? step.dependsOn
      : Array.isArray(dependsOn)
        ? dependsOn
        : [];
  if (!dependencies.length) return null;
  const status = String(step?.status || "").toLowerCase();
  const label =
    status === "waiting"
      ? t("subagentDependencyWaiting")
      : status === "blocked"
        ? t("subagentDependencyBlocked")
        : t("subagentDependencyReceived");

  return (
    <div className="mb-2 flex min-h-8 items-center gap-2 rounded-lg border border-(--border-default) bg-(--bg-primary) px-2.5 py-1.5 text-[12px]">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "blocked" || status === "waiting"
            ? "bg-(--accent-orange)"
            : "bg-(--accent-green)",
        )}
      />
      <span className="shrink-0 text-(--text-muted)">{label}</span>
      <span className="min-w-0 truncate font-mono text-(--text-secondary)">
        {dependencies.join(", ")}
      </span>
    </div>
  );
}

function SubagentStepRow({ step, index }) {
  const status = String(step?.status || "pending").toLowerCase();
  const [expanded, setExpanded] = useState(shouldExpandPlanStep(step));
  const open = status === "running" ? true : expanded;
  const persona = String(step?.role || "").trim();

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        className={ROW_CLASS}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={open}
      >
        {open ? (
          <CaretDown size={14} className={CHEVRON_CLASS} />
        ) : (
          <CaretRight size={14} className={CHEVRON_CLASS} />
        )}
        <span className="min-w-0 flex-1 truncate leading-[18px]">
          {persona ? (
            <span className="shrink-0 text-(--text-secondary)">{persona}</span>
          ) : null}
          {persona ? (
            <span className="msg-process-meta__detail mx-1">·</span>
          ) : null}
          <span className="msg-process-meta__detail">
            {step.title || `Task ${index + 1}`}
          </span>
        </span>
        {status === "running" ? (
          <SessionOrb state="tool" />
        ) : (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              status === "done"
                ? STATUS_DOT.completed
                : status === "failed"
                  ? STATUS_DOT.failed
                  : status === "waiting" || status === "blocked"
                    ? STATUS_DOT[status]
                    : "bg-[var(--muted)]",
            )}
          />
        )}
      </button>
      {open ? (
        <div className="pb-2 pl-6 pr-3">
          <StepBody step={step} />
        </div>
      ) : null}
    </div>
  );
}

export function PlanToolCard({ card }) {
  const planRun = card?.planRun || null;
  const phase =
    planRun?.phase || (card?.status === "done" ? "completed" : "planning");
  const running = String(card?.status || "").toLowerCase() === "running";
  const isSubagent = isRunSubagentCard(card);
  const rawSteps = Array.isArray(planRun?.steps) ? planRun.steps : [];
  const assignedTasks = Array.isArray(card?.arguments?.tasks)
    ? card.arguments.tasks
    : [];
  const assignedTasksCard = assignedTasks.length
    ? {
        id: `${card?.id || "subagent"}-assigned-tasks`,
        name: "tasks",
        status: "done",
        arguments: { tasks: assignedTasks },
      }
    : null;
  const { steps, todoCard } = isSubagent
    ? extractLatestTodoFromPlanSteps(rawSteps, assignedTasksCard)
    : { steps: rawSteps, todoCard: null };
  const todoItems = todoCard
    ? getTodoToolItems(todoCard.arguments, todoCard.result)
    : [];
  const todoCompleted = todoItems.filter(
    (item) => item.status === "completed",
  ).length;
  const primary = steps[0] || null;
  const persona = String(
    primary?.role || card?.arguments?.name || card?.arguments?.role || "",
  ).trim();
  const goal = String(
    isSubagent
      ? card?.arguments?.prompt ||
          planRun?.goal ||
          card?.arguments?.goal ||
          card?.summary ||
          ""
      : planRun?.goal ||
          card?.arguments?.goal ||
          card?.arguments?.prompt ||
          card?.summary ||
          "",
  ).trim();
  const taskSummary = String(
    isSubagent
      ? card?.arguments?.summary || card?.arguments?.goal || goal
      : goal,
  ).trim();
  const title = isSubagent
    ? persona || t("subagentWorker")
    : card?.displayName || planPhaseTitle(phase);
  const singleTask = steps.length <= 1;
  const [open, setOpen] = useState(
    !isSubagent && (running || phase === "executing"),
  );
  const expanded = open;

  return (
    <div
      className={cn(
        "msg-process-meta relative w-full overflow-hidden",
        "codemini-message-surface rounded-xl",
        card.status === "error" &&
          "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-[color:color-mix(in_srgb,var(--accent-red)_32%,transparent)] after:content-['']",
      )}
    >
      <button
        type="button"
        className={cn(ROW_CLASS, "w-full rounded-none text-left")}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <CaretDown size={14} className={CHEVRON_CLASS} />
        ) : (
          <CaretRight size={14} className={CHEVRON_CLASS} />
        )}
        {isSubagent ? (
          persona ? (
            <SubagentAvatar seed={persona} />
          ) : (
            <span className="size-6 shrink-0" aria-hidden="true" />
          )
        ) : (
          <span className={ICON_CLASS}>
            <UserCircle size={15} aria-hidden="true" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 items-start overflow-hidden leading-[18px]">
          <span className="shrink-0 font-medium text-(--text-primary)">
            {title}
          </span>
          {taskSummary && !expanded ? (
            <span
              className="msg-process-meta__detail ml-1.5 min-w-0 flex-1 truncate whitespace-nowrap text-xs font-normal leading-[18px]"
              title={taskSummary}
            >
              <span aria-hidden="true">· </span>
              {taskSummary}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-(--text-secondary)">
          {running && phase !== "waiting" ? (
            <SessionOrb state="tool" />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                STATUS_DOT[phase] || "bg-[var(--text-muted)]",
              )}
            />
          )}
          <span>{isSubagent ? statusLabel(phase) : planPhaseTitle(phase)}</span>
          {isSubagent && todoItems.length ? (
            <span className="tabular-nums text-(--text-muted)">
              {todoCompleted}/{todoItems.length}
            </span>
          ) : null}
        </span>
      </button>

      {expanded ? (
        <div className="codemini-fold-body px-3 pb-3 pt-2">
          {isSubagent ? <SubagentTaskDetails task={goal} /> : null}
          {todoCard ? (
            <div className="mb-2">
              <ToolCard card={todoCard} embedded />
            </div>
          ) : null}
          {isSubagent ? (
            <SubagentDependencyDetails
              step={primary}
              dependsOn={
                card?.arguments?.depends_on || card?.arguments?.dependsOn || []
              }
            />
          ) : null}
          {steps.length > 0 ? (
            singleTask ? (
              <StepBody step={primary} />
            ) : (
              <div className="flex flex-col">
                {steps.map((step, index) => (
                  <SubagentStepRow
                    key={`${step.toolCallId || step.index || index}-${step.role || "step"}`}
                    step={step}
                    index={index}
                  />
                ))}
              </div>
            )
          ) : running ? (
            <div className="flex items-center gap-2 py-1 text-[12px] text-(--text-muted)">
              <SessionOrb state="thinking" />
              <span>{t("thinking")}</span>
            </div>
          ) : (
            <div className="py-1 text-xs text-(--text-muted)">
              {t("subagentNoDetails")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function PlanToolCardGroup({ cards = [] }) {
  const items = Array.isArray(cards) ? cards.filter(Boolean) : [];
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((card) => (
        <PlanToolCard key={card.id || card.name} card={card} />
      ))}
    </div>
  );
}
