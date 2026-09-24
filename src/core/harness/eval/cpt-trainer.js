import crypto from 'node:crypto';
import { DBN_EDGES } from '../belief/discrete-dbn.js';

export function fitBinaryPriors(rows = [], { labelKey = 'label' } = {}) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && row[labelKey] != null) : [];
  const positives = list.filter((row) => Boolean(row[labelKey])).length;
  const alpha = 1;
  const beta = 1;
  return { true: (positives + alpha) / (list.length + alpha + beta), false: (list.length - positives + beta) / (list.length + alpha + beta), sampleCount: list.length };
}

// 为一条父子边学习完整的二值 CPT。即使某个父状态组合没有样本，也会
// 用 Dirichlet(alpha, alpha) 平滑，确保发布的表总是完整且可查询。
export function fitBinaryCpt(rows = [], { childKey = 'label', parentKeys = [], stateKey = 'states', alpha = 1 } = {}) {
  const parents = [...new Set(parentKeys.map(String))];
  const safeAlpha = Number.isFinite(Number(alpha)) && Number(alpha) > 0 ? Number(alpha) : 1;
  const table = {};
  const assignments = 2 ** parents.length;
  for (let mask = 0; mask < assignments; mask += 1) {
    const assignment = Object.fromEntries(parents.map((parent, index) => [parent, Boolean(mask & (1 << index))]));
    const key = parents.map((parent) => `${parent}=${assignment[parent]}`).join('|') || 'root';
    const matching = (Array.isArray(rows) ? rows : []).filter((row) => {
      const states = row?.[stateKey] || row || {};
      return parents.every((parent) => Boolean(states[parent]) === assignment[parent]) && row?.[childKey] != null;
    });
    const positives = matching.filter((row) => Boolean(row[childKey])).length;
    const total = matching.length;
    table[key] = {
      parents: assignment,
      true: (positives + safeAlpha) / (total + safeAlpha * 2),
      false: (total - positives + safeAlpha) / (total + safeAlpha * 2),
      sampleCount: total,
    };
  }
  return { child: childKey, parents, table, alpha: safeAlpha };
}

export function fitNetworkCpts(rows = [], { edges = DBN_EDGES, stateKey = 'states', labelsKey = 'labels', alpha = 1 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return Object.fromEntries(edges.map(([parent, child]) => [`${parent}->${child}`, fitBinaryCpt(list.map((row) => ({
    ...row,
    [child]: row?.[labelsKey]?.[child] ?? row?.[child] ?? (child === 'TaskComplete' ? row?.label : undefined),
    [stateKey]: row?.[stateKey] || row?.belief || {},
  })), { childKey: child, parentKeys: [parent], stateKey, alpha })]));
}

export function emptyNetworkCptSnapshot({ edges = DBN_EDGES, alpha = 1 } = {}) {
  return fitNetworkCpts([], { edges, alpha });
}

export function createCalibrationVersion({ provider = 'rules', modelVersion = 'unknown', questionSetHash = '', datasetHash = '', params = {} } = {}) {
  const createdAt = new Date().toISOString();
  // 版本号只由输入数据和训练参数决定，重复训练同一数据集会得到同一版本。
  const calibrationId = `cal-${crypto.createHash('sha256').update(JSON.stringify({ provider, modelVersion, questionSetHash, datasetHash, params })).digest('hex').slice(0, 16)}`;
  return { calibrationId, provider, modelVersion, questionSetHash, datasetHash, params, createdAt };
}
