import { isShellToolName } from "./tool-names.js";

export function summarizeToolGroupCards(cards = []) {
  const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
  let done = 0;
  let running = 0;
  for (const card of list) {
    const status = String(card.status || "").toLowerCase();
    if (status === "running") running += 1;
    else if (status === "done") done += 1;
  }
  const allCommands =
    list.length > 0 && list.every((card) => isShellToolName(card.name));
  return { total: list.length, done, running, allCommands };
}

export function toolGroupSummaryI18n(cards = []) {
  const { total, done, running, allCommands } = summarizeToolGroupCards(cards);
  const prefix = allCommands ? "toolGroupCommands" : "toolGroupTools";
  if (!total) return { key: "", replacements: {} };
  if (running > 0 && done > 0) {
    return {
      key: `${prefix}Mixed`,
      replacements: { done, running },
    };
  }
  if (running > 0) {
    return {
      key: `${prefix}Running`,
      replacements: { count: running },
    };
  }
  return {
    key: prefix,
    replacements: { count: total },
  };
}

export function formatToolGroupSummaryLabel(cards, translate) {
  const { key, replacements } = toolGroupSummaryI18n(cards);
  if (!key) return "";
  let text = translate(key);
  for (const [name, value] of Object.entries(replacements)) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}
