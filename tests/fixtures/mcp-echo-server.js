import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'codemini-test-server', version: '1.0.0' });
server.registerTool(
  'echo',
  {
    description: 'Echo a value for Codemini MCP integration tests',
    inputSchema: { value: z.string() },
  },
  async ({ value }) => ({ content: [{ type: 'text', text: `echo:${value}` }] }),
);

await server.connect(new StdioServerTransport());
