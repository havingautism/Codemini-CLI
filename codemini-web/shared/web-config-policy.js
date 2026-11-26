// Keep frontend controls and server-side write permissions aligned.
export const WEB_CONFIG_INTEGER_LIMITS = Object.freeze({
  'execution.max_steps': Object.freeze({ min: 1, max: 1000 }),
  'execution.incomplete_retries': Object.freeze({ min: 0, max: 10 }),
  'harness.distillation.max_candidates': Object.freeze({ min: 1, max: 16 }),
});

export const MODEL_CONNECTION_KEYS = Object.freeze([
  'sdk.provider', 'gateway.preset', 'gateway.base_url', 'gateway.api_key', 'model.name', 'model.fast_name',
]);

const cleanModelEndpoint = (value) => String(value || '').trim().replace(/\/+$/, '');

export function modelConnectionChanged(config, changes) {
  return ('gateway.base_url' in changes && cleanModelEndpoint(changes['gateway.base_url']) !== cleanModelEndpoint(config?.gateway?.base_url))
    || ('sdk.provider' in changes && changes['sdk.provider'] !== config?.sdk?.provider);
}

export function validatePresetConnection(config, values, providers) {
  const selected = values['gateway.preset'];
  const presetId = selected ?? config?.gateway?.preset;
  if (!presetId || presetId === 'custom') return;
  const preset = providers.find(({ id }) => id === presetId);
  if (!preset?.baseUrl) {
    if (selected !== undefined) throw new Error('This provider preset has no supported endpoint');
    return;
  }
  const priorUrl = cleanModelEndpoint(config?.gateway?.base_url);
  if (selected === undefined && (priorUrl !== preset.baseUrl || config?.sdk?.provider !== preset.protocol)) return;
  const endpoint = cleanModelEndpoint(values['gateway.base_url'] ?? priorUrl);
  const protocol = values['sdk.provider'] ?? config?.sdk?.provider;
  if (endpoint !== preset.baseUrl || protocol !== preset.protocol) {
    throw new Error('Choose Custom connection before editing the preset endpoint or protocol');
  }
}

export function validateModelConnection(values) {
  const entries = Object.entries(values || {});
  if (!entries.length || entries.some(([key, value]) =>
    !MODEL_CONNECTION_KEYS.includes(key) || typeof value !== 'string')) {
    throw new Error('Invalid model connection settings');
  }
  if ('sdk.provider' in values && !['anthropic', 'openai-compatible'].includes(values['sdk.provider'])) {
    throw new Error('Invalid model connection protocol');
  }
  if ('gateway.base_url' in values) {
    const endpoint = URL.parse(values['gateway.base_url']);
    if (!endpoint || !['https:', 'http:'].includes(endpoint.protocol)
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('Enter an HTTP or HTTPS base URL without credentials, query parameters, or a fragment');
    }
  }
  if ('model.name' in values && !values['model.name'].trim()) throw new Error('Enter a model ID');
  return entries;
}

const WEB_CONFIG_SWITCHES = Object.freeze({
  'sandbox.network': Object.freeze({ values: Object.freeze(['none', 'allow-all']) }),
  'webui.terminal_enabled': Object.freeze({ type: 'boolean' }),
  'policy.safe_mode': Object.freeze({ type: 'boolean' }),
  'policy.allow_dangerous_commands': Object.freeze({ type: 'boolean' }),
});

export function isWebConfigReadOnly(key) {
  if (Object.hasOwn(WEB_CONFIG_SWITCHES, key) || key === 'policy.allowed_paths') return false;
  return /^(policy|sandbox|execution|shell|webui)(\.|$)/.test(key)
    && key !== 'shell.default'
    && !Object.hasOwn(WEB_CONFIG_INTEGER_LIMITS, key);
}

export function validateWebConfigValue(key, value) {
  if (key === 'shell.default') {
    if (!['bash', 'powershell'].includes(value)) {
      throw new Error('shell.default must be bash or powershell');
    }
    return;
  }
  const toggle = WEB_CONFIG_SWITCHES[key];
  if (toggle?.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
    return;
  }
  if (toggle?.values) {
    if (!toggle.values.includes(value)) throw new Error(`${key} must be ${toggle.values.join(' or ')}`);
    return;
  }
  if (key === 'policy.allowed_paths') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error(`${key} must be an array of directory paths`);
    }
    return;
  }
  if (key === 'harness.distillation.confidence_threshold') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 1) {
      throw new Error(`${key} must be a number between 0.5 and 1`);
    }
    return;
  }
  if (!Object.hasOwn(WEB_CONFIG_INTEGER_LIMITS, key)) return;
  const { min, max } = WEB_CONFIG_INTEGER_LIMITS[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
}
