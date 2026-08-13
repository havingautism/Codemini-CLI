export const READ_ONLY_TOKENS = new Set([
  'ls', 'dir', 'tree', 'cat', 'head', 'tail', 'pwd', 'cd', 'wc', 'sort', 'uniq',
  'cut', 'tr', 'basename', 'dirname', 'test', 'true', 'false',
  'whoami', 'uname', 'date', 'env', 'printenv', 'hostname', 'which', 'where', 'where.exe',
  'stat', 'file', 'du', 'df', 'jq', 'hexdump', 'od', 'nl', 'less', 'more', 'man', 'help',
  'rg', 'find', 'grep', 'ag', 'ack', 'fd', 'bat',
  'get-childitem', 'gci', 'get-content', 'gc', 'get-location', 'gl', 'get-command', 'get-help',
  'get-item', 'gi', 'get-process', 'type', 'select-string', 'sls', 'select-object', 'select', 'where-object',
  'foreach-object', 'measure-object', 'sort-object', 'compare-object',
  'resolve-path', 'split-path', 'test-path', 'write-host',
  'git',
  'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3', 'node', 'nodejs', 'python', 'python3', 'py',
  'cargo', 'go', 'dotnet', 'ruby', 'php',
  'echo', 'printf', 'seq',
]);

export function getReadOnlyCommandTokens() {
  return [...READ_ONLY_TOKENS].sort();
}
