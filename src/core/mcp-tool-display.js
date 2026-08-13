/** Browser-safe MCP tool naming / display helpers (no Node SDK imports). */

function safeToolPart(value, fallback = 'tool') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (normalized || fallback).slice(0, 28);
}

export function mcpToolName(server, toolName) {
  const serverId = typeof server === 'object' && server ? server.id : server;
  return `mcp__${safeToolPart(serverId, 'server')}__${safeToolPart(toolName)}`.slice(0, 64);
}

export function formatMcpToolDisplayLabel(server, toolName) {
  const serverLabel = String(
    (typeof server === 'object' && server ? server.name || server.id : server) || 'server',
  ).trim() || 'server';
  const remoteName = String(toolName || 'tool').trim() || 'tool';
  return `MCP/${serverLabel} · ${remoteName}`;
}

export function buildMcpToolDisplayLabels(servers = []) {
  const labels = {};
  const usedNames = new Set();
  for (const server of Array.isArray(servers) ? servers : []) {
    if (!server || server.enabled === false || !String(server.id || '').trim()) continue;
    const tools = Array.isArray(server.cachedTools) ? server.cachedTools : [];
    for (const tool of tools) {
      if (!tool || tool.enabled === false || !String(tool.name || '').trim()) continue;
      let name = mcpToolName(server, tool.name);
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${mcpToolName(server, tool.name).slice(0, 60)}_${suffix++}`;
      }
      usedNames.add(name);
      labels[name] = formatMcpToolDisplayLabel(server, tool.name);
    }
  }
  return labels;
}

export function isMcpToolName(name) {
  return /^mcp__/i.test(String(name || '').trim());
}
