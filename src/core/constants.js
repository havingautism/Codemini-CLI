/**
 * 项目级共享常量。
 * 所有需要在多个模块间复用的目录集、扩展名集、语言映射等统一在此定义。
 */

// ─── 记忆工具（审阅模式下免确认）────────────────────────────────────
export const MEMORY_ALWAYS_ALLOW_TOOLS = [
  'save_memory',
  'list_memory',
  'search_memory',
  'forget_memory',
  'dream_consolidate'
];

// ─── 工具遍历跳过的目录（glob / list / grep 等）─────────────────────
export const TOOL_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.codemini',
  '.codemini-global',
  'dist',
  'coverage'
]);

// ─── 项目索引跳过的目录（更宽，包含构建产物和临时目录）──────────────
export const INDEX_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.codemini',
  '.codemini-global',
  '.venv',
  'venv',
  'env',
  '.env',
  'virtualenv',
  'site-packages',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.pnpm',
  'dist',
  'coverage',
  'benchmark',
  'benchmarks',
  'sessions',
  'tmp',
  'temp',
  '.cache',
  '.turbo',
  '.next',
  '.gradle',
  'build',
  'out',
  'logs',
  'artifacts',
  'vendor',
  'third_party'
]);

// ─── 文本扩展名 ──────────────────────────────────────────────────────
export const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.css',
  '.scss',
  '.html',
  '.yml',
  '.yaml',
  '.sh',
  '.ps1',
  '.c',
  '.h',
  '.cpp',
  '.cc',
  '.cxx',
  '.hpp',
  '.hh',
  '.bash',
  '.php'
]);

// ─── 源码扩展名（用于项目索引）──────────────────────────────────────
export const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh',
  '.sh', '.bash', '.java', '.rs', '.cs', '.php', '.rb'
]);

// ─── 需要写入守卫的代码扩展名 ───────────────────────────────────────
export const CODE_WRITE_GUARD_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.css',
  '.scss',
  '.html',
  '.sh',
  '.ps1'
]);

// ─── 扩展名 -> 语言（标准化） ────────────────────────────────────────
export const EXTENSION_LANGUAGE_MAP = {
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.py': 'python',
  '.go': 'go',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.java': 'java',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.sh': 'bash',
  '.bash': 'bash'
};

// ─── 语言别名 -> 标准语言名 ──────────────────────────────────────────
export const LANGUAGE_ALIASES = {
  javascript: 'js',
  js: 'js',
  jsx: 'js',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  python: 'python',
  py: 'python',
  go: 'go',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  java: 'java',
  rust: 'rust',
  rs: 'rust',
  csharp: 'csharp',
  'c#': 'csharp',
  cs: 'csharp',
  php: 'php',
  ruby: 'ruby',
  rb: 'ruby'
};

// ─── 工具 schema 用的语言 -> 文件类型列表 ─────────────────────────────
export const LANGUAGE_FILE_TYPES = {
  js: ['js', 'jsx', 'mjs', 'cjs'],
  ts: ['ts', 'tsx'],
  py: ['py'],
  python: ['py'],
  md: ['md'],
  json: ['json'],
  css: ['css', 'scss'],
  html: ['html'],
  java: ['java'],
  csharp: ['cs'],
  cs: ['cs'],
  go: ['go'],
  rust: ['rs'],
  ruby: ['rb'],
  shell: ['sh', 'ps1'],
  yaml: ['yml', 'yaml']
};
