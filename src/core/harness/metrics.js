export function summarizeHarnessMetrics({ episodes = [], events = [] } = {}) {
  const list = Array.isArray(episodes) ? episodes : [];
  const eventList = Array.isArray(events) ? events : [];
  const decisions = eventList.filter((event) => event.type === 'harness:decision');
  const errors = decisions.filter((event) => event.payload?.decision?.errors?.length);
  const abstains = decisions.filter((event) => (event.payload?.decision?.answers || []).some((answer) => answer.abstain));
  const actions = {};
  for (const event of decisions) {
    const action = event.payload?.policy?.action || event.payload?.advisory?.action || 'unknown';
    actions[action] = (actions[action] || 0) + 1;
  }
  return {
    episodes: list.length,
    completed: list.filter((episode) => episode.status === 'completed').length,
    decisionEvents: decisions.length,
    providerErrors: errors.length,
    abstains: abstains.length,
    actionCounts: actions,
  };
}
