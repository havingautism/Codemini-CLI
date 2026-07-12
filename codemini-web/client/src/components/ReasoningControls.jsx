import React, { useEffect, useRef, useState } from "react";
import { Brain } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { t } from "../../i18n/index.js";
import {
  clearSettledReasoningGesture,
  REASONING_EFFORT_LEVELS,
  getReasoningEffortAccent,
  getReasoningEffortAccentText,
  getReasoningEffortFillRatio,
  getReasoningEffortFlowDuration,
  getReasoningEffortFromRatio,
  getReasoningEffortLabel,
  getReasoningEffortRatioFromClientX,
  getReasoningEffortShortLabel,
  normalizeReasoningEffort,
  normalizeReasoningEnabled,
} from "@/lib/reasoning-controls.js";
import * as api from "@/hooks/use-api";
import { useApp } from "@/context/app-context.jsx";

const INPUT_PILL_CLASS =
  "codemini-input-pill border-0 bg-(--badge-bg) text-(--text-secondary) h-7 rounded-md inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer text-[11px] sm:text-[12px] whitespace-nowrap transition-all shadow-[0_1px_2px_color-mix(in_srgb,black_5%,transparent)] hover:bg-(--bg-hover) hover:text-(--text-primary) hover:shadow-[0_1px_3px_color-mix(in_srgb,black_10%,transparent)]";

export function ReasoningEffortStepper({
  value,
  onChange,
  disabled = false,
  compact = false,
  idPrefix = "reasoning-effort",
}) {
  const trackRef = useRef(null);
  const activePointerRef = useRef(null);
  // Continuous thumb position while dragging; snapped level for color/labels.
  // Kept after release until `value` catches up so async persist doesn't jump back.
  const [gesture, setGesture] = useState(null);

  const current = normalizeReasoningEffort(value);
  const display = gesture?.level ?? current;
  const fillRatio =
    gesture?.ratio ?? getReasoningEffortFillRatio(display);
  const dragging = gesture?.dragging === true;
  const accent = getReasoningEffortAccent(display);
  const accentText = getReasoningEffortAccentText(display);
  const flowDuration = getReasoningEffortFlowDuration(display);
  const levelCount = REASONING_EFFORT_LEVELS.length;
  // Half thumb (size-5 = 20px) — keeps thumb + fill aligned inside the control.
  const thumbPad = 10;
  const showFlow = fillRatio > 0.02;

  useEffect(() => {
    if (!gesture || gesture.dragging) return;
    if (current === gesture.level) {
      setGesture(null);
    }
  }, [current, gesture]);

  const readRatio = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return getReasoningEffortRatioFromClientX(clientX, rect);
  };

  const handleTrackPointerDown = (event) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ratio = readRatio(event.clientX);
    setGesture({
      ratio,
      level: getReasoningEffortFromRatio(ratio),
      dragging: true,
    });
  };

  const handleTrackPointerMove = (event) => {
    if (activePointerRef.current !== event.pointerId) return;
    const ratio = readRatio(event.clientX);
    setGesture({
      ratio,
      level: getReasoningEffortFromRatio(ratio),
      dragging: true,
    });
  };

  const finishTrackPointer = (event) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const ratio = readRatio(event.clientX);
    const next = getReasoningEffortFromRatio(ratio);
    const snappedRatio = getReasoningEffortFillRatio(next);
    // Snap to stop with transition; keep level until prop syncs.
    setGesture({ ratio: snappedRatio, level: next, dragging: false });
    if (next !== current) {
      commitChange(next);
    }
  };

  const cancelTrackPointer = (event) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    setGesture(null);
  };

  const commitChange = (next) => {
    const result = onChange?.(next);
    const clearGesture = () => {
      setGesture((active) => clearSettledReasoningGesture(active, next));
    };
    Promise.resolve(result).then(clearGesture, clearGesture);
  };

  const handleLabelClick = (level) => {
    if (disabled) return;
    setGesture({
      ratio: getReasoningEffortFillRatio(level),
      level,
      dragging: false,
    });
    if (level !== current) {
      commitChange(level);
    }
  };

  return (
    <div
      className="w-full"
      role="group"
      aria-label={t("reasoningEffort")}
      style={{
        "--reasoning-effort-accent": accent,
        "--reasoning-effort-accent-text": accentText,
        "--reasoning-flow-duration": flowDuration,
      }}
    >
      <div
        className={cn("relative w-full touch-none", compact ? "h-9" : "h-10")}
      >
        {/* Thick pill track */}
        <div
          className="pointer-events-none absolute top-1/2 h-4 -translate-y-1/2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_8%,var(--bg-secondary))]"
          style={{ left: thumbPad, right: thumbPad }}
          aria-hidden="true"
        >
          <div
            className={cn(
              "relative h-full overflow-hidden rounded-full bg-(--reasoning-effort-accent)",
              !dragging && "transition-[width] duration-150 ease-out",
            )}
            style={{ width: `${Math.max(fillRatio * 100, 0)}%` }}
          >
            {showFlow && (
              <div className="codemini-reasoning-flow">
                <div className="codemini-reasoning-flow__shimmer" />
                <div className="codemini-reasoning-flow__particles" />
              </div>
            )}
          </div>
          {/* Short stop notches for middle stops only (ends use labels) */}
          {REASONING_EFFORT_LEVELS.map((level, index) => {
            if (
              level === display ||
              levelCount <= 1 ||
              index === 0 ||
              index === levelCount - 1
            ) {
              return null;
            }
            const stopPercent = (index / (levelCount - 1)) * 100;
            return (
              <span
                key={`notch-${level}`}
                className="absolute top-1/2 h-2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--text-muted) opacity-40"
                style={{ left: `${stopPercent}%` }}
              />
            );
          })}
        </div>

        {/* Drag / click surface — geometry matches thumb travel range */}
        <div
          ref={trackRef}
          className={cn(
            "absolute inset-y-0 z-20",
            disabled
              ? "cursor-not-allowed"
              : dragging
                ? "cursor-grabbing"
                : "cursor-grab",
          )}
          style={{ left: thumbPad, right: thumbPad }}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={finishTrackPointer}
          onPointerCancel={cancelTrackPointer}
        />

        {/* White thumb */}
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 z-10 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--bg-primary)",
            !dragging && "transition-[left] duration-150 ease-out",
          )}
          style={{
            left: `calc(${thumbPad}px + (100% - ${thumbPad * 2}px) * ${fillRatio})`,
            boxShadow: `
              0 0 0 3px color-mix(in srgb, var(--reasoning-effort-accent) 28%, transparent),
              0 1px 3px color-mix(in srgb, black 14%, transparent),
              0 0 0 1px color-mix(in srgb, var(--text-primary) 8%, transparent)
            `,
          }}
          aria-hidden="true"
        />
      </div>

      {/* Text stop labels — clearer than dots on a thick capsule track */}
      <div
        className="relative mt-1.5"
        style={{ marginLeft: thumbPad, marginRight: thumbPad }}
      >
        {REASONING_EFFORT_LEVELS.map((level, index) => {
          const selected = level === display;
          const stopPercent =
            levelCount <= 1 ? 0 : (index / (levelCount - 1)) * 100;
          const isFirst = index === 0;
          const isLast = index === levelCount - 1;
          return (
            <button
              key={level}
              type="button"
              id={`${idPrefix}-${level}`}
              disabled={disabled}
              className={cn(
                "absolute top-0 border-0 bg-transparent px-0.5 py-0.5 text-[10px] leading-none transition-colors duration-200 sm:text-[11px]",
                "disabled:cursor-not-allowed disabled:opacity-50",
                !disabled && "cursor-pointer",
                selected
                  ? "font-semibold"
                  : "font-medium text-(--text-muted) hover:text-(--text-secondary)",
                isFirst && "left-0",
                isLast && "right-0 left-auto",
                !isFirst && !isLast && "-translate-x-1/2",
              )}
              style={{
                ...(selected
                  ? { color: "var(--reasoning-effort-accent-text)" }
                  : undefined),
                ...(!isFirst && !isLast
                  ? { left: `${stopPercent}%` }
                  : undefined),
              }}
              onClick={() => handleLabelClick(level)}
              aria-pressed={selected}
              aria-label={getReasoningEffortLabel(level)}
              title={getReasoningEffortLabel(level)}
            >
              {getReasoningEffortShortLabel(level)}
            </button>
          );
        })}
        {/* Reserve label row height */}
        <div
          className="invisible text-[10px] leading-none sm:text-[11px]"
          aria-hidden="true"
        >
          {getReasoningEffortShortLabel("medium")}
        </div>
      </div>
    </div>
  );
}

export function ReasoningControlsPanel({
  enabled,
  effort,
  onEnabledChange,
  onEffortChange,
  disabled = false,
  showHelp = false,
  compactStepper = false,
  idPrefix = "reasoning",
}) {
  const reasoningEnabled = normalizeReasoningEnabled(enabled);
  const reasoningEffort = normalizeReasoningEffort(effort);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-(--text-primary)">
            {t("reasoningEnabled")}
          </div>
          {showHelp && (
            <div className="mt-0.5 text-[11px] leading-snug text-(--text-muted)">
              {t("reasoningEnabledHelp")}
            </div>
          )}
        </div>
        <Switch
          id={`${idPrefix}-enabled`}
          checked={reasoningEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => onEnabledChange?.(checked)}
        />
      </div>
      {reasoningEnabled && (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-medium text-(--text-muted)">
            {t("reasoningEffort")}
          </div>
          <ReasoningEffortStepper
            idPrefix={`${idPrefix}-effort`}
            value={reasoningEffort}
            onChange={onEffortChange}
            disabled={disabled}
            compact={compactStepper}
          />
          {showHelp && (
            <div className="text-[11px] leading-snug text-(--text-muted)">
              {t("reasoningEffortHelp")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function persistReasoningConfig({ enabled, effort }) {
  const enabledResult = await api.setConfig("model.reasoning_enabled", enabled);
  let latestConfig = enabledResult?.config || null;
  if (effort != null) {
    const effortResult = await api.setConfig(
      "model.reasoning_effort",
      normalizeReasoningEffort(effort),
    );
    latestConfig = effortResult?.config || latestConfig;
  }
  return latestConfig;
}

export function ReasoningQuickControl({ enabled, effort, disabled = false }) {
  const { actions } = useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Optimistic effort so the stepper doesn't flash while config persists.
  const [optimisticEffort, setOptimisticEffort] = useState(null);
  const reasoningEnabled = normalizeReasoningEnabled(enabled);
  const reasoningEffort = normalizeReasoningEffort(effort);
  const displayEffort = optimisticEffort ?? reasoningEffort;
  const triggerLabel = reasoningEnabled
    ? getReasoningEffortShortLabel(displayEffort)
    : t("reasoningOffShort");

  useEffect(() => {
    if (optimisticEffort != null && reasoningEffort === optimisticEffort) {
      setOptimisticEffort(null);
    }
  }, [reasoningEffort, optimisticEffort]);

  const applyChange = async (nextEnabled, nextEffort) => {
    if (saving || disabled) return;
    setSaving(true);
    try {
      const savedConfig = await persistReasoningConfig({
        enabled: nextEnabled,
        effort: nextEffort,
      });
      if (savedConfig) {
        actions.patchRuntimeReasoning(savedConfig);
      }
      await actions.refreshRuntimeState();
    } catch {
      // Roll back optimistic effort if persist failed.
      setOptimisticEffort(null);
    } finally {
      setSaving(false);
    }
  };

  const handleEnabledChange = async (checked) => {
    await applyChange(checked, displayEffort);
  };

  const handleEffortChange = async (level) => {
    const next = normalizeReasoningEffort(level);
    setOptimisticEffort(next);
    if (!reasoningEnabled) {
      await applyChange(true, next);
      return;
    }
    await applyChange(true, next);
  };

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            INPUT_PILL_CLASS,
            "px-2.5",
            disabled && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
          title={t("reasoningQuickControl")}
        >
          <Brain size={13} weight={reasoningEnabled ? "fill" : "regular"} />
          <span className="truncate">{triggerLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-[min(20rem,calc(100vw-1.5rem))] p-3.5 sm:w-80 sm:p-4 md:w-96"
      >
        <div className={cn(saving && "pointer-events-none")}>
          <ReasoningControlsPanel
            idPrefix="input-reasoning"
            enabled={reasoningEnabled}
            effort={displayEffort}
            onEnabledChange={handleEnabledChange}
            onEffortChange={handleEffortChange}
            disabled={disabled}
            compactStepper
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { persistReasoningConfig };
