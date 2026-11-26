import { SettingsSecretField } from '@/components/settings/SettingsSecretField.jsx';
import { hasConfiguredSecret, secretSettingWrite } from '@/lib/secret-settings.js';
import { getDecisionProviderStatus } from '@/lib/decision-provider-status.js';
import { TASK_DECISION_ASSISTANT_AVAILABLE } from '@core/harness/availability.js';
import {
  isWebConfigReadOnly, MODEL_CONNECTION_KEYS, modelConnectionChanged, validateModelConnection, validateWebConfigValue,
} from '../../../shared/web-config-policy.js';
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import * as api from "@/hooks/use-api";
import { Spinner } from "@/components/ui/spinner";
import { t } from "../../i18n/index.js";
import { ReasoningControlsPanel } from "@/components/ReasoningControls.jsx";
import {
  normalizeReasoningAuto,
  normalizeReasoningEffort,
  normalizeReasoningEnabled,
} from "@/lib/reasoning-controls.js";
import { buildSettingsFields } from "@/lib/settings-config.js";
import {
  SETTINGS_TABS,
  getSettingsOptions,
  usesMicroVm,
  usesWindowsHostShell,
} from "@/lib/settings-options.js";
import { SettingsField } from "@/components/settings/SettingsField.jsx";
import { SettingsSection } from "@/components/settings/SettingsSection.jsx";
import { SettingsSegmentedControl } from "@/components/settings/SettingsSegmentedControl.jsx";
import { SettingsChoiceList } from "@/components/settings/SettingsChoiceList.jsx";
import { SettingsProviderCards } from "@/components/settings/SettingsProviderCards.jsx";
import { SettingsPercentField } from "@/components/settings/SettingsPercentField.jsx";
import { SettingsStorage } from "@/components/settings/SettingsStorage.jsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.jsx";
import { SettingsAppearance } from "@/components/settings/SettingsAppearance.jsx";
import { findGatewayPreset, GatewayModelField, GatewayPresetField } from "@/components/settings/GatewayPresetField.jsx";
import { applyAppearance, readAppearance } from "@/lib/ui-appearance.js";

function sandboxFieldNote(sandboxMode, availability) {
  if (availability?.hostFallback) return t("shellSandboxHostFallbackDesc");
  if (usesMicroVm({ sandboxMode, availability })) return t("shellSandboxMicroVmDesc");
  if (!availability || sandboxMode === "danger-full-access") return "";
  if (availability.backend === "os") {
    return availability.osKind === "landlock"
      ? t("shellSandboxOsLandlockDesc")
      : t("shellSandboxOsSeatbeltDesc");
  }
  if (availability.confineAvailable === false) {
    return t(availability.platform === "win32" ? "shellSandboxWindowsFallbackDesc" : "shellSandboxUnavailableDesc");
  }
  return "";
}

function getNestedValue(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

function isSwitchField(field) {
  return field.control === "switch";
}

function isTaskDecisionField(field) {
  return field.path.startsWith("harness.")
    && field.path !== "harness.provider"
    && !field.path.startsWith("harness.providers.");
}

function buildFieldsByPath(fields) {
  return new Map(fields.map((field) => [field.path, field]));
}

function normalizeDraftValue(path, value, fieldsByPath) {
  if (path === "model.reasoning_enabled") {
    return normalizeReasoningEnabled(value);
  }
  if (path === "model.reasoning_auto") {
    return normalizeReasoningAuto(value);
  }
  if (path === "model.reasoning_effort") {
    return normalizeReasoningEffort(value);
  }
  const field = fieldsByPath.get(path);
  if (field && isSwitchField(field)) {
    return field.onValue != null
      ? (value === true || value === field.onValue ? field.onValue : field.offValue)
      : value === true || value === "true";
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
  if (path === "model.reasoning_auto") {
    return normalizeReasoningAuto(config?.model?.reasoning_auto);
  }
  if (path === "model.reasoning_effort") {
    return normalizeReasoningEffort(config?.model?.reasoning_effort);
  }
  const field = fieldsByPath.get(path);
  const raw = getNestedValue(config, path);
  if (field && isSwitchField(field)) {
    if (field.onValue != null) return raw === field.onValue ? field.onValue : field.offValue;
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
  if (fieldsByPath.get(path)?.type === "password") return secretSettingWrite(value) === undefined;
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
  sandboxAvailability = null,
  sandboxMode: runtimeSandboxMode = "",
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [activeTab, setActiveTab] = useState("connection");
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const updateLayout = () => setCompactLayout(media.matches);
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);
  const [appearanceBaseline, setAppearanceBaseline] = useState(readAppearance);
  const [appearanceDraft, setAppearanceDraft] = useState(readAppearance);
  const [configLoading, setConfigLoading] = useState(false);
  const [pendingWarning, setPendingWarning] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setConfigLoading(true);
    setChanges({});
    setPendingWarning(null);
    setSaveError("");
    setActiveTab("connection");
    const appearance = readAppearance();
    setAppearanceBaseline(appearance);
    setAppearanceDraft(appearance);
    api
      .fetchConfig()
      .then((cfg) => {
        if (!cancelled) setConfig(cfg);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setConfigLoading(false);
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
            "model.reasoning_auto" in prev ||
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
  const gatewayPreset = findGatewayPreset(getValue("gateway.preset"), getValue("sdk.provider"), getValue("gateway.base_url"));
  const lockedGatewayPreset = gatewayPreset?.id === getValue("gateway.preset") ? gatewayPreset : null;
  const setGatewayPreset = (preset) => {
    if (!preset) {
      handleChange("gateway.preset", "custom");
      return;
    }
    setChanges((prev) => {
      const next = { ...prev };
      const values = { "gateway.preset": preset.id, "gateway.base_url": preset.baseUrl, "sdk.provider": preset.protocol };
      if (modelConnectionChanged({ gateway: { base_url: getValue("gateway.base_url") }, sdk: { provider: getValue("sdk.provider") } }, values)) {
        delete next["gateway.api_key"];
        if (!preset.models?.includes(getValue("model.name"))) values["model.name"] = "";
        if (!preset.models?.includes(getValue("model.fast_name"))) values["model.fast_name"] = "";
      }
      for (const [path, value] of Object.entries(values)) {
        if (isSameAsBaseline(path, value, config, fieldsByPath)) delete next[path];
        else next[path] = value;
      }
      return next;
    });
  };

  const getBooleanValue = (path) => {
    const field = fieldsByPath.get(path);
    const value = getValue(path);
    if (field?.onValue != null) return value === field.onValue || value === true;
    return value === true || value === "true";
  };
  const availability = sandboxAvailability || status?.sandboxAvailability || null;
  const sandboxMode = runtimeSandboxMode || availability?.mode || getValue("sandbox.mode");

  const jevKeyDraft = changes["harness.providers.jev.api_key"];
  const hasJevKey = jevKeyDraft === null
    ? false
    : Boolean(secretSettingWrite(jevKeyDraft)) || hasConfiguredSecret(config, "harness.providers.jev.api_key");
  const decisionProvider = getValue("harness.provider");
  const decisionProviderStatus = getDecisionProviderStatus({
    provider: decisionProvider,
    baseUrl: getValue(`harness.providers.${decisionProvider}.base_url`),
    hasApiKey: hasJevKey,
  });

  const getReasoningEnabled = () => {
    if ("model.reasoning_enabled" in changes) {
      return normalizeReasoningEnabled(changes["model.reasoning_enabled"]);
    }
    return normalizeReasoningEnabled(config?.model?.reasoning_enabled);
  };

  const getReasoningAuto = () => {
    if ("model.reasoning_auto" in changes) {
      return normalizeReasoningAuto(changes["model.reasoning_auto"]);
    }
    return normalizeReasoningAuto(config?.model?.reasoning_auto);
  };

  const getReasoningEffort = () => {
    if ("model.reasoning_effort" in changes) {
      return normalizeReasoningEffort(changes["model.reasoning_effort"]);
    }
    return normalizeReasoningEffort(config?.model?.reasoning_effort);
  };

  const hasConfigChanges = Object.keys(changes).length > 0;
  const hasAppearanceChanges = Object.keys(appearanceDraft).some(
    (key) => appearanceDraft[key] !== appearanceBaseline[key],
  );
  const hasChanges = hasConfigChanges || hasAppearanceChanges;
  const shouldShowField = (field) =>
    !(field.path === "sdk.provider" && lockedGatewayPreset?.protocol) &&
    !(field.path === "gateway.base_url" && lockedGatewayPreset?.baseUrl) &&
    (typeof field.visibleWhen !== "function" || field.visibleWhen({ getValue }));

  const tabHasChanges = (tabId) =>
    (tabId === "appearance" && hasAppearanceChanges) ||
    (tabId === "connection" && MODEL_CONNECTION_KEYS.some((path) => path in changes)) ||
    SETTINGS_FIELDS.some(
      (field) =>
        field.tab === tabId &&
        field.path in changes,
    ) ||
    (tabId === "model" &&
      ("model.reasoning_enabled" in changes ||
        "model.reasoning_auto" in changes ||
        "model.reasoning_effort" in changes));

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      let savedConfig = config;
      const pendingChanges = hasConfigChanges && !decisionProviderStatus.ready && getBooleanValue("harness.enabled")
        ? { ...changes, "harness.enabled": false }
        : changes;
      const connection = {};
      for (const path of MODEL_CONNECTION_KEYS) {
        if (!(path in pendingChanges)) continue;
        const value = path === "gateway.api_key"
          ? secretSettingWrite(pendingChanges[path])
          : String(pendingChanges[path] ?? "").trim();
        if (value !== undefined) connection[path] = value;
      }
      if (Object.keys(connection).length) {
        if (hasConfiguredSecret(config, "gateway.api_key") && modelConnectionChanged(config, connection)
          && !("gateway.api_key" in connection)) {
          throw new Error(t("gatewayPresetKeyRequired"));
        }
        if (connection["model.name"] === "") throw new Error(t("gatewayPresetModelRequired"));
        validateModelConnection(connection);
        const result = await api.setModelConnection(connection);
        if (result?.config) savedConfig = result.config;
      }
      for (const [path, value] of Object.entries(pendingChanges)) {
        if (MODEL_CONNECTION_KEYS.includes(path)) continue;
        let normalizedValue = value;
        if (path === "model.reasoning_enabled") {
          normalizedValue = value === true || value === "true";
        } else if (path === "model.reasoning_auto") {
          normalizedValue = normalizeReasoningAuto(value);
        } else if (path === "model.reasoning_effort") {
          normalizedValue = normalizeReasoningEffort(value);
        } else {
          const field = fieldsByPath.get(path);
          normalizedValue = isSwitchField(field)
            ? (field.onValue != null
              ? (value === true || value === field.onValue ? field.onValue : field.offValue)
              : value === true || value === "true")
            : field?.control === "number" || field?.control === "percent"
              ? Number(value)
              : value;
          if (path === "policy.allowed_paths") {
            const parsed = typeof normalizedValue === "string" ? JSON.parse(normalizedValue || "[]") : normalizedValue;
            normalizedValue = Array.isArray(parsed) ? parsed : [];
          }
        }
        if (fieldsByPath.get(path)?.type === "password") {
          normalizedValue = secretSettingWrite(value);
          if (normalizedValue === undefined) continue;
        }
        validateWebConfigValue(path, normalizedValue);
        const result = await api.setConfig(path, normalizedValue);
        if (result?.error) throw new Error(result.message || t("settingsSaveFailed"));
        if (result?.config) savedConfig = result.config;
      }
      if (hasAppearanceChanges) applyAppearance(appearanceDraft);
      if (hasConfigChanges) await onSaved?.(savedConfig);
      setConfig(savedConfig);
      setChanges({});
      onOpenChange(false);
    } catch (err) {
      setSaveError(String(err?.message || t("settingsSaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const renderControl = (field) => {
    if (isWebConfigReadOnly(field.path)) {
      const raw = field.path === "sandbox.mode" ? sandboxMode : getValue(field.path);
      const sandboxStatusLabel = field.path === "sandbox.mode" && (
        availability?.hostFallback ? t("sandboxHostFallbackMode")
          : availability?.confineAvailable === false && sandboxMode !== "danger-full-access" ? t("sandboxUnavailableMode") : ""
      );
      const label = sandboxStatusLabel
        || field.valueLabels?.[raw]
        || (field.control === "switch" ? t(getBooleanValue(field.path) ? "enabled" : "disabled") : null)
        || getSettingsOptions(field.optionsKey).find(option => option.value === raw)?.label
        || String(raw ?? "");
      return <div className="text-sm text-(--text-muted)">
        <div>{label}</div>
        <p className="mt-1 text-xs">{t("settingsReadOnlyCli")}</p>
        {field.cliExample ? <code className="mt-1 block break-all text-xs">{field.cliExample}</code> : null}
      </div>;
    }
    const disabled = saving || (isTaskDecisionField(field) && !decisionProviderStatus.ready);
    if (field.type === "password") return <SettingsSecretField
      key={`${field.path}-${open}`} id={field.path} configured={hasConfiguredSecret(config, field.path)}
      draft={changes[field.path]} disabled={disabled} onChange={value => handleChange(field.path, value)} />;
    const value =
      field.path === "shell.default" && usesMicroVm({ sandboxMode, availability })
        ? "bash"
        : field.path === "shell.default" && usesWindowsHostShell({ sandboxMode, availability })
          ? "powershell"
          : getValue(field.path);
    const idPrefix = field.path.replace(/\./g, "-");

    if (field.control === "switch") {
      return (
        <div className="flex justify-end">
          <Switch
            id={field.path}
            checked={field.path === "harness.enabled" && !decisionProviderStatus.ready ? false : getBooleanValue(field.path)}
            disabled={disabled}
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

    if (field.control === "select") {
      return (
        <Select value={value} disabled={disabled} onValueChange={(next) => handleChange(field.path, next)}>
          <SelectTrigger id={field.path} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {getSettingsOptions(field.optionsKey).map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      );
    }

    if (field.control === "choiceList") {
      return (
        <SettingsChoiceList
          idPrefix={idPrefix}
          value={value}
          options={getSettingsOptions(field.optionsKey, { sandboxMode, availability })}
          disabled={disabled}
          onValueChange={(next) => {
            if (field.warning && next === "external_authority") {
              setPendingWarning({ path: field.path, value: next, title: field.label, description: field.warning });
              return;
            }
            handleChange(field.path, next);
          }}
        />
      );
    }

    if (field.control === "providerCards") {
      return (
        <SettingsProviderCards
          idPrefix={idPrefix}
          value={value}
          options={getSettingsOptions(field.optionsKey)}
          disabled={disabled || (field.path === "sdk.provider" && Boolean(lockedGatewayPreset))}
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
          disabled={disabled}
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
          disabled={disabled}
          className="font-mono text-[12px]"
        />
      );
    }

    const hasModelChoices = Boolean(gatewayPreset?.models?.length
      && ["model.name", "model.fast_name"].includes(field.path));
    if (hasModelChoices) {
      return (
        <GatewayModelField
          id={field.path}
          value={value}
          models={gatewayPreset.models}
          placeholder={field.placeholder || ""}
          disabled={disabled}
          onChange={(next) => handleChange(field.path, next)}
        />
      );
    }
    return (
      <Input
        id={field.path}
        type={field.type ?? (field.control === "number" ? "number" : "text")}
        value={value}
        min={field.min}
        max={field.max}
        step={field.step}
        disabled={disabled}
        readOnly={field.path === "gateway.base_url" && Boolean(lockedGatewayPreset)}
        onChange={(e) => handleChange(field.path, e.target.value)}
        placeholder={field.type === "password" ? "Enter a new key to replace the stored key" : field.placeholder || ""}
      />
    );
  };

  const renderTabContent = (tabId) => {
    if (tabId === "appearance") {
      return <SettingsAppearance value={appearanceDraft} onChange={setAppearanceDraft} disabled={saving} />;
    }
    if (tabId === "storage") {
      return <SettingsStorage active={activeTab === "storage"} />;
    }
    const fields = SETTINGS_FIELDS.filter(
      (field) => field.tab === tabId && shouldShowField(field),
    );

    const renderField = (field) => (
      <SettingsField
        key={field.path}
        id={field.path}
        label={field.label}
        help={field.help}
        description={(() => {
          if (field.path === "gateway.base_url" && lockedGatewayPreset) return t("gatewayPresetLocked");
          if (field.path === "gateway.api_key" && hasConfiguredSecret(config, field.path) && modelConnectionChanged(config, changes)) {
            return t("gatewayPresetKeyRequired");
          }
          if (field.path === "shell.default") return sandboxFieldNote(sandboxMode, availability) || undefined;
          if (field.path !== "sandbox.mode") return undefined;
          if (availability?.confineAvailable === false && sandboxMode !== "danger-full-access") {
            return t("sandboxModeUnavailableDesc");
          }
          if (availability?.backend === "os") return sandboxFieldNote(sandboxMode, availability) || undefined;
          return undefined;
        })()}
        inline={field.control === "switch"}
        className={isTaskDecisionField(field) && !decisionProviderStatus.ready ? "opacity-60" : undefined}
      >
        {renderControl(field)}
      </SettingsField>
    );

    if (tabId === "decision") {
      return (
        <div className="flex flex-col gap-8">
          <SettingsSection title={t("commandDecisionSection")} description={t("commandDecisionSectionHelp")}>
            {fields.filter((field) => !isTaskDecisionField(field)).map(renderField)}
          </SettingsSection>
          {TASK_DECISION_ASSISTANT_AVAILABLE && <SettingsSection title={t("harness")} description={t("taskDecisionSectionHelp")}>
            {!decisionProviderStatus.ready && (
              <Alert>
                <AlertTitle>{t("harnessProviderNotReady")}</AlertTitle>
                <AlertDescription>{t(`harnessProvider_${decisionProviderStatus.reason}`)}</AlertDescription>
              </Alert>
            )}
            {fields.filter(isTaskDecisionField).map(renderField)}
          </SettingsSection>}
        </div>
      );
    }

    return (
      <SettingsSection>
        {tabId === "connection" && (
          <SettingsField id="model-gateway-preset" label={t("gatewayPreset")} help={t("gatewayPresetHelp")}>
            <GatewayPresetField id="model-gateway-preset" value={lockedGatewayPreset} disabled={saving || !config} onSelect={setGatewayPreset} />
          </SettingsField>
        )}
        {fields.map(renderField)}

        {tabId === "model" && (
          <SettingsField
            id="model-reasoning"
            label={t("reasoningControls")}
            help={t("reasoningEnabledHelp")}
          >
            <ReasoningControlsPanel
              idPrefix="settings-reasoning"
              enabled={getReasoningEnabled()}
              auto={getReasoningAuto()}
              effort={getReasoningEffort()}
              onEnabledChange={(checked) =>
                handleChange("model.reasoning_enabled", checked)
              }
              onAutoChange={(checked) =>
                handleChange("model.reasoning_auto", checked)
              }
              onEffortChange={(level) =>
                handleChange("model.reasoning_effort", level)
              }
              showHelp
            />
          </SettingsField>
        )}

      </SettingsSection>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="codemini-settings sm:max-w-[720px] h-[666px] max-h-[85dvh] flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 px-6">
          <DialogTitle>{t("settingsTitle")}</DialogTitle>
        </DialogHeader>

        {status?.setupRequired && activeTab !== "appearance" && (
          <div className="px-6 pb-2">
            <Alert>
              <AlertTitle>{t("configRequiredTitle")}</AlertTitle>
              <AlertDescription>{t("configRequiredDesc")}</AlertDescription>
            </Alert>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          orientation={compactLayout ? "horizontal" : "vertical"}
          className="codemini-settings-layout flex min-h-0 flex-1 flex-row gap-0 px-6 pb-4"
        >
          <TabsList
            variant="line"
            className="settings-nav-tabs h-auto w-[100px] sm:w-[148px] shrink-0 flex-col items-stretch justify-start gap-1 border-r border-(--border-default) bg-transparent pr-3"
          >
            {SETTINGS_TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="settings-nav-trigger h-9 justify-start px-2.5 text-[13px] data-[state=active]:font-medium"
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

          <div className="codemini-settings-body min-h-0 min-w-0 flex-1 overflow-y-auto pl-4 scroll-smooth pr-3 [scrollbar-gutter:stable]">
            {SETTINGS_TABS.map((tab) => (
              <TabsContent
                key={tab.id}
                value={tab.id}
                className="mt-0 focus-visible:outline-none"
              >
                {configLoading && tab.id !== "appearance" ? (
                  <div className="flex items-center justify-center py-16"><Spinner /></div>
                ) : renderTabContent(tab.id)}
              </TabsContent>
            ))}
          </div>
        </Tabs>

        {saveError ? <p role="alert" className="px-6 py-2 text-sm text-(--accent-red)">{saveError}</p> : null}
        <DialogFooter className="gap-2 shrink-0 border-t border-(--border-default) px-6 py-4">
          {hasChanges && (
            <span className="mr-auto text-[12px] text-(--text-muted)">
              {t("settingsUnsavedChanges")}
            </span>
          )}
          <Button onClick={handleSave} disabled={!hasChanges || saving}>
            {t("saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={!!pendingWarning}
        title={pendingWarning?.title}
        description={pendingWarning?.description}
        confirmLabel={t("enable")}
        confirmVariant="default"
        onOpenChange={(nextOpen) => !nextOpen && setPendingWarning(null)}
        onConfirm={() => {
          if (!pendingWarning) return;
          handleChange(pendingWarning.path, pendingWarning.value);
          setPendingWarning(null);
        }}
      />
    </Dialog>
  );
}
