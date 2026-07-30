export function buildTerminalColorEnv(baseEnv = process.env) {
  const env = {
    ...baseEnv,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
    FORCE_COLOR: '1',
  };
  delete env.NO_COLOR;
  return env;
}

export function buildPowerShellColorBootstrap() {
  const fileGroups = [
    {
      color: 'BrightCyan',
      extensions: [
        '.c', '.cc', '.cpp', '.cs', '.dart', '.go', '.h', '.hpp', '.java',
        '.js', '.jsx', '.kt', '.kts', '.php', '.ps1', '.py', '.rb', '.rs',
        '.swift', '.ts', '.tsx', '.vue',
      ],
    },
    {
      color: 'BrightYellow',
      extensions: [
        '.conf', '.config', '.env', '.ini', '.json', '.lock', '.properties',
        '.toml', '.xml', '.yaml', '.yml',
      ],
    },
    {
      color: 'BrightGreen',
      extensions: ['.md', '.mdx', '.rst', '.txt'],
    },
    {
      color: 'BrightMagenta',
      extensions: [
        '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.pdf', '.png', '.svg',
        '.webp',
      ],
    },
    {
      color: 'BrightRed',
      extensions: ['.7z', '.bz2', '.gz', '.rar', '.tar', '.tgz', '.zip'],
    },
  ];
  const extensionAssignments = fileGroups
    .flatMap(({ color, extensions }) =>
      extensions.map(
        (extension) =>
          `$PSStyle.FileInfo.Extension['${extension}']=$PSStyle.Foreground.${color}`,
      ),
    )
    .join(';');

  return [
    'Import-Module PSReadLine -ErrorAction SilentlyContinue',
    'Set-PSReadLineOption -HistorySaveStyle SaveNothing -ErrorAction SilentlyContinue',
    'if ($null -ne (Get-Variable PSStyle -ErrorAction SilentlyContinue)) {',
    "$PSStyle.OutputRendering='Ansi'",
    '$PSStyle.FileInfo.Directory=$PSStyle.Foreground.BrightBlue',
    '$PSStyle.FileInfo.SymbolicLink=$PSStyle.Foreground.BrightMagenta',
    '$PSStyle.FileInfo.Executable=$PSStyle.Foreground.BrightGreen',
    extensionAssignments,
    [
      'Set-PSReadLineOption -Colors @{',
      "Command=$PSStyle.Foreground.BrightCyan;",
      "Parameter=$PSStyle.Foreground.BrightYellow;",
      "String=$PSStyle.Foreground.BrightGreen;",
      "Variable=$PSStyle.Foreground.BrightMagenta;",
      "Number=$PSStyle.Foreground.BrightBlue;",
      "Type=$PSStyle.Foreground.Cyan;",
      "Comment=$PSStyle.Foreground.BrightBlack;",
      "Error=$PSStyle.Foreground.BrightRed",
      '} -ErrorAction SilentlyContinue',
    ].join(''),
    '}',
  ].join(';');
}
