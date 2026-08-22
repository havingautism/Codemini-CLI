export const HOST_VERIFICATION_TOOL_NAME = 'run_host_verification';

export const HOST_VERIFICATION_PROGRAMS = Object.freeze([
  'npm', 'pnpm', 'yarn', 'bun', 'node',
  'python', 'py', 'pytest', 'uv',
  'cargo', 'go', 'dotnet',
  'mvn', 'mvnw', 'gradle', 'gradlew',
  'cmake', 'ctest',
]);

const SCRIPT_NAME_RE = /^(?:test|build|lint|check|typecheck)(?:$|[:_-])/i;
const PYTHON_MODULES = new Set(['pytest', 'unittest', 'compileall', 'mypy']);
const SIMPLE_ACTIONS = {
  cargo: new Set(['test', 'build', 'check', 'clippy']),
  go: new Set(['test', 'build', 'vet']),
  dotnet: new Set(['test', 'build']),
};
const MAVEN_GOALS = new Set(['test', 'verify', 'package', 'compile']);
const GRADLE_TASK_RE = /(?:^|:)(?:test|build|check|lint|assemble|compile\w*)$/i;
const WINDOWS_WRAPPERS = {
  mvnw: '.\\mvnw.cmd',
  gradlew: '.\\gradlew.bat',
};

function reject(program, args) {
  throw new Error(
    `${program} ${args.join(' ')} is not an allowed host verification command`,
  );
}

function packageScriptAllowed(program, args) {
  const first = String(args[0] || '').toLowerCase();
  if (first === 'test') return true;
  if (first === 'run' || first === 'run-script') {
    return SCRIPT_NAME_RE.test(String(args[1] || ''));
  }
  return ['pnpm', 'yarn', 'bun'].includes(program) && SCRIPT_NAME_RE.test(first);
}

function validate(program, args) {
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
    return packageScriptAllowed(program, args);
  }
  if (program === 'node') {
    return args[0] === '--check' || String(args[0] || '').startsWith('--test');
  }
  if (program === 'python' || program === 'py') {
    return args[0] === '-m' && PYTHON_MODULES.has(String(args[1] || '').toLowerCase());
  }
  if (program === 'pytest') return true;
  if (program === 'uv') {
    return args[0] === 'run'
      && ['python', 'py', 'pytest'].includes(String(args[1] || '').toLowerCase())
      && validate(String(args[1]).toLowerCase(), args.slice(2));
  }
  if (SIMPLE_ACTIONS[program]) {
    return SIMPLE_ACTIONS[program].has(String(args[0] || '').toLowerCase());
  }
  if (program === 'mvn' || program === 'mvnw') {
    const goals = args.filter((arg) => !String(arg).startsWith('-'));
    return goals.length > 0 && goals.every((goal) => MAVEN_GOALS.has(String(goal).toLowerCase()));
  }
  if (program === 'gradle' || program === 'gradlew') {
    const tasks = args.filter((arg) => !String(arg).startsWith('-'));
    return tasks.length > 0 && tasks.every((task) => GRADLE_TASK_RE.test(String(task)));
  }
  if (program === 'cmake') return args[0] === '--build';
  if (program === 'ctest') return true;
  return false;
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildHostVerificationCommand({ program, args = [] } = {}) {
  const normalizedProgram = String(program || '').trim().toLowerCase();
  const normalizedArgs = Array.isArray(args) ? args.map((arg) => String(arg)) : [];
  if (
    !HOST_VERIFICATION_PROGRAMS.includes(normalizedProgram)
    || normalizedArgs.length === 0
    || normalizedArgs.length > 100
    || normalizedArgs.some((arg) => arg.includes('\0') || arg.length > 2000)
    || !validate(normalizedProgram, normalizedArgs)
  ) {
    reject(normalizedProgram || 'unknown', normalizedArgs);
  }
  return {
    program: normalizedProgram,
    args: normalizedArgs,
    command: `& ${[
      WINDOWS_WRAPPERS[normalizedProgram] || normalizedProgram,
      ...normalizedArgs,
    ].map(quotePowerShell).join(' ')}`,
  };
}
