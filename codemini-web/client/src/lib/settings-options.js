import {
  Code,
  Coffee,
  HardDrives,
  Lightning,
  Lock,
  LockOpen,
  ShieldWarning,
  Terminal,
  TreeStructure,
  Warning,
  WindowsLogo,
} from "./icons.js";
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
    {
      value: "crew",
      label: t("crewMode"),
      description: t("crewModeDesc"),
      icon: TreeStructure,
      disabled: true,
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
      icon: Lightning,
    },
    {
      value: "full_access",
      label: t("fullAccessMode"),
      description: t("fullAccessModeDesc"),
      icon: LockOpen,
    },
  ];
}

export function usesMicroVm({ sandboxMode, availability } = {}) {
  return sandboxMode !== "danger-full-access" && availability?.backend === "vm";
}

export function usesWindowsHostShell({ sandboxMode, availability } = {}) {
  return availability?.platform === "win32" && !usesMicroVm({ sandboxMode, availability });
}

export function getSandboxModeOptions({ sandboxMode, availability = null } = {}) {
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
  ].filter((option) =>
    option.value === "danger-full-access"
    || (availability?.confineAvailable !== false
      && (option.value !== "workspace-write" || sandboxMode !== "danger-full-access")),
  );
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

export function getShellOptions({ sandboxMode = "danger-full-access", availability = null } = {}) {
  const microVm = usesMicroVm({ sandboxMode, availability });
  const windowsHost = usesWindowsHostShell({ sandboxMode, availability });
  return [
    {
      value: "bash",
      label: "Bash",
      description: t("shellBashDesc"),
      icon: Terminal,
    },
    {
      value: "powershell",
      label: "PowerShell (pwsh)",
      description: t("shellPowershellDesc"),
      icon: WindowsLogo,
    },
  ].filter((option) => microVm ? option.value === "bash" : !windowsHost || option.value === "powershell");
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
  harnessProvider: () => [
    { value: "rules", label: t("harnessProviderRules") },
    { value: "jev", label: "Jev" },
    { value: "laya", label: "Laya" },
  ],
  harnessDecisionMode: () => [
    { value: "advisory", label: "建议模式" },
    { value: "external_authority", label: "外部决策接管（高风险）" },
  ],
  distillationMode: () => [
    { value: "shadow", label: t("distillationShadow") },
    { value: "filter", label: t("distillationFilter") },
  ],
};

export function getSettingsOptions(key, context) {
  const getter = OPTION_GETTERS[key];
  return typeof getter === "function" ? getter(context) : [];
}

export const SETTINGS_TABS = [
  { id: "connection", labelKey: "gateway" },
  { id: "model", labelKey: "model" },
  { id: "decision", labelKey: "decision" },
  { id: "execution", labelKey: "execution" },
  { id: "web", labelKey: "webSearch" },
  { id: "context", labelKey: "context" },
  { id: "shell", labelKey: "shell" },
  { id: "storage", labelKey: "storage" },
  { id: "policy", labelKey: "policy" },
  { id: "appearance", labelKey: "appearanceSettings" },
];
