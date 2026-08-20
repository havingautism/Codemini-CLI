const SDK_IDENTITIES = {
  "openai-compatible": {
    sdkLabel: "OpenAI-compatible",
    logo: "/logos/openai.svg",
  },
  anthropic: {
    sdkLabel: "Anthropic",
    logo: "/logos/claude-color.svg",
  },
};

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

export function getModelLogo(modelName) {
  const name = String(modelName || "").trim();
  if (!name) return null;
  for (const { pattern, logo } of MODEL_LOGO_MAP) {
    if (pattern.test(name)) return logo;
  }
  return null;
}

function sameModelName(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

/** Resolve the persisted SDK/model pair into branded UI fields. */
export function getMessageModelIdentity({ sdkProvider, model } = {}) {
  const providerKey = String(sdkProvider || "").trim().toLowerCase();
  const provider = SDK_IDENTITIES[providerKey];
  const modelName = String(model || "").trim();
  if (!provider || !modelName) return null;

  return {
    logo: provider.logo,
    sdkLabel: provider.sdkLabel,
    model: modelName,
    modelLogo: getModelLogo(modelName),
    details: `${provider.sdkLabel} · ${modelName}`,
  };
}

/** Shape the hover panel for the message model badge. */
export function buildModelPanelModel({ sdkProvider, model, runtimeState } = {}) {
  const identity = getMessageModelIdentity({ sdkProvider, model });
  if (!identity) return null;

  const rs = runtimeState && typeof runtimeState === "object" ? runtimeState : {};
  const mainModel = String(rs.mainModel || rs.model || "").trim();
  const fastModel = String(rs.fastModel || "").trim();
  const used = Number(rs.currentContextTokens);
  const max = Number(rs.maxContextTokens);
  const hasContext = Number.isFinite(max) && max > 0;
  const pct = Number.isFinite(Number(rs.contextUsagePct))
    ? Math.min(100, Math.max(0, Math.round(Number(rs.contextUsagePct))))
    : hasContext && Number.isFinite(used)
      ? Math.min(100, Math.max(0, Math.round((used / max) * 100)))
      : 0;

  return {
    identity,
    sdkLabel: identity.sdkLabel,
    replyModel: identity.model,
    mainModel,
    fastModel,
    showReplyModel: Boolean(
      identity.model && mainModel && !sameModelName(identity.model, mainModel),
    ),
    context: hasContext
      ? {
          used: Number.isFinite(used) ? Math.max(0, used) : 0,
          max,
          pct,
        }
      : null,
  };
}
