import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CaretDown,
  CheckCircle,
  CircleNotch,
  Database,
  DotsThreeVertical,
  Globe,
  GridFour,
  Hourglass,
  Lightning,
  ListBullets,
  MagnifyingGlass,
  Plus,
  Stop,
  Target,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { t } from "../../i18n/index.js";
import { useApp } from "@/context/app-context.jsx";
import { MarkdownPreview } from "@/components/MarkdownEditor.jsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.jsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  abortResearchRun,
  confirmResearchPlan,
  createResearchSession,
  deleteResearchSession,
  fetchResearchSession,
  fetchResearchSessions,
  openResearchRunStream,
  startResearchRun,
  updateResearchPlan,
} from "@/hooks/use-api.js";
import { cn } from "@/lib/utils";

const PHASE_FILTERS = [
  ["all", "deepResearchFilterAll"],
  ["planning", "deepResearchFilterPlanning"],
  ["investigating", "deepResearchFilterInvestigating"],
  ["done", "deepResearchFilterDone"],
];

const STEPS = [
  { id: "plan", labelKey: "deepResearchStepPlan" },
  { id: "investigate", labelKey: "deepResearchStepInvestigate" },
  { id: "report", labelKey: "deepResearchStepReport" },
];

const CARD_TONES = [
  "#5B8DEF",
  "#3D9B8F",
  "#C27A4A",
  "#8B6BC9",
  "#4A9B6E",
  "#B85C7A",
];

function researchTone(index) {
  return CARD_TONES[Math.abs(Number(index) || 0) % CARD_TONES.length];
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function ResearchTerm({ children, explanation, className = "" }) {
  if (!explanation) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "cursor-help decoration-(--text-muted)/60 decoration-dotted underline underline-offset-3",
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={7} className="max-w-72 leading-5">
        {explanation}
      </TooltipContent>
    </Tooltip>
  );
}

function coverageHelp(status) {
  const key = {
    covered: "deepResearchTipCovered",
    partial: "deepResearchTipPartial",
    missing: "deepResearchTipMissing",
    conflicted: "deepResearchTipConflicted",
    blocked: "deepResearchTipBlocked",
  }[status];
  return key ? t(key) : "";
}

function runStatusHelp(status) {
  const key = {
    running: "deepResearchTipRunning",
    in_progress: "deepResearchTipRunning",
    evaluating: "deepResearchTipEvaluating",
    done: "deepResearchTipDone",
    completed: "deepResearchTipDone",
    partial: "deepResearchTipScoutPartial",
    blocked: "deepResearchTipBlocked",
    failed: "deepResearchTipFailed",
    aborted: "deepResearchTipAborted",
    pending: "deepResearchTipPending",
    open: "deepResearchTipPending",
  }[status];
  return key ? t(key) : "";
}

function researchToolHelp(name) {
  if (name === "web_search") return t("deepResearchTipSearches");
  if (name === "web_fetch") return t("deepResearchTipFetches");
  return "";
}

function normalizeCriteriaList(list = []) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (item && typeof item === "object") {
      const priority = String(item.priority || "normal").toLowerCase();
      return {
        text: String(item.text || item.criterion || "").trim(),
        priority: ["high", "normal", "low"].includes(priority) ? priority : "normal",
      };
    }
    return { text: String(item || "").trim(), priority: "normal" };
  }).filter((item) => item.text);
}

function priorityLabel(priority) {
  if (priority === "high") return t("deepResearchPriorityHigh");
  if (priority === "low") return t("deepResearchPriorityLow");
  return t("deepResearchPriorityNormal");
}

function priorityTone(priority) {
  if (priority === "high") return "bg-rose-500/12 text-rose-700 dark:text-rose-300";
  if (priority === "low") return "bg-(--bg-hover) text-(--text-muted)";
  return "bg-sky-500/12 text-sky-700 dark:text-sky-300";
}

function latestWaveLimitations(session) {
  const waves = session?.waves || [];
  for (let index = waves.length - 1; index >= 0; index -= 1) {
    const limitations = waves[index]?.evaluation?.limitations;
    if (Array.isArray(limitations) && limitations.length) return limitations;
  }
  return [];
}

function phaseToStep(phase) {
  if (phase === "investigating" || phase === "incomplete" || phase === "failed") return "investigate";
  if (phase === "ready_for_report") return "report";
  if (phase === "writing" || phase === "done") return "report";
  return "plan";
}

function phaseLabel(phase) {
  switch (phase) {
    case "planning":
      return t("deepResearchPhasePlanning");
    case "awaiting_plan_confirm":
      return t("deepResearchPhaseAwaiting");
    case "investigating":
      return t("deepResearchPhaseInvestigating");
    case "ready_for_report":
      return t("deepResearchPhaseReady");
    case "incomplete":
      return t("deepResearchPhaseIncomplete");
    case "writing":
      return t("deepResearchPhaseWriting");
    case "done":
      return t("deepResearchPhaseDone");
    case "failed":
      return t("deepResearchPhaseFailed");
    default:
      return phase || "—";
  }
}

function phaseChipClass(phase) {
  switch (phase) {
    case "done":
      return "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300";
    case "investigating":
    case "writing":
      return "bg-primary/14 text-primary";
    case "ready_for_report":
      return "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300";
    case "failed":
    case "incomplete":
      return "bg-(--accent-red-bg) text-accent-red";
    case "awaiting_plan_confirm":
      return "bg-amber-500/14 text-amber-800 dark:text-amber-300";
    default:
      return "bg-(--bg-hover) text-(--text-secondary)";
  }
}

function statusTone(status) {
  switch (status) {
    case "done":
    case "completed":
      return "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300";
    case "partial":
    case "in_progress":
    case "running":
    case "evaluating":
      return "bg-amber-500/14 text-amber-800 dark:text-amber-300";
    case "blocked":
    case "failed":
    case "aborted":
      return "bg-(--accent-red-bg) text-accent-red";
    default:
      return "bg-(--bg-hover) text-(--text-secondary)";
  }
}

function confidenceTone(level) {
  if (level === "high") return "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300";
  if (level === "low") return "bg-(--accent-red-bg) text-accent-red";
  return "bg-amber-500/14 text-amber-800 dark:text-amber-300";
}

function formatDate(raw) {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function ResearchLibraryCard({
  session,
  toneIndex,
  viewMode,
  menuOpen,
  onOpen,
  onMenuOpenChange,
  onDelete,
}) {
  const isList = viewMode === "list";
  return (
    <article
      className={cn(
        "group relative isolate overflow-visible rounded-2xl border border-white/4 text-left shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition duration-200 hover:-translate-y-0.5 hover:border-white/10 hover:shadow-[0_14px_36px_rgba(0,0,0,0.14)]",
        isList ? "min-h-24" : "min-h-52",
      )}
      style={{
        "--research-tint": researchTone(toneIndex),
        backgroundColor:
          "color-mix(in srgb, var(--research-tint) 22%, var(--bg-secondary))",
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(session.id)}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-label={`${t("deepResearchOpen")}: ${session.question}`}
      />
      <div
        className={cn(
          "pointer-events-none relative z-[1] flex h-full",
          isList ? "items-center gap-4 px-5 py-4 pr-14" : "min-h-52 flex-col px-5 pb-5 pt-5",
        )}
      >
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl"
          style={{
            color: "var(--research-tint)",
            backgroundColor: "color-mix(in srgb, var(--research-tint) 20%, transparent)",
          }}
        >
          <Lightning size={25} weight="duotone" aria-hidden="true" />
        </span>
        <div className={isList ? "min-w-0 flex-1" : "mt-auto min-w-0"}>
          <h3
            className={cn(
              "line-clamp-2 break-words font-medium tracking-[-0.015em] text-(--text-primary)",
              isList ? "text-[15px] leading-5" : "text-[18px] leading-6",
            )}
          >
            {session.question || t("deepResearchUntitled")}
          </h3>
          {session.goal ? (
            <p className="mt-1 line-clamp-1 text-[12px] text-(--text-secondary)">{session.goal}</p>
          ) : null}
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-(--text-muted)">
            <span className={cn("rounded-full px-2 py-0.5 font-medium", phaseChipClass(session.phase))}>
              {phaseLabel(session.phase)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{formatDate(session.updatedAt)}</span>
          </div>
        </div>
      </div>
      <div className="absolute right-3 top-3 z-10">
        <Popover open={menuOpen} onOpenChange={(open) => onMenuOpenChange(open ? session.id : "")}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-full text-(--text-secondary) transition hover:bg-black/10 hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              aria-label={t("deepResearchMore")}
            >
              <DotsThreeVertical size={16} weight="bold" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-40 p-1.5">
            <button
              type="button"
              onClick={() => {
                onMenuOpenChange("");
                onDelete(session);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-accent-red hover:bg-(--accent-red-bg)"
            >
              <Trash size={14} />
              {t("deepResearchDelete")}
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </article>
  );
}

function researchStepReachable(phase, stepId) {
  const unlocked = phase === "ready_for_report" ? "investigate" : phaseToStep(phase);
  const order = STEPS.map((s) => s.id);
  return order.indexOf(stepId) <= order.indexOf(unlocked);
}

function researchContentStep(phase, focusStep) {
  if (focusStep && researchStepReachable(phase, focusStep)) return focusStep;
  if (phase === "ready_for_report") return "investigate";
  return phaseToStep(phase);
}

function Stepper({ phase, focusStep, onFocusStep }) {
  const active = researchContentStep(phase, focusStep);
  const order = STEPS.map((s) => s.id);
  const activeIdx = order.indexOf(active);
  return (
    <nav
      aria-label={t("deepResearchProgress")}
      className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-(--bg-secondary) p-1"
    >
      {STEPS.map((step, index) => {
        const done = index < activeIdx;
        const current = index === activeIdx;
        const reachable = researchStepReachable(phase, step.id);
        const interactive = reachable && typeof onFocusStep === "function";
        const className = cn(
          "shrink-0 rounded-lg px-3.5 py-1.5 text-[11px] font-medium transition",
          current && "bg-(--bg-primary) text-(--text-primary) shadow-sm ring-1 ring-(--border-default)/70",
          done && !current && "text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
          !done && !current && reachable && "text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
          !reachable && "text-(--text-muted) opacity-55",
          interactive && "cursor-pointer",
        );
        return (
          <div key={step.id}>
            {interactive ? (
              <button
                type="button"
                className={className}
                onClick={() => onFocusStep(step.id)}
                aria-current={current ? "step" : undefined}
              >
                {t(step.labelKey)}
              </button>
            ) : (
              <span className={className}>{t(step.labelKey)}</span>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function GuideComposer({ open, onOpenChange, busy, error, onSubmit }) {
  const [question, setQuestion] = useState("");
  const [goal, setGoal] = useState("");
  const [constraints, setConstraints] = useState("");
  const [seedText, setSeedText] = useState("");

  useEffect(() => {
    if (!open) {
      setQuestion("");
      setGoal("");
      setConstraints("");
      setSeedText("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("deepResearchNew")}</DialogTitle>
          <DialogDescription>{t("deepResearchEmpty")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text-secondary)">
              {t("deepResearchQuestion")} *
            </span>
            <textarea
              className="min-h-[100px] rounded-xl border border-(--border-default) bg-(--bg-secondary) px-3 py-2.5 text-[14px] text-(--text-primary) outline-none transition focus:border-primary/40"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t("deepResearchQuestionPlaceholder")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text-secondary)">
              {t("deepResearchGoal")}
            </span>
            <input
              className="h-10 rounded-xl border border-(--border-default) bg-(--bg-secondary) px-3 text-[14px] outline-none focus:border-primary/40"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t("deepResearchGoalPlaceholder")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text-secondary)">
              {t("deepResearchConstraints")}
            </span>
            <textarea
              className="min-h-[72px] rounded-xl border border-(--border-default) bg-(--bg-secondary) px-3 py-2.5 text-[14px] outline-none focus:border-primary/40"
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-(--text-secondary)">
              {t("deepResearchSeed")}
            </span>
            <textarea
              className="min-h-[88px] rounded-xl border border-(--border-default) bg-(--bg-secondary) px-3 py-2.5 text-[14px] outline-none focus:border-primary/40"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder={t("deepResearchSeedPlaceholder")}
            />
          </label>
          {error ? (
            <div className="rounded-xl bg-(--accent-red-bg) px-3 py-2 text-[12px] text-accent-red">{error}</div>
          ) : null}
        </div>
        <DialogFooter>
          <button
            type="button"
            className="rounded-full px-4 py-2 text-[12px] text-(--text-secondary) hover:bg-(--bg-hover)"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !question.trim()}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-(--text-primary) px-5 text-[12px] font-semibold text-(--bg-primary) disabled:opacity-40"
            onClick={() =>
              onSubmit({
                question: question.trim(),
                preferences: { goal: goal.trim(), constraints: constraints.trim() },
                seed: seedText.trim() ? [{ label: "paste", text: seedText.trim() }] : [],
              })
            }
          >
            {busy ? <CircleNotch size={14} className="animate-spin" /> : <Lightning size={14} weight="bold" />}
            {t("deepResearchStart")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanPane({
  session,
  busy,
  running,
  onSave,
  onConfirm,
  onReplan,
  readOnly = false,
}) {
  const [goal, setGoal] = useState(session?.plan?.goal || session?.preferences?.goal || "");
  const [questions, setQuestions] = useState(
    Array.isArray(session?.plan?.questions) ? session.plan.questions : [],
  );

  useEffect(() => {
    setGoal(session?.plan?.goal || session?.preferences?.goal || "");
    setQuestions(Array.isArray(session?.plan?.questions) ? session.plan.questions : []);
  }, [session?.id, session?.updatedAt, session?.plan, session?.preferences?.goal]);

  const draft = useMemo(
    () => ({
      ...(session?.plan || {}),
      goal,
      depth: session?.plan?.depth || "standard",
      questions: questions.map((q, index) => ({
        tempId: q.tempId || q.id || `q${index + 1}`,
        text: q.text || "",
        successCriteria: Array.isArray(q.successCriteria) ? q.successCriteria : [],
        dependsOn: Array.isArray(q.dependsOn) ? q.dependsOn : [],
      })),
      coverageChecklist: Array.isArray(session?.plan?.coverageChecklist)
        ? session.plan.coverageChecklist
        : [],
    }),
    [session?.plan, goal, questions],
  );

  if (session?.phase === "planning" && !questions.length) {
    const stopped = !running;
    return (
      <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.045] px-5 py-8">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
            {running ? (
              <CircleNotch size={22} weight="bold" className="animate-spin" />
            ) : (
              <WarningCircle size={22} weight="fill" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-(--text-primary)">
              {running ? t("deepResearchPlanning") : t("deepResearchPlanningStopped")}
            </div>
            <p className="mt-1 text-[12px] text-(--text-muted)">
              {running ? t("deepResearchPlanningHint") : t("deepResearchPlanningStoppedHint")}
            </p>
            {stopped ? (
              <button
                type="button"
                disabled={busy}
                className="mt-4 inline-flex h-9 items-center rounded-full bg-(--text-primary) px-4 text-[12px] font-semibold text-(--bg-primary) disabled:opacity-40"
                onClick={onReplan}
              >
                {t("deepResearchRetryPlanning")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {session?.plan?.depth ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-(--text-secondary)">
          <span className="rounded-full bg-(--bg-hover) px-2.5 py-1 font-medium uppercase tracking-wide text-(--text-primary)">
            {t(`deepResearchDepth_${session.plan.depth}`) || session.plan.depth}
          </span>
          <span className="text-(--text-muted)">
            <ResearchTerm explanation={t("deepResearchTipDepth")}>
              {t("deepResearchDepth")}
            </ResearchTerm>
          </span>
        </div>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-(--text-secondary)">
          {t("deepResearchGoal")}
        </span>
        <input
          className="h-10 rounded-xl border border-(--border-default) bg-(--bg-secondary) px-3 text-[14px] outline-none focus:border-primary/40 disabled:opacity-70"
          value={goal}
          disabled={readOnly}
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      <div className="flex flex-col gap-3">
        {questions.map((q, index) => (
          <div
            key={q.tempId || q.id || index}
            className="rounded-2xl border border-(--border-default) bg-(--bg-secondary)/60 p-4"
          >
            <div className="mb-2 text-[11px] font-medium text-(--text-muted)">
              {q.tempId || q.id || `q${index + 1}`}
            </div>
            <textarea
              className="min-h-[72px] w-full rounded-xl border border-(--border-default) bg-(--bg-primary) px-3 py-2 text-[13px] outline-none focus:border-primary/40 disabled:opacity-70"
              value={q.text || ""}
              disabled={readOnly}
              onChange={(e) => {
                const value = e.target.value;
                setQuestions((current) => current.map((item, itemIndex) => (
                  itemIndex === index ? { ...item, text: value } : item
                )));
              }}
            />
            {(normalizeCriteriaList(q.successCriteria).length) ? (
              <div className="mt-2 space-y-1.5">
                <div className="text-[11px] font-medium text-(--text-muted)">
                  <ResearchTerm explanation={t("deepResearchTipPriority")}>
                    {t("deepResearchCriteria")}
                  </ResearchTerm>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {normalizeCriteriaList(q.successCriteria).map((criterion, criterionIndex) => (
                    <span
                      key={`${criterion.text}-${criterionIndex}`}
                      title={criterion.text}
                      className={cn(
                        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium",
                        priorityTone(criterion.priority),
                      )}
                    >
                      <span className="shrink-0 uppercase tracking-wide">
                        {priorityLabel(criterion.priority)}
                      </span>
                      <span className="min-w-0 truncate">{criterion.text}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-10 items-center rounded-full border border-(--border-default) px-4 text-[12px] font-medium text-(--text-secondary) hover:bg-(--bg-hover) disabled:opacity-40"
            onClick={() => onSave(draft)}
          >
            {t("deepResearchSavePlan")}
          </button>
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-10 items-center rounded-full bg-(--text-primary) px-5 text-[12px] font-semibold text-(--bg-primary) disabled:opacity-40"
            onClick={() => onConfirm(draft)}
          >
            {t("deepResearchApproveAndStart")}
          </button>
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-10 items-center rounded-full border border-(--border-default) px-4 text-[12px] font-medium text-(--text-secondary) hover:bg-(--bg-hover) disabled:opacity-40"
            onClick={onReplan}
          >
            {t("deepResearchReplan")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function summarizeResearchToolArgs(name, args) {
  let parsed = args;
  if (typeof args === "string") {
    try {
      parsed = JSON.parse(args);
    } catch {
      return String(args || "").slice(0, 140);
    }
  }
  if (!parsed || typeof parsed !== "object") return "";
  const tool = String(name || "");
  if (tool === "web_search") return String(parsed.query || parsed.q || "").slice(0, 140);
  if (tool === "web_fetch") return String(parsed.url || "").slice(0, 160);
  return "";
}

function scoutLiveKey(payload = {}) {
  return String(
    payload.scoutRunId
      || payload.questionId
      || payload.parentToolCallId
      || payload.toolCallId
      || payload.taskId
      || "",
  ).trim();
}

const LIVE_DRAFT_MAX = 6000;

function legacyWavesFromTimeline(timeline = []) {
  const waves = [];
  let current = null;
  for (const entry of timeline) {
    if (entry.type === "wave:start") {
      current = {
        id: entry.waveId || entry.id,
        wave: entry.wave || waves.length + 1,
        status: "running",
        createdAt: entry.at,
        scouts: [],
        evaluation: {},
      };
      waves.push(current);
      continue;
    }
    if (!current) continue;
    if (entry.type === "handoff") {
      current.scouts.push({
        id: entry.id,
        questionId: entry.questionId,
        name: entry.name,
        status: "done",
        handoffMarkdown: entry.handoff,
        ledger: {},
      });
    }
    if (entry.type === "wave:evaluation") {
      current.status = "completed";
      current.evaluation = entry.evaluation || {};
    }
  }
  return waves;
}

function coverageClass(status) {
  if (status === "covered") return "bg-emerald-500/16 text-emerald-700 dark:text-emerald-300";
  if (status === "conflicted" || status === "blocked") return "bg-red-500/14 text-red-700 dark:text-red-300";
  if (status === "partial") return "bg-amber-500/16 text-amber-800 dark:text-amber-300";
  return "bg-(--bg-hover) text-(--text-muted)";
}

function shortResearchLabel(text, max = 48) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, Math.max(1, max - 1))}…` : normalized;
}

function criterionLabelFromQuestion(question, criterionId) {
  const id = String(criterionId || "").trim();
  if (!id) return "";
  const fromLedger = (question?.ledger?.criteria || []).find((item) => item.id === id);
  if (fromLedger?.text) return shortResearchLabel(fromLedger.text);
  const match = /^c(\d+)$/i.exec(id);
  if (match) {
    const criteria = normalizeCriteriaList(question?.successCriteria);
    const criterion = criteria[Number(match[1]) - 1];
    if (criterion?.text) return shortResearchLabel(criterion.text);
  }
  return "";
}

/** Prefer "readable label (id)" so raw rq_/c ids stay copyable but secondary. */
function formatResearchRef(questionId, criterionId, questions = []) {
  const qid = String(questionId || "").trim();
  const cid = String(criterionId || "").trim();
  const question = questions.find((item) => item.id === qid);
  const qLabel = shortResearchLabel(question?.text) || qid || "—";
  const qPart = qid && shortResearchLabel(question?.text) ? `${qLabel} (${qid})` : (qid || qLabel);
  if (!cid) return qPart;
  const cLabel = criterionLabelFromQuestion(question, cid);
  const cPart = cLabel ? `${cLabel} (${cid})` : cid;
  return `${qPart} · ${cPart}`;
}

function humanizeResearchText(text, questions = []) {
  let out = String(text || "");
  if (!out || !questions.length) return out;
  const ids = questions
    .map((question) => String(question?.id || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const id of ids) {
    if (!out.includes(id)) continue;
    const question = questions.find((item) => item.id === id);
    const label = shortResearchLabel(question?.text);
    if (!label) continue;
    out = out.split(id).join(`${label} (${id})`);
  }
  return out;
}

const TERMINAL_SCOUT_STATUSES = new Set([
  "done",
  "partial",
  "blocked",
  "failed",
  "aborted",
  "error",
]);

function mergeScoutCard(scout, live) {
  const persisted = scout?.status;
  const liveStatus = live?.status;
  let status = liveStatus || persisted || "running";
  // Persisted terminal wins over a stale live "running" after scout failure / wave end.
  if (TERMINAL_SCOUT_STATUSES.has(persisted) && (!liveStatus || liveStatus === "running")) {
    status = persisted;
  } else if (TERMINAL_SCOUT_STATUSES.has(liveStatus)) {
    status = liveStatus;
  }
  return {
    ...scout,
    ...live,
    status,
    ledger: live?.ledger || scout?.ledger || {},
    tools: live?.tools || [],
    handoff: live?.handoff || scout?.handoffMarkdown || "",
    error: live?.error || scout?.error || "",
  };
}

function ScoutLedgerCard({ scout, question, live, targetCriterionIds = [] }) {
  const card = mergeScoutCard(scout, live);
  const criteria = Array.isArray(card.coverage) && card.coverage.length
    ? card.coverage
    : Array.isArray(card.ledger?.criteria)
      ? card.ledger.criteria
      : [];
  const candidates = Array.isArray(card.ledger?.candidates) ? card.ledger.candidates : [];
  const status = card.status || "running";
  const running = status === "running";
  const failed = status === "failed" || status === "error" || status === "blocked";
  const completed = status === "done";
  const partial = status === "partial";
  const cycle = card.cycle || card.ledger?.cycles || 0;
  const targetSet = new Set((targetCriterionIds || []).map(String).filter(Boolean));
  const hasWaveTargets = targetSet.size > 0;
  const activeTargets = hasWaveTargets
    ? criteria.filter((criterion) => targetSet.has(String(criterion.id)))
    : criteria.filter((criterion) => !TERMINAL_SCOUT_STATUSES.has(criterion.status) && criterion.status !== "covered");
  // covered/blocked that are not this wave's targets are inherited display only
  const inherited = hasWaveTargets
    ? criteria.filter((criterion) => !targetSet.has(String(criterion.id)))
    : [];

  return (
    <details
      open={running || failed}
      className="group/scout overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-primary) shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl",
            running && "bg-sky-500/12 text-sky-600 dark:text-sky-300",
            completed && "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
            partial && "bg-amber-500/12 text-amber-800 dark:text-amber-300",
            failed && "bg-red-500/12 text-red-700 dark:text-red-300",
          )}
        >
          {running ? (
            <CircleNotch size={16} className="animate-spin" />
          ) : failed || partial ? (
            <WarningCircle size={17} weight="fill" />
          ) : (
            <CheckCircle size={17} weight="fill" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-(--text-primary)">
            {question?.text || card.questionText || card.name || t("deepResearchScout")}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-(--text-muted)">
            <ResearchTerm explanation={t("deepResearchTipScout")}>
              {card.name || t("deepResearchScout")}
            </ResearchTerm>
            {cycle ? (
              <ResearchTerm explanation={t("deepResearchTipCheckpoint")}>
                {t("deepResearchCheckpoint")} {cycle}
              </ResearchTerm>
            ) : null}
            <ResearchTerm explanation={t("deepResearchTipSearches")}>
              {card.searchCount || 0} {t("deepResearchSearchesLabel").toLowerCase()}
            </ResearchTerm>
            <ResearchTerm explanation={t("deepResearchTipFetches")}>
              {card.fetchCount || 0} {t("deepResearchFetchesLabel").toLowerCase()}
            </ResearchTerm>
            <ResearchTerm explanation={t("deepResearchTipCandidates")}>
              {candidates.length || card.candidateCount || 0} {t("deepResearchCandidatesLabel").toLowerCase()}
            </ResearchTerm>
          </span>
        </span>
        <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-semibold", statusTone(status))}>
          <ResearchTerm explanation={runStatusHelp(status)}>{status}</ResearchTerm>
        </span>
        <CaretDown
          size={14}
          className="shrink-0 text-(--text-muted) transition-transform group-open/scout:rotate-180"
        />
      </summary>

      <div className="border-t border-(--border-default) px-4 py-4">
        {hasWaveTargets && activeTargets.length ? (
          <div className="mb-3 rounded-xl bg-sky-500/[0.07] px-3 py-2 text-[11px] leading-5 text-sky-900 dark:text-sky-100">
            <span className="font-semibold">{t("deepResearchWaveTargetsLabel")}</span>
            {" · "}
            {activeTargets.map((criterion) => (
              shortResearchLabel(criterion.text, 36) || criterion.id
            )).join(" · ")}
          </div>
        ) : null}

        {criteria.length ? (
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-(--text-muted)">
              <ResearchTerm explanation={t("deepResearchTipCoverage")}>
                {t("deepResearchCoverage")}
              </ResearchTerm>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {criteria.map((criterion) => {
                const used = Number(criterion.searchCount) || 0;
                const atCap = used >= 5;
                const isTarget = !hasWaveTargets || targetSet.has(String(criterion.id));
                const isInheritedCovered = hasWaveTargets
                  && !isTarget
                  && criterion.status === "covered";
                return (
                  <span
                    key={criterion.id}
                    title={criterion.text}
                    className={cn(
                      "inline-flex max-w-full min-w-0 items-center rounded-full px-2.5 py-1 text-[10px] font-medium",
                      isInheritedCovered
                        ? "bg-(--bg-hover) text-(--text-muted) opacity-70"
                        : coverageClass(criterion.status),
                      isTarget && hasWaveTargets && "ring-1 ring-sky-500/40",
                    )}
                  >
                    <ResearchTerm
                      explanation={`${coverageHelp(criterion.status)} ${t("deepResearchTipCriterionSearches")}`}
                      className="min-w-0 truncate"
                    >
                      {shortResearchLabel(criterion.text, 28) || criterion.id}
                      {criterion.id ? ` (${criterion.id})` : ""}
                      {criterion.priority ? ` · ${priorityLabel(criterion.priority)}` : ""}
                      {" · "}
                      {used}/5
                      {atCap ? ` · ${t("deepResearchSearchCapReached")}` : ""}
                      {isInheritedCovered ? ` · ${t("deepResearchInheritedCovered")}` : ""}
                      {" · "}
                      {criterion.status}
                    </ResearchTerm>
                  </span>
                );
              })}
            </div>
            {inherited.some((item) => item.status === "covered") ? (
              <div className="mt-2 text-[10px] text-(--text-muted)">
                {t("deepResearchInheritedCoveredHint")}
              </div>
            ) : null}
          </div>
        ) : null}

        {card.error ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-500/[0.07] px-3 py-2 text-[11px] leading-5 text-red-700 dark:text-red-200">
            <WarningCircle size={14} className="mt-0.5 shrink-0" weight="fill" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{card.error}</span>
          </div>
        ) : null}

        {card.nextGap ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/[0.07] px-3 py-2 text-[11px] leading-5 text-amber-800 dark:text-amber-200">
            <Target size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              <ResearchTerm explanation={t("deepResearchTipNextGap")}>
                <strong>
                  {shortResearchLabel(
                    criteria.find((item) => item.id === card.nextGap.criterionId)?.text,
                    32,
                  ) || card.nextGap.criterionId}
                  {card.nextGap.criterionId
                    ? ` (${card.nextGap.criterionId})`
                    : ""}
                </strong>
              </ResearchTerm>
              {" · "}
              {card.nextGap.reason || card.nextGap.text}
            </span>
          </div>
        ) : null}

        {card.tools?.length ? (
          <div className="mt-3 space-y-1.5">
            {card.tools.slice(-8).map((tool, index) => (
              <div
                key={`${tool.id || tool.name}-${index}`}
                className="flex items-center gap-2 rounded-lg bg-(--bg-secondary)/60 px-2.5 py-2 text-[10px]"
              >
                {tool.status === "running" ? (
                  <CircleNotch size={12} className="shrink-0 animate-spin text-sky-500" />
                ) : (
                  <Globe size={12} className="shrink-0 text-(--text-muted)" />
                )}
                <span className="shrink-0 font-semibold text-(--text-secondary)">
                  <ResearchTerm explanation={researchToolHelp(tool.name)}>
                    {tool.displayName || tool.name}
                  </ResearchTerm>
                </span>
                <span className="min-w-0 truncate text-(--text-muted)">
                  {tool.detail || tool.summary || ""}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {candidates.length ? (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-(--text-muted)">
                <ResearchTerm explanation={t("deepResearchTipCandidates")}>
                  {t("deepResearchLedgerCandidates")}
                </ResearchTerm>
              </span>
              <span className="text-[10px] text-(--text-muted)">
                <ResearchTerm explanation={t("deepResearchTipAccepted")}>
                  {card.committedCandidateIds?.length || 0} {t("deepResearchAccepted")}
                </ResearchTerm>
              </span>
            </div>
            <div className="space-y-2">
              {candidates.map((candidate) => (
                <div key={candidate.id} className="rounded-xl border border-(--border-default) bg-(--bg-secondary)/35 px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <Database size={13} className="mt-0.5 shrink-0 text-(--text-muted)" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] leading-5 text-(--text-primary)">{candidate.claim}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-(--text-muted)">
                        <span>{candidate.id}</span>
                        <span>·</span>
                        <span>{candidate.confidence}</span>
                        <span>·</span>
                        <ResearchTerm explanation={t("deepResearchTipSources")}>
                          {candidate.sources?.length || 0} {t("deepResearchSourcesLabel").toLowerCase()}
                        </ResearchTerm>
                        {card.committedCandidateIds?.includes(candidate.id) ? (
                          <span className="rounded-full bg-emerald-500/14 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">
                            {t("deepResearchAccepted")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {card.draft && !card.handoff ? (
          <details className="mt-3 rounded-xl bg-(--bg-secondary)/50 px-3 py-2">
            <summary className="cursor-pointer text-[10px] font-medium text-(--text-muted)">
              {t("deepResearchScoutDraft")}
            </summary>
            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-(--text-secondary)">
              {String(card.draft).slice(-LIVE_DRAFT_MAX)}
            </pre>
          </details>
        ) : null}

        {card.handoff ? (
          <details className="mt-3 rounded-xl border border-(--border-default) px-3 py-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-(--text-secondary)">
              <ResearchTerm explanation={t("deepResearchTipHandoff")}>
                {t("deepResearchHandoff")}
              </ResearchTerm>
            </summary>
            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-(--text-secondary)">
              {String(card.handoff).slice(0, 6000)}
            </pre>
          </details>
        ) : null}
      </div>
    </details>
  );
}

function WavesBoard({ waves = [], timeline = [], questions = [], liveScouts = {}, leadStatus = "" }) {
  const persisted = waves.length ? waves : legacyWavesFromTimeline(timeline);
  const liveList = Object.values(liveScouts || {});
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const displayWaves = persisted.length
    ? persisted
    : liveList.length
      ? [{
        id: liveList[0]?.waveId || "live",
        wave: liveList[0]?.wave || 1,
        status: "running",
        scouts: [],
        evaluation: {},
      }]
      : [];

  if (!displayWaves.length) {
    return (
      <div className="rounded-3xl border border-dashed border-(--border-default) bg-(--bg-secondary)/20 px-6 py-14 text-center">
        <Target size={28} weight="duotone" className="mx-auto text-(--text-muted)" />
        <div className="mt-3 text-[12px] text-(--text-muted)">{t("deepResearchTimelineEmpty")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {leadStatus ? (
        <div className="sticky top-0 z-10 flex items-center gap-2 rounded-2xl border border-primary/15 bg-(--bg-primary)/90 px-4 py-3 text-[11px] text-(--text-secondary) shadow-sm backdrop-blur-xl">
          <Lightning size={14} weight="fill" className="text-primary" />
          <span className="truncate">{leadStatus}</span>
        </div>
      ) : null}

      {displayWaves.map((wave, index) => {
        const liveForWave = liveList.filter((item) =>
          item.waveId ? item.waveId === wave.id : Number(item.wave || 1) === Number(wave.wave || 1));
        const scouts = [...(wave.scouts || [])];
        for (const live of liveForWave) {
          if (!scouts.some((scout) => scout.id === live.scoutRunId || scout.questionId === live.questionId)) {
            scouts.push({
              id: live.scoutRunId || live.questionId,
              questionId: live.questionId,
              name: live.name,
              status: live.status,
              ledger: live.ledger || {},
            });
          }
        }
        const completed = scouts.filter((scout) => TERMINAL_SCOUT_STATUSES.has(scout.status)).length;
        const evaluation = wave.evaluation || {};
        const evaluationReason = humanizeResearchText(evaluation.reason || "", questions);
        return (
          <section key={wave.id || `${wave.wave}-${index}`} className="relative pl-5 sm:pl-8">
            <div className="absolute top-0 -bottom-5 left-1.75 w-px bg-(--border-default) sm:left-2.75" />
            <div
              className={cn(
                "absolute top-5 left-0 z-1 size-3.75 rounded-full border-[3px] border-(--bg-primary) sm:left-1",
                wave.status === "completed" ? "bg-emerald-500" : "bg-sky-500 animate-pulse",
              )}
            />
            <div className="overflow-hidden rounded-3xl border border-(--border-default) bg-(--bg-secondary)/35 shadow-[0_12px_32px_rgba(0,0,0,0.04)]">
              <div className="flex flex-col gap-3 border-b border-(--border-default) px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold tracking-[-0.02em] text-(--text-primary)">
                      <ResearchTerm explanation={t("deepResearchTipWave")}>
                        Wave {wave.wave || index + 1}
                      </ResearchTerm>
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider", statusTone(wave.status))}>
                      <ResearchTerm explanation={runStatusHelp(wave.status)}>
                        {wave.status}
                      </ResearchTerm>
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-(--text-muted)">
                    {completed}/{Math.max(scouts.length, wave.targets?.length || 0)}{" "}
                    <ResearchTerm explanation={t("deepResearchTipScout")}>
                      scouts
                    </ResearchTerm>
                    {" · "}
                    <ResearchTerm explanation={t("deepResearchTipWave")}>
                      {t("deepResearchWaveSemantic")}
                    </ResearchTerm>
                  </div>
                </div>
                {evaluation.decision ? (
                  <div
                    className={cn(
                      "flex max-w-xl items-center gap-2 rounded-xl px-3 py-2 text-[10px]",
                      evaluation.decision === "next_wave"
                        ? "bg-amber-500/8 text-amber-800 dark:text-amber-200"
                        : evaluation.decision === "incomplete"
                          ? "bg-red-500/8 text-red-700 dark:text-red-200"
                          : "bg-emerald-500/8 text-emerald-800 dark:text-emerald-200",
                    )}
                  >
                    {evaluation.decision === "next_wave" ? (
                      <ArrowRight size={13} />
                    ) : evaluation.decision === "incomplete" ? (
                      <WarningCircle size={13} weight="fill" />
                    ) : (
                      <CheckCircle size={13} weight="fill" />
                    )}
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      <ResearchTerm explanation={t("deepResearchTipWaveDecision")}>
                        <strong>{evaluation.decision.replaceAll("_", " ")}</strong>
                      </ResearchTerm>
                      {evaluationReason ? ` · ${evaluationReason}` : ""}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[10px] text-(--text-muted)">
                    <Hourglass size={12} />
                    {t("deepResearchWaveInProgress")}
                  </div>
                )}
              </div>
              <div className="space-y-2.5 p-3 sm:p-4">
                {scouts.length ? scouts.map((scout) => {
                  const live = liveScouts[scout.id]
                    || liveList.find((item) =>
                      item.scoutRunId === scout.id
                      || (item.questionId === scout.questionId
                        && (!item.waveId || item.waveId === wave.id)));
                  const liveForCard = wave.status === "completed"
                    && live?.status === "running"
                    && TERMINAL_SCOUT_STATUSES.has(scout.status)
                    ? { ...live, status: scout.status }
                    : live;
                  const targetCriterionIds = (wave.targets || [])
                    .filter((target) => target.questionId === scout.questionId && target.criterionId)
                    .map((target) => String(target.criterionId));
                  return (
                    <ScoutLedgerCard
                      key={scout.id || scout.questionId}
                      scout={scout}
                      question={questionById.get(scout.questionId)}
                      live={liveForCard}
                      targetCriterionIds={targetCriterionIds}
                    />
                  );
                }) : (
                  <div className="px-2 py-6 text-center text-[11px] text-(--text-muted)">
                    {t("deepResearchWaitingHandoff")}
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function QuestionsBoard({ questions = [] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 overflow-hidden">
      <div className="text-[12px] font-semibold text-(--text-primary)">
        <ResearchTerm explanation={t("deepResearchTipQuestions")}>
          {t("deepResearchQuestions")}
        </ResearchTerm>
      </div>
      {!questions.length ? (
        <div className="text-[12px] text-(--text-muted)">—</div>
      ) : (
        questions.map((q) => (
          <div key={q.id} className="min-w-0 overflow-hidden rounded-xl border border-(--border-default) bg-(--bg-primary) px-3 py-2.5">
            <div className="mb-1 flex min-w-0 items-center gap-2">
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", statusTone(q.status))}>
                <ResearchTerm explanation={runStatusHelp(q.status)}>{q.status}</ResearchTerm>
              </span>
            </div>
            <div className="break-words text-[12px] leading-5 text-(--text-primary) [overflow-wrap:anywhere]">
              {q.text}
            </div>
            {q.id ? (
              <div className="mt-1 truncate text-[10px] text-(--text-muted)" title={q.id}>
                {q.id}
              </div>
            ) : null}
            {q.gaps?.length ? (
              <div className="mt-1.5 break-words text-[11px] leading-4 text-amber-700 [overflow-wrap:anywhere] dark:text-amber-300">
                <ResearchTerm explanation={t("deepResearchTipGaps")}>gaps</ResearchTerm>
                {": "}
                <span className="line-clamp-5">{q.gaps.join("; ")}</span>
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

function sourceHostname(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "").replace(/^https?:\/\//, "").split("/")[0] || "";
  }
}

function EvidenceList({ evidence = [], title, variant = "stack" }) {
  const accepted = evidence.filter((ev) => ev.status === "accepted");
  const isGrid = variant === "grid";
  return (
    <section className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-(--text-primary)">
            <ResearchTerm explanation={t("deepResearchTipEvidence")}>
              {title || t("deepResearchEvidence")}
            </ResearchTerm>
          </div>
          {accepted.length ? (
            <div className="mt-0.5 text-[10px] text-(--text-muted)">
              {t("deepResearchSourcesCount").replace("{n}", String(accepted.length))}
            </div>
          ) : null}
        </div>
      </div>
      {!accepted.length ? (
        <div className="rounded-2xl border border-dashed border-(--border-default) px-4 py-8 text-center text-[12px] text-(--text-muted)">
          {t("deepResearchNoEvidence")}
        </div>
      ) : (
        <div
          className={cn(
            isGrid
              ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              : "flex flex-col gap-2",
          )}
        >
          {accepted.map((ev) => {
            const host = sourceHostname(ev.url);
            return (
              <article
                key={ev.id}
                className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-primary) px-3.5 py-3 transition-colors hover:border-primary/25"
              >
                <div className="mb-2 flex min-w-0 items-center gap-2">
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", confidenceTone(ev.confidence))}>
                    <ResearchTerm explanation={t("deepResearchTipConfidence")}>
                      {ev.confidence}
                    </ResearchTerm>
                  </span>
                  {host ? (
                    <span className="min-w-0 truncate text-[10px] text-(--text-muted)" title={ev.url}>
                      {host}
                    </span>
                  ) : null}
                </div>
                <p className={cn(
                  "text-[12px] leading-5 text-(--text-primary) [overflow-wrap:anywhere]",
                  isGrid ? "line-clamp-4" : "break-words",
                )}>
                  {ev.claim}
                </p>
                {ev.url ? (
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-primary hover:underline"
                    title={ev.url}
                  >
                    <Globe size={12} className="shrink-0 opacity-70" />
                    <span className="truncate">{host || ev.url}</span>
                  </a>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ResearchMetrics({ session }) {
  const questions = session?.questions || [];
  const evidence = (session?.evidence || []).filter((item) => item.status === "accepted");
  const waves = session?.waves || [];
  const covered = questions.filter((question) => question.status === "done").length;
  const progress = questions.length ? Math.round((covered / questions.length) * 100) : 0;
  const metrics = [
    {
      icon: Target,
      label: t("deepResearchQuestions"),
      help: t("deepResearchTipQuestions"),
      value: `${covered}/${questions.length}`,
      accent: "text-sky-600 dark:text-sky-300 bg-sky-500/10",
    },
    {
      icon: Database,
      label: t("deepResearchEvidence"),
      help: t("deepResearchTipEvidence"),
      value: evidence.length,
      accent: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10",
    },
    {
      icon: Lightning,
      label: t("deepResearchWavesLabel"),
      help: t("deepResearchTipWave"),
      value: `${waves.length}/${session?.budget?.maxWaves || 5}`,
      accent: "text-amber-700 dark:text-amber-300 bg-amber-500/10",
    },
  ];
  return (
    <div className="overflow-hidden rounded-3xl border border-(--border-default) bg-(--bg-secondary)/35">
      <div className="grid grid-cols-3 divide-x divide-(--border-default)">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="flex min-w-0 items-center gap-3 px-4 py-3.5">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", metric.accent)}>
                <Icon size={15} weight="duotone" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold tracking-[-0.02em] text-(--text-primary)">
                  {metric.value}
                </span>
                <span className="block text-[9px] uppercase tracking-widest text-(--text-muted)">
                  <ResearchTerm explanation={metric.help}>{metric.label}</ResearchTerm>
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="h-1 bg-(--bg-hover)">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function LimitationsBoard({ limitations = [], questions = [] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 overflow-hidden">
      <div className="text-[12px] font-semibold text-(--text-primary)">
        <ResearchTerm explanation={t("deepResearchTipLimitations")}>
          {t("deepResearchLimitations")}
        </ResearchTerm>
      </div>
      {!limitations.length ? (
        <div className="text-[12px] text-(--text-muted)">{t("deepResearchNoLimitations")}</div>
      ) : (
        limitations.map((item, index) => (
          <div
            key={`${item.questionId}-${item.criterionId}-${index}`}
            className="min-w-0 overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5"
          >
            <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-(--text-muted)">
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {formatResearchRef(item.questionId, item.criterionId, questions)}
              </span>
              {item.status ? (
                <span className={cn("rounded-full px-2 py-0.5 font-medium", coverageClass(item.status) || statusTone(item.status))}>
                  {item.status}
                </span>
              ) : null}
            </div>
            <div className="break-words text-[12px] leading-5 text-amber-900 [overflow-wrap:anywhere] dark:text-amber-100">
              {humanizeResearchText(item.gap || item.reason || item.text || "—", questions)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function DetailBody({
  session,
  running,
  busy,
  error,
  liveScouts,
  leadStatus,
  onSavePlan,
  onConfirmPlan,
  onReplan,
  onContinue,
  onWrite,
  onAbort,
}) {
  const phase = session?.phase;
  const investigating = ["investigating", "ready_for_report", "incomplete", "failed"].includes(phase);
  const readyForReport = phase === "ready_for_report";
  const incomplete = phase === "incomplete";
  const planning = phase === "planning" || phase === "awaiting_plan_confirm";
  const runIssue = ["paused", "failed"].includes(session?.runState);
  const displayedError = error || (session?.runState === "failed" ? session?.lastError : "") || "";
  const searchesRemaining =
    Number(session?.budget?.maxSearches || 0) - Number(session?.budgetUsed?.searches || 0);
  const wavesRemaining =
    Number(session?.budget?.maxWaves || 0) - Number(session?.budgetUsed?.waves || 0);
  const canContinue = !incomplete || (searchesRemaining > 0 && wavesRemaining > 0);
  const latestEvaluation = session?.waves?.at(-1)?.evaluation || {};
  const [focusStep, setFocusStep] = useState(null);

  useEffect(() => {
    setFocusStep(null);
  }, [session?.id, phase]);

  const activeStep = researchContentStep(phase, focusStep);
  const showPlan = activeStep === "plan";
  const showInvestigate = activeStep === "investigate";
  const showReport = activeStep === "report";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-(--border-default) px-5 py-3 sm:px-6">
        <Stepper phase={phase} focusStep={focusStep} onFocusStep={setFocusStep} />
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-(--text-secondary)">
                <CircleNotch size={14} className="animate-spin" />
                {leadStatus || t("deepResearchRunning")}
              </span>
              <button
                type="button"
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-(--border-default) px-3 text-[12px] font-medium hover:bg-(--bg-hover)"
                onClick={onAbort}
              >
                <Stop size={14} />
                {t("deepResearchStop")}
              </button>
            </>
          ) : null}
          {investigating && !running ? (
            <>
              {!readyForReport && canContinue ? (
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex h-9 items-center rounded-full border border-(--border-default) px-3 text-[12px] font-medium hover:bg-(--bg-hover) disabled:opacity-40"
                  onClick={onContinue}
                >
                  {t("deepResearchContinue")}
                </button>
              ) : null}
              {readyForReport ? (
                <button
                  type="button"
                  disabled={busy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-(--text-primary) px-4 text-[12px] font-semibold text-(--bg-primary) disabled:opacity-40"
                  onClick={onWrite}
                >
                  <BookOpen size={14} weight="bold" />
                  {t("deepResearchWriteReport")}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {displayedError ? (
        <div className="shrink-0 border-b border-(--accent-red-bg) bg-(--accent-red-bg) px-5 py-2 text-[12px] text-accent-red sm:px-6">
          {displayedError}
        </div>
      ) : null}

      {runIssue && !running ? (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/8 px-5 py-2 text-[12px] text-amber-900 dark:text-amber-100 sm:px-6">
          {session.runState === "paused"
            ? t("deepResearchPausedHint")
            : t("deepResearchFailedHint")}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
        {showPlan ? (
          <PlanPane
            session={session}
            busy={busy || running}
            running={running}
            readOnly={!planning}
            onSave={onSavePlan}
            onConfirm={onConfirmPlan}
            onReplan={onReplan}
          />
        ) : null}

        {showInvestigate ? (
          <div className="space-y-5">
            <div className="relative overflow-hidden rounded-3xl border border-(--border-default) bg-(--bg-primary) px-5 py-5 sm:px-6">
              <div className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-primary/5.5 blur-3xl" />
              <div className="relative max-w-4xl">
                <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">
                  {t("deepResearchQuestion")}
                </div>
                <div className="mt-2 text-[18px] font-semibold leading-7 tracking-tight text-(--text-primary)">
                  {session?.question}
                </div>
                {session?.preferences?.goal ? (
                  <div className="mt-2 text-[11px] leading-5 text-(--text-secondary)">
                    {session.preferences.goal}
                  </div>
                ) : null}
              </div>
            </div>
            <ResearchMetrics session={session} />
            {readyForReport && investigating ? (
              <div className="flex flex-col gap-3 rounded-3xl border border-emerald-500/20 bg-emerald-500/5.5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <CheckCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-emerald-600" />
                  <div>
                    <div className="text-[13px] font-semibold text-(--text-primary)">
                      {t("deepResearchReadyTitle")}
                    </div>
                    <div className="mt-1 text-[11px] text-(--text-secondary)">
                      {t("deepResearchReadyDescription")}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onWrite}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-4 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  <BookOpen size={14} />
                  {t("deepResearchWriteReport")}
                </button>
              </div>
            ) : null}
            {incomplete ? (
              <div className="flex items-start gap-3 rounded-3xl border border-red-500/20 bg-red-500/5.5 px-5 py-4">
                <WarningCircle size={22} weight="fill" className="mt-0.5 shrink-0 text-red-600" />
                <div>
                  <div className="text-[13px] font-semibold text-(--text-primary)">
                    {t("deepResearchIncompleteTitle")}
                  </div>
                  <div className="mt-1 text-[11px] leading-5 text-(--text-secondary)">
                    {humanizeResearchText(
                      latestEvaluation.reason || "",
                      session?.questions || [],
                    ) || t("deepResearchIncompleteDescription")}
                  </div>
                </div>
              </div>
            ) : null}

            <div>
              <div className="mb-3">
                <div className="text-[13px] font-semibold text-(--text-primary)">
                  <ResearchTerm explanation={t("deepResearchTipTimeline")}>
                    {t("deepResearchTimeline")}
                  </ResearchTerm>
                </div>
                <div className="mt-0.5 text-[10px] text-(--text-muted)">
                  {t("deepResearchWaveSemanticDescription")}
                </div>
              </div>
              <WavesBoard
                waves={session?.waves || []}
                timeline={session?.timeline || []}
                questions={session?.questions || []}
                liveScouts={liveScouts}
                leadStatus={running ? leadStatus : ""}
              />
            </div>

            <div className="grid gap-5 border-t border-(--border-default) pt-5 lg:grid-cols-2 xl:grid-cols-3">
              <QuestionsBoard questions={session?.questions || []} />
              <LimitationsBoard
                limitations={latestWaveLimitations(session)}
                questions={session?.questions || []}
              />
              <div className="lg:col-span-2 xl:col-span-1">
                <EvidenceList evidence={session?.evidence || []} variant="stack" />
              </div>
            </div>
          </div>
        ) : null}

        {showReport ? (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
            <div className="overflow-hidden rounded-3xl border border-(--border-default) bg-(--bg-primary)">
              <div className="border-b border-(--border-default) px-5 py-3.5 sm:px-7">
                <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">
                  {t("deepResearchStepReport")}
                </div>
                <div className="mt-1 text-[15px] font-semibold tracking-tight text-(--text-primary)">
                  {session?.question || t("deepResearchUntitled")}
                </div>
              </div>
              <div className="px-5 py-6 sm:px-7 sm:py-8">
                {session?.reportMarkdown ? (
                  <MarkdownPreview value={session.reportMarkdown} className="max-w-none" />
                ) : running ? (
                  <div className="flex items-center gap-2 text-[13px] text-(--text-secondary)">
                    <CircleNotch size={16} className="animate-spin" />
                    {leadStatus || t("deepResearchWriting")}
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-3 text-[13px] text-(--text-muted)">
                    <span>{t("deepResearchNoReport")}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onWrite}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-(--text-primary) px-4 text-[12px] font-semibold text-(--bg-primary) disabled:opacity-40"
                    >
                      <BookOpen size={14} />
                      {t("deepResearchRetryWriting")}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {(session?.evidence || []).some((ev) => ev.status === "accepted") ? (
              <EvidenceList
                evidence={session?.evidence || []}
                title={t("deepResearchSources")}
                variant="grid"
              />
            ) : null}

            {(session?.waves?.length || session?.timeline?.length) ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-(--border-default) bg-(--bg-secondary)/40 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-(--text-primary)">
                    {t("deepResearchReplayTimeline")}
                  </div>
                  <div className="mt-0.5 text-[10px] text-(--text-muted)">
                    {t("deepResearchReplayTimelineHint")}
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-(--border-default) bg-(--bg-primary) px-3.5 text-[12px] font-medium text-(--text-secondary) hover:bg-(--bg-hover)"
                  onClick={() => setFocusStep("investigate")}
                >
                  <ListBullets size={14} />
                  {t("deepResearchViewTimeline")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ResearchPanel() {
  const { state, actions } = useApp();
  const selectedId = String(state.researchSessionId || "").trim();
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [sortMode, setSortMode] = useState("recent");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [liveScouts, setLiveScouts] = useState({});
  const [leadStatus, setLeadStatus] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [menuEntryId, setMenuEntryId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const streamRef = useRef(null);
  const queryRef = useRef("");
  const listRequestRef = useRef(0);
  const sessionRequestRef = useRef(0);

  const isDetailView = Boolean(selectedId);

  const refreshList = useCallback(async ({ signal } = {}) => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setLoading(true);
    try {
      const data = await fetchResearchSessions(queryRef.current, { signal });
      if (requestId !== listRequestRef.current) return;
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch (err) {
      if (isAbortError(err) || requestId !== listRequestRef.current) return;
      setError(err?.message || String(err));
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }, []);

  const loadSession = useCallback(async (id, { signal } = {}) => {
    const requestId = sessionRequestRef.current + 1;
    sessionRequestRef.current = requestId;
    if (!id) {
      setSession(null);
      setDetailLoading(false);
      return null;
    }
    setDetailLoading(true);
    const data = await fetchResearchSession(id, { signal });
    if (requestId !== sessionRequestRef.current) return null;
    setSession(data?.session || null);
    setRunning(Boolean(data?.running));
    setDetailLoading(false);
    return data;
  }, []);

  useEffect(() => {
    queryRef.current = query;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => refreshList({ signal: controller.signal }).catch(() => {}),
      query ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, refreshList]);

  useEffect(() => {
    if (selectedId) {
      const controller = new AbortController();
      setSession(null);
      setError("");
      loadSession(selectedId, { signal: controller.signal }).catch((err) => {
        if (!isAbortError(err)) {
          setDetailLoading(false);
          setError(err.message || String(err));
        }
      });
      return () => {
        controller.abort();
        sessionRequestRef.current += 1;
      };
    }
    sessionRequestRef.current += 1;
    setSession(null);
    setDetailLoading(false);
    setRunning(false);
    setError("");
    setLiveScouts({});
    setLeadStatus("");
    return undefined;
  }, [selectedId, loadSession]);

  useEffect(() => {
    if (!selectedId) return undefined;
    streamRef.current?.close();
    setLiveScouts({});
    setLeadStatus("");
    const source = openResearchRunStream(selectedId);
    streamRef.current = source;

    const upsertLiveScout = (key, patch) => {
      if (!key) return;
      setLiveScouts((prev) => {
        const current = prev[key] || {
          questionId: key,
          name: "Scout",
          status: "running",
          tools: [],
          draft: "",
          handoff: "",
          questionText: "",
        };
        return {
          ...prev,
          [key]: typeof patch === "function" ? patch(current) : { ...current, ...patch },
        };
      });
    };

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "session" && payload.session) setSession(payload.session);
        if (payload.type === "run:start" || payload.type === "run:status") {
          setRunning(true);
          setError("");
          if (payload.type === "run:start") {
            setLiveScouts({});
            setLeadStatus(t("deepResearchRunning"));
          }
        }
        if (payload.type === "phase") {
          const phase = String(payload.phase || "");
          if (phase === "planning" || phase === "awaiting_plan_confirm") {
            setLeadStatus(t("deepResearchPlanning"));
          } else if (phase === "writing") {
            setLeadStatus(t("deepResearchWriting"));
          } else if (phase === "investigating") {
            setLeadStatus(t("deepResearchPhaseInvestigating"));
          }
        }
        if (payload.type === "run:done") {
          setRunning(false);
          setLeadStatus("");
          setLiveScouts({});
          if (payload.session) setSession(payload.session);
          refreshList().catch(() => {});
        }
        if (
          payload.type === "plan"
          || payload.type === "commit"
          || payload.type === "report"
          || payload.type === "handoff"
          || payload.type === "scout:start"
          || payload.type === "wave:start"
          || payload.type === "wave:evaluation"
          || payload.type === "batch:done"
        ) {
          loadSession(selectedId).catch(() => {});
        }
        if (payload.type === "budget" && payload.delta) {
          setSession((prev) => {
            if (!prev) return prev;
            const used = {
              ...(prev.budgetUsed || {}),
              searches:
                (Number(prev.budgetUsed?.searches) || 0)
                + (Number(payload.delta.searches) || 0),
              fetches:
                (Number(prev.budgetUsed?.fetches) || 0)
                + (Number(payload.delta.fetches) || 0),
              waves:
                (Number(prev.budgetUsed?.waves) || 0)
                + (Number(payload.delta.waves) || 0),
            };
            return { ...prev, budgetUsed: used };
          });
          if (payload.scope === "scout") {
            const key = scoutLiveKey(payload);
            upsertLiveScout(key, (current) => ({
              ...current,
              searchCount: payload.scoutUsed?.searches
                ?? ((Number(current.searchCount) || 0) + (Number(payload.delta.searches) || 0)),
              fetchCount: payload.scoutUsed?.fetches
                ?? ((Number(current.fetchCount) || 0) + (Number(payload.delta.fetches) || 0)),
            }));
          }
        }

        if (payload.type === "scout:start") {
          const key = scoutLiveKey(payload);
          upsertLiveScout(key, {
            scoutRunId: payload.scoutRunId || key,
            waveId: payload.waveId || "",
            wave: payload.wave || 1,
            questionId: payload.questionId || key,
            name: payload.name || "Scout",
            questionText: payload.questionText || "",
            status: "running",
            tools: [],
            draft: "",
            handoff: "",
            error: "",
          });
        }

        if (payload.scope === "scout") {
          const key = scoutLiveKey(payload);
          if (payload.type === "tool:start") {
            upsertLiveScout(key, (current) => ({
              ...current,
              status: "running",
              tools: [
                ...(current.tools || []).filter((step) => step.id !== payload.id),
                {
                  id: payload.id,
                  name: payload.name,
                  displayName: payload.displayName || payload.name,
                  detail: summarizeResearchToolArgs(payload.name, payload.arguments),
                  status: "running",
                },
              ].slice(-12),
            }));
            setLeadStatus(
              `${payload.scoutName || "Scout"} · ${payload.displayName || payload.name || "tool"}`,
            );
          }
          if (payload.type === "tool:end" || payload.type === "tool:error") {
            upsertLiveScout(key, (current) => ({
              ...current,
              tools: (current.tools || []).map((step) =>
                step.id === payload.id
                  ? {
                    ...step,
                    status: payload.type === "tool:error" ? "error" : "done",
                    summary: payload.summary || step.summary,
                  }
                  : step),
            }));
          }
          if (payload.type === "assistant:delta" && payload.text) {
            upsertLiveScout(key, (current) => ({
              ...current,
              draft: `${current.draft || ""}${payload.text}`.slice(-LIVE_DRAFT_MAX),
            }));
          }
          if (payload.type === "scout:checkpoint_start") {
            upsertLiveScout(key, (current) => ({
              ...current,
              cycle: payload.cycle,
              nextGap: payload.targetGap || current.nextGap,
            }));
            setLeadStatus(
              `${payload.scoutName || t("deepResearchScout")} · ${t("deepResearchCheckpoint")} ${payload.cycle}`,
            );
          }
          if (payload.type === "scout:checkpoint") {
            upsertLiveScout(key, (current) => ({
              ...current,
              cycle: payload.cycle,
              coverage: payload.coverage || current.coverage,
              nextGap: payload.nextGap || null,
              candidateCount: payload.candidateCount ?? current.candidateCount,
              searchCount: payload.searchCount ?? current.searchCount,
              fetchCount: payload.fetchCount ?? current.fetchCount,
              status: payload.decision === "continue" ? "running" : payload.decision,
            }));
            loadSession(selectedId).catch(() => {});
          }
        }

        if (payload.scope === "lead" && payload.type === "tool:start") {
          const label = payload.displayName || payload.name || "tool";
          setLeadStatus(`${t("deepResearchLead")} · ${label}`);
        }

        if (payload.type === "handoff") {
          const key = scoutLiveKey(payload);
          upsertLiveScout(key, (current) => ({
            ...current,
            name: payload.name || current.name,
            ledger: payload.ledger || current.ledger,
            status: payload.status || "done",
            handoff: payload.handoff || current.handoff,
            draft: "",
          }));
        }

        if (payload.type === "batch:start") {
          setLeadStatus(
            t("deepResearchBatchRunning").replace("{n}", String(payload.questionIds?.length || 0)),
          );
        }
        if (payload.type === "wave:evaluation") {
          const waveId = payload.waveId || "";
          if (waveId) {
            setLiveScouts((prev) => {
              const next = { ...prev };
              for (const [key, scout] of Object.entries(next)) {
                if (scout.waveId === waveId && scout.status === "running") {
                  next[key] = {
                    ...scout,
                    status: "failed",
                    error: scout.error || t("deepResearchScoutFailed"),
                  };
                }
              }
              return next;
            });
          }
          setLeadStatus(
            payload.evaluation?.decision === "next_wave"
              ? t("deepResearchNextWave")
              : payload.evaluation?.decision === "incomplete"
                ? t("deepResearchIncompleteTitle")
                : t("deepResearchReadyTitle"),
          );
          loadSession(selectedId).catch(() => {});
        }

        if (payload.type === "scout:error") {
          const key = scoutLiveKey(payload);
          upsertLiveScout(key, (current) => ({
            ...current,
            waveId: payload.waveId || current.waveId,
            wave: payload.wave || current.wave,
            scoutRunId: payload.scoutRunId || current.scoutRunId,
            questionId: payload.questionId || current.questionId,
            name: payload.name || current.name,
            status: payload.status === "aborted" ? "aborted" : "failed",
            error: payload.error || t("deepResearchScoutFailed"),
            ledger: payload.ledger || current.ledger,
          }));
          loadSession(selectedId).catch(() => {});
        }

        if (payload.type === "run:error" || payload.type === "error") {
          setRunning(false);
          setLeadStatus("");
          setError(payload.error || t("deepResearchFailed"));
          if (payload.session) setSession(payload.session);
        }
        if (payload.type === "aborted") {
          setRunning(false);
          setLeadStatus("");
          loadSession(selectedId).catch(() => {});
        }
      } catch {
        // ignore
      }
    };
    return () => source.close();
  }, [selectedId, loadSession, refreshList]);

  const visibleSessions = useMemo(() => {
    let list = [...sessions];
    if (activeFilter === "planning") {
      list = list.filter((s) => s.phase === "planning" || s.phase === "awaiting_plan_confirm");
    } else if (activeFilter === "investigating") {
      list = list.filter((s) =>
        ["investigating", "ready_for_report", "incomplete", "writing", "failed"].includes(s.phase));
    } else if (activeFilter === "done") {
      list = list.filter((s) => s.phase === "done");
    }
    if (sortMode === "title") {
      list.sort((a, b) => String(a.question || "").localeCompare(String(b.question || "")));
    } else {
      list.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    }
    return list;
  }, [sessions, activeFilter, sortMode]);

  const performDetailAction = async (work, { optimisticRunning = false } = {}) => {
    if (busy) return null;
    setBusy(true);
    setError("");
    if (optimisticRunning) setRunning(true);
    try {
      const result = await work();
      if (result?.session) setSession(result.session);
      return result;
    } catch (err) {
      if (optimisticRunning) setRunning(false);
      setError(err?.message || String(err));
      if (selectedId) loadSession(selectedId).catch(() => {});
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (payload) => {
    setBusy(true);
    setError("");
    try {
      const created = await createResearchSession(payload);
      const id = created?.session?.id;
      await refreshList();
      setComposerOpen(false);
      if (id) {
        actions.openResearchSession(id);
        setSession(created.session);
        setRunning(true);
        const started = await startResearchRun(id, { phase: "planning" });
        if (started?.session) setSession(started.session);
      }
    } catch (err) {
      setRunning(false);
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      await deleteResearchSession(deleteTarget.id);
      if (selectedId === deleteTarget.id) {
        setSession(null);
        actions.openResearchHome();
      }
      await refreshList();
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const listEmpty = !loading && visibleSessions.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-(--bg-primary)">
      <div className="mx-auto w-full max-w-[1540px] px-4 pb-12 pt-5 sm:px-7 lg:px-10 lg:pt-8">
        <header className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {PHASE_FILTERS.map(([filter, labelKey]) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={cn(
                    "shrink-0 rounded-full px-4 py-2 text-[12px] font-medium transition",
                    activeFilter === filter
                      ? "bg-primary/16 text-(--text-primary)"
                      : "text-(--text-secondary) hover:bg-(--bg-hover) hover:text-(--text-primary)",
                  )}
                  aria-current={activeFilter === filter ? "page" : undefined}
                >
                  {t(labelKey)}
                </button>
              ))}
            </nav>

            <div className="flex flex-wrap items-center gap-2">
              <div
                className={cn(
                  "flex h-10 items-center overflow-hidden rounded-full border border-(--border-default) bg-(--bg-primary) transition-[width,border-color]",
                  searchOpen || query ? "w-full sm:w-56" : "w-10",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSearchOpen((v) => !v)}
                  className="flex size-10 shrink-0 items-center justify-center text-(--text-secondary) hover:text-(--text-primary)"
                  aria-label={t("deepResearchSearch")}
                >
                  <MagnifyingGlass size={17} weight="bold" />
                </button>
                {searchOpen || query ? (
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("deepResearchSearch")}
                    className="min-w-0 flex-1 bg-transparent pr-3 text-[12px] text-(--text-primary) outline-none placeholder:text-(--text-muted)"
                    autoFocus
                  />
                ) : null}
              </div>

              <div className="inline-flex h-10 overflow-hidden rounded-full border border-(--border-default)">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={cn(
                    "flex w-10 items-center justify-center transition",
                    viewMode === "grid" ? "bg-primary/16 text-primary" : "text-(--text-secondary) hover:bg-(--bg-hover)",
                  )}
                  aria-pressed={viewMode === "grid"}
                  aria-label={t("deepResearchGridView")}
                  title={t("deepResearchGridView")}
                >
                  <GridFour size={17} weight="bold" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "flex w-10 items-center justify-center border-l border-(--border-default) transition",
                    viewMode === "list" ? "bg-primary/16 text-primary" : "text-(--text-secondary) hover:bg-(--bg-hover)",
                  )}
                  aria-pressed={viewMode === "list"}
                  aria-label={t("deepResearchListView")}
                  title={t("deepResearchListView")}
                >
                  <ListBullets size={17} weight="bold" />
                </button>
              </div>

              <label className="relative">
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value)}
                  aria-label={t("deepResearchSortLabel")}
                  className="h-10 appearance-none rounded-full border border-(--border-default) bg-(--bg-primary) pl-4 pr-9 text-[12px] font-medium text-(--text-secondary) outline-none hover:bg-(--bg-hover)"
                >
                  <option value="recent">{t("deepResearchSortRecent")}</option>
                  <option value="title">{t("deepResearchSortTitle")}</option>
                </select>
                <CaretDown
                  size={12}
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-(--text-muted)"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  setError("");
                  setComposerOpen(true);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-(--text-primary) px-5 text-[12px] font-semibold text-(--bg-primary) shadow-sm transition hover:opacity-90"
              >
                <Plus size={15} weight="bold" />
                {t("deepResearchNew")}
              </button>
            </div>
          </div>
        </header>

        <section className="mt-9">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-[24px] font-medium tracking-[-0.025em] text-(--text-primary)">
                {t("deepResearchLibraryTitle")}
              </h1>
              <p className="mt-1.5 text-[12px] text-(--text-muted)">
                {loading
                  ? t("deepResearchLoading")
                  : t("deepResearchCount").replace("{n}", String(visibleSessions.length))}
              </p>
            </div>
          </div>

          {error && !composerOpen && !isDetailView ? (
            <div className="mt-5 rounded-xl bg-(--accent-red-bg) px-4 py-3 text-[12px] text-accent-red">
              {error}
            </div>
          ) : null}

          {listEmpty ? (
            <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-(--border-default) px-6 text-center">
              <Lightning size={32} weight="duotone" className="text-(--text-muted)" />
              <div className="mt-3 text-[13px] font-medium text-(--text-secondary)">
                {query ? t("deepResearchNoResults") : t("deepResearchEmpty")}
              </div>
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-(--text-primary) px-4 py-2 text-[12px] font-semibold text-(--bg-primary)"
              >
                <Plus size={14} />
                {t("deepResearchNew")}
              </button>
            </div>
          ) : (
            <div
              className={cn(
                "mt-6",
                viewMode === "grid"
                  ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
                  : "flex flex-col gap-3",
              )}
            >
              {viewMode === "grid" ? (
                <button
                  type="button"
                  onClick={() => setComposerOpen(true)}
                  className="group flex min-h-52 flex-col items-center justify-center rounded-2xl border border-(--border-default) bg-transparent text-(--text-secondary) transition hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="flex size-14 items-center justify-center rounded-full bg-primary/14 text-primary transition group-hover:scale-105">
                    <Plus size={23} weight="bold" />
                  </span>
                  <span className="mt-4 text-[14px] font-medium">{t("deepResearchNew")}</span>
                </button>
              ) : null}
              {visibleSessions.map((item, index) => (
                <ResearchLibraryCard
                  key={item.id}
                  session={item}
                  toneIndex={index}
                  viewMode={viewMode}
                  menuOpen={menuEntryId === item.id}
                  onOpen={actions.openResearchSession}
                  onMenuOpenChange={setMenuEntryId}
                  onDelete={(target) => {
                    setMenuEntryId("");
                    setDeleteTarget(target);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={isDetailView}
        onOpenChange={(open) => {
          if (!open) actions.openResearchHome();
        }}
      >
        <DialogContent
          className="grid h-[calc(100dvh-0.5rem)] max-h-[1040px] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 sm:h-[min(96vh,1040px)] sm:w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-1rem)] xl:max-w-[1560px]"
        >
          <DialogHeader className="shrink-0 px-5 pb-3 pt-5 sm:px-6">
            <DialogTitle className="pr-2 text-[20px] leading-7">
              {session?.question || t("deepResearchLoading")}
            </DialogTitle>
            {session ? (
              <DialogDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", phaseChipClass(session.phase))}>
                  {phaseLabel(session.phase)}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatDate(session.updatedAt)}</span>
              </DialogDescription>
            ) : null}
          </DialogHeader>

          {session ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <DetailBody
                session={session}
                running={running}
                busy={busy}
                error={error}
                liveScouts={liveScouts}
                leadStatus={leadStatus}
                onSavePlan={async (plan) => {
                  await performDetailAction(
                    () => updateResearchPlan(session.id, plan),
                  );
                }}
                onConfirmPlan={async (plan) => {
                  await performDetailAction(async () => {
                    const res = await confirmResearchPlan(session.id, plan);
                    const started = await startResearchRun(session.id, { phase: "investigating" });
                    return started?.session ? started : res;
                  }, { optimisticRunning: true });
                }}
                onReplan={async () => {
                  await performDetailAction(
                    () => startResearchRun(session.id, { phase: "planning" }),
                    { optimisticRunning: true },
                  );
                }}
                onContinue={async () => {
                  await performDetailAction(
                    () => startResearchRun(session.id, { phase: "investigating" }),
                    { optimisticRunning: true },
                  );
                }}
                onWrite={async () => {
                  await performDetailAction(
                    () => startResearchRun(session.id, { phase: "writing" }),
                    { optimisticRunning: true },
                  );
                }}
                onAbort={async () => {
                  await performDetailAction(async () => {
                    const result = await abortResearchRun(session.id);
                    if (!result?.ok) throw new Error(t("deepResearchNothingToStop"));
                    setLeadStatus(t("deepResearchPausing"));
                    return result;
                  });
                }}
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-(--text-muted)">
              {detailLoading ? (
                <>
                  <CircleNotch size={18} className="animate-spin" />
                  {t("deepResearchLoading")}
                </>
              ) : (
                <>
                  <WarningCircle size={24} weight="fill" className="text-accent-red" />
                  <span>{error || t("deepResearchSessionUnavailable")}</span>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center rounded-full border border-(--border-default) px-4 text-[12px] font-medium text-(--text-secondary) hover:bg-(--bg-hover)"
                    onClick={() => actions.openResearchHome()}
                  >
                    {t("deepResearchBackToLibrary")}
                  </button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <GuideComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        busy={busy}
        error={composerOpen ? error : ""}
        onSubmit={handleCreate}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("deepResearchDelete")}
        description={deleteTarget?.question || ""}
        confirmLabel={t("deepResearchDelete")}
        loading={deleting}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
