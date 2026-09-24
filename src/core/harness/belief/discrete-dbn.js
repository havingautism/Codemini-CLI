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
    const p = clamp(Number(priors[node] ?? DEFAULT_PRIORS[node]));
    return [node, { true: p, false: 1 - p }];
  }));
}

export function updateBelief(previous = createInitialBelief(), evidence = []) {
  const next = structuredClone(previous);
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const node = String(item?.node || '');
    if (!NODES.includes(node) || item?.abstain) continue;
    const likelihood = item.likelihood || {};
    const pTrue = clamp(Number(likelihood.true ?? (item.value === true ? 0.95 : 0.05)));
    const pFalse = clamp(Number(likelihood.false ?? (item.value === false ? 0.95 : 0.05)));
    const prior = next[node] || createInitialBelief()[node];
    const trueWeight = prior.true * pTrue;
    const falseWeight = prior.false * pFalse;
    const total = trueWeight + falseWeight || 1;
    next[node] = { true: trueWeight / total, false: falseWeight / total };
  }
  return next;
}

export function beliefProbability(belief, node) {
  return clamp(Number(belief?.[node]?.true ?? 0));
}

function clamp(value) {
  return Math.max(0.0001, Math.min(0.9999, Number.isFinite(value) ? value : 0.5));
}

export { NODES, DEFAULT_PRIORS };
