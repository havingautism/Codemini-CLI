const ALIAS_DESCRIPTION = /^\s*alias for [\w.]+\.?\s*$/i;

/**
 * Drop schema properties whose only text is "Alias for <name>".
 * Handlers still accept those aliases; the model is shown the canonical field.
 */
export function omitAliasProperties(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const next = { ...schema };
  if (next.items) next.items = omitAliasProperties(next.items);
  if (next.type === 'object' && next.properties && typeof next.properties === 'object') {
    const properties = {};
    for (const [key, value] of Object.entries(next.properties)) {
      const description = String(value?.description || '').trim();
      if (ALIAS_DESCRIPTION.test(description)) continue;
      properties[key] = omitAliasProperties(value);
    }
    next.properties = properties;
    if (Array.isArray(next.required)) {
      next.required = next.required.filter((name) => Object.prototype.hasOwnProperty.call(properties, name));
    }
  }
  return next;
}

export function compactToolDefinition(definition) {
  const parameters = definition?.function?.parameters;
  if (!parameters) return definition;
  return {
    ...definition,
    function: {
      ...definition.function,
      parameters: omitAliasProperties(parameters),
    },
  };
}
