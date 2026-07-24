import path from 'node:path';
import { getFileMutationPaths } from './approval-policy.js';
import { normalizePath } from './string-utils.js';

const PREFLIGHT_CODE = 'PROJECT_GRAPH_PREFLIGHT';
const DEFAULT_TOKEN_BUDGET = 1200;
const MAX_NODES = 16;
const MAX_EDGES = 24;

function normalizedFiles(toolName, args = {}) {
  return [...new Set(
    getFileMutationPaths(toolName, args)
      .map((value) => normalizePath(String(value || '').trim()).replace(/^\.\/+/, ''))
      .filter((value) => value && value !== '.' && !path.isAbsolute(value) && !value.startsWith('../')),
  )].sort();
}

function signatureFor(files = []) {
  return files.join('\n');
}

function compactNode(node = {}) {
  return {
    id: node.id,
    type: node.type,
    label: node.label || '',
    file: node.file || '',
    range: node.range || null,
    summary: node.summary || '',
  };
}

function compactEdge(edge = {}) {
  return {
    source: edge.source,
    target: edge.target,
    relation: edge.relation,
    confidence: edge.confidence || 'AMBIGUOUS',
    evidence: edge.evidence || null,
  };
}

function compactImpact(result = {}, files = []) {
  const nodes = (Array.isArray(result.nodes) ? result.nodes : [])
    .slice(0, MAX_NODES)
    .map(compactNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(result.edges) ? result.edges : [])
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .slice(0, MAX_EDGES)
    .map(compactEdge);
  return {
    code: PREFLIGHT_CODE,
    mutation_applied: false,
    requires_retry: true,
    guidance:
      'No file was changed. Review the impact map, verify uncertain relationships in source, adjust if needed, then retry the mutation tool.',
    files,
    graph_version: result.graph_version || '',
    impact: {
      nodes,
      edges,
      truncated: Boolean(result.truncated)
        || nodes.length < Number(result?.stats?.displayed_nodes || nodes.length)
        || edges.length < Number(result?.stats?.displayed_edges || edges.length),
    },
  };
}

function formatPreflightPayload(payload = {}) {
  const lines = [
    `[${payload.code || PREFLIGHT_CODE}]`,
    `mutation_applied: ${payload.mutation_applied === true}`,
    `requires_retry: ${payload.requires_retry === true}`,
    `guidance: ${payload.guidance || ''}`,
    `files: ${(payload.files || []).join(', ')}`,
    `graph_version: ${payload.graph_version || 'unknown'}`,
    'impact_nodes:',
  ];
  for (const node of payload?.impact?.nodes || []) {
    lines.push(
      `- ${node.id} | type=${node.type || 'unknown'} | file=${node.file || '-'} | ${node.summary || node.label || ''}`,
    );
  }
  lines.push('impact_edges:');
  for (const edge of payload?.impact?.edges || []) {
    const evidence = edge?.evidence?.file
      ? ` | evidence=${edge.evidence.file}${edge.evidence?.resolver ? ` (${edge.evidence.resolver})` : ''}`
      : '';
    lines.push(
      `- ${edge.source} --${edge.relation || 'related'}/${edge.confidence || 'AMBIGUOUS'}--> ${edge.target}${evidence}`,
    );
  }
  if (payload?.impact?.truncated) lines.push('truncated: true');
  return lines.join('\n');
}

/**
 * Gate file mutations behind one compact project-graph impact review.
 *
 * The first mutation attempt for a target set returns context without writing.
 * A retry in a later agent step is allowed. A successful mutation invalidates
 * the entry so another mutation receives a fresh graph view.
 */
export function createMutationGraphPreflight({
  queryGraph,
  onError,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
} = {}) {
  const attempts = new Map();

  const inspect = async ({ toolName, args = {}, step = 0 } = {}) => {
    if (typeof queryGraph !== 'function') return null;
    const files = normalizedFiles(toolName, args);
    if (files.length === 0) return null;
    const signature = signatureFor(files);
    const previous = attempts.get(signature);
    if (previous) {
      if (previous.step < step) return { required: false, files };
      return {
        required: true,
        files,
        payload: previous.payload,
        content: formatPreflightPayload(previous.payload),
      };
    }

    try {
      const result = await queryGraph({
        operation: 'impact',
        files,
        depth: 1,
        token_budget: tokenBudget,
        include_ambiguous: true,
      });
      if (!Array.isArray(result?.nodes) || result.nodes.length === 0) {
        return { required: false, files };
      }
      const payload = compactImpact(result, files);
      attempts.set(signature, { step, payload });
      return { required: true, files, payload, content: formatPreflightPayload(payload) };
    } catch (error) {
      onError?.(error, { toolName, files });
      return { required: false, files, degraded: true };
    }
  };

  const record = ({ toolName, args = {}, result, step = 0 } = {}) => {
    if (toolName === 'query_project_graph' && String(args?.operation || '').toLowerCase() === 'impact') {
      const uniqueFiles = [...new Set(
        (Array.isArray(args.files) ? args.files : [args.file])
          .map((value) => normalizePath(String(value || '').trim()).replace(/^\.\/+/, ''))
          .filter((value) => value && value !== '.' && !path.isAbsolute(value) && !value.startsWith('../')),
      )].sort();
      if (uniqueFiles.length > 0 && Array.isArray(result?.nodes) && result.nodes.length > 0) {
        attempts.set(signatureFor(uniqueFiles), {
          step: Math.max(0, step - 1),
          payload: compactImpact(result, uniqueFiles),
        });
      }
      return;
    }

    const files = normalizedFiles(toolName, args);
    if (files.length > 0) attempts.delete(signatureFor(files));
  };

  return { inspect, record };
}

export { formatPreflightPayload, PREFLIGHT_CODE };
