// Parse the model-facing read envelope for presentation only. Never change the
// persisted tool result or infer line numbers across an omitted/gapped window.
export function parseReadToolPreview(output) {
  if (typeof output !== 'string') return null;
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  if (!/^\[(?:File|AST): .+\]$/.test(lines[0] || '')) return null;
  const header = lines[0];
  const source = [];
  let startLine;
  let index = 1;
  for (; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\d+):(?: (.*))?$/);
    if (!match) break;
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number < 1) return null;
    startLine ??= number;
    if (number !== startLine + source.length) return null;
    source.push(match[2] ?? '');
  }
  if (source.length === 0) return null;
  const footer = lines.slice(index).join('\n').trim();
  // An older head/tail preview is not a continuous source window.
  if (/^\d+:/m.test(footer) || /\[omitted\b/.test(footer)) return null;
  return { header, content: source.join('\n'), startLine, footer };
}
