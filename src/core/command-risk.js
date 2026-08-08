import { collectCommandTokens, firstToken } from './command-policy.js';

/* ── 只读命令 token ───────────────────────────────────────────── */
export const READ_ONLY_TOKENS = new Set([
  'ls', 'dir', 'tree', 'cat', 'head', 'tail', 'pwd', 'wc', 'sort', 'uniq',
  'cut', 'tr', 'basename', 'dirname', 'test', 'true', 'false',
  'whoami', 'uname', 'date', 'env', 'printenv', 'hostname', 'which', 'where', 'where.exe',
  'stat', 'file', 'du', 'df', 'jq', 'hexdump', 'od', 'nl', 'less', 'more', 'man', 'help',
  'rg', 'find', 'grep', 'ag', 'ack', 'fd', 'bat',
  'get-childitem', 'gci', 'get-content', 'gc', 'get-location', 'gl', 'get-command', 'get-help',
  'get-item', 'gi', 'get-process', 'type', 'select-string', 'sls', 'select-object', 'select', 'where-object',
  'foreach-object', 'measure-object', 'sort-object', 'compare-object',
  'resolve-path', 'test-path',
  'git',
  'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3', 'node', 'nodejs', 'python', 'python3', 'py',
  'cargo', 'go', 'dotnet', 'ruby', 'php',
  'echo', 'printf', 'seq', 'yes'
]);

export function getReadOnlyCommandTokens() {
  return [...READ_ONLY_TOKENS].sort();
}

/* 只读时需要检查子命令的 token */
const READ_ONLY_SUBCOMMANDS = {
  git: new Set([
    'status', 'log', 'diff', 'branch', 'show', 'tag', 'stash',
    'list', 'remote', 'rev-parse', 'describe', 'blame',
    'shortlog', 'count', 'ls-files', 'ls-remote', 'ls-tree',
    'config', '--version', 'var', 'for-each-ref', 'name-rev',
    'merge-base', 'cherry'
  ]),
  // Package managers: inspection only. install/run/test stay out and hit LLM/heuristic.
  npm: new Set(['list', 'ls', 'view', 'info', 'outdated', 'explain', 'why', 'version']),
  npx: new Set(['--version']),
  pnpm: new Set(['list', 'ls', 'why', 'view', 'info', 'outdated', 'version']),
  yarn: new Set(['list', 'why', 'info', 'outdated', 'version']),
  pip: new Set(['list', 'show', 'freeze', 'index']),
  pip3: new Set(['list', 'show', 'freeze', 'index']),
  cargo: new Set(['tree', 'metadata', 'version', 'search']),
  go: new Set(['list', 'version', 'env', 'doc', 'help']),
  dotnet: new Set(['--info', '--list-sdks', '--list-runtimes', '--version']),
  // Interpreters: version probes only. `-e`/`-c`/script paths fall through as ambiguous.
  node: new Set(['--version']),
  nodejs: new Set(['--version']),
  python: new Set(['--version']),
  python3: new Set(['--version']),
  py: new Set(['--version']),
  ruby: new Set(['--version']),
  php: new Set(['--version']),
};

/* ── 高风险 pattern（仅用于非纯只读命令；避免 `rg install` 误伤）── */
const HIGH_RISK_PATTERNS = [
  /\binstall\b/i,
  /\bpublish\b/i,
  /\bpush\b/i,
  /\bcommit\b/i,
  /\brebase\b/i,
  /\breset\s/i,
  /\bcheckout\s+--/i,
  /\brm\b/i,
  /\bdel\b/i,
  /\bmkdi[ri]\b/i,
  /\btouch\b/i,
  /\bcp\b/i,
  /\bmv\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bmktemp\b/i,
  /\btee\b/i,
  /\bsudo\b/i,
  /\bsu\b/,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bcurl\s+.*-[A-Z]\s*(POST|PUT|DELETE|PATCH)/i,
  /\bwget\b/i,
  /\bdocker\s+(rm|stop|kill|rmi)\b/i,
  /\bsystemctl\b/i,
  /\bservice\b/i,
  /\blaunchctl\b/i,
  />\s*\S/,
  />>\s*\S/,
  /\|&\s*\S/
];

/* ── 核心分类逻辑 ──────────────────────────────────────────────── */

/**
 * 判断单个 token 是否为只读命令（含子命令检查）。
 */
function isReadOnlyToken(token, rawSegment) {
  if (!READ_ONLY_TOKENS.has(token)) return false;

  /* 需要 子命令 校验的 token */
  const allowedSubs = READ_ONLY_SUBCOMMANDS[token];
  if (!allowedSubs) return true; // 如 ls, pwd 等本身只读

  /* 提取子命令：去掉 token 后第一个非 flag 参数 */
  const rest = String(rawSegment || '').trim().slice(token.length).trim();
  const parts = rest.split(/\s+/).filter(Boolean);
  /* 以 - 开头的 flag 视为安全，取第一个非 flag 参数 */
  let subcmd = '';
  for (const part of parts) {
    if (part.startsWith('-')) {
      // Bare version probes: `node --version`, `dotnet --info`
      if (allowedSubs.has(part)) return true;
      continue;
    }
    subcmd = part;
    break;
  }
  /* 只有 token 本身或全部是 flags → 视为安全（version-style probes） */
  if (!subcmd) return true;
  if (allowedSubs.has(subcmd)) return true;
  /* 子命令 不在白名单 → 不确定 */
  return false;
}

/**
 * 对命令文本做快速 高风险 pattern 扫描。
 */
function matchesHighRiskPattern(text) {
  return HIGH_RISK_PATTERNS.some((p) => p.test(text));
}

function allSegmentsReadOnly(tokens) {
  return tokens.length > 0 && tokens.every(({ token, raw }) => isReadOnlyToken(token, raw));
}

/**
 * 分类命令风险等级。
 * @param {string} command
 * @param {string} [shellName='bash']
 * @returns {'read-only'|'write-high-risk'|'ambiguous'}
 */
export function classifyCommandRisk(command, shellName = 'bash') {
  const cmd = String(command || '').trim();
  if (!cmd) return 'read-only';

  /* 解析链式命令的每个 segment */
  const tokens = collectCommandTokens(cmd);
  if (tokens.length === 0) return 'ambiguous';

  // Pure inspectors first — so `rg install` / `git log --grep=commit` stay read-only
  // instead of being poisoned by HIGH_RISK_PATTERNS on the argument text.
  if (allSegmentsReadOnly(tokens)) return 'read-only';

  /* 高风险 pattern 仅作用于非纯只读命令 */
  if (matchesHighRiskPattern(cmd)) return 'write-high-risk';

  let highestRisk = 'read-only';
  const RISK_ORDER = { 'read-only': 0, ambiguous: 1, 'write-high-risk': 2 };

  for (const { token, raw } of tokens) {
    if (isReadOnlyToken(token, raw)) {
      /* 保持当前级别 */
    } else {
      /* 不在只读集合 → 至少 ambiguous */
      const segRisk = matchesHighRiskPattern(raw) ? 'write-high-risk' : 'ambiguous';
      if (RISK_ORDER[segRisk] > RISK_ORDER[highestRisk]) {
        highestRisk = segRisk;
      }
    }
  }

  return highestRisk;
}

/**
 * 是否需要进入审批评估流程。
 * 只读命令跳过，其余都需要。
 */
export function requiresApprovalEvaluation(command, shellName = 'bash') {
  return classifyCommandRisk(command, shellName) !== 'read-only';
}
