import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('workspace and terminal routes share a request-scoped cwd resolver', async () => {
  const source = await fs.readFile('codemini-web/server.js', 'utf8');
  const resolver = source.indexOf('const resolveTerminalCwd = async (url, body = {}) =>');
  const workspaceRoute = source.indexOf('routes.get("/api/workspace/tree"');
  const requestHandler = source.indexOf('const handleRequest = async (req, res) =>');

  assert.ok(resolver >= 0, 'expected a cwd resolver that accepts the route URL');
  assert.ok(resolver < workspaceRoute, 'cwd resolver must be visible to registered routes');
  assert.ok(workspaceRoute < requestHandler, 'expected workspace route registration');
  assert.match(source, /routes\.get\("\/api\/workspace\/tree"[\s\S]*?resolveTerminalCwd\(url\)/);
  assert.match(source, /routes\.get\("\/api\/terminal\/stream"[\s\S]*?resolveTerminalCwd\(url\)/);
  assert.match(source, /routes\.post\("\/api\/terminal\/resize"[\s\S]*?resolveTerminalCwd\(url, body\)/);
});
