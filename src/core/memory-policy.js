const SECRET_PATTERNS = [
  /\b(api[_-]?key|token|secret|password|passwd|bearer)\b/i,
  /\b(database_url|aws_secret_access_key|aws_access_key_id|openai_api_key|github_token|github_pat|slack_bot_token)\b\s*[:=]\s*\S+/i,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s]+@/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[a-z0-9]{20,}\b/i,
  /\bgithub_pat_[a-z0-9_]{20,}\b/i,
  /\bglpat-[a-z0-9_-]{20,}\b/i,
  /\bsk-[a-z0-9]{8,}\b/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/i
];

/** Persistent memory scopes (single taxonomy for tools, store, dream, UI). */
export const MEMORY_SCOPES = Object.freeze(['user', 'global', 'project']);

/**
 * Four broad kinds — enough for routing/lifecycle, details live in content.
 * - preference: user tastes, interests, habits, interaction style
 * - convention: durable project/tool workflows and rules
 * - lesson: corrections and reusable learnings from failures/wins
 * - note: other durable facts that do not fit above
 */
export const MEMORY_KINDS = Object.freeze(['preference', 'convention', 'lesson', 'note']);

const USER_PROFILE_KINDS = new Set(['preference']);
const LONGTERM_KINDS = new Set(['preference', 'convention']);
const OPERATIONAL_KINDS = new Set(['lesson', 'note']);

/** Map legacy fine-grained kinds onto the four buckets. */
const KIND_ALIASES = Object.freeze({
  interest: 'preference',
  habit: 'preference',
  hobby: 'preference',
  likes: 'preference',
  style: 'preference',
  workflow: 'convention',
  pattern: 'convention',
  decision: 'convention',
  architecture: 'convention',
  win: 'lesson',
  correction: 'lesson',
  failure: 'lesson',
  gap: 'lesson',
  observation: 'note',
  module: 'note'
});

export function normalizeMemoryText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function isSensitiveMemoryContent(value) {
  const text = normalizeMemoryText(value);
  if (!text) return false;
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function assertSafeMemoryContent(value) {
  if (isSensitiveMemoryContent(value)) {
    throw new Error('Refusing to store sensitive or secret-like memory content');
  }
}

export function summarizeMemoryContent(value, maxChars = 72) {
  const text = normalizeMemoryText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

/**
 * Normalize persistent / inbox scope. Legacy aliases: repo|thread → project.
 */
export function normalizeMemoryScope(value, { fallback = 'project' } = {}) {
  const scope = String(value || '').trim().toLowerCase();
  if (scope === 'repo' || scope === 'thread') return 'project';
  if (MEMORY_SCOPES.includes(scope)) return scope;
  return fallback;
}

export function normalizeMemoryKind(value, fallback = 'note') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  const aliased = KIND_ALIASES[raw] || raw;
  if (MEMORY_KINDS.includes(aliased)) return aliased;
  return fallback;
}

/** Infer scope when the model omits it: preference → user, else project. */
export function inferMemoryScope({ scope, kind } = {}) {
  const explicit = String(scope || '').trim();
  if (explicit) return normalizeMemoryScope(explicit, { fallback: 'project' });
  const normalizedKind = normalizeMemoryKind(kind, 'note');
  if (USER_PROFILE_KINDS.has(normalizedKind)) return 'user';
  return 'project';
}

export function chooseMemoryLifecycle(kind) {
  const value = normalizeMemoryKind(kind, 'note');
  if (LONGTERM_KINDS.has(value)) return 'longterm';
  if (OPERATIONAL_KINDS.has(value)) return 'operational';
  return 'operational';
}

export function isUserProfileKind(kind) {
  return USER_PROFILE_KINDS.has(normalizeMemoryKind(kind, ''));
}

const PROJECT_HINT_PATTERN =
  /(?:本项目|这个项目|当前项目|这个仓库|当前仓库|\brepo\b|\brepository\b|\bproject\b)/i;

const GLOBAL_HINT_PATTERN =
  /(?:跨项目|所有项目|任何项目|通用规则|全局规则|系统环境|操作系统|\bwindows\b|\bpowershell\b|\bwsl\b|\bbash\b|\blinux\b|\bmacos\b)/i;

const EXPLICIT_MEMORY_PATTERN =
  /(?:请记住|记住这点|长期记住|以后(?:都|请|不要|别)|今后(?:都|请|不要|别)|后续(?:都|请|不要|别)|always remember|remember that|from now on)/i;

const PREFERENCE_PATTERN =
  /(?:我偏好|我的偏好|我喜欢|我爱|我爱好|我习惯|感兴趣|兴趣是|平时喜欢|我更喜欢|我讨厌|我不喜欢|我受不了|i prefer|my preference|i like|i love|i enjoy|i'?m into|i am into|my hobby|hobbies|favorite|favourite|i hate|i dislike)/i;

const PERSONAL_FACT_PATTERN =
  /(?:我叫|我的名字|我是(?:一名|一个)?|我住在|我的职业|我的身份|my name is|i am an?\b|i live in|my role is)/i;

const LESSON_PATTERN =
  /(?:经验|教训|根因|原因是|解决办法|解决方法|修复方法|避免踩坑|失败是因为|报错是因为|不支持|不能直接|lesson|root cause|workaround|failed because|error occurs because|does not support|doesn't support)/i;

const CURRENT_TASK_PATTERN =
  /(?:这次|本次|当前任务|这个任务|先不要|暂时不要|目前不要|for this task|this time|for now)/i;

/**
 * High-intent user utterances that should be saved via save_memory by the model
 * (not auto-written by the runtime). Also used to keep these out of the soft
 * dream inbox capture path.
 * Returns null when the text is not a clear preference / interest / remember directive.
 */
export function classifyDirectMemoryPrompt(text) {
  const value = normalizeMemoryText(text);
  if (value.length < 6) return null;

  const isExplicitMemory = EXPLICIT_MEMORY_PATTERN.test(value);
  const isPreference = PREFERENCE_PATTERN.test(value);
  const isPersonalFact = PERSONAL_FACT_PATTERN.test(value);
  const isLesson = LESSON_PATTERN.test(value);
  if (!isExplicitMemory && !isPreference) return null;
  if (CURRENT_TASK_PATTERN.test(value) && !isExplicitMemory) return null;

  const scope = PROJECT_HINT_PATTERN.test(value)
    ? 'project'
    : GLOBAL_HINT_PATTERN.test(value)
      ? 'global'
      : 'user';

  const kind = isPreference
    ? 'preference'
    : isLesson
      ? 'lesson'
      : isPersonalFact
        ? 'note'
        : scope === 'user'
          ? 'note'
          : 'convention';

  return {
    scope,
    kind,
    content: value
  };
}

/** Softer task prompts worth staging in inbox for dream (not direct durable write). */
export function shouldAutoCaptureUserPrompt(text) {
  const value = normalizeMemoryText(text);
  if (value.length < 12) return false;
  if (classifyDirectMemoryPrompt(value)) return false;
  return /\b(add|build|fix|implement|change|update|refactor|test|debug|remember|capture|continue|review)\b|实现|增加|添加|修复|修改|更新|重构|测试|调试|记住|继续|检查|沉淀|捕获/i.test(
    value
  );
}
