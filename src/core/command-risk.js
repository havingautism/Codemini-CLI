import { collectCommandTokens, firstToken } from './command-policy.js';
import { READ_ONLY_TOKENS, getReadOnlyCommandTokens } from './read-only-command-tokens.js';

export { READ_ONLY_TOKENS, getReadOnlyCommandTokens };

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

const SHELL_WRITE_SYNTAX_PATTERNS = [/>\s*\S/, />>\s*\S/, /\|&\s*\S/];

/* ── 核心分类逻辑 ──────────────────────────────────────────────── */

/**
 * 判断单个 token 是否为只读命令（含子命令检查）。
 */
function isReadOnlyToken(token, rawSegment, platform) {
  if (!READ_ONLY_TOKENS.has(token)) return false;
  if (platform !== 'win32') {
    if (
      token === 'find'
      && /(?:^|\s)-(?:delete|exec|execdir|ok|okdir)\b/i.test(String(rawSegment || ''))
    ) return false;
    if (token === 'date' && /(?:^|\s)(?:-s\b|--set(?:=|\s))/i.test(String(rawSegment || ''))) {
      return false;
    }
    if (token === 'sort' && /(?:^|\s)(?:-o\b|--output(?:=|\s))/i.test(String(rawSegment || ''))) {
      return false;
    }
    if (token === 'env') {
      const parts = String(rawSegment || '').trim().slice(token.length).trim().split(/\s+/).filter(Boolean);
      if (parts.some((part) => !part.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(part))) {
        return false;
      }
    }
  }

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
  if (
    platform !== 'win32'
    && (
      (token === 'git' && ['branch', 'tag', 'stash', 'remote', 'config'].includes(subcmd))
      || (token === 'npm' && subcmd === 'version')
      || (token === 'go' && subcmd === 'env')
    )
  ) return false;
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

function allSegmentsReadOnly(tokens, platform) {
  return tokens.length > 0 && tokens.every(({ token, raw }) => isReadOnlyToken(token, raw, platform));
}

/**
 * 分类命令风险等级。
 * @param {string} command
 * @param {string} [shellName='bash']
 * @returns {'read-only'|'write-high-risk'|'ambiguous'}
 */
export function classifyCommandRisk(command, shellName = 'bash', platform = process.platform) {
  const cmd = String(command || '').trim();
  if (!cmd) return 'read-only';

  /* 解析链式命令的每个 segment */
  const tokens = collectCommandTokens(cmd);
  if (tokens.length === 0) return 'ambiguous';

  if (platform !== 'win32' && SHELL_WRITE_SYNTAX_PATTERNS.some((pattern) => pattern.test(cmd))) {
    return 'write-high-risk';
  }

  // Pure inspectors first — so `rg install` / `git log --grep=commit` stay read-only
  // instead of being poisoned by HIGH_RISK_PATTERNS on the argument text.
  if (allSegmentsReadOnly(tokens, platform)) return 'read-only';

  /* 高风险 pattern 仅作用于非纯只读命令 */
  if (matchesHighRiskPattern(cmd)) return 'write-high-risk';

  let highestRisk = 'read-only';
  const RISK_ORDER = { 'read-only': 0, ambiguous: 1, 'write-high-risk': 2 };

  for (const { token, raw } of tokens) {
    if (isReadOnlyToken(token, raw, platform)) {
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
export function requiresApprovalEvaluation(command, shellName = 'bash', platform = process.platform) {
  return classifyCommandRisk(command, shellName, platform) !== 'read-only';
}

const ROUTINE_PROJECT_SCRIPTS = /^(?:build|check|dev|fmt|format|lint|preview|start|test|type-?check)(?::[\w.-]+)?$/i;

/** Commands whose purpose is clear enough to skip per-command LLM review on Windows. */
export function isRoutineProjectCommand(command) {
  const text = String(command || '').trim();
  if (!text || /[<>]|(?:^|\s)(?:~[\\/]|\.\.[\\/]|%[^%]+%|\$env:|\$[A-Za-z_])/i.test(text)) return false;

  const tokens = collectCommandTokens(text);
  return tokens.length > 0 && tokens.every(({ token, raw }) => {
    const tail = commandTail(raw);
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(token)) {
      const direct = tail.match(/^(?:run\s+)?([^\s]+)/i)?.[1] || '';
      return ROUTINE_PROJECT_SCRIPTS.test(direct);
    }
    if (token === 'node') return /^--(?:check|test)\b/i.test(tail);
    if (['python', 'python3', 'py'].includes(token)) return /^-m\s+(?:pytest|unittest)\b/i.test(tail);
    if (['pytest', 'vitest', 'jest', 'eslint', 'prettier', 'tsc'].includes(token)) return true;
    if (token === 'cargo') return /^(?:build|check|clippy|fmt|test)\b/i.test(tail);
    if (token === 'go') return /^(?:build|fmt|test|vet)\b/i.test(tail);
    if (token === 'dotnet') return /^(?:build|format|test)\b/i.test(tail);
    return false;
  });
}

function commandTail(raw = '') {
  const text = String(raw || '').trim();
  const executable = text.match(/^(?:"[^"]+"|'[^']+'|\S+)/)?.[0] || '';
  return text.slice(executable.length).trim();
}

/**
 * Deterministic effects the file sandbox does not make routine or recoverable.
 * These go straight to human approval; ordinary workspace writes rely on the sandbox.
 */
export function requiresDeterministicCommandApproval(command) {
  return collectCommandTokens(command).some(({ token, raw }) => {
    const tail = commandTail(raw);
    if (['sudo', 'doas', 'su', 'systemctl', 'service', 'launchctl', 'shutdown', 'reboot', 'halt', 'poweroff', 'kill', 'pkill', 'killall', 'ssh', 'scp'].includes(token)) return true;
    if (token === 'git') {
      return /^(?:(?:-[cC])\s+\S+\s+)*(?:push\b|reset\s+--hard\b|clean\b.*(?:--force|-[^\s]*f)|branch\s+-D\b|checkout\s+--\b)/i.test(tail);
    }
    if (['npm', 'pnpm', 'yarn'].includes(token)) return /^(?:install|add|remove|uninstall|publish)\b/i.test(tail);
    if (['pip', 'pip3'].includes(token)) return /^install\b/i.test(tail);
    if (token === 'cargo') return /^(?:install|publish)\b/i.test(tail);
    if (token === 'curl') return /(?:^|\s)(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b|(?:^|\s)(?:-d|--data(?:-raw|-binary|-urlencode)?|-[Tt]|--upload-file)(?:\s|=)/i.test(tail);
    if (token === 'wget') return /(?:^|\s)--(?:post-data|post-file|method)(?:\s|=)/i.test(tail);
    if (token === 'rm') return /(?:^|\s)(?:--recursive|-[^-\s]*r[^\s]*)(?:\s|$)/i.test(tail);
    if (token === 'find') return /(?:^|\s)-(?:delete|exec|execdir|ok|okdir)\b/i.test(tail);
    if (token === 'xargs') return /^rm\b/i.test(tail);
    if (['docker', 'podman'].includes(token)) return /^(?:rm|rmi|stop|kill|push|login|system\s+prune|volume\s+(?:rm|prune)|network\s+(?:rm|prune))\b/i.test(tail);
    if (token === 'kubectl') return /^(?:apply|create|delete|edit|patch|replace|scale|exec|port-forward|rollout\s+(?:restart|undo))\b/i.test(tail);
    if (token === 'gh') return /^(?:pr\s+(?:create|merge|close|reopen|review)|issue\s+(?:create|close|reopen|edit)|release\s+(?:create|delete|upload)|repo\s+(?:create|delete|archive))\b/i.test(tail);
    return false;
  });
}
