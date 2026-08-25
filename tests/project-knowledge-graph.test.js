import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  initializeProjectIndex,
  refreshIndexedFile,
} from '../src/core/project-index.js';
import { queryProjectKnowledgeGraph } from '../src/core/project-knowledge-graph.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-graph-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"graph-fixture","type":"module"}\n');
  await fs.writeFile(
    path.join(root, 'src', 'helper.js'),
    'export function helper() { return 1; }\n',
  );
  await fs.writeFile(
    path.join(root, 'src', 'main.js'),
    "import { helper } from './helper.js';\nexport function start() { return helper(); }\nexport const runArrow = () => helper();\n",
  );
  await fs.writeFile(
    path.join(root, 'tests', 'main.test.js'),
    "import { start } from '../src/main.js';\nexport function verifiesStart() { return start(); }\n",
  );
  await fs.writeFile(
    path.join(root, 'src', 'server.js'),
    "export function route(req, url) { if (req.method === 'GET' && url.pathname === '/api/items') return 1; }\n",
  );
  return root;
}

test('project knowledge graph persists evidence-backed nodes and supports path queries', async (t) => {
  const root = await createProject();
  t.after(async () => {
    closeSqliteDatabasesForTests(root);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  });

  await initializeProjectIndex(root);
  const overview = queryProjectKnowledgeGraph(root, {
    operation: 'overview',
    depth: 2,
    token_budget: 8000,
  });
  assert.ok(overview.stats.total_nodes >= 7);
  assert.ok(overview.edges.some((edge) => edge.relation === 'imports'));
  assert.ok(overview.edges.some((edge) => edge.relation === 'defines'));
  assert.ok(overview.nodes.some((node) => node.label === 'runArrow'));
  assert.ok(overview.nodes.some((node) => node.type === 'interface' && node.label === 'GET /api/items'));
  assert.ok(overview.edges.every((edge) => edge.confidence && edge.evidence?.resolver));

  const pathResult = queryProjectKnowledgeGraph(root, {
    operation: 'path',
    from: 'start',
    to: 'helper',
  });
  assert.deepEqual(
    pathResult.nodes.map((node) => node.label),
    ['start', 'helper'],
  );
  assert.equal(pathResult.edges[0].relation, 'calls');
  assert.equal(pathResult.edges[0].confidence, 'INFERRED');
});

test('project knowledge graph version changes after an indexed source edit', async (t) => {
  const root = await createProject();
  t.after(async () => {
    closeSqliteDatabasesForTests(root);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  });

  await initializeProjectIndex(root);
  const before = queryProjectKnowledgeGraph(root, { operation: 'overview', depth: 0 });
  await fs.writeFile(
    path.join(root, 'src', 'helper.js'),
    'export function helper() { return 2; }\n',
  );
  await refreshIndexedFile(root, 'src/helper.js');
  const after = queryProjectKnowledgeGraph(root, { operation: 'overview', depth: 0 });
  assert.notEqual(after.graph_version, before.graph_version);
  assert.ok(new Date(after.built_at) >= new Date(before.built_at));
});

test('project knowledge graph version ignores index refresh timestamps', async (t) => {
  const root = await createProject();
  t.after(async () => {
    closeSqliteDatabasesForTests(root);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  });

  await initializeProjectIndex(root);
  const before = queryProjectKnowledgeGraph(root, { operation: 'overview', depth: 0 });
  await refreshIndexedFile(root, 'src/helper.js');
  const after = queryProjectKnowledgeGraph(root, { operation: 'overview', depth: 0 });
  assert.equal(after.graph_version, before.graph_version);
  assert.equal(after.built_at, before.built_at);
});

test('project indexing keeps same-name symbols from different scopes distinct', async (t) => {
  const root = await createProject();
  t.after(async () => {
    closeSqliteDatabasesForTests(root);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  });
  await fs.writeFile(
    path.join(root, 'src', 'scopes.js'),
    [
      'export function first() { function handler() { return 1; } return handler(); }',
      'export function second() { function handler() { return 2; } return handler(); }',
      '',
    ].join('\n'),
  );

  const initialized = await initializeProjectIndex(root);
  const entry = initialized.fileIndex.files.find((file) => file.file === 'src/scopes.js');
  const handlers = entry.symbols.filter((symbol) => symbol.name === 'handler');
  assert.equal(handlers.length, 2);
  assert.equal(new Set(handlers.map((symbol) => symbol.symbol_id)).size, 2);
});
