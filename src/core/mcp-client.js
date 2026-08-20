import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  formatMcpToolDisplayLabel,
  mcpToolName,
} from './mcp-tool-display.js';
import { setMcpToolDisplayLabels } from './tool-display.js';

export { formatMcpToolDisplayLabel, mcpToolName } from './mcp-tool-display.js';

const CLIENT_NAME = 'codemini-cli';
const CLIENT_VERSION = '0.8.4';
const DEFAULT_TIMEOUT_MS = 30_000;
const runtimeClients = new Map();
// In-flight connection creations keyed by server id, so concurrent
// getRuntimeConnection calls share one connection instead of spawning
// duplicate stdio MCP servers (and orphaning one of them).
const pendingConnections = new Map();
let closeAllPromise = null;

function stringRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [String(key).trim(), String(item ?? '')])
      .filter(([key]) => key),
  );
}

function stringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '')).filter(Boolean)
    : [];
}

export function normalizeMcpServer(input = {}) {
  const transport = String(input.transport || input.type || 'stdio').toLowerCase();
  const id = String(input.id || input.name || '').trim();
  return {
    id,
    name: String(input.name || id).trim(),
    enabled: input.enabled !== false,
    transport: ['http', 'streamable-http', 'streamable_http'].includes(transport)
      ? 'http'
      : 'stdio',
    command: String(input.command || '').trim(),
    args: stringList(input.args),
    env: stringRecord(input.env),
    cwd: String(input.cwd || '').trim(),
    url: String(input.url || '').trim(),
    headers: stringRecord(input.headers),
    timeoutMs: Math.max(1_000, Number(input.timeoutMs || input.timeout_ms || DEFAULT_TIMEOUT_MS)),
    cachedTools: Array.isArray(input.cachedTools)
      ? input.cachedTools.map(normalizeCachedTool).filter((tool) => tool.name)
      : [],
    instructions: String(input.instructions || '').trim(),
    lastConnectedAt: String(input.lastConnectedAt || '').trim(),
  };
}

function normalizeCachedTool(tool = {}) {
  return {
    name: String(tool.name || '').trim(),
    description: String(tool.description || '').trim(),
    enabled: tool.enabled !== false,
    inputSchema:
      tool.inputSchema && typeof tool.inputSchema === 'object'
        ? tool.inputSchema
        : { type: 'object', properties: {} },
  };
}

export function validateMcpServer(input = {}) {
  const server = normalizeMcpServer(input);
  if (!server.id || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(server.id)) {
    throw new Error('MCP server id must use letters, numbers, dots, underscores, or hyphens.');
  }
  if (!server.name) throw new Error('MCP server name is required.');
  if (server.transport === 'stdio' && !server.command) {
    throw new Error('A command is required for a stdio MCP server.');
  }
  if (server.transport === 'http') {
    let parsed;
    try {
      parsed = new URL(server.url);
    } catch {
      throw new Error('A valid MCP server URL is required.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('MCP URL must use http or https.');
    }
  }
  return server;
}

function resolveEnvValue(value) {
  const text = String(value ?? '');
  const match = text.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  return match ? String(process.env[match[1]] || '') : text;
}

function resolvedRecord(record) {
  return Object.fromEntries(
    Object.entries(record || {}).map(([key, value]) => [key, resolveEnvValue(value)]),
  );
}

function serverSignature(server) {
  return JSON.stringify({
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd,
    url: server.url,
    headers: server.headers,
  });
}

function timeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

async function createConnection(serverInput) {
  const server = validateMcpServer(serverInput);
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
  const transport = server.transport === 'http'
    ? new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: resolvedRecord(server.headers) },
      })
    : new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: { ...process.env, ...resolvedRecord(server.env) },
        cwd: server.cwd ? path.resolve(server.cwd) : undefined,
        stderr: 'pipe',
      });
  try {
    await timeout(client.connect(transport), server.timeoutMs, `Connecting to ${server.name}`);
    return { client, transport, server, signature: serverSignature(server) };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

async function getRuntimeConnection(serverInput) {
  const server = validateMcpServer(serverInput);
  const signature = serverSignature(server);
  const existing = runtimeClients.get(server.id);
  if (existing?.signature === signature) return existing;
  // Another call is already creating a fresh connection for this server id:
  // await it instead of racing (a second createConnection would spawn and
  // then orphan a second stdio MCP server process).
  const pending = pendingConnections.get(server.id);
  if (pending) return pending;
  const promise = (async () => {
    if (existing) await existing.client.close().catch(() => {});
    const connection = await createConnection(server);
    runtimeClients.set(server.id, connection);
    return connection;
  })();
  pendingConnections.set(server.id, promise);
  try {
    return await promise;
  } finally {
    if (pendingConnections.get(server.id) === promise) pendingConnections.delete(server.id);
  }
}

export async function inspectMcpServer(serverInput) {
  const connection = await createConnection(serverInput);
  try {
    const response = await timeout(
      connection.client.listTools(),
      connection.server.timeoutMs,
      `Listing tools from ${connection.server.name}`,
    );
    return {
      ok: true,
      server: connection.server.id,
      tools: (response?.tools || []).map(normalizeCachedTool).filter((tool) => tool.name),
      instructions: String(connection.client.getServerCapabilities?.()?.instructions || connection.client.getInstructions?.() || ''),
      connectedAt: new Date().toISOString(),
    };
  } finally {
    await connection.client.close().catch(() => {});
  }
}

function configuredServers(config = {}) {
  const servers = Array.isArray(config?.mcp?.servers) ? config.mcp.servers : [];
  return servers.map(normalizeMcpServer).filter((server) => server.enabled && server.id);
}

export function getMcpToolBundle(config = {}) {
  const definitions = [];
  const handlers = {};
  const formatters = {};
  const displayLabels = {};
  const usedNames = new Set();

  for (const server of configuredServers(config)) {
    for (const tool of server.cachedTools.filter((item) => item.enabled !== false)) {
      let name = mcpToolName(server, tool.name);
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${mcpToolName(server, tool.name).slice(0, 60)}_${suffix++}`;
      }
      usedNames.add(name);
      displayLabels[name] = formatMcpToolDisplayLabel(server, tool.name);
      definitions.push({
        type: 'function',
        function: {
          name,
          description: `[MCP: ${server.name}] ${tool.description || tool.name}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      });
      handlers[name] = async (args = {}) => {
        const connection = await getRuntimeConnection(server);
        return timeout(
          connection.client.callTool({ name: tool.name, arguments: args }),
          server.timeoutMs,
          `${server.name}.${tool.name}`,
        );
      };
      formatters[name] = (result) => {
        if (!result || typeof result !== 'object') return String(result ?? '');
        const content = Array.isArray(result.content) ? result.content : [];
        const lines = content.map((item) => {
          if (item?.type === 'text') return String(item.text || '');
          if (item?.type === 'resource') return JSON.stringify(item.resource || item);
          if (item?.type === 'image' || item?.type === 'audio') {
            return `[${item.type} content from ${server.name}.${tool.name}]`;
          }
          return JSON.stringify(item);
        }).filter(Boolean);
        if (result.structuredContent !== undefined) {
          lines.push(JSON.stringify(result.structuredContent));
        }
        if (result.isError) lines.unshift(`[MCP tool error: ${server.name}.${tool.name}]`);
        return lines.join('\n') || JSON.stringify(result);
      };
    }
  }
  setMcpToolDisplayLabels(displayLabels);
  return { definitions, handlers, formatters, displayLabels };
}

export async function closeMcpClient(serverId) {
  const id = String(serverId || '').trim();
  // Wait for an in-flight creation to settle so we never orphan the stdio
  // server process it is about to spawn, then close whatever it created.
  const pending = pendingConnections.get(id);
  if (pending) {
    try {
      await pending;
    } catch {
      // creation failed; nothing was registered
    }
    if (pendingConnections.get(id) === pending) pendingConnections.delete(id);
  }
  const existing = runtimeClients.get(id);
  runtimeClients.delete(id);
  await existing?.client?.close().catch(() => {});
}

/**
 * Best-effort close of every runtime MCP connection. Safe to call at shutdown
 * (exit handlers below); in-session callers must not use this mid-turn because
 * it tears down live connections. Runs at most once per process.
 */
export function closeAllMcpClients() {
  if (closeAllPromise) return closeAllPromise;
  const connections = [...runtimeClients.values()];
  runtimeClients.clear();
  pendingConnections.clear();
  closeAllPromise = Promise.allSettled(
    connections.map((connection) => connection.client.close().catch(() => {})),
  ).then(() => undefined);
  return closeAllPromise;
}

// Module-level safeguard: only act when the process is actually exiting, never
// mid-session. 'beforeExit' lets the async close complete on natural exit;
// 'exit' is the last chance fallback (fire-and-forget — the OS reaps the
// stdio children's pipes regardless).
process.on('beforeExit', () => {
  void closeAllMcpClients().catch(() => {});
});
process.on('exit', () => {
  try {
    void closeAllMcpClients().catch(() => {});
  } catch {
    // never throw from an exit handler
  }
});
