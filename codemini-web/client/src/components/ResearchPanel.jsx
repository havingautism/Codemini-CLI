import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CaretDown,
  CaretLeft,
  CaretRight,
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

/** Mirrors src/core/research-store RESEARCH_DEPTH_RUNTIME_LIMITS for UI denominators. */
const RESEARCH_TOOLS_PER_CRITERION = 10;
const RESEARCH_DEPTH_RUNTIME_LIMITS = {
  brief: { toolsPerCriterion: RESEARCH_TOOLS_PER_CRITERION, maxWaves: 1 },
  standard: { toolsPerCriterion: RESEARCH_TOOLS_PER_CRITERION, maxWaves: 1 },
  deep: { toolsPerCriterion: RESEARCH_TOOLS_PER_CRITERION, maxWaves: 1 },
};

function researchDepthRuntimeLimits(depth) {
  const key = String(depth || "standard").trim().toLowerCase();
  return RESEARCH_DEPTH_RUNTIME_LIMITS[key] || RESEARCH_DEPTH_RUNTIME_LIMITS.standard;
}

function researchSessionToolsCap(session) {
  return researchDepthRuntimeLimits(session?.plan?.depth).toolsPerCriterion
    || RESEARCH_TOOLS_PER_CRITERION;
}

function researchSessionMaxWaves(session) {
  const fromBudget = Number(session?.budget?.maxWaves);
  if (Number.isFinite(fromBudget) && fromBudget > 0) return fromBudget;
  return researchDepthRuntimeLimits(session?.plan?.depth).maxWaves;
}

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

function coverageHelp(status, toolsCap = 10) {
  const key = {
    covered: "deepResearchTipCovered",
    partial: "deepResearchTipPartial",
    missing: "deepResearchTipMissing",
    conflicted: "deepResearchTipConflicted",
    blocked: "deepResearchTipBlocked",
  }[status];
  if (!key) return "";
  return t(key).replaceAll("{n}", String(toolsCap));
}

function runStatusHelp(status, toolsCap = 10) {
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
  if (!key) return "";
  return t(key).replaceAll("{n}", String(toolsCap));
}

function researchToolHelp(name, toolsCap = 10) {
  if (name === "web_search" || name === "web_fetch") {
    return t("deepResearchTipTools").replaceAll("{n}", String(toolsCap));
  }
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

function splitEmojiTitle(value) {
  const fullTitle = String(value || "").trim();
  if (!fullTitle) return { emoji: "", title: "" };

  const firstGrapheme =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(fullTitle)][0]
          ?.segment || ""
      : Array.from(fullTitle)[0] || "";
  const isEmoji =
    /\p{Extended_Pictographic}/u.test(firstGrapheme) ||
    /\p{Regional_Indicator}/u.test(firstGrapheme);

  if (!isEmoji) return { emoji: "", title: fullTitle };
  return {
    emoji: firstGrapheme,
    title: fullTitle.slice(firstGrapheme.length).trimStart() || fullTitle,
  };
}

function researchDisplayTitle(session) {
  return splitEmojiTitle(session?.title || session?.plan?.title || session?.question || "");
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
  const titleParts = researchDisplayTitle(session);
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
        aria-label={`${t("deepResearchOpen")}: ${titleParts.title || session.question}`}
      />
      <div
        className={cn(
          "pointer-events-none relative z-[1] flex h-full",
          isList ? "items-center gap-4 px-5 py-4 pr-14" : "min-h-52 flex-col px-5 pb-5 pt-5",
        )}
      >
        {titleParts.emoji ? (
          <span
            className={cn(
              "flex shrink-0 items-center justify-center",
              isList ? "size-11 text-[30px]" : "size-14 text-[42px]",
            )}
            aria-hidden="true"
          >
            {titleParts.emoji}
          </span>
        ) : (
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl"
            style={{
              color: "var(--research-tint)",
              backgroundColor: "color-mix(in srgb, var(--research-tint) 20%, transparent)",
            }}
          >
            <Lightning size={25} weight="duotone" aria-hidden="true" />
          </span>
        )}
        <div className={isList ? "min-w-0 flex-1" : "mt-auto min-w-0"}>
          <h3
            className={cn(
              "line-clamp-2 break-words font-medium tracking-[-0.015em] text-(--text-primary)",
              isList ? "text-[15px] leading-5" : "text-[18px] leading-6",
            )}
          >
            {titleParts.title || t("deepResearchUntitled")}
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
  const [contextOpen, setContextOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuestion("");
      setGoal("");
      setConstraints("");
      setSeedText("");
      setContextOpen(false);
    }
  }, [open]);

  const trimmedQuestion = question.trim();
  const contextCount = [goal, constraints, seedText].filter((value) => value.trim()).length;

  const handleSubmit = () => {
    if (busy || !trimmedQuestion) return;
    onSubmit({
      question: trimmedQuestion,
      preferences: { goal: goal.trim(), constraints: constraints.trim() },
      seed: seedText.trim() ? [{ label: "paste", text: seedText.trim() }] : [],
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy || nextOpen) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="flex max-h-[min(760px,calc(100dvh-1rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[660px]"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            handleSubmit();
          }
        }}
      >
        <DialogHeader showCloseButton={!busy} className="shrink-0 border-b border-(--separator) px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-primary/14 text-primary ring-1 ring-primary/15">
              <Lightning size={18} weight="duotone" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{t("deepResearchNew")}</DialogTitle>
              <DialogDescription className="mt-0.5">{t("deepResearchComposerDescription")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <label className="block">
            <span className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-(--text-muted)">
              <span>{t("deepResearchQuestion")}</span>
              <span className="normal-case tracking-normal text-(--text-muted)">{t("deepResearchRequired")}</span>
            </span>
            <textarea
              autoFocus
              rows={4}
              className="min-h-[124px] w-full resize-none rounded-2xl border border-(--border-default) bg-(--bg-secondary)/70 px-4 py-3.5 text-[15px] leading-6 text-(--text-primary) outline-none transition-[border-color,box-shadow,background-color] placeholder:text-(--text-muted) hover:bg-(--bg-secondary) focus:border-primary/45 focus:bg-(--bg-primary) focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_12%,transparent)]"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t("deepResearchQuestionPlaceholder")}
            />
          </label>

          <div className="mt-4 overflow-hidden rounded-2xl border border-(--border-default) bg-(--bg-secondary)/40">
            <button
              type="button"
              aria-expanded={contextOpen}
              aria-controls="deep-research-context-fields"
              onClick={() => setContextOpen((value) => !value)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-(--bg-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--bg-primary) text-(--text-secondary) ring-1 ring-(--border-default)">
                <Target size={15} weight="duotone" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-(--text-primary)">
                  {t("deepResearchAddContext")}
                  {contextCount ? ` · ${contextCount}` : ""}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-(--text-muted)">
                  {t("deepResearchContextHint")}
                </span>
              </span>
              <CaretDown
                size={14}
                weight="bold"
                aria-hidden="true"
                className={cn("shrink-0 text-(--text-muted) transition-transform", contextOpen && "rotate-180")}
              />
            </button>

            {contextOpen ? (
              <div id="deep-research-context-fields" className="grid gap-4 border-t border-(--separator) px-4 py-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-[11px] font-medium text-(--text-secondary)">{t("deepResearchGoal")}</span>
                  <input
                    className="h-10 rounded-xl border border-(--border-default) bg-(--bg-primary) px-3 text-[13px] text-(--text-primary) outline-none transition focus:border-primary/45 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_10%,transparent)]"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder={t("deepResearchGoalPlaceholder")}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-(--text-secondary)">{t("deepResearchConstraints")}</span>
                  <textarea
                    rows={3}
                    className="min-h-[84px] resize-none rounded-xl border border-(--border-default) bg-(--bg-primary) px-3 py-2.5 text-[13px] leading-5 text-(--text-primary) outline-none transition placeholder:text-(--text-muted) focus:border-primary/45 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_10%,transparent)]"
                    value={constraints}
                    onChange={(e) => setConstraints(e.target.value)}
                    placeholder={t("deepResearchConstraintsPlaceholder")}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-(--text-secondary)">{t("deepResearchSeed")}</span>
                  <textarea
                    rows={3}
                    className="min-h-[84px] resize-none rounded-xl border border-(--border-default) bg-(--bg-primary) px-3 py-2.5 text-[13px] leading-5 text-(--text-primary) outline-none transition placeholder:text-(--text-muted) focus:border-primary/45 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_10%,transparent)]"
                    value={seedText}
                    onChange={(e) => setSeedText(e.target.value)}
                    placeholder={t("deepResearchSeedPlaceholder")}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex items-center gap-2.5 rounded-xl px-1 text-[10px] leading-4 text-(--text-muted)">
            <span className="inline-flex items-center gap-1"><Target size={13} />{t("deepResearchStepPlan")}</span>
            <ArrowRight size={11} aria-hidden="true" />
            <span className="inline-flex items-center gap-1"><Globe size={13} />{t("deepResearchStepInvestigate")}</span>
            <ArrowRight size={11} aria-hidden="true" />
            <span className="inline-flex items-center gap-1"><BookOpen size={13} />{t("deepResearchStepReport")}</span>
          </div>

          {error ? (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-(--accent-red-bg) px-3 py-2.5 text-[12px] leading-5 text-accent-red">
              <WarningCircle size={15} weight="fill" className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 items-center border-t border-(--separator) bg-(--bg-secondary)/35 px-5 py-3 sm:justify-between sm:px-6">
          <span className="hidden text-[10px] text-(--text-muted) sm:block">{t("deepResearchSubmitShortcut")}</span>
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <button
            type="button"
            disabled={busy}
            className="h-9 rounded-full px-4 text-[12px] font-medium text-(--text-secondary) transition hover:bg-(--bg-hover) disabled:opacity-40"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !trimmedQuestion}
            className="inline-flex h-9 min-w-[112px] items-center justify-center gap-2 rounded-full bg-(--text-primary) px-4 text-[12px] font-semibold text-(--bg-primary) shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleSubmit}
          >
            {busy ? <CircleNotch size={14} className="animate-spin" /> : <Lightning size={14} weight="bold" />}
            {busy ? t("deepResearchStarting") : t("deepResearchStart")}
          </button>
          </div>
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
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-(--border-default) pb-4">
        <div>
          <div className="text-[11px] font-medium text-(--text-muted)">{t("deepResearchStepPlan")}</div>
          <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-(--text-primary)">
            {session?.question || t("deepResearchUntitled")}
          </h3>
        </div>
        {session?.plan?.depth ? (
          <div className="text-right text-[11px] text-(--text-muted)">
            <ResearchTerm explanation={t("deepResearchTipDepth")}>{t("deepResearchDepth")}</ResearchTerm>
            <span className="ml-2 font-medium text-(--text-secondary)">
              {t(`deepResearchDepth_${session.plan.depth}`) || session.plan.depth}
            </span>
          </div>
        ) : null}
      </div>

      <section className="border-b border-(--border-default) py-5">
        <div className="mb-2 text-[11px] font-medium text-(--text-muted)">{t("deepResearchGoal")}</div>
        {readOnly ? (
          <p className="max-w-3xl text-[13px] leading-6 text-(--text-secondary)">{goal || "—"}</p>
        ) : (
          <input
            className="h-10 w-full rounded-lg border border-(--border-default) bg-(--bg-primary) px-3 text-[13px] text-(--text-primary) outline-none focus:border-primary/40"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        )}
      </section>

      <div className="divide-y divide-(--border-default)">
        {questions.map((q, index) => (
          <section
            key={q.tempId || q.id || index}
            className="grid gap-3 py-5 sm:grid-cols-[36px_minmax(0,1fr)]"
          >
            <div className="pt-0.5 text-[12px] tabular-nums text-(--text-muted)">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="min-w-0">
              {readOnly ? (
                <h4 className="text-[14px] font-medium leading-6 text-(--text-primary)">{q.text || "—"}</h4>
              ) : (
                <textarea
                  className="min-h-[72px] w-full resize-y rounded-lg border border-(--border-default) bg-(--bg-primary) px-3 py-2.5 text-[13px] leading-5 text-(--text-primary) outline-none focus:border-primary/40"
                  value={q.text || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setQuestions((current) => current.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, text: value } : item
                    )));
                  }}
                />
              )}
              {normalizeCriteriaList(q.successCriteria).length ? (
                <div className="mt-3">
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-(--text-muted)">
                  <ResearchTerm explanation={t("deepResearchTipPriority")}>
                    {t("deepResearchCriteria")}
                  </ResearchTerm>
                  </div>
                  <ul className="space-y-1.5">
                  {normalizeCriteriaList(q.successCriteria).map((criterion, criterionIndex) => (
                    <li
                      key={`${criterion.text}-${criterionIndex}`}
                      title={criterion.text}
                      className="grid min-w-0 grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-2 text-[11px] leading-5"
                    >
                      <span className="mt-2 size-1 rounded-full bg-(--text-muted)" aria-hidden="true" />
                      <span className="min-w-0 text-(--text-secondary)">{criterion.text}</span>
                      <span className="shrink-0 text-[10px] text-(--text-muted)">{priorityLabel(criterion.priority)}</span>
                    </li>
                  ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-(--border-default) pt-4">
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-9 items-center rounded-lg border border-(--border-default) px-3.5 text-[12px] font-medium text-(--text-secondary) hover:bg-(--bg-hover) disabled:opacity-40"
            onClick={() => onSave(draft)}
          >
            {t("deepResearchSavePlan")}
          </button>
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-9 items-center rounded-lg bg-(--text-primary) px-4 text-[12px] font-semibold text-(--bg-primary) disabled:opacity-40"
            onClick={() => onConfirm(draft)}
          >
            {t("deepResearchApproveAndStart")}
          </button>
          <button
            type="button"
            disabled={busy}
            className="inline-flex h-9 items-center rounded-lg border border-(--border-default) px-3.5 text-[12px] font-medium text-(--text-secondary) hover:bg-(--bg-hover) disabled:opacity-40"
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
  const fromCoverage = (question?.coverage?.criteria || []).find((item) => item.id === id);
  if (fromCoverage?.text) return shortResearchLabel(fromCoverage.text);
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

/** Map persisted/runtime names (Scout N / Investigator N) to the active locale. */
function formatScoutLabel(name, translate = t) {
  const raw = String(name || "").trim();
  const matched = raw.match(/^(?:Scout|Investigator|调查员)\s+(\d+)$/i);
  if (matched) return translate("deepResearchScoutNamed").replace("{n}", matched[1]);
  if (!raw || /^(?:Scout|Investigator|调查员)$/i.test(raw)) return translate("deepResearchScout");
  return raw;
}

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
    coverage: live?.coverage || scout?.coverage || live?.ledger?.criteria || scout?.ledger?.criteria || [],
    tools: live?.tools || [],
    handoff: live?.handoff || scout?.handoffMarkdown || "",
    error: live?.error || scout?.error || "",
    activeCriterionId: live?.activeCriterionId || live?.criterionId || "",
  };
}

function ScoutCard({
  scout,
  question,
  live,
  toolsCap = 10,
  evidence = [],
}) {
  const card = mergeScoutCard(scout, live);
  const criteria = Array.isArray(card.coverage) && card.coverage.length
    ? card.coverage
    : Array.isArray(question?.coverage?.criteria)
      ? question.coverage.criteria
      : [];
  const acceptedEvidence = (evidence || []).filter((item) =>
    item.status === "accepted" && item.questionId === (card.questionId || question?.id));
  const status = card.status || "running";
  const running = status === "running";
  const failed = status === "failed" || status === "error" || status === "blocked";
  const completed = status === "done";
  const partial = status === "partial";
  const cap = Math.max(1, Math.floor(Number(toolsCap) || RESEARCH_TOOLS_PER_CRITERION));
  const liveTools = Number(card.toolsUsed);
  const criterionToolsTip = t("deepResearchTipCriterionTools").replaceAll("{n}", String(cap));
  const activeCriterionId = String(card.activeCriterionId || "");

  return (
    <details
      open={running || failed}
      className="group/scout border-b border-(--border-default) last:border-b-0"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-1 py-3.5 [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center",
            running && "text-sky-600 dark:text-sky-300",
            completed && "text-emerald-700 dark:text-emerald-300",
            partial && "text-amber-800 dark:text-amber-300",
            failed && "text-red-700 dark:text-red-300",
          )}
        >
          {running ? (
            <CircleNotch size={14} className="animate-spin" />
          ) : failed || partial ? (
            <WarningCircle size={14} weight="fill" />
          ) : (
            <CheckCircle size={14} weight="fill" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-(--text-primary)">
            {question?.text || card.questionText || formatScoutLabel(card.name)}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-(--text-muted)">
            <ResearchTerm explanation={t("deepResearchTipScout")}>
              {formatScoutLabel(card.name)}
            </ResearchTerm>
            {activeCriterionId ? (
              <ResearchTerm explanation={t("deepResearchTipCheckpoint")}>
                {activeCriterionId}
              </ResearchTerm>
            ) : null}
            <ResearchTerm explanation={researchToolHelp("web_search", cap)}>
              {Number.isFinite(liveTools) ? liveTools : (card.searchCount || 0) + (card.fetchCount || 0)}
              /{cap} {t("deepResearchToolsLabel").toLowerCase()}
            </ResearchTerm>
            <ResearchTerm explanation={t("deepResearchTipEvidence")}>
              {acceptedEvidence.length} {t("deepResearchEvidenceLabel").toLowerCase()}
            </ResearchTerm>
          </span>
        </span>
        <span className="text-[10px] font-medium text-(--text-muted)">
          <ResearchTerm explanation={runStatusHelp(status, cap)}>{status}</ResearchTerm>
        </span>
        <CaretDown
          size={14}
          className="shrink-0 text-(--text-muted) transition-transform group-open/scout:rotate-180"
        />
      </summary>

      <div className="border-t border-(--separator) px-8 py-4">
        {criteria.length ? (
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-(--text-muted)">
              <ResearchTerm explanation={t("deepResearchTipCoverage")}>
                {t("deepResearchCoverage")}
              </ResearchTerm>
            </div>
            <div className="divide-y divide-(--separator)">
              {criteria.map((criterion) => {
                const isActive = running && criterion.id === activeCriterionId;
                const used = isActive && Number.isFinite(liveTools)
                  ? liveTools
                  : (Number(criterion.toolCount) || 0);
                const atCap = used >= cap;
                return (
                  <div
                    key={criterion.id}
                    title={criterion.text}
                    className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-[10px]", isActive && "text-sky-700 dark:text-sky-300")}
                  >
                    <ResearchTerm
                      explanation={`${coverageHelp(criterion.status, cap)} ${criterionToolsTip}`}
                      className="min-w-0 text-(--text-secondary)"
                    >
                      {criterion.text || criterion.id}
                    </ResearchTerm>
                    <span className="shrink-0 tabular-nums text-(--text-muted)">
                      {criterion.status} · {used}/{cap}{atCap ? ` · ${t("deepResearchSearchCapReached")}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {card.error ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-500/[0.07] px-3 py-2 text-[11px] leading-5 text-red-700 dark:text-red-200">
            <WarningCircle size={14} className="mt-0.5 shrink-0" weight="fill" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{card.error}</span>
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

        {acceptedEvidence.length ? (
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-(--text-muted)">
              <ResearchTerm explanation={t("deepResearchTipEvidence")}>
                {t("deepResearchEvidence")}
              </ResearchTerm>
            </div>
            <div className="space-y-2">
              {acceptedEvidence.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-xl border border-(--border-default) bg-(--bg-secondary)/35 px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <Database size={13} className="mt-0.5 shrink-0 text-(--text-muted)" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] leading-5 text-(--text-primary)">{item.claim}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-(--text-muted)">
                        <span>{item.id}</span>
                        {item.criterionIds?.length ? (
                          <>
                            <span>·</span>
                            <span>{item.criterionIds.join(", ")}</span>
                          </>
                        ) : null}
                        {item.url ? (
                          <>
                            <span>·</span>
                            <span className="truncate">{item.url}</span>
                          </>
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

function InvestigationBoard({
  waves = [],
  timeline = [],
  questions = [],
  evidence = [],
  liveScouts = {},
  leadStatus = "",
  toolsCap = 10,
}) {
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
      <div className="border-y border-dashed border-(--border-default) px-6 py-12 text-center">
        <Target size={28} weight="duotone" className="mx-auto text-(--text-muted)" />
        <div className="mt-3 text-[12px] text-(--text-muted)">{t("deepResearchTimelineEmpty")}</div>
      </div>
    );
  }

  return (
    <div>
      {leadStatus ? (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-(--border-default) bg-(--bg-primary)/95 px-1 py-2.5 text-[11px] text-(--text-secondary) backdrop-blur-xl">
          <CircleNotch size={13} className="animate-spin text-(--text-muted)" />
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
              coverage: live.coverage || [],
            });
          }
        }
        const completed = scouts.filter((scout) => TERMINAL_SCOUT_STATUSES.has(scout.status)).length;
        const evaluation = wave.evaluation || {};
        const evaluationReason = humanizeResearchText(evaluation.reason || "", questions);
        const coveredQuestions = questions.filter((question) =>
          (question.coverage?.criteria || []).length
          && (question.coverage.criteria || []).every((item) => item.status === "covered")).length;
        return (
          <section key={wave.id || `${wave.wave}-${index}`} className="border-t border-(--border-default) first:border-t-0">
              <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-(--text-primary)">
                      <ResearchTerm explanation={t("deepResearchTipWave")}>
                        {t("deepResearchInvestigationTitle")}
                      </ResearchTerm>
                    </span>
                    <span className="text-[10px] font-medium text-(--text-muted)">
                      <ResearchTerm explanation={runStatusHelp(wave.status)}>
                        {wave.status}
                      </ResearchTerm>
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-(--text-muted)">
                    {completed}/{Math.max(scouts.length, wave.targets?.length || 0)}{" "}
                    <ResearchTerm explanation={t("deepResearchTipScout")}>
                      {t("deepResearchWavesLabel")}
                    </ResearchTerm>
                    {" · "}
                    {coveredQuestions}/{questions.length || 0}{" "}
                    <ResearchTerm explanation={t("deepResearchTipQuestions")}>
                      {t("deepResearchQuestionsLabel").toLowerCase()}
                    </ResearchTerm>
                    {" · "}
                    {evidence.filter((item) => item.status === "accepted").length}{" "}
                    <ResearchTerm explanation={t("deepResearchTipEvidence")}>
                      {t("deepResearchEvidenceLabel").toLowerCase()}
                    </ResearchTerm>
                  </div>
                </div>
                {evaluation.decision ? (
                  <div className="flex max-w-xl items-start gap-2 text-[10px] leading-5 text-(--text-secondary)">
                    {evaluation.decision === "incomplete" ? (
                      <WarningCircle size={13} weight="fill" className="mt-0.5 shrink-0 text-red-600" />
                    ) : (
                      <CheckCircle size={13} weight="fill" className="mt-0.5 shrink-0 text-emerald-600" />
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
              <div className="border-t border-(--separator)">
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
                  return (
                    <ScoutCard
                      key={scout.id || scout.questionId}
                      scout={scout}
                      question={questionById.get(scout.questionId)}
                      live={liveForCard}
                      toolsCap={toolsCap}
                      evidence={evidence}
                    />
                  );
                }) : (
                  <div className="px-2 py-6 text-center text-[11px] text-(--text-muted)">
                    {t("deepResearchWaitingHandoff")}
                  </div>
                )}
              </div>
          </section>
        );
      })}
    </div>
  );
}

function QuestionsBoard({ questions = [] }) {
  return (
    <section className="min-w-0 overflow-hidden">
      <div className="mb-2 text-[12px] font-semibold text-(--text-primary)">
        <ResearchTerm explanation={t("deepResearchTipQuestions")}>
          {t("deepResearchQuestions")}
        </ResearchTerm>
      </div>
      {!questions.length ? (
        <div className="text-[12px] text-(--text-muted)">—</div>
      ) : (
        <div className="divide-y divide-(--separator) border-y border-(--border-default)">
          {questions.map((q, index) => (
          <div key={q.id} className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] gap-2 py-2.5">
            <span className="text-[10px] tabular-nums text-(--text-muted)">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <div className="break-words text-[11px] leading-5 text-(--text-primary) [overflow-wrap:anywhere]">
                {q.text}
              </div>
              {q.gaps?.length ? (
                <div className="mt-1 break-words text-[10px] leading-4 text-amber-700 [overflow-wrap:anywhere] dark:text-amber-300">
                  <ResearchTerm explanation={t("deepResearchTipGaps")}>gaps</ResearchTerm>
                  {`: ${q.gaps.join("; ")}`}
                </div>
              ) : null}
            </div>
              <span className="shrink-0 text-[10px] font-medium text-(--text-muted)">
                <ResearchTerm explanation={runStatusHelp(q.status)}>{q.status}</ResearchTerm>
              </span>
          </div>
          ))}
        </div>
      )}
    </section>
  );
}

function sourceHostname(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "").replace(/^https?:\/\//, "").split("/")[0] || "";
  }
}

const EVIDENCE_PAGE_SIZE = 9; // 3 cols × 3 rows

function EvidenceList({ evidence = [], title, countLabel }) {
  const [page, setPage] = useState(0);
  const accepted = evidence.filter((ev) => ev.status === "accepted");
  const totalPages = Math.max(1, Math.ceil(accepted.length / EVIDENCE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const showPager = accepted.length > EVIDENCE_PAGE_SIZE;
  const visible = showPager
    ? accepted.slice(safePage * EVIDENCE_PAGE_SIZE, (safePage + 1) * EVIDENCE_PAGE_SIZE)
    : accepted;
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
              {(countLabel || t("deepResearchSourcesCount")).replace("{n}", String(accepted.length))}
            </div>
          ) : null}
        </div>
      </div>
      {!accepted.length ? (
        <div className="rounded-2xl border border-dashed border-(--border-default) px-4 py-8 text-center text-[12px] text-(--text-muted)">
          {t("deepResearchNoEvidence")}
        </div>
      ) : (
        <>
          <div className="grid gap-x-8 sm:grid-cols-2">
            {visible.map((ev) => {
              const host = sourceHostname(ev.url);
              return (
                <article
                  key={ev.id}
                  className="group flex min-w-0 flex-col border-t border-(--border-default) py-3.5"
                >
                  <div className="mb-1.5 flex min-w-0 items-center gap-2 text-[10px] text-(--text-muted)">
                    <span className="shrink-0 font-medium">
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
                  <p className="line-clamp-4 text-[11px] leading-5 text-(--text-secondary) [overflow-wrap:anywhere]">
                    {ev.claim}
                  </p>
                  {ev.url ? (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex max-w-full items-center gap-1 truncate text-[10px] text-(--text-secondary) hover:text-(--text-primary) hover:underline"
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
          {showPager ? (
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={safePage <= 0}
                onClick={() => setPage(safePage - 1)}
                className="inline-flex size-8 items-center justify-center rounded-full border border-(--border-default) bg-(--bg-primary) text-(--text-secondary) hover:bg-(--bg-hover) disabled:pointer-events-none disabled:opacity-35"
                aria-label="Previous page"
              >
                <CaretLeft size={14} />
              </button>
              <span className="min-w-12 text-center text-[12px] tabular-nums text-(--text-muted)">
                {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
                className="inline-flex size-8 items-center justify-center rounded-full border border-(--border-default) bg-(--bg-primary) text-(--text-secondary) hover:bg-(--bg-hover) disabled:pointer-events-none disabled:opacity-35"
                aria-label="Next page"
              >
                <CaretRight size={14} />
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ResearchMetrics({ session }) {
  const questions = session?.questions || [];
  const evidence = (session?.evidence || []).filter((item) => item.status === "accepted");
  const waves = session?.waves || [];
  const covered = questions.filter((question) => question.status === "done").length;
  const metrics = [
    {
      label: t("deepResearchQuestions"),
      help: t("deepResearchTipQuestions"),
      value: `${covered}/${questions.length}`,
    },
    {
      label: t("deepResearchEvidence"),
      help: t("deepResearchTipEvidence"),
      value: evidence.length,
    },
    {
      label: t("deepResearchWavesLabel"),
      help: t("deepResearchTipScout"),
      value: `${Math.max(waves.flatMap((wave) => wave.scouts || []).filter((scout) =>
        ["done", "partial", "blocked", "failed", "aborted"].includes(scout.status)).length, covered)}/${Math.max(questions.length, 1)}`,
    },
  ];
  return (
    <div className="border-y border-(--border-default)">
      <div className="grid grid-cols-3 divide-x divide-(--separator)">
        {metrics.map((metric) => {
          return (
            <div key={metric.label} className="min-w-0 px-3 py-3 first:pl-0 sm:px-4">
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold tabular-nums text-(--text-primary)">
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
    </div>
  );
}

function LimitationsBoard({ limitations = [], questions = [] }) {
  return (
    <section className="min-w-0 overflow-hidden">
      <div className="mb-2 text-[12px] font-semibold text-(--text-primary)">
        <ResearchTerm explanation={t("deepResearchTipLimitations")}>
          {t("deepResearchLimitations")}
        </ResearchTerm>
      </div>
      {!limitations.length ? (
        <div className="text-[12px] text-(--text-muted)">{t("deepResearchNoLimitations")}</div>
      ) : (
        <div className="divide-y divide-(--separator) border-y border-(--border-default)">
          {limitations.map((item, index) => (
          <div
            key={`${item.questionId}-${item.criterionId}-${index}`}
            className="min-w-0 overflow-hidden py-2.5"
          >
            <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-(--text-muted)">
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {formatResearchRef(item.questionId, item.criterionId, questions)}
              </span>
              {item.status ? (
                <span className="font-medium text-(--text-muted)">
                  {item.status}
                </span>
              ) : null}
            </div>
            <div className="break-words text-[12px] leading-5 text-amber-900 [overflow-wrap:anywhere] dark:text-amber-100">
              {humanizeResearchText(item.gap || item.reason || item.text || "—", questions)}
            </div>
          </div>
          ))}
        </div>
      )}
    </section>
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
  const displayTitle = researchDisplayTitle(session);
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
          <div className="mx-auto w-full max-w-6xl space-y-6">
            <header className="border-b border-(--border-default) pb-5">
              <div className="max-w-4xl">
                <div className="text-[10px] font-medium text-(--text-muted)">
                  {t("deepResearchQuestion")}
                </div>
                <h3 className="mt-1 text-[18px] font-semibold leading-7 tracking-[-0.02em] text-(--text-primary)">
                  {session?.question}
                </h3>
                {session?.preferences?.goal ? (
                  <p className="mt-2 max-w-3xl text-[11px] leading-5 text-(--text-secondary)">
                    {session.preferences.goal}
                  </p>
                ) : null}
              </div>
            </header>
            <ResearchMetrics session={session} />
            {readyForReport && investigating ? (
              <div className="flex flex-col gap-3 border-b border-(--border-default) pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5">
                  <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-emerald-600" />
                  <div>
                    <div className="text-[12px] font-medium text-(--text-primary)">
                      {t("deepResearchReadyTitle")}
                    </div>
                    <div className="mt-0.5 text-[10px] text-(--text-muted)">
                      {t("deepResearchReadyDescription")}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onWrite}
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-(--text-primary) px-3 text-[11px] font-semibold text-(--bg-primary) hover:opacity-90 disabled:opacity-40"
                >
                  <BookOpen size={14} />
                  {t("deepResearchWriteReport")}
                </button>
              </div>
            ) : null}
            {incomplete ? (
              <div className="flex items-start gap-2.5 border-b border-(--border-default) pb-5">
                <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-red-600" />
                <div>
                  <div className="text-[12px] font-medium text-(--text-primary)">
                    {t("deepResearchIncompleteTitle")}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-5 text-(--text-secondary)">
                    {humanizeResearchText(
                      latestEvaluation.reason || "",
                      session?.questions || [],
                    ) || t("deepResearchIncompleteDescription")}
                  </div>
                </div>
              </div>
            ) : null}

            <section>
              <div className="mb-2">
                <div className="text-[13px] font-semibold text-(--text-primary)">
                  <ResearchTerm explanation={t("deepResearchTipTimeline")}>
                    {t("deepResearchTimeline")}
                  </ResearchTerm>
                </div>
                <div className="mt-0.5 text-[10px] text-(--text-muted)">
                  {t("deepResearchWaveSemanticDescription")}
                </div>
              </div>
              <InvestigationBoard
                waves={session?.waves || []}
                timeline={session?.timeline || []}
                questions={session?.questions || []}
                evidence={session?.evidence || []}
                liveScouts={liveScouts}
                leadStatus={running ? leadStatus : ""}
                toolsCap={researchSessionToolsCap(session)}
              />
            </section>

            <div className="flex flex-col gap-6 border-t border-(--border-default) pt-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <QuestionsBoard questions={session?.questions || []} />
                <LimitationsBoard
                  limitations={latestWaveLimitations(session)}
                  questions={session?.questions || []}
                />
              </div>
              <EvidenceList
                evidence={session?.evidence || []}
                countLabel={t("deepResearchEvidenceCount")}
              />
            </div>
          </div>
        ) : null}

        {showReport ? (
          <article className="mx-auto flex w-full max-w-[860px] flex-col gap-10 pb-8">
            <div>
              <header className="border-b border-(--border-default) pb-4">
                <div className="text-[10px] font-medium text-(--text-muted)">
                  {t("deepResearchStepReport")}
                </div>
                <div className="mt-1 text-[16px] font-semibold tracking-[-0.02em] text-(--text-primary)">
                  {displayTitle.title || t("deepResearchUntitled")}
                </div>
              </header>
              <div className="pt-7">
                {session?.reportMarkdown ? (
                  <MarkdownPreview value={session.reportMarkdown} className="max-w-none [&_h1]:tracking-[-0.025em] [&_h2]:tracking-[-0.02em]" />
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
              />
            ) : null}

            {(session?.waves?.length || session?.timeline?.length) ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--border-default) pt-4">
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
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-(--border-default) bg-(--bg-primary) px-3 text-[11px] font-medium text-(--text-secondary) hover:bg-(--bg-hover)"
                  onClick={() => setFocusStep("investigate")}
                >
                  <ListBullets size={14} />
                  {t("deepResearchViewTimeline")}
                </button>
              </div>
            ) : null}
          </article>
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
          name: t("deepResearchScout"),
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
              toolsUsed: payload.scoutUsed?.tools
                ?? payload.toolsUsed
                ?? current.toolsUsed,
              toolsCap: payload.scoutUsed?.toolsCap
                ?? payload.toolsCap
                ?? current.toolsCap,
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
            name: payload.name || t("deepResearchScout"),
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
              `${formatScoutLabel(payload.scoutName)} · ${payload.displayName || payload.name || "tool"}`,
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
          if (payload.type === "criterion:start" || payload.type === "scout:checkpoint_start") {
            upsertLiveScout(key, (current) => ({
              ...current,
              cycle: payload.cycle,
              activeCriterionId: payload.criterionId
                || payload.targetGap?.criterionId
                || current.activeCriterionId,
              nextGap: payload.targetGap || current.nextGap,
              toolsCap: payload.toolsCap ?? current.toolsCap,
              toolsUsed: 0,
              criterionId: payload.criterionId
                || payload.targetGap?.criterionId
                || current.criterionId,
            }));
            setLeadStatus(
              `${formatScoutLabel(payload.scoutName)} · ${
                payload.criterionId || payload.targetGap?.criterionId || t("deepResearchCriterionPass")
              }`,
            );
          }
          if (payload.type === "criterion:coverage" || payload.type === "scout:checkpoint") {
            upsertLiveScout(key, (current) => ({
              ...current,
              cycle: payload.cycle,
              coverage: payload.coverage?.criteria || payload.coverage || current.coverage,
              nextGap: payload.nextGap || null,
              candidateCount: payload.candidateCount ?? current.candidateCount,
              searchCount: payload.searchCount ?? current.searchCount,
              fetchCount: payload.fetchCount ?? current.fetchCount,
              toolsUsed: payload.toolsUsed ?? payload.toolCount ?? current.toolsUsed,
              toolsCap: payload.toolsCap ?? current.toolsCap,
              activeCriterionId: payload.criterionId || current.activeCriterionId,
              status: payload.type === "criterion:coverage"
                ? "running"
                : (payload.decision === "continue" ? "running" : payload.decision),
            }));
            loadSession(selectedId).catch(() => {});
          }
          if (payload.type === "evidence:accepted" || payload.type === "finding") {
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
            coverage: payload.coverage?.criteria || payload.coverage || current.coverage,
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
            payload.evaluation?.decision === "incomplete"
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
          <DialogHeader className="shrink-0 border-b border-(--separator) bg-(--material-elevated) px-5 py-4 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              {researchDisplayTitle(session).emoji ? (
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center text-[25px]" aria-hidden="true">
                  {researchDisplayTitle(session).emoji}
                </span>
              ) : (
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-primary/14 text-primary ring-1 ring-primary/15">
                  <Lightning size={18} weight="duotone" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <DialogTitle className="line-clamp-2 pr-2 text-[17px] leading-6">
                  {researchDisplayTitle(session).title || t("deepResearchLoading")}
                </DialogTitle>
                {session ? (
                  <DialogDescription className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", phaseChipClass(session.phase))}>
                      {phaseLabel(session.phase)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(session.updatedAt)}</span>
                  </DialogDescription>
                ) : null}
              </div>
            </div>
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
