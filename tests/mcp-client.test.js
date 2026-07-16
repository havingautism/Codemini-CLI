import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getMcpToolBundle,
  closeMcpClient,
  inspectMcpServer,
  mcpToolName,
  normalizeMcpServer,
  validateMcpServer,
} from '../src/core/mcp-client.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('normalizes stdio and Streamable HTTP MCP server configs', () => {
  const stdio = normalizeMcpServer({
    id: 'files',
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@example/server'],
    env: { TOKEN: '${MCP_TOKEN}' },
  });
  assert.equal(stdio.transport, 'stdio');
  assert.equal(stdio.timeoutMs, 30000);
  assert.deepEqual(stdio.args, ['-y', '@example/server']);

  const http = validateMcpServer({
    id: 'remote',
    name: 'Remote',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
  });
  assert.equal(http.transport, 'http');
  assert.equal(http.url, 'https://example.com/mcp');
});

test('rejects invalid MCP server configs', () => {
  assert.throws(
    () => validateMcpServer({ id: 'bad id', name: 'Bad', command: 'node' }),
    /server id/i,
  );
  assert.throws(
    () => validateMcpServer({ id: 'local', name: 'Local', transport: 'stdio' }),
    /command/i,
  );
  assert.throws(
    () => validateMcpServer({ id: 'remote', name: 'Remote', transport: 'http', url: 'file:///tmp/mcp' }),
    /http or https/i,
  );
});

test('builds namespaced agent tools from cached MCP schemas', () => {
  const config = {
    mcp: {
      servers: [
        {
          id: 'git-hub',
          name: 'GitHub',
          enabled: true,
          transport: 'http',
          url: 'https://example.com/mcp',
          cachedTools: [
            {
              name: 'list_issues',
              description: 'List repository issues',
              inputSchema: {
                type: 'object',
                properties: { repo: { type: 'string' } },
                required: ['repo'],
              },
            },
          ],
        },
      ],
    },
  };
  const bundle = getMcpToolBundle(config);
  const name = mcpToolName(config.mcp.servers[0], 'list_issues');
  assert.equal(name, 'mcp__git-hub__list_issues');
  assert.equal(bundle.definitions.length, 1);
  assert.equal(bundle.definitions[0].function.name, name);
  assert.deepEqual(bundle.definitions[0].function.parameters.required, ['repo']);
  assert.equal(typeof bundle.handlers[name], 'function');
  assert.equal(typeof bundle.formatters[name], 'function');
});

test('does not expose disabled or untested MCP servers to the agent', () => {
  const bundle = getMcpToolBundle({
    mcp: {
      servers: [
        { id: 'disabled', enabled: false, command: 'node', cachedTools: [{ name: 'x' }] },
        { id: 'untested', enabled: true, command: 'node', cachedTools: [] },
      ],
    },
  });
  assert.deepEqual(bundle.definitions, []);
  assert.deepEqual(bundle.handlers, {});
});

test('discovers and invokes tools from a real stdio MCP server', async () => {
  const server = {
    id: 'echo-fixture',
    name: 'Echo fixture',
    transport: 'stdio',
    command: process.execPath,
    args: [path.join(fixtureDir, 'mcp-echo-server.js')],
    timeoutMs: 5000,
  };
  const inspection = await inspectMcpServer(server);
  assert.equal(inspection.ok, true);
  assert.deepEqual(inspection.tools.map((tool) => tool.name), ['echo']);

  const configured = { ...server, cachedTools: inspection.tools };
  const bundle = getMcpToolBundle({ mcp: { servers: [configured] } });
  const name = mcpToolName(configured, 'echo');
  try {
    const result = await bundle.handlers[name]({ value: 'hello' });
    assert.equal(result.content[0].text, 'echo:hello');
    assert.equal(bundle.formatters[name](result), 'echo:hello');
  } finally {
    await closeMcpClient(server.id);
  }
});
