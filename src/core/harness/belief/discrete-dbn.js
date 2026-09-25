const NODES = [
  'RequirementClarity', 'ContextSufficient', 'ToolReliability', 'EnvironmentFault',
  'CodeDefect', 'PermissionIssue', 'TestPass', 'DiffScopeOK', 'RequirementsMiss',
  'RetryBenefit', 'TaskComplete'
];
const DEFAULT_PRIORS = Object.freeze({
  RequirementClarity: 0.80,
  ContextSufficient: 0.75,
  ToolReliability: 0.85,
  EnvironmentFault: 0.12,
  CodeDefect: 0.20,
  PermissionIssue: 0.08,
  TestPass: 0.60,
  DiffScopeOK: 0.90,
  RequirementsMiss: 0.15,
  RetryBenefit: 0.40,
  TaskComplete: 0.35,
});

// 工程先验，不代表已校准的真实成功率。训练得到的 CPT 可以覆盖默认值。
export const DEFAULT_EDGE_CPTS = Object.freeze({
  'RequirementClarity->RequirementsMiss': Object.freeze({ parentTrue: 0.08, parentFalse: 0.72 }),
  'ContextSufficient->RequirementsMiss': Object.freeze({ parentTrue: 0.10, parentFalse: 0.68 }),
  'CodeDefect->TestPass': Object.freeze({ parentTrue: 0.20, parentFalse: 0.88 }),
  'EnvironmentFault->TestPass': Object.freeze({ parentTrue: 0.35, parentFalse: 0.86 }),
  'PermissionIssue->TestPass': Object.freeze({ parentTrue: 0.35, parentFalse: 0.86 }),
  'TestPass->TaskComplete': Object.freeze({ parentTrue: 0.92, parentFalse: 0.12 }),
  'DiffScopeOK->TaskComplete': Object.freeze({ parentTrue: 0.86, parentFalse: 0.24 }),
  'RequirementsMiss->TaskComplete': Object.freeze({ parentTrue: 0.08, parentFalse: 0.84 }),
  'ToolReliability->RetryBenefit': Object.freeze({ parentTrue: 0.60, parentFalse: 0.15 }),
});

export const DBN_EDGES = Object.freeze([
  ['RequirementClarity', 'RequirementsMiss'],
  ['ContextSufficient', 'RequirementsMiss'],
  ['CodeDefect', 'TestPass'],
  ['EnvironmentFault', 'TestPass'],
  ['PermissionIssue', 'TestPass'],
  ['TestPass', 'TaskComplete'],
  ['DiffScopeOK', 'TaskComplete'],
  ['RequirementsMiss', 'TaskComplete'],
  ['ToolReliability', 'RetryBenefit'],
]);

export function createInitialBelief(priors = DEFAULT_PRIORS) {
  return Object.fromEntries(NODES.map((node) => {
    const configured = priors[node];
    const raw = configured && typeof configured === 'object' ? configured.true : configured;
    const p = clamp(Number(raw ?? DEFAULT_PRIORS[node]));
    return [node, { true: p, false: 1 - p }];
  }));
}

// 对 11 个二值节点枚举联合分布（2048 项），同时支持联合父 CPT 和逐边 CPT。
// 逐边表缺少联合关系时使用明确的等权混合 CPT；不会按证据抵达顺序反复平均。
export function updateBelief(previous = createInitialBelief(), evidence = [], { cpts = DEFAULT_EDGE_CPTS, nodeCpts = {} } = {}) {
  if (!Array.isArray(evidence) || !evidence.length) return structuredClone(previous);
  const observations = new Map();
  for (const item of evidence) {
    if (!NODES.includes(item?.node) || item.abstain) continue;
    if (typeof item.posterior === 'number' && Number.isFinite(item.posterior)) {
      observations.set(item.node, { posterior: clamp(item.posterior) });
    } else if (typeof item.value === 'boolean') {
      // 运行时布尔信号是强证据而非绝对真值，保留少量观测噪声，避免一次异常把整张网推到边界。
      observations.set(item.node, {
        likelihood: item.value
          ? { true: 0.95, false: 0.05 }
          : { true: 0.05, false: 0.95 },
      });
    } else if (Number.isFinite(item.likelihood?.true) && Number.isFinite(item.likelihood?.false)) {
      observations.set(item.node, { likelihood: item.likelihood });
    }
  }
  const sums = Object.fromEntries(NODES.map((node) => [node, 0]));
  let total = 0;
  for (let mask = 0; mask < 2 ** NODES.length; mask += 1) {
    const states = Object.fromEntries(NODES.map((node, index) => [node, Boolean(mask & (1 << index))]));
    let weight = 1;
    for (const node of NODES) {
      const observed = observations.get(node);
      const parents = DBN_EDGES.filter(([, child]) => child === node).map(([parent]) => parent);
      let probability = beliefProbability(previous, node);
      const joint = nodeCpts?.[node];
      const key = parents.map((parent) => `${parent}=${states[parent]}`).join('|') || 'root';
      if (joint?.table?.[key] && Number.isFinite(joint.table[key].true)) {
        probability = clamp(joint.table[key].true);
      } else if (parents.length) {
        probability = parents.reduce((sum, parent) => sum + cptValue(
          cpts?.[`${parent}->${node}`] || DEFAULT_EDGE_CPTS[`${parent}->${node}`], states[parent],
        ), 0) / parents.length;
      }
      // 已知当前状态或外部 Beta 后验直接替换该节点的先验，避免重复记账。
      if (observed?.posterior != null) probability = observed.posterior;
      weight *= states[node] ? probability : 1 - probability;
      if (observed?.likelihood) weight *= clamp(observed.likelihood[String(states[node])]);
    }
    total += weight;
    for (const node of NODES) if (states[node]) sums[node] += weight;
  }
  if (!(total > 0)) return structuredClone(previous);
  return Object.fromEntries(NODES.map((node) => {
    const p = clamp(sums[node] / total);
    return [node, { true: p, false: 1 - p }];
  }));
}

export function beliefProbability(belief, node) {
  return clamp(Number(belief?.[node]?.true ?? 0));
}

function clamp(value) {
  return Math.max(0.0001, Math.min(0.9999, Number.isFinite(value) ? value : 0.5));
}

function cptValue(edge, parentIsTrue) {
  if (edge && typeof edge === 'object') {
    const direct = edge[parentIsTrue ? 'parentTrue' : 'parentFalse'];
    if (Number.isFinite(Number(direct))) return clamp(Number(direct));
    const key = Object.keys(edge.table || {}).find((item) => item.endsWith(`=${parentIsTrue}`));
    const tableValue = key ? edge.table[key]?.true : undefined;
    if (Number.isFinite(Number(tableValue))) return clamp(Number(tableValue));
  }
  return 0.5;
}

export { NODES, DEFAULT_PRIORS };
