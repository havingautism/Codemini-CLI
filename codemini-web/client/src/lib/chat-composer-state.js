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

export function findComposerMentionToken(value, cursor = String(value || '').length) {
  const text = String(value || '');
  const safeCursor = Math.max(0, Math.min(text.length, Number(cursor) || 0));
  const beforeCursor = text.slice(0, safeCursor);
  const match = beforeCursor.match(/(?:^|\s)@(?:"([^"]*)|([^\s]*))$/);
  if (!match) return null;
  const tokenText = match[0];
  const whitespacePrefix = tokenText.match(/^\s/)?.[0] || '';
  const quoted = match[1] != null;
  let end = safeCursor;
  if (quoted) {
    const closingQuote = text.indexOf('"', safeCursor);
    if (closingQuote >= 0) end = closingQuote + 1;
  } else {
    while (end < text.length && !/\s/.test(text[end])) end += 1;
  }
  return {
    start: safeCursor - tokenText.length + whitespacePrefix.length,
    end,
    query: match[1] ?? match[2] ?? '',
    quoted,
  };
}

export function parseComposerMentionQuery(value, cursor) {
  return findComposerMentionToken(value, cursor)?.query ?? null;
}

export function formatComposerFileMention(path) {
  const value = String(path || '').trim().replace(/\\/g, '/');
  if (!value) return '@';
  return /^[A-Za-z0-9_./-]+$/.test(value) ? `@${value}` : `@"${value}"`;
}

export function replaceComposerMentionToken(value, replacement, cursor) {
  const text = String(value || '');
  const token = findComposerMentionToken(text, cursor ?? text.length);
  if (!token) return text;
  const suffix = text.slice(token.end);
  const nextReplacement = /\s$/.test(replacement) && /^\s/.test(suffix)
    ? replacement.trimEnd()
    : replacement;
  return `${text.slice(0, token.start)}${nextReplacement}${suffix}`;
}

export function removeComposerMentionToken(value, cursor) {
  const text = String(value || '');
  const token = findComposerMentionToken(text, cursor ?? text.length);
  if (!token) {
    return {
      text,
      cursor: Math.max(0, Math.min(text.length, Number(cursor) || 0)),
    };
  }
  const prefix = text.slice(0, token.start);
  let suffix = text.slice(token.end);
  if (/\s$/.test(prefix) && /^[ \t]/.test(suffix)) suffix = suffix.slice(1);
  if (!prefix && /^[ \t]/.test(suffix)) suffix = suffix.slice(1);
  return {
    text: `${prefix}${suffix}`,
    cursor: prefix.length,
  };
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
