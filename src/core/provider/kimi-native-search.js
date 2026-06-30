export const KIMI_NATIVE_SEARCH_TOOL_ID = '$web_search';

export const KIMI_NATIVE_SEARCH_DEFINITION = {
  type: 'builtin_function',
  function: {
    name: KIMI_NATIVE_SEARCH_TOOL_ID,
    description:
      'Model-native web search provided by the current Kimi gateway. Call this tool directly when live web information is needed. The gateway executes search server-side.'
  }
};

export function buildKimiNativeSearchHandler() {
  return (args = {}, { rawArguments = '' } = {}) => {
    const raw = typeof rawArguments === 'string' ? rawArguments.trim() : '';
    const content = raw || JSON.stringify(args ?? {});
    return {
      content,
      toolWireName: KIMI_NATIVE_SEARCH_TOOL_ID,
      echoed: true
    };
  };
}

export function formatKimiNativeSearchResult(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  if (result.echoed) {
    return result.content || `[${KIMI_NATIVE_SEARCH_TOOL_ID}]`;
  }
  return String(result.content || result);
}

export function kimiNativeSearchActiveInTools(tools = []) {
  return (Array.isArray(tools) ? tools : []).some((tool) => {
    const name = tool?.function?.name || tool?.name || '';
    return name === KIMI_NATIVE_SEARCH_TOOL_ID;
  });
}

export function resolveKimiNativeSearchPayloadExtras({ tools } = {}) {
  if (!kimiNativeSearchActiveInTools(tools)) {
    return {};
  }
  return { thinking: { type: 'disabled' } };
}
