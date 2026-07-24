import path from 'node:path';
import { createHash } from 'node:crypto';
import { getProjectDatabase, transaction } from './sqlite-database.js';

const GRAPH_SCHEMA_VERSION = 1;
const DEFAULT_MAX_NODES = 80;
const DEFAULT_TOKEN_BUDGET = 2400;

function normalizePath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function graphVersion(fileIndex = {}) {
  const digest = createHash('sha256');
  digest.update(String(fileIndex.updatedAt || ''));
  for (const entry of fileIndex.files || []) {
    digest.update(`${entry.file}:${entry.hash || entry.mtimeMs || ''}\n`);
  }
  return digest.digest('hex').slice(0, 16);
}

function moduleName(file = '') {
  const parts = normalizePath(file).split('/').filter(Boolean);
  if (parts[0] === 'codemini-web' && parts[1] === 'client') return 'codemini-web/client';
  if (parts[0] === 'codemini-web') return 'codemini-web';
  if (parts[0] === 'src' && parts[1]) return `src/${parts[1]}`;
  return parts[0] || 'root';
}

function nodeId(type, value) {
  return `${type}:${normalizePath(value)}`;
}

function resolveImport(sourceFile, specifier, fileSet) {
  if (!specifier?.startsWith('.')) return '';
  const base = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), specifier)));
  const candidates = [
    base,
    ...['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.rs'].map((ext) => `${base}${ext}`),
    ...['index.js', 'index.jsx', 'index.ts', 'index.tsx', '__init__.py'].map((name) => `${base}/${name}`)
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) || '';
}

function buildGraph(projectMap = {}, fileIndex = {}) {
  const version = graphVersion(fileIndex);
  const files = Array.isArray(fileIndex.files) ? fileIndex.files : [];
  const fileSet = new Set(files.map((entry) => normalizePath(entry.file)));
  const nodes = new Map();
  const edges = new Map();
  const symbolsByShortName = new Map();

  const addNode = (node) => {
    if (!node?.id) return;
    const current = nodes.get(node.id);
    nodes.set(node.id, current ? { ...current, ...node } : node);
  };
  const addEdge = (edge) => {
    if (!edge?.source || !edge?.target || edge.source === edge.target) return;
    const id = edge.id || `${edge.source}->${edge.target}:${edge.relation}`;
    if (!edges.has(id)) edges.set(id, { ...edge, id, graph_version: version });
  };

  for (const entry of files) {
    const file = normalizePath(entry.file);
    const module = moduleName(file);
    const moduleId = nodeId('module', module);
    const fileId = nodeId('file', file);
    const isTest = /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i.test(file);
    addNode({
      id: moduleId,
      type: 'module',
      label: module,
      file: '',
      range: null,
      summary: `Module containing project files under ${module}/`,
      graph_version: version
    });
    addNode({
      id: fileId,
      type: isTest ? 'test' : 'file',
      label: path.posix.basename(file),
      file,
      language: entry.language || '',
      range: null,
      summary: unique([
        ...(entry.exports || []).slice(0, 4),
        ...(entry.classes || []).slice(0, 2)
      ]).length
        ? `Exports ${unique([...(entry.exports || []), ...(entry.classes || [])]).slice(0, 6).join(', ')}`
        : `${entry.language || 'source'} file`,
      graph_version: version
    });
    addEdge({
      source: moduleId,
      target: fileId,
      relation: 'contains',
      confidence: 'EXTRACTED',
      confidence_score: 1,
      evidence: { file, range: null, resolver: 'directory-layout' }
    });

    for (const item of entry.interfaces || []) {
      const displayName = item.method ? `${item.method} ${item.name}` : item.name;
      const interfaceId = nodeId('interface', `${item.kind}:${displayName}`);
      addNode({
        id: interfaceId,
        type: 'interface',
        interface_kind: item.kind,
        label: displayName,
        file,
        range: null,
        summary: `${item.kind} interface ${displayName}`,
        graph_version: version
      });
      addEdge({
        source: fileId,
        target: interfaceId,
        relation: 'handles',
        confidence: 'EXTRACTED',
        confidence_score: 1,
        evidence: { file, range: null, resolver: `${item.kind}-interface-extractor` }
      });
    }

    for (const symbol of entry.symbols || []) {
      const symbolId = nodeId('symbol', symbol.symbol_id || `${file}#${symbol.name}`);
      const shortName = String(symbol.name || '').split('.').pop();
      addNode({
        id: symbolId,
        type: symbol.type || 'symbol',
        label: symbol.name || shortName || symbolId,
        file,
        range: symbol.range || null,
        signature: symbol.signature || '',
        summary: symbol.signature || `${symbol.type || 'symbol'} ${symbol.name || ''}`.trim(),
        graph_version: version
      });
      addEdge({
        source: fileId,
        target: symbolId,
        relation: 'defines',
        confidence: 'EXTRACTED',
        confidence_score: 1,
        evidence: { file, range: symbol.range || null, resolver: 'project-index-symbol' }
      });
      if (shortName) {
        if (!symbolsByShortName.has(shortName)) symbolsByShortName.set(shortName, []);
        symbolsByShortName.get(shortName).push({ id: symbolId, file, symbol });
      }
    }
  }

  for (const entry of files) {
    const file = normalizePath(entry.file);
    const fileId = nodeId('file', file);
    for (const specifier of entry.imports || []) {
      const targetFile = resolveImport(file, specifier, fileSet);
      if (!targetFile) continue;
      addEdge({
        source: fileId,
        target: nodeId('file', targetFile),
        relation: 'imports',
        confidence: 'EXTRACTED',
        confidence_score: 1,
        evidence: { file, range: null, resolver: 'relative-import' }
      });
    }
    for (const symbol of entry.symbols || []) {
      const sourceId = nodeId('symbol', symbol.symbol_id || `${file}#${symbol.name}`);
      for (const rawCall of symbol.calls || []) {
        const shortName = String(rawCall || '').split('.').pop();
        const targets = (symbolsByShortName.get(shortName) || []).filter((target) => target.id !== sourceId);
        if (targets.length === 0) continue;
        const confidence = targets.length === 1 ? 'INFERRED' : 'AMBIGUOUS';
        const score = targets.length === 1 ? 0.85 : 0.4;
        for (const target of targets.slice(0, confidence === 'AMBIGUOUS' ? 4 : 1)) {
          addEdge({
            source: sourceId,
            target: target.id,
            relation: 'calls',
            confidence,
            confidence_score: score,
            evidence: { file, range: symbol.range || null, resolver: 'short-name-call-resolution', expression: rawCall }
          });
        }
      }
    }
  }

  const testFiles = files.filter((entry) => /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i.test(entry.file));
  for (const testEntry of testFiles) {
    const testFile = normalizePath(testEntry.file);
    const testStem = path.posix.basename(testFile).replace(/\.(test|spec)?\.[^.]+$/i, '').toLowerCase();
    for (const entry of files) {
      const file = normalizePath(entry.file);
      if (file === testFile || !testStem) continue;
      const stem = path.posix.basename(file).replace(/\.[^.]+$/, '').toLowerCase();
      if (stem !== testStem) continue;
      addEdge({
        source: nodeId('file', file),
        target: nodeId('file', testFile),
        relation: 'tested_by',
        confidence: 'INFERRED',
        confidence_score: 0.85,
        evidence: { file: testFile, range: null, resolver: 'test-file-name' }
      });
    }
  }

  return {
    schema_version: GRAPH_SCHEMA_VERSION,
    graph_version: version,
    built_at: new Date().toISOString(),
    project_root: projectMap.projectRoot || '',
    nodes: [...nodes.values()],
    edges: [...edges.values()]
  };
}

function persistGraph(projectRoot, graph) {
  const db = getProjectDatabase(projectRoot);
  transaction(db, () => {
    db.exec('DELETE FROM knowledge_graph_edges; DELETE FROM knowledge_graph_nodes;');
    const putNode = db.prepare(`
      INSERT INTO knowledge_graph_nodes(id, type, label, file, graph_version, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const putEdge = db.prepare(`
      INSERT INTO knowledge_graph_edges(id, source, target, relation, confidence, source_file, graph_version, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const node of graph.nodes) {
      putNode.run(node.id, node.type, node.label || '', node.file || '', graph.graph_version, JSON.stringify(node));
    }
    for (const edge of graph.edges) {
      putEdge.run(
        edge.id, edge.source, edge.target, edge.relation, edge.confidence || 'AMBIGUOUS',
        edge.evidence?.file || '', graph.graph_version, JSON.stringify(edge)
      );
    }
    db.prepare(`
      INSERT INTO project_metadata(key, payload_json) VALUES ('knowledge_graph', ?)
      ON CONFLICT(key) DO UPDATE SET payload_json = excluded.payload_json
    `).run(JSON.stringify({
      schema_version: graph.schema_version,
      graph_version: graph.graph_version,
      built_at: graph.built_at,
      nodes: graph.nodes.length,
      edges: graph.edges.length
    }));
  });
}

export function refreshProjectKnowledgeGraph(projectRoot, { projectMap = {}, fileIndex = {} } = {}) {
  const graph = buildGraph(projectMap, fileIndex);
  const db = getProjectDatabase(projectRoot);
  const current = JSON.parse(
    db.prepare("SELECT payload_json FROM project_metadata WHERE key = 'knowledge_graph'").get()?.payload_json || '{}'
  );
  if (current.graph_version === graph.graph_version) {
    return {
      graph_version: current.graph_version,
      built_at: current.built_at || graph.built_at,
      nodes: Number(current.nodes || graph.nodes.length),
      edges: Number(current.edges || graph.edges.length),
      unchanged: true
    };
  }
  persistGraph(projectRoot, graph);
  return {
    graph_version: graph.graph_version,
    built_at: graph.built_at,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  };
}

function loadGraph(projectRoot) {
  const db = getProjectDatabase(projectRoot);
  const metadata = JSON.parse(
    db.prepare("SELECT payload_json FROM project_metadata WHERE key = 'knowledge_graph'").get()?.payload_json || '{}'
  );
  const nodes = db.prepare('SELECT payload_json FROM knowledge_graph_nodes ORDER BY id').all()
    .map((row) => JSON.parse(row.payload_json));
  const edges = db.prepare('SELECT payload_json FROM knowledge_graph_edges ORDER BY id').all()
    .map((row) => JSON.parse(row.payload_json));
  return { ...metadata, nodes, edges };
}

function tokenize(value = '') {
  return unique(String(value).toLowerCase().match(/[a-z0-9_$./#-]+|[\u4e00-\u9fff]+/g) || []);
}

function graphIndexes(graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    outgoing.get(edge.source).push(edge);
    incoming.get(edge.target).push(edge);
  }
  return { byId, outgoing, incoming };
}

function matchingSeeds(graph, text, max = 8) {
  const tokens = tokenize(text);
  return graph.nodes
    .map((node) => {
      const haystack = `${node.id} ${node.label || ''} ${node.file || ''} ${node.summary || ''}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (String(node.label || '').toLowerCase() === token) score += 12;
        else if (haystack.includes(token)) score += node.type === 'module' ? 4 : 6;
      }
      return { node, score };
    })
    .filter((item) => item.score > 0 || tokens.length === 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .slice(0, max)
    .map((item) => item.node.id);
}

function traverse(graph, seedIds, { depth = 2, direction = 'both', relations = [], includeAmbiguous = false } = {}) {
  const { byId, outgoing, incoming } = graphIndexes(graph);
  const allowedRelations = new Set(relations);
  const distances = new Map(seedIds.filter((id) => byId.has(id)).map((id) => [id, 0]));
  const queue = [...distances.keys()];
  const selectedEdges = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    const currentDepth = distances.get(current);
    if (currentDepth >= depth) continue;
    const candidates = [
      ...(direction !== 'in' ? outgoing.get(current) || [] : []),
      ...(direction !== 'out' ? incoming.get(current) || [] : [])
    ];
    for (const edge of candidates) {
      if (!includeAmbiguous && edge.confidence === 'AMBIGUOUS') continue;
      if (allowedRelations.size > 0 && !allowedRelations.has(edge.relation)) continue;
      selectedEdges.set(edge.id, edge);
      const next = edge.source === current ? edge.target : edge.source;
      if (!distances.has(next)) {
        distances.set(next, currentDepth + 1);
        queue.push(next);
      }
    }
  }
  return {
    distances,
    nodes: [...distances.keys()].map((id) => byId.get(id)).filter(Boolean),
    edges: [...selectedEdges.values()].filter((edge) => distances.has(edge.source) && distances.has(edge.target))
  };
}

function shortestPath(graph, from, to, maxHops = 8) {
  const { outgoing, incoming } = graphIndexes(graph);
  const queue = [from];
  const previous = new Map([[from, null]]);
  const previousEdge = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === to) break;
    const hop = [];
    let cursor = current;
    while (previous.get(cursor)) {
      hop.push(cursor);
      cursor = previous.get(cursor);
    }
    if (hop.length >= maxHops) continue;
    for (const edge of [...(outgoing.get(current) || []), ...(incoming.get(current) || [])]) {
      if (edge.confidence === 'AMBIGUOUS') continue;
      const next = edge.source === current ? edge.target : edge.source;
      if (previous.has(next)) continue;
      previous.set(next, current);
      previousEdge.set(next, edge);
      queue.push(next);
    }
  }
  if (!previous.has(to)) return { nodes: [], edges: [] };
  const nodeIds = [];
  const edges = [];
  let cursor = to;
  while (cursor) {
    nodeIds.push(cursor);
    const edge = previousEdge.get(cursor);
    if (edge) edges.push(edge);
    cursor = previous.get(cursor);
  }
  nodeIds.reverse();
  edges.reverse();
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return { nodes: nodeIds.map((id) => byId.get(id)).filter(Boolean), edges };
}

function clipToBudget(result, tokenBudget) {
  const maxChars = Math.max(1000, Math.min(64000, Number(tokenBudget || DEFAULT_TOKEN_BUDGET) * 4));
  const nodes = [];
  let used = 0;
  for (const node of result.nodes || []) {
    const cost = JSON.stringify(node).length;
    if (nodes.length > 0 && used + cost > maxChars) break;
    nodes.push(node);
    used += cost;
  }
  const ids = new Set(nodes.map((node) => node.id));
  const edges = (result.edges || []).filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return { ...result, nodes, edges, truncated: nodes.length < (result.nodes || []).length };
}

export function queryProjectKnowledgeGraph(projectRoot, args = {}) {
  const graph = loadGraph(projectRoot);
  const operation = String(args.operation || 'query').toLowerCase();
  if (!graph.nodes.length) return { ...graph, operation, nodes: [], edges: [] };

  let result;
  if (operation === 'path') {
    const from = graph.nodes.find((node) => node.id === args.from)?.id || matchingSeeds(graph, args.from, 1)[0];
    const to = graph.nodes.find((node) => node.id === args.to)?.id || matchingSeeds(graph, args.to, 1)[0];
    result = from && to ? shortestPath(graph, from, to, Math.max(1, Math.min(12, Number(args.max_hops || 8)))) : { nodes: [], edges: [] };
  } else {
    let seeds = [];
    if (operation === 'neighbors' && args.node_id) seeds = [String(args.node_id)];
    else if (operation === 'impact') {
      const changed = Array.isArray(args.files) ? args.files : [args.file].filter(Boolean);
      seeds = changed.map((file) => nodeId('file', file));
    } else if (operation === 'overview') {
      seeds = graph.nodes.filter((node) => node.type === 'module').map((node) => node.id);
    } else {
      seeds = matchingSeeds(graph, args.query || args.text || '', 8);
    }
    result = traverse(graph, seeds, {
      depth: Math.max(0, Math.min(6, Number(args.depth ?? (operation === 'overview' ? 1 : 2)))),
      direction: operation === 'impact' ? 'both' : String(args.direction || 'both'),
      relations: Array.isArray(args.relations) ? args.relations : [],
      includeAmbiguous: args.include_ambiguous === true
    });
    result.seeds = seeds;
  }

  const clipped = clipToBudget(result, args.token_budget);
  return {
    schema_version: graph.schema_version,
    graph_version: graph.graph_version,
    built_at: graph.built_at,
    operation,
    stats: {
      total_nodes: graph.nodes.length,
      total_edges: graph.edges.length,
      displayed_nodes: clipped.nodes.length,
      displayed_edges: clipped.edges.length
    },
    ...clipped
  };
}
