export async function replayHarnessEpisode({ events = [], onEvent = null } = {}) {
  const ordered = [...(Array.isArray(events) ? events : [])].sort((left, right) => {
    const stepDelta = Number(left?.step || 0) - Number(right?.step || 0);
    if (stepDelta) return stepDelta;
    return String(left?.createdAt || '').localeCompare(String(right?.createdAt || ''));
  });
  const state = { step: 0, events: [] };
  for (const event of ordered) {
    state.step = Number(event.step || state.step || 0);
    state.events.push(event);
    if (typeof onEvent === 'function') await onEvent(event, state);
  }
  return state;
}
