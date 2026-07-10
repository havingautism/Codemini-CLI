import React, { useState } from "react";
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
  REASONING_EFFORT_LEVELS,
  extractReasoningRuntimePatch,
  getReasoningEffortLabel,
  getReasoningEffortShortLabel,
  normalizeReasoningEffort,
  normalizeReasoningEnabled,
} from "@/lib/reasoning-controls.js";
import * as api from "@/hooks/use-api";
import { useApp } from "@/context/app-context.jsx";

const INPUT_PILL_CLASS =
  "border border-(--border-default) bg-transparent text-(--text-secondary) h-7 rounded-md inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer text-[11px] sm:text-[12px] whitespace-nowrap transition-colors hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary)";

export function ReasoningEffortStepper({
  value,
  onChange,
  disabled = false,
  compact = false,
  idPrefix = "reasoning-effort",
}) {
  const current = normalizeReasoningEffort(value);

  return (
    <div
      className={cn("w-full", compact && "max-w-[220px]")}
      role="group"
      aria-label={t("reasoningEffort")}
    >
      <div className="relative flex items-center px-1">
        <div
          className="pointer-events-none absolute left-3 right-3 top-[9px] h-1 rounded-full bg-[var(--input-shell-glow-soft)]"
          aria-hidden="true"
        />
        {REASONING_EFFORT_LEVELS.map((level) => {
          const selected = level === current;
          return (
            <button
              key={level}
              type="button"
              id={`${idPrefix}-${level}`}
              disabled={disabled}
              className={cn(
                "relative z-10 flex flex-1 flex-col items-center gap-1.5 border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50",
                compact ? "py-1" : "py-1.5",
              )}
              onClick={() => onChange?.(level)}
              aria-pressed={selected}
              aria-label={getReasoningEffortLabel(level)}
              title={getReasoningEffortLabel(level)}
            >
              <span
                className={cn(
                  "rounded-full transition-all duration-200",
                  selected
                    ? "size-3.5 bg-[var(--input-shell-accent)] ring-4 ring-[var(--input-shell-glow)]"
                    : "size-2.5 bg-(--border-strong) hover:bg-[color-mix(in_srgb,var(--input-shell-accent)_45%,transparent)]",
                )}
              />
              {!compact && (
                <span
                  className={cn(
                    "text-[10px] leading-none",
                    selected
                      ? "font-medium text-[var(--input-shell-accent)]"
                      : "text-(--text-muted)",
                  )}
                >
                  {getReasoningEffortShortLabel(level)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {compact && (
        <div className="mt-1 text-center text-[11px] text-(--text-muted)">
          {getReasoningEffortLabel(current)}
        </div>
      )}
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

export function ReasoningQuickControl({
  enabled,
  effort,
  disabled = false,
}) {
  const { actions } = useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const reasoningEnabled = normalizeReasoningEnabled(enabled);
  const reasoningEffort = normalizeReasoningEffort(effort);
  const triggerLabel = reasoningEnabled
    ? getReasoningEffortShortLabel(reasoningEffort)
    : t("reasoningOffShort");

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
    } finally {
      setSaving(false);
    }
  };

  const handleEnabledChange = async (checked) => {
    await applyChange(checked, reasoningEffort);
  };

  const handleEffortChange = async (level) => {
    if (!reasoningEnabled) {
      await applyChange(true, level);
      return;
    }
    await applyChange(true, level);
  };

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            INPUT_PILL_CLASS,
            "px-2.5 hover:border-(--border-strong) hover:bg-(--bg-hover) hover:text-(--text-primary)",
            (saving || disabled) && "opacity-50 pointer-events-none",
          )}
          disabled={disabled}
          title={t("reasoningQuickControl")}
        >
          <Brain size={13} weight={reasoningEnabled ? "fill" : "regular"} />
          <span className="truncate">{triggerLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-72 p-3">
        <ReasoningControlsPanel
          idPrefix="input-reasoning"
          enabled={reasoningEnabled}
          effort={reasoningEffort}
          onEnabledChange={handleEnabledChange}
          onEffortChange={handleEffortChange}
          disabled={disabled || saving}
          compactStepper
        />
      </PopoverContent>
    </Popover>
  );
}

export { persistReasoningConfig };
