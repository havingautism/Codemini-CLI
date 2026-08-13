const MCP_DISCOVERY_INPUTS = new Set([
  'transport',
  'command',
  'argsText',
  'envText',
  'cwd',
  'url',
  'headersText',
]);

export function applyMcpEditorPatch(current = {}, patch = {}) {
  const invalidatesDiscovery = Object.entries(patch).some(
    ([key, value]) => MCP_DISCOVERY_INPUTS.has(key) && !Object.is(current[key], value),
  );
  return {
    ...current,
    ...patch,
    ...(invalidatesDiscovery
      ? { cachedTools: [], instructions: '', lastConnectedAt: '' }
      : {}),
  };
}
