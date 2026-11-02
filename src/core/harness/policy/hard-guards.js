export function checkHardGuards({ state = {}, decision = {}, belief = {} } = {}) {
  const reasons = [];
  const risk = String(state.riskTier || decision.advisory?.risk || 'low').toLowerCase();
  const highRisk = ['high', 'critical'].includes(risk);
  if (highRisk || state.outsideWorkspace || state.destructive || state.publish || state.payment || state.sensitiveData) {
    reasons.push('high_risk_action_requires_review');
  }
  if (state.approvalRequired || state.approvalBlocked || state.commandBlocked || state.sandboxBlocked) {
    reasons.push('existing_policy_block');
  }
  if (state.diffScopeOk === false) reasons.push('diff_scope_invalid');
  if (state.unresolvedError === true) reasons.push('unresolved_error');
  return { allowed: reasons.length === 0, requiresReview: reasons.length > 0, reasons, belief };
}
