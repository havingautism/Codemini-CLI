const SPEC_REVIEW_ACTIONS = [
  ['spec.plan-and-execute', 'Plan and execute'],
  ['spec.execute', 'Execute'],
  ['spec.save', 'Save'],
  ['spec.revise', 'Revise'],
  ['spec.reject', 'Reject']
];

const REFLECT_REVIEW_ACTIONS = [
  ['reflect.approve', 'Approve'],
  ['reflect.revise', 'Revise'],
  ['reflect.reject', 'Reject']
];

const APPROVAL_REVIEW_ACTIONS = [
  ['approval.approve', 'Approve'],
  ['approval.reject', 'Reject']
];

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && ['action', 'skill'].includes(item.kind) && String(item.name || '').trim())
    .map((item) => ({ ...item, name: String(item.name).trim() }));
}

export function filteredActionSelectorItems(state) {
  const query = String(state?.query || '').trim().toLowerCase();
  const items = normalizeItems(state?.items);
  if (!query) return items;
  return items.filter((item) =>
    `${item.name} ${item.label || ''} ${item.description || ''}`.toLowerCase().includes(query)
  );
}

export function createActionSelectorState(items = []) {
  return {
    open: true,
    items: normalizeItems(items),
    query: '',
    activeIndex: 0,
    selectedSkillNames: [],
    activeParameterAction: null,
    parameterText: '',
    parameterDrafts: {},
    effect: null
  };
}

export function reduceActionSelector(state, event = {}) {
  if (!state) return createActionSelectorState();
  if (event.type === 'parameter' && state.activeParameterAction) {
    return { ...state, parameterText: String(event.value || ''), effect: null };
  }
  if (event.type === 'cancel-parameter' && state.activeParameterAction) {
    return {
      ...state,
      activeParameterAction: null,
      parameterText: '',
      parameterDrafts: {
        ...state.parameterDrafts,
        [state.activeParameterAction]: state.parameterText
      },
      effect: null
    };
  }
  if (event.type === 'submit-parameter' && state.activeParameterAction === 'capture') {
    const summary = state.parameterText.trim();
    if (!summary) return { ...state, effect: null };
    return {
      ...state,
      effect: {
        type: 'dispatch-action',
        action: { name: 'capture', payload: { summary, details: '' } }
      }
    };
  }
  if (event.type === 'complete-parameter') {
    return {
      ...state,
      activeParameterAction: null,
      parameterText: '',
      parameterDrafts: { ...state.parameterDrafts, [state.activeParameterAction]: '' },
      effect: null
    };
  }
  if (event.type === 'open') return { ...state, open: true, query: '', activeIndex: 0, effect: null };
  if (event.type === 'close') return { ...state, open: false, query: '', activeIndex: 0, effect: null };
  if (event.type === 'query') return { ...state, query: String(event.value || ''), activeIndex: 0, effect: null };
  if (event.type === 'set-skills') {
    const names = [...new Set((Array.isArray(event.names) ? event.names : []).map((name) => String(name || '').trim()).filter(Boolean))];
    return { ...state, selectedSkillNames: names, effect: null };
  }
  if (event.type === 'clear-skills') return { ...state, selectedSkillNames: [], effect: null };
  if (event.type === 'remove-skill') {
    return {
      ...state,
      selectedSkillNames: state.selectedSkillNames.filter((name) => name !== event.name),
      effect: null
    };
  }
  const filtered = filteredActionSelectorItems(state);
  if (event.type === 'move') {
    if (!filtered.length) return { ...state, activeIndex: 0, effect: null };
    const delta = Number(event.delta || 0);
    return { ...state, activeIndex: ((state.activeIndex + delta) % filtered.length + filtered.length) % filtered.length, effect: null };
  }
  if (event.type !== 'select' || !filtered.length) return state;
  const item = filtered[Math.min(state.activeIndex, filtered.length - 1)];
  if (item.kind === 'skill') {
    const selected = state.selectedSkillNames.includes(item.name);
    return {
      ...state,
      selectedSkillNames: selected
        ? state.selectedSkillNames.filter((name) => name !== item.name)
        : [...state.selectedSkillNames, item.name],
      effect: null
    };
  }
  if (item.name === 'capture') {
    return {
      ...state,
      open: false,
      activeParameterAction: 'capture',
      parameterText: state.parameterDrafts.capture || '',
      effect: null
    };
  }
  return {
    ...state,
    open: false,
    query: '',
    activeIndex: 0,
    effect: { type: 'dispatch-action', action: { name: item.name, payload: { ...(item.payload || {}) } } }
  };
}

export function createReviewSelectorState(kind) {
  return {
    kind,
    activeIndex: 0,
    activeFeedbackAction: null,
    feedback: '',
    feedbackDrafts: {},
    effect: null
  };
}

export function reduceReviewSelector(state, event = {}) {
  if (!state) return state;
  if (event.type === 'move') {
    const actions = state.kind === 'spec'
      ? SPEC_REVIEW_ACTIONS
      : state.kind === 'approval'
        ? APPROVAL_REVIEW_ACTIONS
        : REFLECT_REVIEW_ACTIONS;
    const delta = Number(event.delta || 0);
    return { ...state, activeIndex: ((state.activeIndex + delta) % actions.length + actions.length) % actions.length, effect: null };
  }
  if (event.type === 'choose') {
    const name = String(event.name || '');
    if (name.endsWith('.revise')) {
      return {
        ...state,
        activeFeedbackAction: name,
        feedback: state.feedbackDrafts[name] || '',
        effect: null
      };
    }
    return { ...state, effect: { type: 'dispatch-action', action: { name, payload: {} } } };
  }
  if (event.type === 'feedback' && state.activeFeedbackAction) {
    return { ...state, feedback: String(event.value || ''), effect: null };
  }
  if (event.type === 'cancel-feedback' && state.activeFeedbackAction) {
    return {
      ...state,
      feedbackDrafts: { ...state.feedbackDrafts, [state.activeFeedbackAction]: state.feedback },
      activeFeedbackAction: null,
      effect: null
    };
  }
  if (event.type === 'submit-feedback' && state.activeFeedbackAction && state.feedback.trim()) {
    return {
      ...state,
      effect: {
        type: 'dispatch-action',
        action: { name: state.activeFeedbackAction, payload: { feedback: state.feedback.trim() } }
      }
    };
  }
  return state;
}

export function reviewActionsForPendingState(runtimeState = {}) {
  if (runtimeState.pendingApproval) {
    const requestId = String(runtimeState.pendingApproval.id || '');
    return APPROVAL_REVIEW_ACTIONS.map(([name, label]) => ({
      kind: 'action',
      name,
      label,
      payload: { requestId }
    }));
  }
  const definitions = runtimeState.pendingSpecApproval
    ? SPEC_REVIEW_ACTIONS
    : (runtimeState.pendingReflectSkill || runtimeState.pendingReflectApproval)
      ? REFLECT_REVIEW_ACTIONS
      : [];
  return definitions.map(([name, label]) => ({ kind: 'action', name, label }));
}
