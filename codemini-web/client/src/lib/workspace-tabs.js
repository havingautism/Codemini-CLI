export const NEW_WORKSPACE_TAB = { id: 'new', type: 'new' };
export const EMPTY_WORKSPACE_TABS = {
  tabs: [NEW_WORKSPACE_TAB], activeId: NEW_WORKSPACE_TAB.id, nextTerminal: 1,
};

export function openWorkspacePicker(state) {
  const tabs = state.tabs.some(tab => tab.type === 'new')
    ? state.tabs : [...state.tabs, NEW_WORKSPACE_TAB];
  return { ...state, tabs, activeId: NEW_WORKSPACE_TAB.id };
}

export function openWorkspaceTool(state, type, terminalId) {
  const tabs = state.tabs.filter(tab => tab.type !== 'new');
  const existing = tabs.find(tab => tab.type === type);
  if (type !== 'terminal' && existing) return { ...state, tabs, activeId: existing.id };
  const pickerIndex = state.tabs.findIndex(tab => tab.type === 'new');
  const tab = type === 'terminal'
    ? { id: terminalId, type, number: state.nextTerminal }
    : { id: type, type };
  tabs.splice(pickerIndex < 0 ? tabs.length : pickerIndex, 0, tab);
  return { ...state, tabs, activeId: tab.id, nextTerminal: state.nextTerminal + (type === 'terminal' ? 1 : 0) };
}

export function removeWorkspaceTab(state, id) {
  const index = state.tabs.findIndex(tab => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter(tab => tab.id !== id);
  if (!tabs.length) tabs.push(NEW_WORKSPACE_TAB);
  return {
    ...state,
    tabs,
    activeId: state.activeId === id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeId,
  };
}

export function isActiveAgentCommand(command) {
  return command?.background === true && command.status === 'running';
}

export function visibleAgentCommands(commands, hidden = []) {
  return (Array.isArray(commands) ? commands : []).filter(command =>
    isActiveAgentCommand(command) && !hidden.includes(command.id));
}

export function dismissAgentTab(state, id) {
  const hidden = state.hiddenAgentTabs || [];
  if (hidden.includes(id)) return state;
  return {
    ...state,
    hiddenAgentTabs: [...hidden, id],
    activeId: state.activeId === id ? state.tabs.at(-1).id : state.activeId,
  };
}
