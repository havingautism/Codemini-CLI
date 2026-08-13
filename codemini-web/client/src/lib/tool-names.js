export function isShellToolName(name = '') {
  const base = String(name || '').trim().split('(', 1)[0].toLowerCase();
  return ['run', 'bash', 'shell', 'powershell'].includes(base);
}
