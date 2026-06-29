export function parseInput(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: 'empty' };
  }
  const skillMatch = trimmed.match(/^skill:\[([^\]]*)\]\s*(.*)$/is);
  if (skillMatch) {
    const skills = [...new Set(
      skillMatch[1]
        .split(',')
        .map((name) => name.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    )];
    return { type: 'skill', skills, text: skillMatch[2].trim(), full: trimmed };
  }
  const commandMatch = trimmed.match(/^command:\[([^\]]+)\]\s*(.*)$/is);
  if (commandMatch) {
    const command = commandMatch[1].trim().replace(/^["']|["']$/g, '');
    const args = commandMatch[2].trim().split(/\s+/).filter(Boolean);
    return {
      type: 'slash',
      command,
      args,
      full: [command, ...args].join(' '),
      syntax: 'directive'
    };
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
