import { useState } from "react";
import { CaretDown, CaretRight, ListChecks } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { LinearRing, LinearStatusDot } from "@/components/ui/spinner";
import { PlanStepStatusGlyph } from "@/components/plan-step-icons.jsx";
import { ROLE_BADGE_CLASS, ROLE_PILLS } from "@/components/PlanProgress.jsx";
import { StreamdownRenderer } from "@/components/StreamdownRenderer.jsx";
import { ToolCard } from "@/components/ToolCard.jsx";
import { cn } from "@/lib/utils";
import {
  planPhaseTitle,
  shouldExpandPlanStep,
} from "@/lib/plan-ui-state.js";
import { t } from "../../i18n/index.js";

const COLLAPSE_ROW_CLASS =
  "flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[12px] text-(--text-muted) hover:bg-(--bg-tertiary)/50";

function isProcessSegment(segment) {
  return segment?.type === "thinking" || segment?.type === "tools";
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
  // Stay collapsed by default — even while tools run or wait for approval —
  // so review prompts do not flash the fold open.
  const open = expanded;
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
        return name === "run" || name.startsWith("run(");
      }).length
    );
  }, 0);
  const thoughtCount = segments.filter((item) => item.type === "thinking").length;
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
        className={COLLAPSE_ROW_CLASS}
        aria-expanded={open}
      >
        {open ? <CaretDown size={13} /> : <CaretRight size={13} />}
        <span className="inline-flex h-4 w-4 items-center justify-center">
          <span className="inline-block size-1.5 rounded-full bg-(--accent-green)" />
        </span>
        <span>{label}</span>
        {details ? (
          <span className="min-w-0 truncate opacity-70">{details}</span>
        ) : null}
      </button>
      {open && (
        <div className="relative ml-3.5 mt-1.5 flex flex-col gap-1.5 border-l border-(--border-default) pl-3">
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
                    />
                  ))}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
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
        className={COLLAPSE_ROW_CLASS}
        aria-expanded={open}
      >
        <CaretRight
          size={13}
          className={cn("transition-transform", open && "rotate-90")}
        />
        <span className="inline-flex h-4 w-4 items-center justify-center">
          <span className="inline-block size-1.5 rounded-full bg-(--accent-blue)" />
        </span>
        <span className="font-medium text-(--text-secondary)">Handoff</span>
        <span className="min-w-0 flex-1 truncate">{preview}</span>
      </button>
      {open && (
        <div className="relative ml-3.5 mt-1.5 border-l border-(--border-default) pl-3 text-[13px] leading-relaxed text-(--text-secondary)">
          <StreamdownRenderer text={text} streaming={false} inlineEmbeds={false} />
        </div>
      )}
    </div>
  );
}

function StepBody({ step }) {
  const segments = Array.isArray(step?.segments) ? step.segments : [];
  const { process, answers } = splitStepSegments(segments);
  const hasContent = process.length > 0 || answers.length > 0 || Boolean(step?.summary);

  if (!hasContent) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-(--text-muted)">
        {step?.status === "running" ? (
          <>
            <LinearRing size="sm" />
            <span>{t("thinking")}</span>
          </>
        ) : (
          "—"
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-(--border-default)/50 px-2.5 py-2">
      {process.length > 0 && <StepProcessFold segments={process} />}
      {answers.map((segment, index) => (
        <StepAnswer key={`ans-${index}`} segment={segment} />
      ))}
      {step?.summary && answers.length === 0 && (
        <div className="text-[12px] whitespace-pre-wrap text-(--text-secondary)">
          {step.summary}
        </div>
      )}
    </div>
  );
}

function PlanStepRow({ step, index }) {
  const status = String(step?.status || "pending").toLowerCase();
  const defaultExpanded = shouldExpandPlanStep(step);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const open = status === "running" ? true : expanded;

  return (
    <div className="overflow-hidden rounded-lg border border-(--border-default)/80 bg-(--bg-primary)/35">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px]"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={open}
      >
        {open ? (
          <CaretDown size={14} className="shrink-0 text-(--text-muted)" />
        ) : (
          <CaretRight size={14} className="shrink-0 text-(--text-muted)" />
        )}
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
            "codemini-linear-step",
            status === "done" && "codemini-linear-step--done",
            status === "failed" && "codemini-linear-step--failed",
            status === "running" && "codemini-linear-step--running",
          )}
        >
          <PlanStepStatusGlyph step={step} index={index} />
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
        <span className="min-w-0 flex-1 truncate text-[13px] text-(--text-secondary)">
          {step.title || `Step ${index + 1}`}
        </span>
      </button>
      {open && <StepBody step={step} />}
    </div>
  );
}

export function PlanToolCard({ card }) {
  const planRun = card?.planRun || null;
  const phase = planRun?.phase || (card?.status === "done" ? "completed" : "planning");
  const title = card?.displayName || planPhaseTitle(phase);
  const goal =
    planRun?.goal ||
    String(card?.arguments?.goal || "").trim() ||
    String(card?.summary || "").trim();
  const steps = Array.isArray(planRun?.steps) ? planRun.steps : [];
  const running = card?.status === "running" || phase === "executing" || phase === "planning";
  const current = steps.find((step) => String(step.status).toLowerCase() === "running");

  return (
    <div className="codemini-message-surface codemini-plan-tool-card my-3 w-full max-w-4xl overflow-hidden rounded-xl border border-(--border-default)">
      <div className="flex items-start gap-3 border-b border-(--border-default)/80 px-4 py-3.5">
        <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center text-(--text-secondary)">
          {running ? <LinearStatusDot /> : <ListChecks size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-(--text-primary)">
              {title}
            </span>
            {current?.title ? (
              <span className="truncate text-[12px] text-(--text-muted)">
                {String(current.role || "").toUpperCase()} · {current.title}
              </span>
            ) : null}
          </div>
          {goal ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-(--text-secondary)">
              {goal}
            </p>
          ) : null}
        </div>
      </div>
      {steps.length > 0 ? (
        <div className="flex flex-col gap-2 p-3.5">
          {steps.map((step, index) => (
            <PlanStepRow
              key={`${step.index || index}-${step.role || "step"}`}
              step={step}
              index={index}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-[13px] text-(--text-muted)">
          {running ? t("thinking") : null}
        </div>
      )}
    </div>
  );
}
