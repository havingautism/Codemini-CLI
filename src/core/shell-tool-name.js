export function shellToolName({ platform = process.platform, shell = '' } = {}) {
  const normalized = String(shell || '').trim().toLowerCase();
  if (normalized === 'bash') return 'Bash';
  if (normalized === 'powershell' || normalized === 'pwsh') return 'Powershell';
  return platform === 'win32' ? 'Powershell' : 'Bash';
}

export function isShellToolName(name = '') {
  return ['run', 'bash', 'shell', 'powershell'].includes(String(name || '').trim().toLowerCase());
}

export function canonicalShellToolName(name = '') {
  return isShellToolName(name) ? 'run' : String(name || '').trim();
}

export function toolNameAllowed(allowed = [], name = '') {
  return allowed.includes(name) || (isShellToolName(name) && allowed.includes('run'));
}
