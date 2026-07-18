import {
  Code,
  Coffee,
  Command,
  LockOpen,
  ShieldWarning,
  Sparkle,
  Terminal,
  TerminalWindow,
  WindowsLogo,
} from "@phosphor-icons/react";
import { t } from "../../i18n/index.js";

export function getExecutionModeOptions() {
  return [
    {
      value: "normal",
      label: t("normalExecutionMode"),
      description: t("normalModeDesc"),
      icon: Coffee,
    },
    {
      value: "plan",
      label: t("planMode"),
      description: t("planModeDesc"),
      icon: Code,
    },
  ];
}

export function getPlanExecutionModelOptions() {
  return [
    {
      value: "default",
      label: t("planExecutionModelDefault"),
      description: t("planExecutionModelDefaultDesc"),
      icon: Code,
    },
    {
      value: "fast",
      label: t("planExecutionModelFast"),
      description: t("planExecutionModelFastDesc"),
      icon: Sparkle,
    },
    {
      value: "role",
      label: t("planExecutionModelRole"),
      description: t("planExecutionModelRoleDesc"),
      icon: TerminalWindow,
    },
  ];
}

export function getApprovalModeOptions() {
  return [
    {
      value: "review",
      label: t("reviewMode"),
      description: t("reviewModeDesc"),
      icon: ShieldWarning,
    },
    {
      value: "auto",
      label: t("autoMode"),
      description: t("autoModeDesc"),
      icon: Sparkle,
    },
    {
      value: "full_access",
      label: t("fullAccessMode"),
      description: t("fullAccessModeDesc"),
      icon: LockOpen,
    },
  ];
}

export function getProviderOptions() {
  return [
    {
      value: "openai-compatible",
      label: t("providerOpenaiCompatible"),
      description: t("providerOpenaiCompatibleDesc"),
      logo: "/logos/openai.svg",
    },
    {
      value: "anthropic",
      label: t("providerAnthropic"),
      description: t("providerAnthropicDesc"),
      logo: "/logos/claude-color.svg",
    },
  ];
}

export function getSearchProviderOptions() {
  return [
    {
      value: "bing_rss",
      label: t("webSearchProviderBingRss"),
      description: t("webSearchProviderBingRssDesc"),
      logo: "/logos/microsoft-color.svg",
    },
    {
      value: "tavily",
      label: t("webSearchProviderTavily"),
      description: t("webSearchProviderTavilyDesc"),
      logo: "/logos/tavily-color.svg",
    },
    {
      value: "exa",
      label: t("webSearchProviderExa"),
      description: t("webSearchProviderExaDesc"),
      logo: "/logos/exa-color.svg",
    },
  ];
}

export function getShellOptions() {
  return [
    {
      value: "bash",
      label: "Bash",
      description: t("shellBashDesc"),
      icon: Terminal,
    },
    {
      value: "powershell",
      label: "PowerShell",
      description: t("shellPowershellDesc"),
      icon: WindowsLogo,
    },
    {
      value: "zsh",
      label: "Zsh",
      description: t("shellZshDesc"),
      icon: TerminalWindow,
    },
    {
      value: "cmd",
      label: "CMD",
      description: t("shellCmdDesc"),
      icon: Command,
    },
  ];
}

export function getReplyLanguageOptions() {
  return [
    { value: "zh", label: t("replyLanguageZh") },
    { value: "en", label: t("replyLanguageEn") },
  ];
}

const OPTION_GETTERS = {
  executionMode: getExecutionModeOptions,
  planExecutionModel: getPlanExecutionModelOptions,
  approvalMode: getApprovalModeOptions,
  provider: getProviderOptions,
  searchProvider: getSearchProviderOptions,
  shell: getShellOptions,
  replyLanguage: getReplyLanguageOptions,
};

export function getSettingsOptions(key) {
  const getter = OPTION_GETTERS[key];
  return typeof getter === "function" ? getter() : [];
}

export const SETTINGS_TABS = [
  { id: "connection", labelKey: "gateway" },
  { id: "model", labelKey: "model" },
  { id: "execution", labelKey: "execution" },
  { id: "web", labelKey: "webSearch" },
  { id: "context", labelKey: "context" },
  { id: "shell", labelKey: "shell" },
  { id: "storage", labelKey: "storage" },
  { id: "policy", labelKey: "policy" },
];
