import {
  Brain,
  ChartLine,
  Code,
  Coffee,
  LockOpen,
  Plug,
  ShieldWarning,
  Sparkle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { t } from "../../i18n/index.js";

const STAGE_LIVE_CLASS = "linear-status-dot linear-status-dot--sm";

const MODEL_LOGO_MAP = [
  { pattern: /\bdeepseek\b/i, logo: "/logos/deepseek-color.svg" },
  { pattern: /\bopenai\b/i, logo: "/logos/openai.svg" },
  { pattern: /\bgpt\b/i, logo: "/logos/openai.svg" },
  { pattern: /\bo[134]\b/i, logo: "/logos/openai.svg" },
  { pattern: /\bgemini\b/i, logo: "/logos/gemini-color.svg" },
  { pattern: /\bqwen\b/i, logo: "/logos/qwen-color.svg" },
  { pattern: /\bchatglm\b/i, logo: "/logos/chatglm-color.svg" },
  { pattern: /\bglm-/i, logo: "/logos/glm-color.svg" },
  { pattern: /\bkimi\b/i, logo: "/logos/kimi-color.svg" },
  { pattern: /\bminimax\b/i, logo: "/logos/minimax-color.svg" },
  { pattern: /\bmoonshot\b/i, logo: "/logos/moonshot.svg" },
  { pattern: /\bnvidia\b/i, logo: "/logos/nvidia-color.svg" },
  { pattern: /\bzhipu\b/i, logo: "/logos/zhipu-color.svg" },
  { pattern: /\bclaude\b/i, logo: "/logos/claude-color.svg" },
];

const SDK_LOGO_MAP = {
  "openai-compatible": "/logos/openai.svg",
  anthropic: "/logos/claude-color.svg",
};

function getModelLogo(modelName) {
  if (!modelName) return null;
  for (const { pattern, logo } of MODEL_LOGO_MAP) {
    if (pattern.test(modelName)) return logo;
  }
  return null;
}

function ModelLogo({ src, size = 13 }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-sm object-contain"
    />
  );
}

export function StatusBar({ runtimeState, live, stageLabel }) {
  const rs = runtimeState || {};
  const mode = rs.mode || "normal";
  const approvalMode = rs.approvalMode || "review";
  const used = rs.currentContextTokens || 0;
  const max = rs.maxContextTokens || 0;
  const pct = max ? Math.round((used / max) * 100) : 0;
  const contextColor =
    pct < 40
      ? "bg-(--accent-green)"
      : pct < 75
        ? "bg-(--accent-orange)"
        : "bg-(--accent-red)";

  const modelLogo = getModelLogo(rs.model);
  const sdkLogo = SDK_LOGO_MAP[rs.sdkProvider];
  const WorkIcon = mode === "plan" ? Code : Coffee;
  const workLabel = mode === "plan" ? t("planMode") : t("normalExecutionMode");
  const ApprovalIcon =
    approvalMode === "full_access"
      ? LockOpen
      : approvalMode === "auto"
        ? Sparkle
        : ShieldWarning;
  const approvalLabel =
    approvalMode === "full_access"
      ? t("fullAccessMode")
      : approvalMode === "auto"
        ? t("autoMode")
        : t("reviewMode");

  return (
    <div className="flex items-center gap-2.5 flex-1 min-w-0 text-[11px] text-(--text-muted) overflow-hidden">
      {/* <span className="hidden sm:inline-flex items-center gap-1 whitespace-nowrap">
        <WorkIcon size={13} className="shrink-0 opacity-70" />
        <span>{workLabel}</span>
      </span>
      <span className="hidden md:inline-flex items-center gap-1 whitespace-nowrap">
        <ApprovalIcon size={13} className="shrink-0 opacity-70" />
        <span>{approvalLabel}</span>
      </span> */}
      <span className="hidden xl:inline-flex items-center gap-1 whitespace-nowrap">
        {sdkLogo ? (
          <ModelLogo src={sdkLogo} />
        ) : (
          <Plug size={13} className="shrink-0 opacity-70" />
        )}
        <span>{rs.sdkProvider?.toUpperCase() || "-"}</span>
      </span>
      <span className="hidden lg:inline-flex items-center gap-1 whitespace-nowrap">
        {modelLogo ? (
          <ModelLogo src={modelLogo} />
        ) : (
          <Brain size={13} className="shrink-0 opacity-70" />
        )}
        <span>{rs.model?.toUpperCase() || "-"}</span>
      </span>

      {max > 0 && (
        <span className="hidden lg:inline-flex items-center gap-1 whitespace-nowrap">
          <ChartLine size={13} className="shrink-0 opacity-70" />
          <span>CTX</span>
          <span className="w-12 h-1 bg-(--muted) rounded-full overflow-hidden">
            <span
              className={cn(
                "block h-full rounded-full transition-all",
                contextColor,
              )}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span>{pct}%</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1 ml-auto whitespace-nowrap">
        {live ? (
          <span
            className={cn(STAGE_LIVE_CLASS, "shrink-0")}
            aria-hidden="true"
          />
        ) : (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 bg-(--text-muted)"
            aria-hidden="true"
          />
        )}
        <span>{live ? stageLabel : t("idle")}</span>
      </span>
    </div>
  );
}
