export function mapStateToEvidence(state = {}, decision = null) {
  const evidence = [];
  const add = (node, value, source = 'runtime', likelihood = null) => evidence.push({
    node, value, source, ...(likelihood ? { likelihood } : {})
  });
  if (state.toolError != null || state.toolResult?.ok != null) add('ToolReliability', state.toolError ? false : state.toolResult?.ok !== false);
  if (Number.isFinite(Number(state.toolReliability))) {
    const probability = Math.max(0.001, Math.min(0.999, Number(state.toolReliability)));
    evidence.push({ node: 'ToolReliability', posterior: probability, source: 'tool_reliability' });
  }
  if (state.environmentFault != null) add('EnvironmentFault', Boolean(state.environmentFault));
  if (state.codeDefect != null) add('CodeDefect', Boolean(state.codeDefect));
  if (state.requirementClarity != null) add('RequirementClarity', Boolean(state.requirementClarity));
  if (state.contextSufficient != null) add('ContextSufficient', Boolean(state.contextSufficient));
  if (state.permissionIssue != null) add('PermissionIssue', Boolean(state.permissionIssue));
  if (state.diffScopeOk != null) add('DiffScopeOK', Boolean(state.diffScopeOk));
  if (state.requirementsMiss != null) add('RequirementsMiss', Boolean(state.requirementsMiss));
  if (state.retryBenefit != null) add('RetryBenefit', Boolean(state.retryBenefit));
  if (state.testsPassed != null || state.verificationPassed != null) add('TestPass', Boolean(state.testsPassed ?? state.verificationPassed));
  const taskAnswer = decision?.answers?.find((answer) => answer.id === 'task_complete');
  if (taskAnswer && taskAnswer.abstain !== true && decision.calibrationId) {
    const p = Math.max(0.001, Math.min(0.999, Number(taskAnswer.pTrue)));
    if (Number.isFinite(p)) add('TaskComplete', null, `provider:${decision.provider}`, { true: p, false: 1 - p });
  }
  if (state.taskComplete != null) add('TaskComplete', Boolean(state.taskComplete));
  if (state.retries != null && state.retrySucceeded != null) add('RetryBenefit', Boolean(state.retrySucceeded));
  return evidence;
}
