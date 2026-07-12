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
