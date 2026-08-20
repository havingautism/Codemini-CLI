import {
  Code,
  Coffee,
  Command,
  HardDrives,
  Lock,
  LockOpen,
  ShieldWarning,
  Sparkle,
  Terminal,
  TerminalWindow,
  Warning,
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

export function getSandboxModeOptions() {
  return [
    {
      value: "read-only",
      label: t("sandboxReadOnlyMode"),
      description: t("sandboxReadOnlyModeDesc"),
      icon: Lock,
    },
    {
      value: "workspace-write",
      label: t("sandboxWorkspaceWriteMode"),
      description: t("sandboxWorkspaceWriteModeDesc"),
      icon: HardDrives,
    },
    {
      value: "danger-full-access",
      label: t("sandboxDangerFullAccessMode"),
      description: t("sandboxDangerFullAccessModeDesc"),
      icon: Warning,
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
    {
      value: "firecrawl",
      label: t("webSearchProviderFirecrawl"),
      description: t("webSearchProviderFirecrawlDesc"),
      logo: "/logos/firecrawl-color.svg",
    },
  ];
}

export function getShellOptions({ sandboxMode = "danger-full-access" } = {}) {
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
  ].map((option) => ({
    ...option,
    disabled: sandboxMode !== "danger-full-access" && option.value !== "bash",
  }));
}

export function getReplyLanguageOptions() {
  return [
    { value: "zh", label: t("replyLanguageZh") },
    { value: "en", label: t("replyLanguageEn") },
  ];
}

const OPTION_GETTERS = {
  sandboxMode: getSandboxModeOptions,
  executionMode: getExecutionModeOptions,
  approvalMode: getApprovalModeOptions,
  provider: getProviderOptions,
  searchProvider: getSearchProviderOptions,
  shell: getShellOptions,
  replyLanguage: getReplyLanguageOptions,
};

export function getSettingsOptions(key, context) {
  const getter = OPTION_GETTERS[key];
  return typeof getter === "function" ? getter(context) : [];
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
