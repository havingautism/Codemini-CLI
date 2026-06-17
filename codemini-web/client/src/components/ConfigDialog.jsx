import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Question } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import * as api from "@/hooks/use-api";
import { Spinner } from "@/components/ui/spinner";
import { t } from "../../i18n/index.js";

function getNestedValue(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

function isBooleanOption(key) {
  const options = Array.isArray(key?.options) ? key.options.map(String) : [];
  return (
    options.length === 2 &&
    options.includes("true") &&
    options.includes("false")
  );
}

export function ConfigDialog({ open, onOpenChange, status = null, onSaved }) {
  // Define config groups inside the component to ensure proper translation
  const CONFIG_GROUPS = [
    {
      title: t("gateway"),
      keys: [
        {
          path: "gateway.base_url",
          label: t("baseUrl"),
          placeholder: "http://127.0.0.1:8000/v1",
          help: t("baseUrlHelp"),
        },
        {
          path: "gateway.api_key",
          label: t("apiKey"),
          type: "password",
          placeholder: "sk-...",
          help: t("apiKeyHelp"),
        },
        {
          path: "gateway.timeout_ms",
          label: t("timeout"),
          type: "number",
          help: t("timeoutHelp"),
        },
        {
          path: "gateway.max_retries",
          label: t("maxRetries"),
          type: "number",
          help: t("maxRetriesHelp"),
        },
      ],
    },
    {
      title: t("sdk"),
      keys: [
        {
          path: "sdk.provider",
          label: t("provider"),
          options: ["openai-compatible", "anthropic"],
          optionLogos: {
            "openai-compatible": "/logos/openai.svg",
            anthropic: "/logos/claude-color.svg",
          },
          help: t("providerHelp"),
        },
      ],
    },
    {
      title: t("model"),
      keys: [
        {
          path: "model.name",
          label: t("modelName"),
          placeholder: "gpt-4.1-mini",
          help: t("modelNameHelp"),
        },
        {
          path: "model.fast_name",
          label: t("fastModel"),
          placeholder: t("fastModelPlaceholder"),
          help: t("fastModelHelp"),
        },
        {
          path: "model.max_context_tokens",
          label: t("maxContextTokens"),
          type: "number",
          help: t("maxContextTokensHelp"),
        },
      ],
    },

    {
      title: t("execution"),
      keys: [
        {
          path: "execution.mode",
          label: t("mode"),
          options: ["normal", "plan"],
          optionLabels: {
            normal: t("normalExecutionMode"),
            plan: t("planMode"),
          },
          help: t("executionModeHelp"),
        },
        {
          path: "execution.approval_mode",
          label: t("approvalMode"),
          options: ["review", "auto", "full_access"],
          optionLabels: {
            review: t("reviewMode"),
            auto: t("autoMode"),
            full_access: t("fullAccessMode"),
          },
          help: t("approvalModeHelp"),
        },
        {
          path: "ui.reply_language",
          label: t("replyLanguage"),
          options: ["zh", "en"],
          help: t("replyLanguageHelp"),
        },
      ],
    },
    {
      title: t("context"),
      keys: [
        {
          path: "context.preflight_trigger_pct",
          label: t("preflightTrigger"),
          type: "number",
          placeholder: "60",
          help: t("preflightTriggerHelp"),
        },
        {
          path: "context.hard_limit_pct",
          label: t("hardLimit"),
          type: "number",
          placeholder: "98",
          help: t("hardLimitHelp"),
        },
        {
          path: "context.tool_result_max_chars",
          label: t("toolResultMaxChars"),
          type: "number",
          placeholder: "12000",
          help: t("toolResultMaxCharsHelp"),
        },
        {
          path: "context.microcompact_enabled",
          label: t("microcompactEnabled"),
          options: ["true", "false"],
          help: t("microcompactEnabledHelp"),
        },
        {
          path: "context.microcompact_keep_recent",
          label: t("microcompactKeepRecent"),
          type: "number",
          placeholder: "5",
          help: t("microcompactKeepRecentHelp"),
        },
        {
          path: "context.project_context_enabled",
          label: t("projectContextEnabled"),
          options: ["true", "false"],
          help: t("projectContextEnabledHelp"),
        },
      ],
    },
    {
      title: t("shell"),
      keys: [
        {
          path: "shell.default",
          label: t("defaultShell"),
          options: ["bash", "powershell", "zsh", "cmd"],
          help: t("defaultShellHelp"),
        },
      ],
    },
    {
      title: t("policy"),
      keys: [
        {
          path: "policy.safe_mode",
          label: t("safeMode"),
          options: ["true", "false"],
          help: t("safeModeHelp"),
        },
        {
          path: "policy.allowed_paths",
          label: t("allowedPaths"),
          placeholder: '["D:\\\\shared-assets","E:\\\\sibling-repo"]',
          help: t("allowedPathsHelp"),
        },
        {
          path: "policy.allow_dangerous_commands",
          label: t("allowDangerousCommands"),
          options: ["false", "true"],
          help: t("allowDangerousCommandsHelp"),
        },
      ],
    },
  ];

  const [config, setConfig] = useState(null);
  const [changes, setChanges] = useState({});
  const [configLoading, setConfigLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setConfigLoading(true);
      api
        .fetchConfig()
        .then((cfg) => {
          setConfig(cfg);
          setChanges({});
        })
        .catch(() => {})
        .finally(() => setConfigLoading(false));
    }
  }, [open]);

  const handleChange = (path, value) => {
    setChanges((prev) => ({ ...prev, [path]: value }));
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

  const hasChanges = Object.keys(changes).length > 0;

  const handleSave = async () => {
    try {
      for (const [path, value] of Object.entries(changes)) {
        const key = CONFIG_GROUPS.flatMap((g) => g.keys).find(
          (k) => k.path === path,
        );
        const normalizedValue = isBooleanOption(key)
          ? value === true || value === "true"
          : key?.type === "number"
            ? Number(value)
            : value;
        await api.setConfig(path, normalizedValue);
      }
      await onSaved?.();
      setChanges({});
      onOpenChange(false);
    } catch (err) {
      console.error("Config save failed:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("settingsTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 px-3.5 py-1 overflow-y-auto flex-1 min-h-0 scroll-smooth">
          {status?.setupRequired && (
            <Alert>
              <AlertTitle>{t("configRequiredTitle")}</AlertTitle>
              <AlertDescription>{t("configRequiredDesc")}</AlertDescription>
            </Alert>
          )}
          {configLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          ) : (
            CONFIG_GROUPS.map((group, gi) => (
              <div key={group.title}>
                <div className="text-[13px] font-semibold text-(--text-secondary) mb-2.5 uppercase tracking-[0.3px]">
                  {group.title}
                </div>
                <FieldGroup className="gap-2.5">
                  {group.keys.map((key) => (
                    <Field key={key.path} className="items-center">
                      <FieldLabel htmlFor={key.path}>
                        <span>{key.label}</span>
                        {key.help && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="ml-1 inline-flex align-[-2px] text-(--text-muted) hover:text-(--text-primary)"
                                aria-label={key.help}
                              >
                                <Question size={13} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              className="max-w-[300px] leading-relaxed"
                            >
                              {key.help}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </FieldLabel>
                      <FieldContent>
                        {isBooleanOption(key) ? (
                          <div className="flex items-center justify-end min-h-8">
                            <Switch
                              id={key.path}
                              checked={getBooleanValue(key.path)}
                              onCheckedChange={(checked) =>
                                handleChange(key.path, checked)
                              }
                            />
                          </div>
                        ) : key.options ? (
                          <Select
                            value={getValue(key.path)}
                            onValueChange={(v) => handleChange(key.path, v)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent
                              position="popper"
                              align="start"
                              className="w-[var(--radix-select-trigger-width)]"
                            >
                              <SelectGroup>
                                {key.options.map((opt) => (
                                  <SelectItem key={opt} value={opt}>
                                    <span className="inline-flex items-center gap-1.5">
                                      {key.optionLogos?.[opt] && (
                                        <img
                                          src={key.optionLogos[opt]}
                                          alt=""
                                          width={13}
                                          height={13}
                                          className="shrink-0 rounded-sm object-contain"
                                        />
                                      )}
                                      {key.optionLabels?.[opt] ||
                                        (key.optionLogos ? opt.toUpperCase() : opt)}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id={key.path}
                            type={key.type || "text"}
                            value={getValue(key.path)}
                            onChange={(e) =>
                              handleChange(key.path, e.target.value)
                            }
                            placeholder={key.placeholder || ""}
                            className="flex-1"
                          />
                        )}
                      </FieldContent>
                    </Field>
                  ))}
                </FieldGroup>
                {gi < CONFIG_GROUPS.length - 1 && (
                  <Separator className="mt-4 bg-(--border-default)" />
                )}
              </div>
            ))
          )}
        </div>
        <DialogFooter className="gap-2 shrink-0">
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
