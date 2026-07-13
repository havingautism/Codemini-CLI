export function parseInput(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    return { type: 'empty' };
  }
  if (trimmed.startsWith('!')) {
    return { type: 'shell', command: trimmed.slice(1).trim() };
  }
  return { type: 'chat', text: trimmed };
}
