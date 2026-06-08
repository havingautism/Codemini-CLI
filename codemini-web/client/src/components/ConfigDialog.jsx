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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

function SwitchControl({ checked, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={checked}
      className={cn(
        "relative h-5 w-9 rounded-full border shadow-inner transition-colors",
        checked
          ? "border-(--text-primary) bg-(--text-primary)"
          : "border-(--border-strong) bg-(--bg-hover)",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 size-3.5 rounded-full transition-transform",
          checked ? "bg-(--bg-primary)" : "bg-(--text-muted)",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
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
        <div className="space-y-5 px-3.5 py-1 overflow-y-auto flex-1 min-h-0 scroll-smooth">
          {status?.setupRequired && (
            <div className="rounded-md border border-(--border-default) bg-(--bg-secondary) px-3 py-2 text-[13px] text-(--text-primary)">
              <div className="font-medium">{t("configRequiredTitle")}</div>
              <div className="mt-1 text-(--text-secondary)">
                {t("configRequiredDesc")}
              </div>
            </div>
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
                <div className="space-y-2.5">
                  {group.keys.map((key) => (
                    <div key={key.path} className="flex items-center gap-3">
                      <label className="text-[13px] text-(--text-muted) w-32 shrink-0">
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
                      </label>
                      {isBooleanOption(key) ? (
                        <div className="flex-1 flex items-center justify-end min-h-8">
                          <SwitchControl
                            checked={getValue(key.path) === "true"}
                            title={key.label}
                            onClick={() =>
                              handleChange(
                                key.path,
                                getValue(key.path) === "true" ? false : true,
                              )
                            }
                          />
                        </div>
                      ) : key.options ? (
                        <Select
                          value={getValue(key.path)}
                          onValueChange={(v) => handleChange(key.path, v)}
                        >
                          <SelectTrigger className="flex-1 h-8 text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
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
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type={key.type || "text"}
                          value={getValue(key.path)}
                          onChange={(e) =>
                            handleChange(key.path, e.target.value)
                          }
                          placeholder={key.placeholder || ""}
                          className="flex-1 h-8 text-[13px]"
                        />
                      )}
                    </div>
                  ))}
                </div>
                {gi < CONFIG_GROUPS.length - 1 && (
                  <Separator className="mt-4 bg-(--border-default)" />
                )}
              </div>
            ))
          )}
        </div>
        <DialogFooter className="gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="text-[13px]"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges}
            className="text-[13px]"
          >
            {t("saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
