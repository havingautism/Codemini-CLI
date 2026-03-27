export function parseInput(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: 'empty' };
  }
  if (trimmed.startsWith('!')) {
    return { type: 'shell', command: trimmed.slice(1).trim() };
  }
  if (trimmed.startsWith('/')) {
    const body = trimmed.slice(1).trim();
    const [command = '', ...args] = body.split(/\s+/);
    return { type: 'slash', command, args, full: body };
  }
  return { type: 'chat', text: trimmed };
}
