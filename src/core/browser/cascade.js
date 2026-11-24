export function classifyDeclarations(matched = {}, properties = []) {
  const wanted = new Set(properties);
  const winning = new Map();
  const overridden = [];
  const rules = [];

  for (const entry of matched.matchedCSSRules || []) {
    const selectors = entry?.rule?.selectorList?.selectors || [];
    rules.push({
      selector: selectors.map((item) => item?.text).filter(Boolean).join(', ') || '(rule)',
      origin: entry?.rule?.origin || 'regular',
      properties: entry?.rule?.style?.cssProperties || [],
    });
  }
  if (matched.inlineStyle?.cssProperties) {
    rules.push({
      selector: 'style=""',
      origin: 'inline',
      properties: matched.inlineStyle.cssProperties,
    });
  }

  // CDP returns matched rules in ascending cascade order: a later declaration
  // wins unless an earlier one is !important and the later one is not.
  for (const rule of rules) {
    for (const prop of rule.properties) {
      if (!prop?.name || prop.disabled || prop.implicit) continue;
      if (wanted.size > 0 && !wanted.has(prop.name)) continue;
      const next = {
        property: prop.name,
        value: String(prop.value ?? ''),
        selector: rule.selector,
        important: Boolean(prop.important),
        origin: rule.origin,
      };
      const previous = winning.get(prop.name);
      if (!previous) {
        winning.set(prop.name, next);
        continue;
      }
      const nextWins = next.important || !previous.important;
      const loser = nextWins ? previous : next;
      const winner = nextWins ? next : previous;
      overridden.push({
        property: loser.property,
        value: loser.value,
        selector: loser.selector,
        important: loser.important,
        overridden_by: `${winner.selector} { ${winner.property}: ${winner.value}${winner.important ? ' !important' : ''} }`,
      });
      winning.set(prop.name, winner);
    }
  }

  return {
    winning: [...winning.values()],
    overridden,
  };
}

export function diffSnapshot(previous, next) {
  const prevLines = String(previous || '').split('\n');
  const nextLines = String(next || '').split('\n');
  const counts = new Map();
  for (const line of prevLines) counts.set(line, (counts.get(line) || 0) + 1);
  const added = [];
  let unchanged = 0;
  for (const line of nextLines) {
    const remaining = counts.get(line) || 0;
    if (remaining > 0) {
      counts.set(line, remaining - 1);
      unchanged += 1;
    } else {
      added.push(line);
    }
  }
  const removed = [];
  for (const [line, count] of counts) {
    for (let index = 0; index < count; index += 1) removed.push(line);
  }
  if (added.length === 0 && removed.length === 0) {
    return {
      useDelta: true,
      text: `[snapshot unchanged lines=${nextLines.length}]`,
    };
  }
  const body = [
    ...removed.slice(0, 40).map((line) => `- ${line}`),
    ...added.slice(0, 40).map((line) => `+ ${line}`),
  ];
  const omitted = Math.max(0, removed.length - 40) + Math.max(0, added.length - 40);
  if (omitted) body.push(`[${omitted} more changed lines omitted]`);
  const text = `[snapshot delta unchanged=${unchanged} added=${added.length} removed=${removed.length}]\n${body.join('\n')}`;
  const useDelta = text.length < String(next || '').length * 0.75
    && (added.length + removed.length) < Math.max(nextLines.length, 1);
  return { useDelta, text };
}
