export function createComposerState(seed = {}) {
  return {
    text: String(seed.text || ""),
    selectedSkills: [],
    activeAction: null,
    parameterText: "",
    parameterDrafts: {},
    ...seed,
  };
}

export function parseComposerSlashQuery(value) {
  const match = String(value || '').match(/^\/([^\s]*)$/);
  return match ? match[1] : null;
}

export function toggleComposerSkill(state, skill) {
  const selected = state.selectedSkills.some((item) => item.name === skill.name);
  return {
    ...state,
    selectedSkills: selected
      ? state.selectedSkills.filter((item) => item.name !== skill.name)
      : [...state.selectedSkills, skill],
  };
}

export function beginActionParameter(state, actionName) {
  return {
    ...state,
    activeAction: actionName,
    parameterText: state.parameterDrafts[actionName] || "",
  };
}

export function cancelActionParameter(state) {
  const parameterDrafts = state.activeAction
    ? { ...state.parameterDrafts, [state.activeAction]: state.parameterText }
    : state.parameterDrafts;
  return {
    ...state,
    activeAction: null,
    parameterText: "",
    parameterDrafts,
  };
}

export function completeComposerSubmit(state) {
  const parameterDrafts = state.activeAction
    ? { ...state.parameterDrafts, [state.activeAction]: state.parameterText }
    : state.parameterDrafts;
  return {
    ...state,
    text: "",
    selectedSkills: [],
    activeAction: null,
    parameterText: "",
    parameterDrafts,
  };
}

export async function runComposerAction(actionName, onAction, parameterText = "") {
  if (actionName === "capture") {
    const summary = String(parameterText || "").trim();
    if (!summary) throw new Error("Capture summary is required");
    return await onAction(actionName, { summary, details: "" });
  }
  return await onAction(actionName, {});
}
