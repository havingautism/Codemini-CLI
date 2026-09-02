import { useMemo, useState } from "react";
import { Avatar, Style } from "@dicebear/core";
import bottts from "@dicebear/styles/bottts.json" with { type: "json" };
import {
  UserCircle,
} from "@/lib/icons";
import { SessionOrb, Spinner } from "@/components/ui/spinner";
import { StreamdownRenderer } from "@/components/StreamdownRenderer.jsx";
import {
  DisclosureRowButton,
} from "@/components/DisclosureLeading.jsx";
import { ToolCard } from "@/components/ToolCard.jsx";
import { UsageBadge } from "@/components/UsageBadge.jsx";
import { ModelIdentityBadge } from "@/components/ModelIdentityBadge.jsx";
import { extractLatestTodoFromPlanSteps } from "@/lib/answer-process.js";
import { getTodoToolItems } from "@/lib/tool-card-display.js";
import { formatToolGroupSummaryLabel } from "@/lib/tool-group-summary.js";
import { cn } from "@/lib/utils";
import {
  planPhaseTitle,
  shouldExpandPlanStep,
  stripDelegationTaskPrefix,
} from "@/lib/plan-ui-state.js";
import { describeTowerRunSubagent } from "../../../../src/core/tool-display.js";
import { t } from "../../i18n/index.js";

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

const FORK_STATUS_LABEL_KEY = {
  planning: "forkStatusReady",
  executing: "forkStatusRunning",
  waiting: "forkStatusWaiting",
  completed: "forkStatusDone",
  blocked: "forkStatusBlocked",
  failed: "forkStatusFailed",
  aborted: "forkStatusAborted",
};

function statusLabel(phase, kind = "subagent") {
  const keys = kind === "fork" ? FORK_STATUS_LABEL_KEY : STATUS_LABEL_KEY;
  return t(keys[phase] || (kind === "fork" ? "forkStatusReady" : "subagentStatusReady"));
}

function isRunSubagentCard(card) {
  return String(card?.name || "").toLowerCase() === "run_subagent";
}

function isForkCard(card) {
  return String(card?.name || "").toLowerCase() === "fork_task";
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

  return <img src={src} alt="" className="size-5 shrink-0 rounded-full" />;
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
  const thoughtCount = segments.filter(
    (item) => item.type === "thinking",
  ).length;
  const toolCards = segments.flatMap((item) =>
    item.type === "tools" ? item.cards || [] : [],
  );
  const toolCount = toolCards.length;
  const running = toolCards.some((card) => card.status === "running");
  const label =
    thoughtCount === 0 && toolCount > 0
      ? formatToolGroupSummaryLabel(toolCards, t)
      : t("processed");
  const details =
    thoughtCount === 0 && toolCount > 0
      ? ""
      : t("processedDetails")
          .replace("{{thoughts}}", thoughtCount)
          .replace("{{tools}}", toolCount);

  if (!segments.length) return null;

  return (
    <div className="codemini-disclosure my-0.5">
      <DisclosureRowButton
        open={expanded}
        onClick={() => setExpanded((value) => !value)}
        icon={
          running ? (
            <Spinner className="loading-dots--tool" aria-hidden="true" />
          ) : (
            <span className="inline-block size-1.5 rounded-full bg-(--accent-green)" />
          )
        }
      >
        <span>{label}</span>
        {details ? (
          <>
            <span className="codemini-disclosure-sep" aria-hidden="true" />
            <span className="min-w-0 truncate opacity-70">{details}</span>
          </>
        ) : null}
      </DisclosureRowButton>
      {expanded ? (
        <div className="codemini-disclosure-tree">
          {segments.map((item, index) => {
            if (item.type === "thinking") {
              return (
                <div
                  key={`th-${index}`}
                  className="codemini-disclosure-body text-[12px] italic leading-5 text-(--text-secondary)"
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
                <div key={`tools-${index}`} className="flex flex-col gap-1">
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

  return (
    <div className="codemini-disclosure">
      <div className="px-3 py-1.5 text-[13px] leading-6 text-(--text-process)">
        {t("subagentHandoff")}
      </div>
      <div className="codemini-disclosure-payload codemini-disclosure-scroll mt-1 max-h-64 px-3 py-2 text-[12px] leading-relaxed text-(--text-secondary)">
        <StreamdownRenderer
          text={text}
          streaming={false}
          inlineEmbeds={false}
        />
      </div>
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
          <div className="flex items-center justify-end gap-1">
            <ModelIdentityBadge
              sdkProvider={step.sdkProvider}
              model={step.model}
              showOnlyWhenDifferent
            />
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
        <div className="flex items-center justify-end gap-1">
          <ModelIdentityBadge
            sdkProvider={step.sdkProvider}
            model={step.model}
            showOnlyWhenDifferent
          />
          <UsageBadge usage={step.usage} />
        </div>
      ) : null}
    </div>
  );
}

function TowerWorkerMeta({ args }) {
  const tower = describeTowerRunSubagent(args);
  if (!tower) return null;
  const paths = Array.isArray(args?.paths)
    ? args.paths.map((item) => String(item || "").trim()).filter(Boolean).join(", ")
    : "";
  const hint =
    tower.kind === "review"
      ? t("towerReviewHint")
      : tower.kind === "survey"
        ? t("towerSurveyHint")
        : t("towerWorkerHint");
  return (
    <div className="mb-1 px-1 text-[11px] leading-snug text-(--text-muted)">
      {hint}
      {paths ? ` · ${paths}` : ""}
    </div>
  );
}

function SubagentTaskDetails({ task }) {
  const text = String(task || "").trim();
  if (!text) return null;

  return (
    <div className="codemini-disclosure">
      <div className="px-3 py-1.5 text-[13px] leading-6 text-(--text-process)">
        {t("planStepTask")}
      </div>
      <div className="codemini-disclosure-payload codemini-disclosure-scroll mt-1 max-h-48 px-3 py-2 text-[12px] leading-relaxed text-(--text-secondary)">
        <StreamdownRenderer
          text={text}
          streaming={false}
          inlineEmbeds={false}
        />
      </div>
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
    <div className="mb-1 flex min-h-8 items-center gap-2 px-1 text-[12px]">
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
  const title = stripDelegationTaskPrefix(step?.title) || `Task ${index + 1}`;

  return (
    <div className="codemini-disclosure overflow-hidden">
      <DisclosureRowButton
        open={open}
        onClick={() => setExpanded((value) => !value)}
        icon={
          status === "running" ? (
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
          )
        }
      >
        <span className="min-w-0 flex-1 truncate leading-6">
          {persona ? (
            <span className="shrink-0 text-(--text-secondary)">{persona}</span>
          ) : null}
          {persona ? (
            <span className="msg-process-meta__detail mx-1">·</span>
          ) : null}
          <span className="msg-process-meta__detail">
            {title}
          </span>
        </span>
      </DisclosureRowButton>
      {open ? (
        <div className="codemini-disclosure-tree">
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
  const isFork = isForkCard(card);
  const isDelegationCard = isSubagent || isFork;
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
  const { steps, todoCard } = isDelegationCard
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
  const goal = stripDelegationTaskPrefix(
    isDelegationCard
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
  );
  const taskSummary = stripDelegationTaskPrefix(
    isDelegationCard
      ? card?.arguments?.summary || card?.arguments?.goal || goal
      : goal,
  );
  const title = isSubagent
    ? describeTowerRunSubagent(card?.arguments)?.label || persona || t("subagentWorker")
    : isFork
      ? t("forkBranch")
      : card?.displayName || planPhaseTitle(phase);
  const singleTask = steps.length <= 1;
  const [open, setOpen] = useState(
    !isDelegationCard && (running || phase === "executing"),
  );
  const expanded = open;

  return (
    <div className="codemini-disclosure msg-process-meta relative w-full">
      <DisclosureRowButton
        open={expanded}
        onClick={() => setOpen((value) => !value)}
        icon={
          running && phase !== "waiting" ? (
            <SessionOrb state="tool" />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                STATUS_DOT[phase] || "bg-[var(--text-muted)]",
              )}
            />
          )
        }
      >
        {isSubagent ? (
          persona ? (
            <SubagentAvatar seed={persona} />
          ) : (
            <UserCircle size={15} aria-hidden="true" className="shrink-0 text-(--text-secondary)" />
          )
        ) : !isFork ? (
          <UserCircle size={15} aria-hidden="true" className="shrink-0 text-(--text-secondary)" />
        ) : null}
        <span className="shrink-0">{title}</span>
        {taskSummary && !expanded ? (
          <>
            <span className="codemini-disclosure-sep" aria-hidden="true" />
            <span
              className="msg-process-meta__detail min-w-0 flex-1 truncate"
              title={taskSummary}
            >
              {taskSummary}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-(--text-secondary)">
          <span>
            {isSubagent
              ? statusLabel(phase, "subagent")
              : isFork
                ? statusLabel(phase, "fork")
                : planPhaseTitle(phase)}
          </span>
          {isDelegationCard && todoItems.length ? (
            <span className="tabular-nums text-(--text-muted)">
              {todoCompleted}/{todoItems.length}
            </span>
          ) : null}
        </span>
      </DisclosureRowButton>

      {expanded ? (
        <div className="codemini-disclosure-tree">
          {isDelegationCard ? <SubagentTaskDetails task={goal} /> : null}
          {isSubagent ? (
            <TowerWorkerMeta args={card?.arguments} />
          ) : null}
          {todoCard ? <ToolCard card={todoCard} embedded /> : null}
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
              <div className="flex flex-col gap-1">
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
