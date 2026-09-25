export const TASK_ROUTE_OPTIONS = Object.freeze(['proceed_fast', 'deep_review', 'split_task', 'ask_user', 'block']);

export function resolveTaskRoute({ choice, probability = 0, riskTier = 'low', margin = 1, thresholds = {} } = {}) {
  const minProbability = Number(thresholds.route_min_probability ?? 0.55);
  const minMargin = Number(thresholds.route_min_margin ?? 0.12);
  if (String(riskTier || '').toLowerCase() === 'critical' && choice === 'proceed_fast') return { choice: 'deep_review', reason: 'critical_risk_override' };
  if (!TASK_ROUTE_OPTIONS.includes(choice) || probability < minProbability || margin < minMargin) return { choice: 'ask_user', reason: 'low_confidence' };
  return { choice, reason: 'provider_route' };
}
