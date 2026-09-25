export function buildDecisionLabels(episode = {}, events = []) {
  const list = Array.isArray(events) ? events : [];
  const decisions = list.filter((event) => event.type === 'harness:decision');
  const last = decisions.at(-1)?.payload || {};
  const hasSuccess = list.some((event) => event.type === 'tool:result' && event.payload?.ok === true)
    || list.some((event) => event.type === 'step:end' && event.payload?.verificationPassed === true);
  const hasHumanIntervention = list.some((event) => String(event.type || '').startsWith('approval:'))
    || episode.status === 'aborted';
  const ambiguous = !list.length || (episode.status === 'completed' && !hasSuccess && !last.policy);
  if (ambiguous) return { status: 'ambiguous' };
  return {
    status: 'labeled',
    done: episode.status === 'completed' && hasSuccess,
    retry: Boolean(last.advisory?.action === 'retry_once' && hasSuccess),
    escalate: hasHumanIntervention || last.policy?.action === 'escalate',
    retryBenefit: Boolean(last.advisory?.action === 'retry_once' && hasSuccess),
  };
}

export function extractCalibrationRows(episodes = [], eventsByEpisode = new Map()) {
  const rows = [];
  for (const episode of episodes) {
    const labels = buildDecisionLabels(episode, eventsByEpisode.get(episode.id) || []);
    if (labels.status !== 'labeled') continue;
    for (const event of eventsByEpisode.get(episode.id) || []) {
      if (event.type !== 'harness:decision') continue;
      const prediction = event.payload?.belief?.TaskComplete?.true;
      if (!Number.isFinite(Number(prediction))) continue;
      rows.push({
        id: event.id,
        episodeId: episode.id,
        provider: event.payload?.provider || 'rules',
        prediction: Number(prediction),
        label: labels.done,
        labels: { TaskComplete: labels.done, RetryBenefit: labels.retryBenefit },
        states: Object.fromEntries(Object.entries(event.payload?.belief || {}).map(([node, value]) => [node, Number(value?.true) >= 0.5])),
      });
    }
  }
  return rows;
}
