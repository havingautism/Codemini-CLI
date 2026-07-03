import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import * as api from "@/hooks/use-api";
import { Spinner } from "@/components/ui/spinner";
import { t } from "../../i18n/index.js";
import { ReasoningControlsPanel } from "@/components/ReasoningControls.jsx";
import {
  normalizeReasoningEffort,
  normalizeReasoningEnabled,
} from "@/lib/reasoning-controls.js";
import { buildSettingsFields } from "@/lib/settings-config.js";
import {
  SETTINGS_TABS,
  getSettingsOptions,
} from "@/lib/settings-options.js";
import { SettingsField } from "@/components/settings/SettingsField.jsx";
import { SettingsSection } from "@/components/settings/SettingsSection.jsx";
import { SettingsSegmentedControl } from "@/components/settings/SettingsSegmentedControl.jsx";
import { SettingsChoiceList } from "@/components/settings/SettingsChoiceList.jsx";
import { SettingsProviderCards } from "@/components/settings/SettingsProviderCards.jsx";
import { SettingsPercentField } from "@/components/settings/SettingsPercentField.jsx";

function getNestedValue(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

function isSwitchField(field) {
  return field.control === "switch";
}

function buildFieldsByPath(fields) {
  return new Map(fields.map((field) => [field.path, field]));
}

function normalizeDraftValue(path, value, fieldsByPath) {
  if (path === "model.reasoning_enabled") {
    return normalizeReasoningEnabled(value);
  }
  if (path === "model.reasoning_effort") {
    return normalizeReasoningEffort(value);
  }
  const field = fieldsByPath.get(path);
  if (field && isSwitchField(field)) {
    return value === true || value === "true";
  }
  if (field?.control === "number" || field?.control === "percent") {
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  }
  return value;
}

function getBaselineValue(path, config, fieldsByPath) {
  if (!config) return undefined;
  if (path === "model.reasoning_enabled") {
    return normalizeReasoningEnabled(config?.model?.reasoning_enabled);
  }
  if (path === "model.reasoning_effort") {
    return normalizeReasoningEffort(config?.model?.reasoning_effort);
  }
  const field = fieldsByPath.get(path);
  const raw = getNestedValue(config, path);
  if (field && isSwitchField(field)) {
    return raw === true || raw === "true";
  }
  if (field?.control === "number" || field?.control === "percent") {
    return Number(raw);
  }
  if (Array.isArray(raw) || (raw && typeof raw === "object")) {
    return JSON.stringify(raw);
  }
  return String(raw ?? "");
}

function isSameAsBaseline(path, value, config, fieldsByPath) {
  if (!config) return false;
  return (
    normalizeDraftValue(path, value, fieldsByPath) ===
    getBaselineValue(path, config, fieldsByPath)
  );
}

function pruneChanges(changes, config, fieldsByPath) {
  if (!config || !changes || Object.keys(changes).length === 0) {
    return changes;
  }
  const next = { ...changes };
  for (const path of Object.keys(next)) {
    if (isSameAsBaseline(path, next[path], config, fieldsByPath)) {
      delete next[path];
    }
  }
  return next;
}

export function ConfigDialog({
  open,
  onOpenChange,
  status = null,
  onSaved,
  reasoningSyncKey = "",
}) {
  const SETTINGS_FIELDS = useMemo(() => buildSettingsFields(), []);
  const fieldsByPath = useMemo(
    () => buildFieldsByPath(SETTINGS_FIELDS),
    [SETTINGS_FIELDS],
  );

  const [config, setConfig] = useState(null);
  const [changes, setChanges] = useState({});
  const [activeTab, setActiveTab] = useState("connection");
  const [configLoading, setConfigLoading] = useState(false);
  const [playwrightStatus, setPlaywrightStatus] = useState(null);
  const [playwrightLoading, setPlaywrightLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setConfigLoading(true);
    setPlaywrightLoading(true);
    setPlaywrightStatus(null);
    setChanges({});
    setActiveTab("connection");
    api
      .fetchConfig()
      .then((cfg) => {
        if (!cancelled) setConfig(cfg);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setConfigLoading(false);
      });
    api
      .fetchPlaywrightStatus()
      .then((status) => {
        if (!cancelled) setPlaywrightStatus(status);
      })
      .catch(() => {
        if (!cancelled) setPlaywrightStatus(null);
      })
      .finally(() => {
        if (!cancelled) setPlaywrightLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !reasoningSyncKey) return;
    let cancelled = false;
    api
      .fetchConfig()
      .then((cfg) => {
        if (cancelled) return;
        setChanges((prev) => {
          const hasReasoningDraft =
            "model.reasoning_enabled" in prev ||
            "model.reasoning_effort" in prev;
          if (!hasReasoningDraft) {
            setConfig(cfg);
          }
          return pruneChanges(prev, cfg, fieldsByPath);
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, reasoningSyncKey, fieldsByPath]);

  const handleChange = (path, value) => {
    setChanges((prev) => {
      const next = { ...prev, [path]: value };
      if (isSameAsBaseline(path, value, config, fieldsByPath)) {
        delete next[path];
      }
      return next;
    });
  };

  const getValue = (path) => {
    if (path in changes) return changes[path];
    const value = config ? getNestedValue(config, path) : "";
    if (Array.isArray(value) || (value && typeof value === "object")) {
      return JSON.stringify(value);
    }
    return String(value ?? "");
  };

  const getBooleanValue = (path) => {
    const value = getValue(path);
    return value === true || value === "true";
  };

  const getReasoningEnabled = () => {
    if ("model.reasoning_enabled" in changes) {
      return normalizeReasoningEnabled(changes["model.reasoning_enabled"]);
    }
    return normalizeReasoningEnabled(config?.model?.reasoning_enabled);
  };

  const getReasoningEffort = () => {
    if ("model.reasoning_effort" in changes) {
      return normalizeReasoningEffort(changes["model.reasoning_effort"]);
    }
    return normalizeReasoningEffort(config?.model?.reasoning_effort);
  };

  const hasChanges = Object.keys(changes).length > 0;
  const shouldShowField = (field) =>
    typeof field.visibleWhen !== "function" || field.visibleWhen({ getValue });

  const tabHasChanges = (tabId) =>
    SETTINGS_FIELDS.some(
      (field) =>
        field.tab === tabId &&
        field.path in changes,
    ) ||
    (tabId === "model" &&
      ("model.reasoning_enabled" in changes ||
        "model.reasoning_effort" in changes));

  const playwrightReady =
    playwrightStatus?.packageInstalled && playwrightStatus?.chromiumReady;
  const playwrightLabel = playwrightLoading
    ? t("playwrightChecking")
    : playwrightReady
      ? t("playwrightReady")
      : playwrightStatus?.packageInstalled
        ? t("playwrightBrowserMissing")
        : t("playwrightNotInstalled");
  const PlaywrightStatusIcon = playwrightLoading
    ? null
    : playwrightReady
      ? CheckCircle
      : playwrightStatus?.packageInstalled
        ? WarningCircle
        : XCircle;
  const playwrightStatusClass = playwrightLoading
    ? "text-(--text-muted)"
    : playwrightReady
      ? "text-(--accent-green)"
      : playwrightStatus?.packageInstalled
        ? "text-(--accent-amber, #d97706)"
        : "text-(--text-muted)";

  const handleSave = async () => {
    try {
      let savedConfig = config;
      for (const [path, value] of Object.entries(changes)) {
        let normalizedValue = value;
        if (path === "model.reasoning_enabled") {
          normalizedValue = value === true || value === "true";
        } else if (path === "model.reasoning_effort") {
          normalizedValue = normalizeReasoningEffort(value);
        } else {
          const field = fieldsByPath.get(path);
          normalizedValue = isSwitchField(field)
            ? value === true || value === "true"
            : field?.control === "number" || field?.control === "percent"
              ? Number(value)
              : value;
        }
        const result = await api.setConfig(path, normalizedValue);
        if (result?.config) savedConfig = result.config;
      }
      await onSaved?.(savedConfig);
      setChanges({});
      onOpenChange(false);
    } catch (err) {
      console.error("Config save failed:", err);
    }
  };

  const renderControl = (field) => {
    const value = getValue(field.path);
    const idPrefix = field.path.replace(/\./g, "-");

    if (field.control === "switch") {
      return (
        <div className="flex justify-end">
          <Switch
            id={field.path}
            checked={getBooleanValue(field.path)}
            onCheckedChange={(checked) => handleChange(field.path, checked)}
          />
        </div>
      );
    }

    if (field.control === "segmented") {
      return (
        <SettingsSegmentedControl
          idPrefix={idPrefix}
          value={value}
          options={getSettingsOptions(field.optionsKey)}
          onValueChange={(next) => handleChange(field.path, next)}
        />
      );
    }

    if (field.control === "choiceList") {
      return (
        <SettingsChoiceList
          idPrefix={idPrefix}
          value={value}
          options={getSettingsOptions(field.optionsKey)}
          onValueChange={(next) => handleChange(field.path, next)}
        />
      );
    }

    if (field.control === "providerCards") {
      return (
        <SettingsProviderCards
          idPrefix={idPrefix}
          value={value}
          options={getSettingsOptions(field.optionsKey)}
          onValueChange={(next) => handleChange(field.path, next)}
        />
      );
    }

    if (field.control === "percent") {
      return (
        <SettingsPercentField
          id={field.path}
          value={value}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          onChange={(next) => handleChange(field.path, next)}
        />
      );
    }

    if (field.control === "textarea") {
      return (
        <Textarea
          id={field.path}
          value={value}
          onChange={(e) => handleChange(field.path, e.target.value)}
          placeholder={field.placeholder || ""}
          rows={3}
          className="font-mono text-[12px]"
        />
      );
    }

    return (
      <Input
        id={field.path}
        type={field.type ?? (field.control === "number" ? "number" : "text")}
        value={value}
        onChange={(e) => handleChange(field.path, e.target.value)}
        placeholder={field.placeholder || ""}
      />
    );
  };

  const renderTabContent = (tabId) => {
    const fields = SETTINGS_FIELDS.filter(
      (field) => field.tab === tabId && shouldShowField(field),
    );

    return (
      <SettingsSection>
        {fields.map((field) => (
          <SettingsField
            key={field.path}
            id={field.path}
            label={field.label}
            help={field.help}
            inline={field.control === "switch"}
          >
            {renderControl(field)}
          </SettingsField>
        ))}

        {tabId === "model" && (
          <SettingsField
            id="model-reasoning"
            label={t("reasoningControls")}
            help={t("reasoningEnabledHelp")}
          >
            <ReasoningControlsPanel
              idPrefix="settings-reasoning"
              enabled={getReasoningEnabled()}
              effort={getReasoningEffort()}
              onEnabledChange={(checked) =>
                handleChange("model.reasoning_enabled", checked)
              }
              onEffortChange={(level) =>
                handleChange("model.reasoning_effort", level)
              }
              showHelp
            />
          </SettingsField>
        )}

        {tabId === "web" && (
          <SettingsField id="playwright-status" label={t("playwright")} help={t("playwrightHelp")}>
            <div
              className={cn(
                "flex min-h-[52px] items-center gap-2 rounded-lg border border-(--border-default) px-3 py-2.5 text-[13px]",
                playwrightStatusClass,
              )}
            >
              {playwrightLoading ? (
                <Spinner className="size-4" />
              ) : PlaywrightStatusIcon ? (
                <PlaywrightStatusIcon size={16} weight="fill" />
              ) : null}
              <span>{playwrightLabel}</span>
            </div>
          </SettingsField>
        )}
      </SettingsSection>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] h-[666px] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>{t("settingsTitle")}</DialogTitle>
        </DialogHeader>

        {status?.setupRequired && (
          <div className="px-6 pb-2">
            <Alert>
              <AlertTitle>{t("configRequiredTitle")}</AlertTitle>
              <AlertDescription>{t("configRequiredDesc")}</AlertDescription>
            </Alert>
          </div>
        )}

        {configLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner />
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            orientation="vertical"
            className="flex min-h-0 flex-1 flex-row gap-0 px-6 pb-4"
          >
            <TabsList
              variant="line"
              className="h-auto w-[148px] shrink-0 flex-col items-stretch justify-start gap-0.5 border-r border-(--border-default) bg-transparent pr-3"
            >
              {SETTINGS_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="h-9 justify-start px-2.5 text-[13px] data-[state=active]:font-medium data-[state=active]:after:bg-[var(--input-shell-accent)]"
                >
                  <span className="truncate">{t(tab.labelKey)}</span>
                  {tabHasChanges(tab.id) && (
                    <span
                      className="ml-auto size-1.5 shrink-0 rounded-full bg-[var(--input-shell-accent)]"
                      aria-label={t("settingsUnsavedChanges")}
                    />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto pl-4 scroll-smooth pr-3 [scrollbar-gutter:stable]">
              {SETTINGS_TABS.map((tab) => (
                <TabsContent
                  key={tab.id}
                  value={tab.id}
                  className="mt-0 focus-visible:outline-none"
                >
                  {renderTabContent(tab.id)}
                </TabsContent>
              ))}
            </div>
          </Tabs>
        )}

        <DialogFooter className="gap-2 shrink-0 border-t border-(--border-default) px-6 py-4">
          {hasChanges && (
            <span className="mr-auto text-[12px] text-(--text-muted)">
              {t("settingsUnsavedChanges")}
            </span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges}>
            {t("saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
